import { invoke } from "@tauri-apps/api/core";
import type { DbClient } from "../database/database";
import { parseVdf, collectNestedStrings, VdfObject } from "../utils/vdfParser";
import { normalizeTitle } from "../importers/SpreadsheetImporter";

/**
 * Detects games actually present on disk — Steam and Epic installs, and
 * ROM files in user-configured folders — and matches them back to the
 * library by title.
 *
 * Multi-drive handling (the specific thing to get right here):
 *  - Steam keeps one central `libraryfolders.vdf` inside the main Steam
 *    install that lists every additional library folder's absolute
 *    path, wherever they are — that one file is enough to find
 *    everything regardless of how many drives are involved.
 *  - Epic's manifest files always live in one fixed location
 *    (%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests) no matter
 *    which drive a given game is actually installed on — each manifest
 *    just stores that game's real install path directly.
 *  - ROM folders are whatever the user explicitly configures (plural,
 *    not singular — see Settings), so multiple drives just means
 *    configuring one folder per drive.
 *
 * UNVERIFIED end-to-end: built without a Windows machine or a real
 * Steam/Epic install to test against. The VDF/JSON formats themselves
 * are well-documented and very stable, but this hasn't been run for
 * real — worth a first real scan being treated as the actual test.
 */

export interface DetectedGame {
  source: "steam" | "epic";
  title: string;
  installPath: string;
  sourceId: string;
}

export interface MatchedGame extends DetectedGame {
  matchedGameId: string | null;
  matchedTitle: string | null;
  matchedCoverArtUrl: string | null;
  matchedViaOverride: boolean;
}

export interface DetectedRom {
  sourceId: string; // the file path — ROMs have no other stable identifier
  filePath: string;
  fileName: string;
  guessedTitle: string;
  console: string | null;
}

export interface MatchedRom extends DetectedRom {
  matchedGameId: string | null;
  matchedTitle: string | null;
  matchedCoverArtUrl: string | null;
  matchedViaOverride: boolean;
}

export type DetectedSourceType = "steam" | "epic" | "rom";

/** Reads every persisted manual match at once — cheap enough to load in
 * full and key by "sourceType:sourceId" in memory, rather than a
 * per-item round trip during matching. */
export async function getDetectedGameOverrides(db: DbClient): Promise<Map<string, string>> {
  const rows = await db.select<{ SourceType: string; SourceId: string; GameId: string }>(
    `SELECT SourceType, SourceId, GameId FROM DetectedGameOverrides`
  );
  return new Map(rows.map((r) => [`${r.SourceType}:${r.SourceId}`, r.GameId]));
}

export async function setDetectedGameOverride(
  db: DbClient,
  sourceType: DetectedSourceType,
  sourceId: string,
  gameId: string
): Promise<void> {
  await db.execute(
    `
    INSERT INTO DetectedGameOverrides (SourceType, SourceId, GameId) VALUES (?, ?, ?)
    ON CONFLICT(SourceType, SourceId) DO UPDATE SET GameId = excluded.GameId
    `,
    [sourceType, sourceId, gameId]
  );
}

export async function clearDetectedGameOverride(
  db: DbClient,
  sourceType: DetectedSourceType,
  sourceId: string
): Promise<void> {
  await db.execute(`DELETE FROM DetectedGameOverrides WHERE SourceType = ? AND SourceId = ?`, [
    sourceType,
    sourceId,
  ]);
}

const DEFAULT_STEAM_PATHS = ["C:\\Program Files (x86)\\Steam", "C:\\Program Files\\Steam"];

async function resolveSteamPath(manualOverride: string | null): Promise<string | null> {
  if (manualOverride && manualOverride.trim()) return manualOverride.trim();

  const registryPath = await invoke<string | null>("find_steam_path");
  if (registryPath) return registryPath;

  for (const candidate of DEFAULT_STEAM_PATHS) {
    const exists = await invoke<boolean>("file_exists", {
      path: `${candidate}\\steamapps\\libraryfolders.vdf`,
    });
    if (exists) return candidate;
  }
  return null;
}

/** Case/trailing-slash-insensitive dedup key for comparing Windows
 * paths that may come from different sources (registry vs. a VDF file)
 * and could differ in casing or a trailing separator while referring to
 * the exact same folder. */
function normalizePath(path: string): string {
  return path.trim().replace(/[\\/]+$/, "").toLowerCase();
}

/** Steam-specific note: installdir in appmanifest_*.acf is relative to
 * <library>\steamapps\common\, not an absolute path — this builds the
 * real absolute path from the pieces. */
export async function scanSteamGames(manualPathOverride: string | null = null): Promise<DetectedGame[]> {
  const steamPath = await resolveSteamPath(manualPathOverride);
  if (!steamPath) {
    throw new Error(
      "Couldn't locate a Steam install automatically. Set the Steam install path manually in Settings."
    );
  }

  const libraryFoldersPath = `${steamPath}\\steamapps\\libraryfolders.vdf`;
  const text = await invoke<string>("read_text_file", { path: libraryFoldersPath });
  const parsed = parseVdf(text);
  const foldersObj = (parsed["libraryfolders"] ?? parsed["LibraryFolders"]) as VdfObject | undefined;

  const rawRoots = foldersObj ? collectNestedStrings(foldersObj, "path") : [];
  // Some Steam versions' libraryfolders.vdf only lists *additional*
  // libraries beyond the main install — make sure the main one is
  // always included even if it's missing from that list.
  if (!rawRoots.some((r) => normalizePath(r) === normalizePath(steamPath))) {
    rawRoots.unshift(steamPath);
  }

  // Dedupe by normalized path — a real, reported bug: the registry path
  // and the VDF's own listed path for the same library can differ in
  // casing or a trailing slash even when they mean the same folder,
  // which meant that folder got scanned twice and every game in it
  // showed up twice in the results.
  const seenRoots = new Set<string>();
  const libraryRoots = rawRoots.filter((r) => {
    const key = normalizePath(r);
    if (seenRoots.has(key)) return false;
    seenRoots.add(key);
    return true;
  });

  const games: DetectedGame[] = [];
  for (const root of libraryRoots) {
    let manifestFiles: string[];
    try {
      manifestFiles = await invoke<string[]>("list_files_recursive", {
        root: `${root}\\steamapps`,
        extensions: ["acf"],
        maxDepth: 0,
      });
    } catch {
      continue; // a configured library folder that's since been removed/unmounted shouldn't abort the whole scan
    }

    for (const manifestPath of manifestFiles) {
      try {
        const manifestText = await invoke<string>("read_text_file", { path: manifestPath });
        const appState = parseVdf(manifestText)["AppState"] as VdfObject | undefined;
        const name = appState?.["name"];
        const appid = appState?.["appid"];
        const installdir = appState?.["installdir"];
        if (typeof name !== "string" || typeof appid !== "string") continue;

        games.push({
          source: "steam",
          title: name,
          installPath: typeof installdir === "string" ? `${root}\\steamapps\\common\\${installdir}` : root,
          sourceId: appid,
        });
      } catch {
        continue; // one corrupt/unreadable manifest shouldn't abort the whole scan
      }
    }
  }

  // Final safety net regardless of the root cause above: never return
  // two entries with the same Steam appid.
  return dedupeBySourceId(games);
}

export function dedupeBySourceId<T extends { sourceId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.sourceId)) return false;
    seen.add(item.sourceId);
    return true;
  });
}

const EPIC_MANIFESTS_DIR = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";

export async function scanEpicGames(): Promise<DetectedGame[]> {
  let files: string[];
  try {
    files = await invoke<string[]>("list_files_recursive", {
      root: EPIC_MANIFESTS_DIR,
      extensions: ["item"],
      maxDepth: 0,
    });
  } catch {
    return []; // Epic not installed at all is a normal outcome, not an error
  }

  const games: DetectedGame[] = [];
  for (const filePath of files) {
    try {
      const text = await invoke<string>("read_text_file", { path: filePath });
      const manifest = JSON.parse(text) as {
        DisplayName?: string;
        InstallLocation?: string;
        AppName?: string;
        CatalogItemId?: string;
      };
      if (!manifest.DisplayName || !manifest.InstallLocation) continue;
      games.push({
        source: "epic",
        title: manifest.DisplayName,
        installPath: manifest.InstallLocation,
        sourceId: manifest.AppName ?? manifest.CatalogItemId ?? filePath,
      });
    } catch {
      continue;
    }
  }
  return dedupeBySourceId(games);
}

// Extension -> display console name. Deliberately not exhaustive — the
// common cartridge/handheld formats are unambiguous, but several disc
// formats (.iso/.bin/.cue/.chd) are shared across multiple real
// consoles (PS1, PS2, GameCube, Dreamcast, Wii...) with no way to tell
// which from the extension alone, so those get a generic label instead
// of a guess that would often be wrong.
const ROM_EXTENSIONS: Record<string, string> = {
  nes: "NES",
  fds: "NES",
  sfc: "SNES",
  smc: "SNES",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  n64: "Nintendo 64",
  z64: "Nintendo 64",
  v64: "Nintendo 64",
  nds: "Nintendo DS",
  "3ds": "Nintendo 3DS",
  cia: "Nintendo 3DS",
  wbfs: "Wii",
  rvz: "Wii / GameCube",
  gcm: "GameCube",
  xci: "Nintendo Switch",
  nsp: "Nintendo Switch",
  md: "Sega Genesis",
  gen: "Sega Genesis",
  smd: "Sega Genesis",
  gg: "Game Gear",
  "32x": "Sega 32X",
  pbp: "PlayStation",
  iso: "Disc image (PS1/PS2/GameCube/Wii/etc.)",
  cue: "Disc image (PS1/PS2/etc.)",
  bin: "Disc image (PS1/PS2/etc.)",
  chd: "Disc image (PS1/PS2/Dreamcast/etc.)",
};

/** Strips extension and common ROM-naming tags — region/language in
 * parens ("(USA)", "(En,Fr,De)"), verification tags in brackets
 * ("[!]"), underscores/dots used as spaces — down to a clean guessed
 * title. Not perfect (ROM naming conventions vary a lot across
 * scene/archive sources), but a reasonable general-purpose cleanup. */
export function cleanRomTitle(fileName: string): string {
  let name = fileName.replace(/\.[^.]+$/, "");
  name = name.replace(/\([^)]*\)/g, "");
  name = name.replace(/\[[^\]]*\]/g, "");
  name = name.replace(/[_.]+/g, " ");
  return name.replace(/\s+/g, " ").trim();
}

export async function scanRomFolder(folderPath: string): Promise<DetectedRom[]> {
  const extensions = Object.keys(ROM_EXTENSIONS);
  const files = await invoke<string[]>("list_files_recursive", {
    root: folderPath,
    extensions,
    maxDepth: 6, // deep enough for console/region-organized collections without risking a runaway scan
  });

  return files.map((filePath) => {
    const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    return {
      sourceId: filePath,
      filePath,
      fileName,
      guessedTitle: cleanRomTitle(fileName),
      console: ROM_EXTENSIONS[ext] ?? null,
    };
  });
}

/** Automatic normalized-title match, with any persisted manual override
 * (see getDetectedGameOverrides) taking priority when one exists —
 * consistent with the same "automatic first, manual override layered on
 * top" pattern used for Series Completion's equivalence matching. */
export function matchToLibrary<T extends { sourceId: string; title?: string; guessedTitle?: string }>(
  detected: T[],
  sourceType: DetectedSourceType,
  libraryGames: { id: string; title: string; coverArtUrl: string | null }[],
  overrides: Map<string, string>
): (T & { matchedGameId: string | null; matchedTitle: string | null; matchedCoverArtUrl: string | null; matchedViaOverride: boolean })[] {
  const byId = new Map(libraryGames.map((g) => [g.id, g]));
  const byNormalizedTitle = new Map(libraryGames.map((g) => [normalizeTitle(g.title), g]));

  return detected.map((d) => {
    const overrideGameId = overrides.get(`${sourceType}:${d.sourceId}`);
    const overrideMatch = overrideGameId ? byId.get(overrideGameId) : undefined;
    if (overrideMatch) {
      return {
        ...d,
        matchedGameId: overrideMatch.id,
        matchedTitle: overrideMatch.title,
        matchedCoverArtUrl: overrideMatch.coverArtUrl,
        matchedViaOverride: true,
      };
    }

    const titleToMatch = d.title ?? d.guessedTitle ?? "";
    const autoMatch = byNormalizedTitle.get(normalizeTitle(titleToMatch));
    return {
      ...d,
      matchedGameId: autoMatch?.id ?? null,
      matchedTitle: autoMatch?.title ?? null,
      matchedCoverArtUrl: autoMatch?.coverArtUrl ?? null,
      matchedViaOverride: false,
    };
  });
}

export interface InstalledGame {
  gameId: string;
  title: string;
  coverArtUrl: string | null;
  source: string;
  detectedAt: string;
}

/**
 * Persists a snapshot of "these games are actually installed as of the
 * last scan" so the Recommendations page's Installed tab can show it
 * without re-running a filesystem scan itself — Hardware.tsx calls this
 * right after a scan completes, using the same matched (including
 * manually-overridden) results it displays.
 *
 * Full replace (DELETE then INSERT), not a merge — a game no longer
 * found on a fresh scan should stop showing up as installed, not linger
 * from a stale previous scan.
 */
export async function saveInstalledGameSnapshot(
  db: DbClient,
  matches: { gameId: string; source: DetectedSourceType }[]
): Promise<void> {
  await db.execute(`DELETE FROM InstalledGameStatus`);

  // Dedupe by gameId — the same game could in principle be matched via
  // more than one source (e.g. owned on Steam and separately emulated
  // via a ROM), and GameId is the primary key here, so only the first
  // source seen for a given game is kept.
  const seen = new Set<string>();
  const now = new Date().toISOString();
  for (const { gameId, source } of matches) {
    if (seen.has(gameId)) continue;
    seen.add(gameId);
    await db.execute(`INSERT INTO InstalledGameStatus (GameId, Source, DetectedAt) VALUES (?, ?, ?)`, [
      gameId,
      source,
      now,
    ]);
  }
}

export async function getInstalledGames(db: DbClient): Promise<InstalledGame[]> {
  return db.select<InstalledGame>(`
    SELECT g.Id AS gameId, g.Title AS title, g.CoverArtUrl AS coverArtUrl, s.Source AS source, s.DetectedAt AS detectedAt
    FROM InstalledGameStatus s
    JOIN Games g ON g.Id = s.GameId
    ORDER BY g.Title
  `);
}

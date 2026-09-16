import * as XLSX from "xlsx";
import type { DbClient } from "../database/database";

/**
 * Imports the personal backlog spreadsheet — the secondary enrichment
 * source the spec anticipated (Section 3/4: "Personal Spreadsheet
 * Enrichment," "Desire to Play Scores") but that was never built until
 * now. Confirmed directly: HLTB/Metacritic values in this spreadsheet are
 * the user's own rough manual estimates, not scraped exact figures (some
 * rounded, some from memory/feel rather than looked up) — good enough to
 * use, but the UI should label them as personal estimates rather than
 * imply they're precise lookups.
 *
 * Column layout is discovered by searching for the header row (contains
 * both "Game" and "Category") rather than a hardcoded row index — the
 * real file has a free-text notes row above the actual header, and
 * hardcoding an index would silently break if that changes.
 */

export interface SpreadsheetRow {
  game: string;
  category?: string;
  platform?: string;
  storefront?: string;
  hltb?: number;
  metacritic?: number;
  desireToPlay?: number;
  ownedForRoms?: string;
}

export interface MatchResult {
  spreadsheetTitle: string;
  matchedGameId: string | null;
  matchedGameTitle: string | null;
  confidence: number;
  row: SpreadsheetRow;
}

// Anything at or above this similarity is auto-matched without review.
// Below it, the match is still the best guess but should be surfaced for
// confirmation rather than applied silently — a wrong auto-merge here
// means silently overwriting one game's data with another's.
export const HIGH_CONFIDENCE_THRESHOLD = 0.92;

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents (é -> e) so "Pokémon" matches "Pokemon"
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, "") // leading article differs inconsistently between the two sources
    .replace(/\s*&\s*/g, " and ") // "Mario & Luigi" vs "Mario and Luigi"
    .replace(/[:'’\-–—,!]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

function cellToString(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return String(value).trim();
}

function cellToNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function parseSpreadsheet(buffer: ArrayBuffer): SpreadsheetRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames.includes("Backlog") ? "Backlog" : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`No sheet named "Backlog" and no fallback sheet found.`);

  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });

  const headerRowIndex = raw.findIndex(
    (row) => Array.isArray(row) && row.includes("Game") && row.includes("Category")
  );
  if (headerRowIndex === -1) {
    throw new Error(`Couldn't find a header row containing both "Game" and "Category".`);
  }
  const header = raw[headerRowIndex] as unknown[];
  const colIndex = (name: string) => header.indexOf(name);

  const gameCol = colIndex("Game");
  const categoryCol = colIndex("Category");
  const platformCol = colIndex("Platform");
  const storefrontCol = colIndex("Storefront");
  const hltbCol = colIndex("HLTB");
  const metacriticCol = colIndex("Metacritic");
  const desireCol = colIndex("Desire to Play");
  const ownedCol = colIndex("Owned? (For Roms)");

  const rows: SpreadsheetRow[] = [];
  for (let i = headerRowIndex + 1; i < raw.length; i++) {
    const row = raw[i] as unknown[] | undefined;
    const game = row?.[gameCol];
    if (typeof game !== "string" || game.trim() === "") continue;

    rows.push({
      game: game.trim(),
      category: cellToString(row?.[categoryCol]),
      platform: cellToString(row?.[platformCol]),
      storefront: cellToString(row?.[storefrontCol]),
      hltb: cellToNumber(row?.[hltbCol]),
      metacritic: cellToNumber(row?.[metacriticCol]),
      desireToPlay: cellToNumber(row?.[desireCol]),
      ownedForRoms: cellToString(row?.[ownedCol]),
    });
  }
  return rows;
}

// Spreadsheet platform names don't always match IGDB's naming exactly
// (e.g. "PC" vs "PC (Microsoft Windows)") — mapping the known cases seen
// in the real spreadsheet lets these reuse the same Platforms row IGDB
// enrichment already created, rather than creating a visually-duplicate
// second row for the same real platform.
const PLATFORM_NAME_ALIASES: Record<string, string> = {
  pc: "PC (Microsoft Windows)",
  ps4: "PlayStation 4",
  ps5: "PlayStation 5",
  psvita: "PlayStation Vita",
  switch: "Nintendo Switch",
  "switch 2": "Nintendo Switch 2",
  "3ds": "Nintendo 3DS",
  ds: "Nintendo DS",
};

/** Finds an existing Platforms row by name (case-insensitive, after alias
 * mapping), or creates one with a synthetic negative id — real IGDB
 * platform ids are always positive, so negative ids can never collide
 * with them. Used for spreadsheet-only concepts like "Emulated" that
 * have no IGDB platform to anchor to.
 *
 * INSERT OR IGNORE rather than a plain INSERT: Platforms.Name now has a
 * UNIQUE constraint (see schema.ts and
 * EnrichmentService.ensurePlatformNameUniqueness for why), so a plain
 * INSERT could throw if a race or an exact-case match this function's
 * own case-insensitive lookup above happened to miss somehow got there
 * first. OR IGNORE plus the re-SELECT afterward is the same safe
 * find-or-create pattern every other lookup table in this schema
 * already uses (see getOrCreateNamedLookupId in LookupTables.ts) —
 * Platforms was simply the one table built differently before. */
async function getOrCreatePlatformIdByName(db: DbClient, rawName: string): Promise<number> {
  const canonical = PLATFORM_NAME_ALIASES[rawName.trim().toLowerCase()] ?? rawName.trim();

  const existing = await db.select<{ Id: number }>(`SELECT Id FROM Platforms WHERE LOWER(Name) = LOWER(?) LIMIT 1`, [
    canonical,
  ]);
  if (existing.length > 0) return existing[0].Id;

  const lowest = await db.select<{ MinId: number | null }>(`SELECT MIN(Id) AS MinId FROM Platforms`);
  const newId = Math.min(0, lowest[0]?.MinId ?? 0) - 1;
  await db.execute(`INSERT OR IGNORE INTO Platforms (Id, Name) VALUES (?, ?)`, [newId, canonical]);

  // Re-select rather than trusting newId: if the INSERT was ignored
  // (a same-named row already existed under a different id), this finds
  // the real one instead of returning an id that was never actually used.
  const afterInsert = await db.select<{ Id: number }>(
    `SELECT Id FROM Platforms WHERE LOWER(Name) = LOWER(?) LIMIT 1`,
    [canonical]
  );
  return afterInsert[0].Id;
}

// Detects the three subscription services by name pattern (case-
// insensitive, tolerant of "Gamepass"/"Game Pass", "PS Plus"/
// "PlayStation Plus", "Nintendo Online"/"NSO") and normalizes to one
// canonical name each, so a differently-worded spreadsheet entry still
// lands on the same Storefronts row. Anything not matching one of these
// three patterns (Steam, GOG, Physical, ROM, etc.) is a normal one-time
// ownership storefront, not a subscription.
const SUBSCRIPTION_NAME_PATTERNS: [RegExp, string][] = [
  [/game\s*pass/i, "Xbox Game Pass"],
  [/(ps|playstation)\s*plus/i, "PlayStation Plus"],
  [/nintendo\s*(switch\s*)?online|\bnso\b/i, "Nintendo Switch Online"],
];

/** Same shape as getOrCreatePlatformIdByName, plus subscription
 * detection: matching one of the three known subscription-service name
 * patterns sets IsSubscription = 1 (even on an already-existing row, in
 * case it was created earlier under an unlabeled numeric id and hadn't
 * been flagged yet) — this is what makes a storefront eligible to show
 * up in Settings' subscription toggle list at all. */
async function getOrCreateStorefrontIdByName(db: DbClient, rawName: string): Promise<number> {
  const trimmed = rawName.trim();
  let canonical = trimmed;
  let isSubscription = false;
  for (const [pattern, name] of SUBSCRIPTION_NAME_PATTERNS) {
    if (pattern.test(trimmed)) {
      canonical = name;
      isSubscription = true;
      break;
    }
  }

  const existing = await db.select<{ Id: number }>(`SELECT Id FROM Storefronts WHERE LOWER(Name) = LOWER(?) LIMIT 1`, [
    canonical,
  ]);
  if (existing.length > 0) {
    if (isSubscription) {
      await db.execute(`UPDATE Storefronts SET IsSubscription = 1 WHERE Id = ?`, [existing[0].Id]);
    }
    return existing[0].Id;
  }

  const lowest = await db.select<{ MinId: number | null }>(`SELECT MIN(Id) AS MinId FROM Storefronts`);
  const newId = Math.min(0, lowest[0]?.MinId ?? 0) - 1;
  await db.execute(`INSERT OR IGNORE INTO Storefronts (Id, Name, IsSubscription) VALUES (?, ?, ?)`, [
    newId,
    canonical,
    isSubscription ? 1 : 0,
  ]);

  // Re-select rather than trusting newId — same reasoning as
  // getOrCreatePlatformIdByName above: if the INSERT was ignored (a
  // same-named row already existed), this finds the real one.
  const afterInsert = await db.select<{ Id: number }>(
    `SELECT Id FROM Storefronts WHERE LOWER(Name) = LOWER(?) LIMIT 1`,
    [canonical]
  );
  return afterInsert[0].Id;
}

/**
 * Matches each spreadsheet row against the library's existing Games by
 * title similarity. Pure function of (rows, existing titles) — doesn't
 * touch the database itself, so it's testable without a DbClient at all.
 */
export function matchSpreadsheetRows(
  rows: SpreadsheetRow[],
  existingGames: { id: string; title: string }[]
): MatchResult[] {
  return rows.map((row) => {
    let best: { id: string; title: string; score: number } | null = null;
    for (const game of existingGames) {
      const score = titleSimilarity(row.game, game.title);
      if (!best || score > best.score) best = { id: game.id, title: game.title, score };
    }
    const confident = best !== null && best.score >= HIGH_CONFIDENCE_THRESHOLD;
    return {
      spreadsheetTitle: row.game,
      matchedGameId: confident ? best!.id : null,
      matchedGameTitle: best?.title ?? null,
      confidence: best?.score ?? 0,
      row,
    };
  });
}

/**
 * Applies one matched row's data to a game. HLTB/Metacritic are personal
 * estimates (see module doc) — stored as given, without pretending to
 * more precision than they have.
 *
 * Platform/Storefront now resolve to real Platforms/Storefronts rows
 * (UserGames.OwnedPlatformId/OwnedStorefrontId) rather than being dumped
 * into a free-text note — a real fix, not just a nicer data model: the
 * old approach appended a new note fragment on every import without
 * removing the previous one, so re-importing after updating a game's
 * storefront in the spreadsheet would leave BOTH the old and new value
 * concatenated in Notes forever, never actually reflecting the update.
 * OwnedPlatformId/OwnedStorefrontId are plain UPDATEs, so the current
 * spreadsheet value always wins on re-import, same as every other field
 * here — this is also what makes the "did you handle Dead Cells moving
 * from Game Pass to Steam" case actually work correctly.
 *
 * ROM ownership and the spreadsheet's own Category still go into Notes
 * (no better structured home for those yet) — but Notes is now fully
 * REPLACED each import rather than appended to, fixing the same
 * duplication problem for those two fields as well.
 */
export async function applySpreadsheetMatch(db: DbClient, gameId: string, row: SpreadsheetRow): Promise<void> {
  if (row.hltb != null) {
    await db.execute(`UPDATE Games SET HLTBMainStory = ? WHERE Id = ?`, [row.hltb, gameId]);
  }
  if (row.metacritic != null) {
    await db.execute(`UPDATE Games SET MetacriticScore = ? WHERE Id = ?`, [row.metacritic, gameId]);
  }
  if (row.desireToPlay != null) {
    await db.execute(`UPDATE UserGames SET DesireToPlay = ? WHERE GameId = ?`, [row.desireToPlay, gameId]);
  }

  const platformId = row.platform ? await getOrCreatePlatformIdByName(db, row.platform) : null;
  const storefrontId = row.storefront ? await getOrCreateStorefrontIdByName(db, row.storefront) : null;

  if (platformId !== null || storefrontId !== null) {
    await db.execute(
      `
      UPDATE UserGames SET
        OwnedPlatformId = COALESCE(?, OwnedPlatformId),
        OwnedStorefrontId = COALESCE(?, OwnedStorefrontId)
      WHERE GameId = ?
      `,
      [platformId, storefrontId, gameId]
    );
  }

  const noteParts: string[] = [];
  if (row.ownedForRoms) noteParts.push(`ROM ownership: ${row.ownedForRoms}`);
  if (row.category) noteParts.push(`Spreadsheet category: ${row.category}`);

  if (noteParts.length > 0) {
    await db.execute(`UPDATE UserGames SET Notes = ? WHERE GameId = ?`, [noteParts.join(" | "), gameId]);
  }
}

import { useEffect, useMemo, useState } from "react";
import { getDatabase } from "../database/database";
import {
  getPlatformsWithOwnership,
  setPlatformOwned,
  getUnplayableGames,
  PlatformOwnership,
  UnplayableGame,
} from "../services/HardwareService";
import { getSetting, SETTINGS_KEYS, getRomFolders } from "../services/SettingsService";
import {
  scanSteamGames,
  scanEpicGames,
  scanRomFolder,
  matchToLibrary,
  getDetectedGameOverrides,
  setDetectedGameOverride,
  saveInstalledGameSnapshot,
  dedupeBySourceId,
  DetectedGame,
  DetectedRom,
  DetectedSourceType,
} from "../services/InstalledGamesService";
import { Game } from "../types/game";
import CoverArt from "../components/CoverArt";

interface Props {
  onSelectGame: (game: Game) => void;
}

type Tab = "hardware" | "unplayable" | "detected";

interface LibraryGameOption {
  id: string;
  title: string;
  coverArtUrl: string | null;
}

export default function Hardware({ onSelectGame }: Props) {
  const [tab, setTab] = useState<Tab>("hardware");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [platforms, setPlatforms] = useState<PlatformOwnership[]>([]);
  const [unplayable, setUnplayable] = useState<UnplayableGame[]>([]);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);

  // Raw scan results, kept separate from the matched/rendered view —
  // setting a manual override just re-derives the matched lists from
  // these (see the useMemo below) rather than re-scanning the
  // filesystem, which could be slow for a large ROM folder.
  const [steamDetected, setSteamDetected] = useState<DetectedGame[]>([]);
  const [epicDetected, setEpicDetected] = useState<DetectedGame[]>([]);
  const [romsDetected, setRomsDetected] = useState<DetectedRom[]>([]);

  const [library, setLibrary] = useState<LibraryGameOption[]>([]);
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());

  const [overrideOpenFor, setOverrideOpenFor] = useState<string | null>(null);
  const [overrideQuery, setOverrideQuery] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const db = await getDatabase();
      // Sequential, not Promise.all: getPlatformsWithOwnership runs the
      // platform-dedup pass as a side effect, and getUnplayableGames
      // separately reads Platforms too — running them concurrently
      // risked getUnplayableGames reading a mid-merge state.
      const p = await getPlatformsWithOwnership(db);
      const u = await getUnplayableGames(db);
      setPlatforms(p);
      setUnplayable(u);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleScan() {
    setScanning(true);
    setScanError(null);
    try {
      const db = await getDatabase();
      const libraryRows = await db.select<{ Id: string; Title: string; CoverArtUrl: string | null }>(
        `SELECT Id, Title, CoverArtUrl FROM Games`
      );
      const libraryForMatch = libraryRows.map((g) => ({ id: g.Id, title: g.Title, coverArtUrl: g.CoverArtUrl }));
      setLibrary(libraryForMatch);
      const overridesForMatch = await getDetectedGameOverrides(db);
      setOverrides(overridesForMatch);

      const steamPathOverride = await getSetting(SETTINGS_KEYS.STEAM_PATH_OVERRIDE);
      const romFolders = await getRomFolders();

      const [steamResult, epicResult, ...romResults] = await Promise.allSettled([
        scanSteamGames(steamPathOverride),
        scanEpicGames(),
        ...romFolders.map((folder) => scanRomFolder(folder)),
      ]);

      const steamRaw = steamResult.status === "fulfilled" ? steamResult.value : [];
      const epicRaw = epicResult.status === "fulfilled" ? epicResult.value : [];
      // Deduped by file path — if two configured ROM folders overlap
      // (one nested inside the other, or genuinely the same folder
      // added twice), the same file would otherwise show up once per
      // folder it was found through.
      const romsRaw = dedupeBySourceId(romResults.flatMap((r) => (r.status === "fulfilled" ? r.value : [])));

      setSteamDetected(steamRaw);
      setEpicDetected(epicRaw);
      setRomsDetected(romsRaw);

      // Persist the matched snapshot so the Recommendations page's
      // Installed tab can show it without re-running a filesystem scan
      // itself. Computed directly here (not read back from the
      // reactive useMemo-derived state below) to avoid a timing race —
      // React batches the setSteamDetected/etc. calls above, so those
      // derived values wouldn't actually be recomputed yet within this
      // same function call.
      const steamMatched = matchToLibrary(steamRaw, "steam", libraryForMatch, overridesForMatch);
      const epicMatched = matchToLibrary(epicRaw, "epic", libraryForMatch, overridesForMatch);
      const romsMatched = matchToLibrary(romsRaw, "rom", libraryForMatch, overridesForMatch);
      await saveInstalledGameSnapshot(db, [
        ...steamMatched
          .filter((g) => g.matchedGameId)
          .map((g) => ({ gameId: g.matchedGameId as string, source: "steam" as DetectedSourceType })),
        ...epicMatched
          .filter((g) => g.matchedGameId)
          .map((g) => ({ gameId: g.matchedGameId as string, source: "epic" as DetectedSourceType })),
        ...romsMatched
          .filter((r) => r.matchedGameId)
          .map((r) => ({ gameId: r.matchedGameId as string, source: "rom" as DetectedSourceType })),
      ]);

      // Surface Steam's error specifically (the one scan most likely to
      // need the manual path override) — Epic and ROM folder failures
      // are silently treated as "found nothing" instead, since an
      // uninstalled launcher or a not-yet-configured folder is a normal
      // outcome, not something to alarm the user about.
      if (steamResult.status === "rejected") {
        setScanError(String(steamResult.reason));
      }

      setScanned(true);
    } finally {
      setScanning(false);
    }
  }

  const steamGames = useMemo(
    () => matchToLibrary(steamDetected, "steam", library, overrides),
    [steamDetected, library, overrides]
  );
  const epicGames = useMemo(
    () => matchToLibrary(epicDetected, "epic", library, overrides),
    [epicDetected, library, overrides]
  );
  const roms = useMemo(
    () => matchToLibrary(romsDetected, "rom", library, overrides),
    [romsDetected, library, overrides]
  );

  async function handleSetOverride(sourceType: DetectedSourceType, sourceId: string, gameId: string) {
    const db = await getDatabase();
    await setDetectedGameOverride(db, sourceType, sourceId, gameId);
    setOverrides(await getDetectedGameOverrides(db));
    setOverrideOpenFor(null);
    setOverrideQuery("");
  }

  async function handleToggle(platformId: number, owned: boolean) {
    // Optimistic update — checking a box should feel instant, not wait
    // on a DB round-trip. The unplayable list is refetched after, since
    // toggling one platform can change which games qualify.
    setPlatforms((prev) => prev.map((p) => (p.id === platformId ? { ...p, currentlyOwned: owned } : p)));
    const db = await getDatabase();
    await setPlatformOwned(db, platformId, owned);
    const u = await getUnplayableGames(db);
    setUnplayable(u);
  }

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (error) return <p className="text-red-400">Failed to load Hardware: {error}</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Hardware</h1>
      <p className="mt-2 text-sm text-gray-400">
        Click a platform to toggle whether you currently have working hardware for it. Turning one
        off flags any game owned specifically on that platform as unplayable right now — e.g.
        Persona 5 owned only on PS5, with no PS5 currently on hand.
      </p>

      <div className="mt-6 flex gap-2 border-b border-red-900/40 pb-2">
        <button
          onClick={() => setTab("hardware")}
          className={
            "rounded-lg px-4 py-2 text-sm font-medium transition " +
            (tab === "hardware" ? "bg-amber-500 text-gray-950" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200")
          }
        >
          Hardware
        </button>
        <button
          onClick={() => setTab("unplayable")}
          className={
            "rounded-lg px-4 py-2 text-sm font-medium transition " +
            (tab === "unplayable" ? "bg-amber-500 text-gray-950" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200")
          }
        >
          Unable to Play Currently
          <span className="ml-1.5 text-xs opacity-70">{unplayable.length}</span>
        </button>
        <button
          onClick={() => setTab("detected")}
          className={
            "rounded-lg px-4 py-2 text-sm font-medium transition " +
            (tab === "detected" ? "bg-amber-500 text-gray-950" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200")
          }
        >
          Installed & ROMs
        </button>
      </div>

      {tab === "hardware" && (
        <div className="mt-6">
          {platforms.length === 0 ? (
            <p className="text-sm text-gray-500">
              No platforms resolved yet — import your library and run enrichment in Settings first.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {platforms.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleToggle(p.id, !p.currentlyOwned)}
                  title={p.currentlyOwned ? `${p.name} — click to mark as not currently owned` : `${p.name} — click to mark as owned`}
                  className={
                    "group flex flex-col items-center rounded-t-lg border-b-4 bg-gray-800/60 px-3 pb-3 pt-5 ring-1 transition " +
                    (p.currentlyOwned
                      ? "border-amber-500 ring-amber-500/40 hover:bg-gray-800"
                      : "border-gray-700 opacity-40 ring-white/5 grayscale hover:opacity-70")
                  }
                >
                  <div className="flex h-16 w-full items-center justify-center">
                    {p.logoUrl ? (
                      <CoverArt
                        gameId={`platform-${p.id}`}
                        url={p.logoUrl}
                        alt={p.name ?? ""}
                        className="max-h-16 max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-center text-xs text-gray-500">{p.name}</span>
                    )}
                  </div>
                  <p
                    className={
                      "mt-2 truncate text-center text-xs font-medium " +
                      (p.currentlyOwned ? "text-gray-200" : "text-gray-500")
                    }
                  >
                    {p.name}
                  </p>
                  <p className="text-center text-[11px] text-gray-600">
                    {p.ownedGameCount} game{p.ownedGameCount === 1 ? "" : "s"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "unplayable" && (
        <div className="mt-6">
          {unplayable.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nothing flagged — either every owned platform is checked above, or no game's
              platform info points at an unchecked one.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {unplayable.map((g) => (
                <button
                  key={g.gameId}
                  onClick={() => onSelectGame({ id: g.gameId, title: g.title })}
                  className="flex flex-col text-left"
                >
                  <div className="aspect-[3/4] w-full overflow-hidden rounded-lg bg-gray-800 opacity-60 ring-1 ring-white/10 transition hover:opacity-100 hover:ring-red-600">
                    {g.coverArtUrl ? (
                      <CoverArt gameId={g.gameId} url={g.coverArtUrl} alt={g.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-gray-500">
                        {g.title}
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-sm font-medium text-gray-200">{g.title}</p>
                  <p className="truncate text-xs text-amber-400">
                    Needs: {g.platformName}
                    {g.viaFallback && " (last played on)"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "detected" && (
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="max-w-2xl text-sm text-gray-400">
              Scans your Steam and Epic installs and any ROM folders configured in Settings, then
              matches what's found against your library by title. Read-only — nothing here writes
              back to your library automatically except manual matches you make below, which are
              remembered for future scans.
            </p>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="flex-shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scanning ? "Scanning..." : "Scan Now"}
            </button>
          </div>
          {scanError && (
            <p className="mt-2 text-sm text-red-400">
              Steam scan failed: {scanError} — set the Steam install path manually in Settings if
              auto-detection isn't finding it.
            </p>
          )}

          {!scanned && !scanning && (
            <p className="mt-6 text-sm text-gray-500">Click "Scan Now" to check what's installed.</p>
          )}

          {scanned && (
            <div className="mt-6 flex flex-col gap-8">
              <DetectedSection
                title="Steam"
                sourceType="steam"
                subtitle={`${steamGames.length} found, ${steamGames.filter((g) => g.matchedGameId).length} matched to your library`}
                items={steamGames.map((g) => ({
                  sourceId: g.sourceId,
                  label: g.title,
                  matchedGameId: g.matchedGameId,
                  matchedTitle: g.matchedTitle,
                  matchedCoverArtUrl: g.matchedCoverArtUrl,
                  matchedViaOverride: g.matchedViaOverride,
                }))}
                library={library}
                overrideOpenFor={overrideOpenFor}
                setOverrideOpenFor={setOverrideOpenFor}
                overrideQuery={overrideQuery}
                setOverrideQuery={setOverrideQuery}
                onSetOverride={handleSetOverride}
                onSelectGame={onSelectGame}
              />
              <DetectedSection
                title="Epic Games"
                sourceType="epic"
                subtitle={`${epicGames.length} found, ${epicGames.filter((g) => g.matchedGameId).length} matched to your library`}
                items={epicGames.map((g) => ({
                  sourceId: g.sourceId,
                  label: g.title,
                  matchedGameId: g.matchedGameId,
                  matchedTitle: g.matchedTitle,
                  matchedCoverArtUrl: g.matchedCoverArtUrl,
                  matchedViaOverride: g.matchedViaOverride,
                }))}
                library={library}
                overrideOpenFor={overrideOpenFor}
                setOverrideOpenFor={setOverrideOpenFor}
                overrideQuery={overrideQuery}
                setOverrideQuery={setOverrideQuery}
                onSetOverride={handleSetOverride}
                onSelectGame={onSelectGame}
              />
              <DetectedSection
                title="ROMs"
                sourceType="rom"
                subtitle={`${roms.length} found, ${roms.filter((r) => r.matchedGameId).length} matched to your library`}
                items={roms.map((r) => ({
                  sourceId: r.sourceId,
                  label: r.guessedTitle,
                  sublabel: r.console ?? undefined,
                  matchedGameId: r.matchedGameId,
                  matchedTitle: r.matchedTitle,
                  matchedCoverArtUrl: r.matchedCoverArtUrl,
                  matchedViaOverride: r.matchedViaOverride,
                }))}
                library={library}
                overrideOpenFor={overrideOpenFor}
                setOverrideOpenFor={setOverrideOpenFor}
                overrideQuery={overrideQuery}
                setOverrideQuery={setOverrideQuery}
                onSetOverride={handleSetOverride}
                onSelectGame={onSelectGame}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface DetectedItem {
  sourceId: string;
  label: string;
  sublabel?: string;
  matchedGameId: string | null;
  matchedTitle: string | null;
  matchedCoverArtUrl: string | null;
  matchedViaOverride: boolean;
}

function DetectedSection({
  title,
  sourceType,
  subtitle,
  items,
  library,
  overrideOpenFor,
  setOverrideOpenFor,
  overrideQuery,
  setOverrideQuery,
  onSetOverride,
  onSelectGame,
}: {
  title: string;
  sourceType: DetectedSourceType;
  subtitle: string;
  items: DetectedItem[];
  library: LibraryGameOption[];
  overrideOpenFor: string | null;
  setOverrideOpenFor: (key: string | null) => void;
  overrideQuery: string;
  setOverrideQuery: (q: string) => void;
  onSetOverride: (sourceType: DetectedSourceType, sourceId: string, gameId: string) => void;
  onSelectGame: (game: Game) => void;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="text-xs text-gray-500">{subtitle}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">Nothing found.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {items.map((item) => {
            const overrideKey = `${sourceType}:${item.sourceId}`;
            const searchMatches =
              overrideOpenFor === overrideKey && overrideQuery
                ? library.filter((g) => g.title.toLowerCase().includes(overrideQuery.toLowerCase())).slice(0, 8)
                : [];

            return (
              <div key={item.sourceId} className="rounded-lg bg-gray-800/60 px-3 py-2 ring-1 ring-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-12 w-9 flex-shrink-0 overflow-hidden rounded bg-gray-900">
                      {item.matchedCoverArtUrl && item.matchedGameId && (
                        <CoverArt
                          gameId={item.matchedGameId}
                          url={item.matchedCoverArtUrl}
                          alt={item.label}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-gray-200">{item.label}</p>
                      {item.sublabel && <p className="text-xs text-gray-500">{item.sublabel}</p>}
                    </div>
                  </div>
                  {item.matchedGameId ? (
                    <button
                      onClick={() => onSelectGame({ id: item.matchedGameId as string, title: item.matchedTitle ?? item.label })}
                      className="ml-3 flex-shrink-0 rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-400 hover:bg-amber-500/30"
                    >
                      {item.matchedViaOverride ? "In library (manual)" : "In library"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setOverrideOpenFor(overrideOpenFor === overrideKey ? null : overrideKey)}
                      className="ml-3 flex-shrink-0 text-xs text-gray-500 underline hover:text-gray-300"
                    >
                      Not in library — match manually
                    </button>
                  )}
                </div>

                {overrideOpenFor === overrideKey && (
                  <div className="mt-2 rounded-lg bg-gray-900 p-2 ring-1 ring-white/10">
                    <input
                      autoFocus
                      value={overrideQuery}
                      onChange={(e) => setOverrideQuery(e.target.value)}
                      placeholder="Search your library..."
                      className="w-full rounded bg-gray-800 px-2 py-1 text-xs text-gray-100 focus:outline-none"
                    />
                    <div className="mt-1 max-h-32 overflow-y-auto">
                      {searchMatches.map((g) => (
                        <button
                          key={g.id}
                          onClick={() => onSetOverride(sourceType, item.sourceId, g.id)}
                          className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-gray-300 hover:bg-gray-800"
                        >
                          {g.title}
                        </button>
                      ))}
                      {overrideQuery && searchMatches.length === 0 && (
                        <p className="px-1.5 py-1 text-xs text-gray-600">No matches.</p>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setOverrideOpenFor(null);
                        setOverrideQuery("");
                      }}
                      className="mt-1 text-xs text-gray-500 hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

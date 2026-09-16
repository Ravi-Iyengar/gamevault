import { useEffect, useMemo, useState } from "react";
import { getDatabase } from "../database/database";
import {
  getSeriesList,
  getSeriesCompletion,
  refreshSeriesCatalog,
  setSeriesOverride,
  SeriesSummary,
  SeriesSlot,
} from "../services/SeriesService";
import { getIgdbCredentials } from "../services/SettingsService";
import { IgdbClient } from "../services/IgdbClient";
import { Game } from "../types/game";
import CoverArt from "../components/CoverArt";

interface Props {
  onSelectGame: (game: Game) => void;
}

interface LibraryGameOption {
  id: string;
  title: string;
  coverArtUrl: string | null;
}

/**
 * Size buckets for the series-picker tabs, requested so a library with
 * many small, loosely-tagged collections (single-game "collections" are
 * common in IGDB's data) doesn't bury the handful of real large series
 * you actually care about in one long undifferentiated list.
 *
 * Interpreted the requested breakpoints (1 / 2-5 / 6-15 / 15+ / 35+ /
 * 50+) as non-overlapping ranges, since taken literally "15+", "35+"
 * and "50+" would all match the same large series at once — each
 * series belongs to exactly one bucket here.
 */
type SizeBucket = "all" | "one" | "small" | "medium" | "large" | "veryLarge" | "huge";

const SIZE_TABS: { key: SizeBucket; label: string }[] = [
  { key: "all", label: "All" },
  { key: "one", label: "1" },
  { key: "small", label: "2–5" },
  { key: "medium", label: "6–15" },
  { key: "large", label: "16–34" },
  { key: "veryLarge", label: "35–49" },
  { key: "huge", label: "50+" },
];

function bucketOf(totalCount: number): SizeBucket {
  if (totalCount <= 1) return "one";
  if (totalCount <= 5) return "small";
  if (totalCount <= 15) return "medium";
  if (totalCount <= 34) return "large";
  if (totalCount <= 49) return "veryLarge";
  return "huge";
}

/**
 * "How many Dark Souls games have I actually played?" — a series
 * (IGDB Collection) picker plus a grid of every game IGDB lists under
 * it, owned entries in color and clickable through to their GameDetail
 * page, unowned entries grayed out. See SeriesService.ts for the
 * equivalence logic (remaster/remake/port collapsing, manual overrides)
 * that decides what counts as "owned" for a given slot.
 *
 * UNVERIFIED end-to-end, same caveat as this project's other
 * IGDB-network-dependent features: built without the ability to
 * actually call the IGDB API or run the app in this environment.
 */
export default function SeriesCompletion({ onSelectGame }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<SeriesSummary[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [slots, setSlots] = useState<SeriesSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number } | null>(null);

  const [libraryGames, setLibraryGames] = useState<LibraryGameOption[]>([]);
  const [overrideOpenFor, setOverrideOpenFor] = useState<number | null>(null);
  const [overrideQuery, setOverrideQuery] = useState("");

  const [sizeTab, setSizeTab] = useState<SizeBucket>("all");
  const [catalogSearch, setCatalogSearch] = useState("");

  useEffect(() => {
    loadSeries();
  }, []);

  async function loadSeries() {
    setLoading(true);
    setError(null);
    try {
      const db = await getDatabase();
      const list = await getSeriesList(db);
      setSeries(list);
      if (list.length > 0 && selectedId === null) {
        setSelectedId(list[0].collectionId);
      }
      const rows = await db.select<{ Id: string; Title: string; CoverArtUrl: string | null }>(
        `SELECT Id, Title, CoverArtUrl FROM Games ORDER BY Title`
      );
      setLibraryGames(rows.map((r) => ({ id: r.Id, title: r.Title, coverArtUrl: r.CoverArtUrl })));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedId === null) return;
    loadSlots(selectedId);
  }, [selectedId]);

  async function loadSlots(collectionId: number) {
    setSlotsLoading(true);
    try {
      const db = await getDatabase();
      const result = await getSeriesCompletion(db, collectionId);
      setSlots(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setSlotsLoading(false);
    }
  }

  /** Highest completion percentage first. Series with an unknown total
   * (totalCount 0 — shouldn't normally happen, but a collection whose
   * catalog fetch found zero games) sort last rather than dividing by
   * zero. */
  function percentPlayed(s: SeriesSummary): number {
    return s.totalCount > 0 ? s.ownedCount / s.totalCount : -1;
  }

  async function handleRefreshAllCatalogs() {
    const withIgdbId = series.filter((s) => s.igdbCollectionId != null);
    const skipped = series.length - withIgdbId.length;

    setRefreshing(true);
    setRefreshError(null);
    setRefreshProgress({ done: 0, total: withIgdbId.length });
    try {
      const creds = await getIgdbCredentials();
      if (!creds) throw new Error("Save your IGDB Client ID and Secret in Settings first.");
      const db = await getDatabase();
      const client = new IgdbClient(creds.clientId, creds.clientSecret);

      for (let i = 0; i < withIgdbId.length; i++) {
        const s = withIgdbId[i];
        // Sequential, not parallel — same reasoning as everywhere else
        // IgdbClient is used: it self-throttles to IGDB's documented
        // rate limit, so firing every request at once would just queue
        // up behind that same throttle rather than actually going
        // faster, while making a single failure harder to isolate.
        await refreshSeriesCatalog(db, client, s.collectionId, s.igdbCollectionId as number);
        setRefreshProgress({ done: i + 1, total: withIgdbId.length });
      }

      const refreshed = await getSeriesList(db);
      refreshed.sort((a, b) => percentPlayed(b) - percentPlayed(a));
      setSeries(refreshed);

      if (skipped > 0) {
        setRefreshError(
          `${skipped} series had no IGDB collection id on record and were skipped — re-run "Fetch Metadata & Cover Art" (or "Re-fetch All") in Settings to pick those up.`
        );
      }

      if (selectedId !== null) await loadSlots(selectedId);
    } catch (e) {
      setRefreshError(String(e));
    } finally {
      setRefreshing(false);
      setRefreshProgress(null);
    }
  }

  async function handleSetOverride(canonicalIgdbId: number, gameId: string) {
    const db = await getDatabase();
    await setSeriesOverride(db, gameId, canonicalIgdbId);
    setOverrideOpenFor(null);
    setOverrideQuery("");
    if (selectedId !== null) await loadSlots(selectedId);
  }

  const visibleSeries = useMemo(() => {
    const bucketed = series.filter((s) => sizeTab === "all" || bucketOf(s.totalCount) === sizeTab);
    if (sizeTab !== "all" || !catalogSearch.trim()) return bucketed;
    const q = catalogSearch.trim().toLowerCase();
    return bucketed.filter((s) => s.name.toLowerCase().includes(q));
  }, [series, sizeTab, catalogSearch]);

  // Keep the right-hand panel in sync with whichever tab/search is
  // active: if the current selection isn't part of the visible set
  // (switched to a bucket it's not in, or a search that excludes it),
  // fall back to the first visible series rather than silently showing
  // a series that no longer has a highlighted entry in the nav list.
  useEffect(() => {
    if (visibleSeries.length === 0) return;
    if (!visibleSeries.some((s) => s.collectionId === selectedId)) {
      setSelectedId(visibleSeries[0].collectionId);
    }
  }, [visibleSeries, selectedId]);

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (error) return <p className="text-red-400">Failed to load Series Completion: {error}</p>;

  if (series.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Series Completion</h1>
        <p className="mt-4 text-sm text-gray-500">
          Nothing to show yet — Series Completion needs at least one game whose IGDB collection has
          been fetched (Settings → "Fetch Metadata & Cover Art").
        </p>
      </div>
    );
  }

  const active = series.find((s) => s.collectionId === selectedId) ?? visibleSeries[0] ?? series[0];
  const searchMatches =
    overrideOpenFor !== null && overrideQuery
      ? libraryGames.filter((g) => g.title.toLowerCase().includes(overrideQuery.toLowerCase())).slice(0, 8)
      : [];

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Series Completion</h1>
          <p className="mt-2 text-sm text-gray-400">
            Every game IGDB lists under a series, owned entries in full color. Remasters, remakes,
            and ports collapse into the original's slot automatically where IGDB links them — use
            "own this via a different edition" on an unowned entry if it doesn't.
          </p>
        </div>
        <button
          onClick={handleRefreshAllCatalogs}
          disabled={refreshing}
          className="flex-shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {refreshing
            ? refreshProgress
              ? `Refreshing ${refreshProgress.done}/${refreshProgress.total}...`
              : "Refreshing..."
            : "Refresh All Catalogs"}
        </button>
      </div>
      {refreshError && <p className="mt-2 text-sm text-red-400">{refreshError}</p>}
      <p className="mt-1 text-xs text-gray-500">
        Refreshes every series' full catalog from IGDB, then sorts the list on the left by
        percentage played (most complete first).
      </p>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-red-900/40 pb-2">
        {SIZE_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setSizeTab(tab.key)}
            className={
              "rounded-lg px-3 py-1.5 text-sm font-medium transition " +
              (sizeTab === tab.key
                ? "bg-amber-500 text-gray-950"
                : "bg-gray-800/60 text-gray-400 hover:bg-gray-800 hover:text-gray-200")
            }
          >
            {tab.label}
            <span className="ml-1.5 text-xs opacity-70">
              {tab.key === "all" ? series.length : series.filter((s) => bucketOf(s.totalCount) === tab.key).length}
            </span>
          </button>
        ))}
      </div>

      {sizeTab === "all" && (
        <input
          value={catalogSearch}
          onChange={(e) => setCatalogSearch(e.target.value)}
          placeholder="Search the full catalogue by series name..."
          className="mt-4 w-full max-w-md rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
        />
      )}

      <div className="mt-4 flex gap-6">
        <nav className="flex w-64 flex-shrink-0 flex-col gap-1">
          {visibleSeries.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-500">No series match.</p>
          )}
          {visibleSeries.map((s) => (
            <button
              key={s.collectionId}
              onClick={() => setSelectedId(s.collectionId)}
              className={
                "flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition " +
                (s.collectionId === active.collectionId
                  ? "bg-amber-500 text-gray-950"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200")
              }
            >
              <span className="truncate">{s.name}</span>
              <span className="ml-2 flex-shrink-0 text-xs opacity-70">
                {s.ownedCount}/{s.totalCount}
              </span>
            </button>
          ))}
        </nav>

        <div className="flex-1">
          <div>
            <h2 className="text-lg font-semibold text-white">{active.name}</h2>
            <p className="text-xs text-gray-500">
              {active.catalogFetchedAt
                ? `Full catalog last refreshed ${new Date(active.catalogFetchedAt).toLocaleDateString()}`
                : "Full catalog not yet fetched — showing owned games only until you refresh."}
            </p>
          </div>

          {slotsLoading ? (
            <p className="mt-6 text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {slots.map((slot) => (
                <div key={slot.canonicalIgdbId} className="flex flex-col">
                  <button
                    onClick={() => slot.ownedGameId && onSelectGame({ id: slot.ownedGameId, title: slot.title })}
                    disabled={!slot.owned}
                    className={
                      "aspect-[3/4] w-full overflow-hidden rounded-lg bg-gray-800 ring-1 ring-white/10 transition " +
                      (slot.owned ? "hover:ring-red-600" : "cursor-default opacity-50 grayscale")
                    }
                    title={slot.owned ? slot.title : `${slot.title} — not in your library`}
                  >
                    {slot.coverArtUrl ? (
                      <CoverArt
                        gameId={slot.ownedGameId ?? `catalog-${slot.canonicalIgdbId}`}
                        url={slot.coverArtUrl}
                        alt={slot.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-gray-500">
                        {slot.title}
                      </div>
                    )}
                  </button>
                  <p className="mt-1.5 truncate text-sm font-medium text-gray-200">{slot.title}</p>
                  <p className="text-xs text-gray-500">
                    {slot.releaseYear ?? "—"}
                    {slot.ownedViaOverride && " · manual match"}
                  </p>

                  {!slot.owned && (
                    <div className="mt-1">
                      {overrideOpenFor === slot.canonicalIgdbId ? (
                        <div className="rounded-lg bg-gray-900 p-2 ring-1 ring-white/10">
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
                                onClick={() => handleSetOverride(slot.canonicalIgdbId, g.id)}
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
                      ) : (
                        <button
                          onClick={() => setOverrideOpenFor(slot.canonicalIgdbId)}
                          className="text-xs text-gray-500 underline hover:text-gray-300"
                        >
                          own this via a different edition
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

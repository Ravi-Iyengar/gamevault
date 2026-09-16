import { useState } from "react";
import { getDatabase } from "../database/database";
import { getIgdbCredentials } from "../services/SettingsService";
import { IgdbClient } from "../services/IgdbClient";
import { createManualGame, searchGamesForAdd, GameSearchResult } from "../services/GameEditService";
import { enrichSingleGame } from "../services/EnrichmentService";
import CoverArt from "./CoverArt";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

type Status = "backlog" | "playing" | "wishlist" | "none";

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "playing", label: "Currently Playing" },
  { value: "wishlist", label: "Wishlist" },
  { value: "none", label: "None of these" },
];

/**
 * Add Game modal. Two ways this can end:
 *  - Pick an IGDB search result: creates the game with IGDBId set, then
 *    immediately runs enrichSingleGame so cover art/genre data shows up
 *    right away instead of waiting for the next batch enrichment run.
 *  - "Add without linking": creates a bare title-only stub — can be
 *    linked to IGDB later by editing it (once that's built) or just
 *    left as-is.
 *
 * Search is debounced client-side (a fixed delay after typing stops,
 * not on every keystroke) — IGDB's search endpoint still counts against
 * the same rate limit as everything else IgdbClient does.
 */
export default function AddGameModal({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("backlog");
  const [searchResults, setSearchResults] = useState<GameSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [debounceHandle, setDebounceHandle] = useState<ReturnType<typeof setTimeout> | null>(null);

  function handleTitleChange(value: string) {
    setTitle(value);
    setSearchResults([]);
    setSearchError(null);
    if (debounceHandle) clearTimeout(debounceHandle);
    if (!value.trim()) return;
    const handle = setTimeout(() => runSearch(value), 500);
    setDebounceHandle(handle);
  }

  async function runSearch(query: string) {
    setSearching(true);
    setSearchError(null);
    try {
      const creds = await getIgdbCredentials();
      if (!creds) throw new Error("Save your IGDB Client ID and Secret in Settings first.");
      const client = new IgdbClient(creds.clientId, creds.clientSecret);
      const results = await searchGamesForAdd(client, query);
      setSearchResults(results);
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }

  async function handlePickResult(result: GameSearchResult) {
    setSaving(true);
    setSaveError(null);
    try {
      const db = await getDatabase();
      const gameId = await createManualGame(db, {
        title: result.title,
        igdbId: result.igdbId,
        coverArtUrl: result.coverArtUrl,
        status,
      });

      const creds = await getIgdbCredentials();
      if (creds) {
        // Best-effort — if this fails (network, credentials issue), the
        // game still exists with the basic info from the search result
        // itself; it'll just be picked up by the next normal "Fetch
        // Metadata" run instead of getting full enrichment immediately.
        try {
          const client = new IgdbClient(creds.clientId, creds.clientSecret);
          await enrichSingleGame(db, client, gameId, result.igdbId);
        } catch (e) {
          console.error("Immediate enrichment for new game failed (non-fatal):", e);
        }
      }

      onCreated();
    } catch (e) {
      setSaveError(String(e));
      setSaving(false);
    }
  }

  async function handleAddWithoutLinking() {
    if (!title.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const db = await getDatabase();
      await createManualGame(db, { title, status });
      onCreated();
    } catch (e) {
      setSaveError(String(e));
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-gray-900 p-6 ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Add Game</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-400">Title</label>
          <input
            autoFocus
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Start typing a game title..."
            className="rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
          />
        </div>

        <div className="mt-4">
          <label className="text-xs font-medium text-gray-400">Status</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setStatus(opt.value)}
                className={
                  "rounded-lg px-3 py-1.5 text-xs font-medium " +
                  (status === opt.value
                    ? "bg-amber-500 text-gray-950"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200")
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {searching && <p className="mt-4 text-sm text-gray-500">Searching IGDB...</p>}
        {searchError && <p className="mt-4 text-sm text-red-400">{searchError}</p>}

        {searchResults.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <p className="text-xs text-gray-500">Pick a match, or add without linking below.</p>
            {searchResults.map((r) => (
              <button
                key={r.igdbId}
                onClick={() => handlePickResult(r)}
                disabled={saving}
                className="flex items-center gap-3 rounded-lg bg-gray-800/60 p-2 text-left ring-1 ring-white/10 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="h-16 w-12 flex-shrink-0 overflow-hidden rounded bg-gray-900">
                  {r.coverArtUrl && (
                    <CoverArt gameId={`search-${r.igdbId}`} url={r.coverArtUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-200">
                    {r.title}
                    {r.isRemakeOrRemaster && <span className="ml-1.5 text-xs text-amber-400">(remake/remaster)</span>}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {r.releaseYear ?? "—"}
                    {r.platforms && ` · ${r.platforms}`}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}

        {saveError && <p className="mt-4 text-sm text-red-400">{saveError}</p>}

        <div className="mt-6 flex items-center justify-between">
          <button
            onClick={handleAddWithoutLinking}
            disabled={!title.trim() || saving}
            className="text-sm text-gray-400 underline hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add without linking to IGDB
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

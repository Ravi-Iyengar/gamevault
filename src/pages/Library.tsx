import { useEffect, useMemo, useState } from "react";
import { getGames } from "../services/GameService";
import { Game, deriveStatus, GameStatus } from "../types/game";
import GameCard from "../components/GameCard";
import AddGameModal from "../components/AddGameModal";

interface Props {
  onSelectGame: (game: Game) => void;
}

const STATUS_OPTIONS: (GameStatus | "All")[] = [
  "All",
  "Playing",
  "Unfinished",
  "Completed",
  "Abandoned",
  "Shelved",
  "Retired",
  "Endless",
  "Backlog",
  "Wishlist",
  "Dropped",
];

type SortKey = "dateAdded" | "title" | "hoursPlayed" | "playthroughCount" | "rating" | "releaseYear";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "dateAdded", label: "Date Added (newest first)" },
  { key: "title", label: "Title (A–Z)" },
  { key: "hoursPlayed", label: "Hours Played (most first)" },
  { key: "playthroughCount", label: "Playthroughs (most first)" },
  { key: "rating", label: "Rating (highest first)" },
  { key: "releaseYear", label: "Release Year (newest first)" },
];

/** Every sort here pushes games missing that field to the end rather than
 * letting them sort as if they were 0/blank — a backlog game with no
 * rating yet shouldn't outrank a 9/10 game by sorting as "lower than any
 * real rating," and it shouldn't beat one either; it just doesn't
 * meaningfully compare, so it goes last regardless of direction. */
function compareGames(a: Game, b: Game, key: SortKey): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title);
    case "hoursPlayed": {
      const av = a.totalHoursPlayed;
      const bv = b.totalHoursPlayed;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    }
    case "playthroughCount": {
      const av = a.playthroughCount ?? 0;
      const bv = b.playthroughCount ?? 0;
      return bv - av;
    }
    case "rating": {
      const av = a.latestRating;
      const bv = b.latestRating;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    }
    case "releaseYear": {
      const av = a.releaseYear;
      const bv = b.releaseYear;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    }
    case "dateAdded":
    default: {
      const av = a.dateAdded;
      const bv = b.dateAdded;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      // dateAdded is a raw Unix timestamp stored as a string (Backloggd's
      // last_edited_at) — compare numerically, not lexicographically.
      return Number(bv) - Number(av);
    }
  }
}

export default function Library({ onSelectGame }: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<GameStatus | "All">("All");
  const [genreFilter, setGenreFilter] = useState<string>("All");
  const [sortKey, setSortKey] = useState<SortKey>("dateAdded");
  const [showAddGame, setShowAddGame] = useState(false);

  function loadGames() {
    setLoading(true);
    getGames()
      .then((g) => {
        setGames(g);
        setLoading(false);
      })
      .catch((e) => {
        // Without this, a thrown error here left `loading` stuck true
        // forever — an infinite spinner with the real cause visible only
        // in devtools, not to the user at all.
        setError(String(e));
        setLoading(false);
      });
  }

  useEffect(() => {
    loadGames();
  }, []);

  const allGenres = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) for (const genre of g.genres ?? []) set.add(genre);
    return ["All", ...Array.from(set).sort()];
  }, [games]);

  const filteredGames = useMemo(() => {
    return games
      .filter((game) => {
        const matchesSearch = game.title.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = statusFilter === "All" || deriveStatus(game) === statusFilter;
        const matchesGenre = genreFilter === "All" || (game.genres ?? []).includes(genreFilter);
        return matchesSearch && matchesStatus && matchesGenre;
      })
      .sort((a, b) => compareGames(a, b, sortKey));
  }, [games, search, statusFilter, genreFilter, sortKey]);

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (error) return <p className="text-red-400">Failed to load library: {error}</p>;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Library</h1>
        <button
          onClick={() => setShowAddGame(true)}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-amber-400"
        >
          + Add Game
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search games..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[200px] flex-1 rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as GameStatus | "All")}
          className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={genreFilter}
          onChange={(e) => setGenreFilter(e.target.value)}
          className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10"
        >
          {allGenres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10"
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              Sort: {s.label}
            </option>
          ))}
        </select>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        {filteredGames.length} of {games.length} games
      </p>

      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
        {filteredGames.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            onClick={() => onSelectGame(game)}
            subtitle={
              game.totalHoursPlayed ? `${game.totalHoursPlayed.toFixed(0)}h` : deriveStatus(game)
            }
          />
        ))}
      </div>

      {filteredGames.length === 0 && (
        <p className="mt-8 text-center text-sm text-gray-600">No games match these filters.</p>
      )}

      {showAddGame && (
        <AddGameModal
          onClose={() => setShowAddGame(false)}
          onCreated={() => {
            setShowAddGame(false);
            loadGames();
          }}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { getGames, getFavorites, getCurrentlyPlaying, getMostReturnedTo } from "../services/GameService";
import { getRecentCompletions, getHoursThisMonth, getCurrentStreak, RecentCompletion } from "../services/DashboardService";
import { getHoursByPlatform, getHoursByGenre } from "../services/AnalyticsService";
import { Game } from "../types/game";
import GameCard from "../components/GameCard";

interface Props {
  onGoToSettings: () => void;
  onSelectGame: (game: Game) => void;
}

function GameRow({ title, games, onSelectGame, emptyText }: {
  title: string;
  games: Game[];
  onSelectGame: (g: Game) => void;
  emptyText: string;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{title}</h2>
      {games.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">{emptyText}</p>
      ) : (
        <div className="mt-2 flex gap-4 overflow-x-auto pb-2">
          {games.map((g) => (
            <GameCard key={g.id} game={g} onClick={() => onSelectGame(g)} />
          ))}
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-gray-800/60 p-4 ring-1 ring-white/5">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function DistributionList({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-xl bg-gray-800/60 p-4 ring-1 ring-white/5">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{title}</p>
      <div className="mt-3 flex flex-col gap-2">
        {rows.slice(0, 6).map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            <span className="w-28 truncate text-gray-300">{r.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded bg-gray-700">
              <div
                className="h-full rounded bg-amber-500"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
            <span className="w-6 text-right text-gray-500">{r.count}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-gray-600">No data yet.</p>}
      </div>
    </div>
  );
}

export default function Dashboard({ onGoToSettings, onSelectGame }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allGames, setAllGames] = useState<Game[]>([]);
  const [favorites, setFavorites] = useState<Game[]>([]);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<Game[]>([]);
  const [mostReturnedTo, setMostReturnedTo] = useState<Game[]>([]);
  const [recentCompletions, setRecentCompletions] = useState<RecentCompletion[]>([]);
  const [hoursThisMonth, setHoursThisMonth] = useState(0);
  const [streak, setStreak] = useState(0);
  const [platformDist, setPlatformDist] = useState<{ label: string; count: number }[]>([]);
  const [genreDist, setGenreDist] = useState<{ label: string; count: number }[]>([]);

  useEffect(() => {
    Promise.all([
      getGames(),
      getFavorites(),
      getCurrentlyPlaying(),
      getMostReturnedTo(),
      getRecentCompletions(),
      getHoursThisMonth(),
      getCurrentStreak(),
      getHoursByPlatform(),
      getHoursByGenre(),
    ])
      .then(([games, favs, playing, returned, completions, hours, streakDays, platforms, genres]) => {
        setAllGames(games);
        setFavorites(favs);
        setCurrentlyPlaying(playing);
        setMostReturnedTo(returned);
        setRecentCompletions(completions);
        setHoursThisMonth(hours);
        setStreak(streakDays);
        setPlatformDist(platforms.map((p) => ({ label: p.platform, count: p.gameCount })));
        setGenreDist(genres.map((g) => ({ label: g.genre, count: g.gameCount })));
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (error) return <p className="text-red-400">Failed to load dashboard: {error}</p>;

  if (allGames.length === 0) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-bold text-white">Welcome to GameVault</h1>
        <p className="mt-2 text-gray-400">Your library is empty. Import your Backloggd export to get started.</p>
        <button
          onClick={onGoToSettings}
          className="mt-6 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-amber-400"
        >
          Go to Settings to Import
        </button>
      </div>
    );
  }

  const backlogCount = allGames.filter((g) => g.isBacklog).length;
  const wishlistCount = allGames.filter((g) => g.isWishlist).length;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold text-white">Dashboard</h1>

      <GameRow title="Currently Playing" games={currentlyPlaying} onSelectGame={onSelectGame} emptyText="Nothing marked as currently playing." />
      <GameRow title="Favorites" games={favorites} onSelectGame={onSelectGame} emptyText="No favorites marked yet." />
      <GameRow title="Most Returned To" games={mostReturnedTo} onSelectGame={onSelectGame} emptyText="No replayed games yet." />

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Activity</h2>
        <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Hours this month" value={hoursThisMonth.toFixed(1)} />
          <StatCard label="Current streak (days)" value={streak} />
          <StatCard label="Recent completions" value={recentCompletions.length} />
          <StatCard label="Library size" value={allGames.length} />
        </div>
        {recentCompletions.length > 0 && (
          <div className="mt-3 flex gap-4 overflow-x-auto pb-2">
            {recentCompletions.map((c) => (
              <GameCard
                key={c.gameId + c.finishDate}
                game={{ id: c.gameId, title: c.title, coverArtUrl: c.coverArtUrl ?? undefined }}
                subtitle={c.finishDate}
                onClick={() => onSelectGame({ id: c.gameId, title: c.title })}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Collection</h2>
        <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <StatCard label="Library size" value={allGames.length} />
          <StatCard label="Backlog size" value={backlogCount} />
          <StatCard label="Wishlist size" value={wishlistCount} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DistributionList title="Platform Distribution" rows={platformDist} />
          <DistributionList title="Genre Distribution" rows={genreDist} />
        </div>
        {(platformDist.length === 0 || genreDist.length === 0) && (
          <p className="mt-2 text-xs text-gray-600">
            Platform/genre distribution needs metadata — fetch it from Settings.
          </p>
        )}
      </section>
    </div>
  );
}

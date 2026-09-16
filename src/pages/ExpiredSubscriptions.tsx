import { useEffect, useState } from "react";
import { getExpiredSubscriptionGames, ExpiredSubscriptionGame } from "../services/SubscriptionService";
import GameCard from "../components/GameCard";
import { Game } from "../types/game";

interface Props {
  onSelectGame: (game: Game) => void;
}

export default function ExpiredSubscriptions({ onSelectGame }: Props) {
  const [games, setGames] = useState<ExpiredSubscriptionGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getExpiredSubscriptionGames()
      .then((g) => {
        setGames(g);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (error) return <p className="text-red-400">Failed to load: {error}</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Expired Subscriptions</h1>
      <p className="mt-2 text-sm text-gray-400">
        Games you own through a subscription service you've since unticked in Settings — you'd
        need to resubscribe to play these again. Toggle a subscription back on in Settings if this
        list doesn't look right.
      </p>

      {games.length === 0 ? (
        <p className="mt-8 text-center text-sm text-gray-600">
          Nothing here — either all your subscriptions are active, or you don't own anything
          through a subscription service.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
          {games.map((g) => (
            <GameCard
              key={g.gameId}
              game={{ id: g.gameId, title: g.title, coverArtUrl: g.coverArtUrl ?? undefined }}
              subtitle={g.storefrontName}
              onClick={() => onSelectGame({ id: g.gameId, title: g.title })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

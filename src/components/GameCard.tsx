import { Game } from "../types/game";
import CoverArt from "./CoverArt";

interface Props {
  game: Game;
  onClick?: () => void;
  subtitle?: string;
}

/** Games without cover art yet (before IGDB enrichment has run) fall back
 * to a plain title tile rather than a broken image. */
export default function GameCard({ game, onClick, subtitle }: Props) {
  return (
    <button
      onClick={onClick}
      className="group flex w-36 flex-col text-left"
      title={game.title}
    >
      <div className="aspect-[3/4] w-full overflow-hidden rounded-lg bg-gray-800 ring-1 ring-white/10 transition group-hover:ring-red-600">
        {game.coverArtUrl ? (
          <CoverArt
            gameId={game.id}
            url={game.coverArtUrl}
            alt={game.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-gray-500">
            {game.title}
          </div>
        )}
      </div>
      <p className="mt-1.5 truncate text-sm font-medium text-gray-200">{game.title}</p>
      {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
    </button>
  );
}

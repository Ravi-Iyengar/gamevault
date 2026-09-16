import { QuarterMoment } from "../services/TimeGalleryService";
import { getFlavorText } from "../services/TimeGalleryFlavorText";
import StarRating from "./StarRating";
import CoverArt from "./CoverArt";

interface Props {
  moment: QuarterMoment;
  onClick: () => void;
}

export default function TimeGalleryCard({ moment, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col overflow-hidden rounded-xl bg-gray-800/60 text-left ring-1 ring-white/10 transition hover:ring-red-600"
    >
      <div className="h-36 w-full overflow-hidden bg-gray-800">
        {moment.coverArtUrl ? (
          <CoverArt
            gameId={moment.gameId}
            url={moment.coverArtUrl}
            alt={moment.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-gray-500">
            {moment.title}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-sm font-semibold text-white">{moment.title}</p>

        <p className="text-xs leading-relaxed text-gray-400">{getFlavorText(moment)}</p>

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-gray-500">
          {moment.hoursThisQuarter > 0 && <span>{moment.hoursThisQuarter}h</span>}
          {moment.sessionCount > 0 && (
            <span>
              {moment.sessionCount} session{moment.sessionCount === 1 ? "" : "s"}
            </span>
          )}
          {moment.dominantPlatform && <span>{moment.dominantPlatform}</span>}
        </div>

        {moment.rating != null && (
          <div className="flex items-center gap-1.5">
            <StarRating rating={moment.rating} />
            {moment.ratingIsFallback && <span className="text-[10px] text-gray-600">(overall)</span>}
          </div>
        )}
      </div>
    </button>
  );
}

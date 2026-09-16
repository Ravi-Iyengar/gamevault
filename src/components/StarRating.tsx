import { useId } from "react";

/**
 * Rating is 0–10; stars are out of 5, so divide by 2. Renders full/half/
 * empty stars via an SVG gradient split rather than just showing a
 * number.
 *
 * Extracted from GameDetail (which only ever shows one of these per
 * page) into a shared component for Time Gallery, which renders many at
 * once — that surfaced a real bug worth fixing here, not just carrying
 * over: the gradient `id`s only varied by star index (1–5), not by which
 * StarRating instance they belonged to. With a single instance per page
 * that was invisible, but with many on screen at once, every instance's
 * "star 1" gradient shared the same id, and `url(#star-fill-1)` in SVG
 * resolves to whichever definition appears first in the DOM — so every
 * card after the first could silently render the wrong fill. `useId()`
 * gives each instance a stable, unique prefix, so gradients never
 * collide across cards.
 */
export default function StarRating({ rating }: { rating: number }) {
  const instanceId = useId();
  const stars = Math.round((rating / 2) * 2) / 2; // nearest half-star

  return (
    <div className="flex items-center gap-0.5" title={`${rating}/10`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = stars >= i ? "100%" : stars >= i - 0.5 ? "50%" : "0%";
        const gradientId = `star-fill-${instanceId}-${i}`;
        return (
          <svg key={i} viewBox="0 0 20 20" className="h-4 w-4">
            <defs>
              <linearGradient id={gradientId}>
                <stop offset={fill} stopColor="#f59e0b" />
                <stop offset={fill} stopColor="#374151" />
              </linearGradient>
            </defs>
            <path
              fill={`url(#${gradientId})`}
              d="M10 1.5l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.6-4.1 6.1-.6z"
            />
          </svg>
        );
      })}
    </div>
  );
}

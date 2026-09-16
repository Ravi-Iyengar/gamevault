import { useEffect, useState } from "react";
import { getCachedCoverArtSrc } from "../services/CoverArtCache";

interface Props {
  gameId: string;
  url: string | null;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
}

/**
 * Drop-in replacement for a plain <img src={coverArtUrl}> that
 * transparently uses the local disk cache (see CoverArtCache.ts)
 * instead of always hitting IGDB's live CDN. Callers keep their own
 * "no cover art at all" fallback UI around this — it renders nothing
 * when `url` is null, same as the plain <img> it replaces would have.
 *
 * Starts by showing the remote URL immediately (no blank flash while
 * the cache check runs in the background) and swaps to the local
 * cached path once/if that resolves — visually a no-op once the image
 * is already loaded, since browsers don't re-fetch on an unchanged
 * `src` and the caching only touches the network address, not the
 * pixels shown.
 */
export default function CoverArt({ gameId, url, alt, className, loading = "lazy" }: Props) {
  const [src, setSrc] = useState<string | null>(url);

  useEffect(() => {
    setSrc(url);
    if (!url) return;
    let cancelled = false;
    getCachedCoverArtSrc(gameId, url).then((resolved) => {
      if (!cancelled && resolved) setSrc(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [gameId, url]);

  if (!src) return null;
  return <img src={src} alt={alt} loading={loading} className={className} />;
}

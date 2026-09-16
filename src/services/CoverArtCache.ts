import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";

/**
 * Local disk cache for IGDB cover art (README item, project handoff
 * Section 9.4/9.5: "Local cover art caching — currently always loaded
 * live from IGDB's CDN"). Every cover-art <img> previously pointed
 * straight at Games.CoverArtUrl (images.igdb.com) on every render,
 * meaning the app needed a live connection just to show a cover it had
 * already fetched once before, and re-downloaded it on every visit.
 *
 * Images are cached to disk once per game (keyed by gameId, not the
 * URL itself — IGDB's own CDN URL for a given game's cover doesn't
 * change) under the Tauri app data directory in a `cover-art/`
 * subfolder, and served back to <img> tags via Tauri's asset protocol
 * (convertFileSrc) instead of being re-fetched. Falls back to the live
 * URL whenever the cache can't be resolved (no network, a write
 * failure, app-data-dir resolution failing) — a cache miss should never
 * be worse than the pre-caching behavior.
 *
 * Implemented with plain Rust std::fs commands (get_app_cache_dir /
 * file_exists / write_binary_file in src-tauri/src/lib.rs) rather than
 * the Tauri fs plugin, consistent with this project's existing pattern
 * (see run_python_script / read_binary_file) of custom app commands for
 * filesystem work, which need no capability/ACL entry — unlike a
 * plugin-provided command would.
 *
 * UNVERIFIED end-to-end: built without the ability to actually run the
 * app or hit a real network in this environment, same caveat as this
 * project's other Rust-backed features before their first real test.
 */

let cacheDirPromise: Promise<string> | null = null;

function getCacheDir(): Promise<string> {
  if (!cacheDirPromise) {
    cacheDirPromise = invoke<string>("get_app_cache_dir");
  }
  // Non-null assertion: the branch above guarantees this is set by this
  // point, but TypeScript doesn't carry that narrowing across a
  // module-level `let` reliably.
  return cacheDirPromise!;
}

// In-memory de-dupe so two components mounting for the same game at
// once (e.g. the same game showing in both a Dashboard carousel and a
// Library grid) don't each independently kick off a download of the
// same cover.
const inFlight = new Map<string, Promise<string | null>>();

function extensionFromUrl(url: string): string {
  const lastSegment = url.split("/").pop() ?? "";
  const withoutQuery = lastSegment.split("?")[0];
  const dot = withoutQuery.lastIndexOf(".");
  return dot >= 0 ? withoutQuery.slice(dot + 1) : "jpg";
}

/**
 * Returns a src usable directly in an <img> tag: a local asset:// URL
 * if the cover is already cached (or was just downloaded successfully),
 * or the original remote URL as a fallback. Never throws.
 */
export async function getCachedCoverArtSrc(
  gameId: string,
  remoteUrl: string | null
): Promise<string | null> {
  if (!remoteUrl) return null;

  const cacheKey = gameId;
  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    try {
      const dir = await getCacheDir();
      const localPath = `${dir}/${gameId}.${extensionFromUrl(remoteUrl)}`;

      const exists = await invoke<boolean>("file_exists", { path: localPath });
      if (exists) return convertFileSrc(localPath);

      const response = await fetch(remoteUrl);
      if (!response.ok) return remoteUrl;
      const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
      await invoke("write_binary_file", { path: localPath, bytes });
      return convertFileSrc(localPath);
    } catch {
      return remoteUrl;
    }
  })();

  inFlight.set(cacheKey, promise);
  return promise;
}

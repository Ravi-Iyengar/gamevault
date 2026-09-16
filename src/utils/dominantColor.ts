/**
 * Best-effort average color from a game's cover art, used for Time
 * Gallery's per-year background tint (themed around that year's
 * highest-rated game).
 *
 * Real pixel sampling via canvas is attempted first, but this is
 * genuinely unverified: it depends on IGDB's image CDN sending
 * permissive-enough CORS headers for `ctx.getImageData()` to succeed
 * without throwing a tainted-canvas security error, which couldn't be
 * checked from this environment (no way to load a real cross-origin
 * image here). Any failure — network, decode, or a security error —
 * falls back to a deterministic color hashed from the game's own title.
 * That fallback is still specific to that game (same title always
 * produces the same color) even though it isn't literally sampled from
 * the image's pixels, so a year's tint is never just arbitrary even in
 * the worst case.
 */

const colorCache = new Map<string, string>();

function hashToHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h) % 360;
}

function fallbackColor(seed: string): string {
  // Converted to rgb() rather than left as hsl() so every caller only
  // ever has to handle one color format — this function and
  // sampleAverageColor() below are the two possible sources, and
  // downstream code (Time Gallery's gradient tint) needs to append an
  // alpha channel, which is far more reliably done for "rgb(r, g, b)"
  // than for a comma-form hsl() string with an alpha bolted on.
  const hue = hashToHue(seed);
  const [r, g, b] = hslToRgb(hue, 0.5, 0.3);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Standard HSL->RGB conversion (h in degrees 0-360, s/l as 0-1 fractions). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r1, g1, b1] = [0, 0, 0];
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

function sampleAverageColor(imageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        // Downscaled to a small canvas — only the average matters here,
        // not per-pixel detail, and it's much cheaper to average 144
        // pixels than a full-resolution cover.
        const size = 12;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context unavailable");
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size); // throws if the canvas is tainted by a cross-origin image without proper CORS headers

        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        resolve(`rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = imageUrl;
  });
}

/**
 * `cacheKey` should uniquely identify what's being colored (e.g. a
 * year), not just the game — the same game could in principle be the
 * top-rated pick for two different years, and re-deriving is cheap
 * either way, but a stable key keeps the cache simple and correct.
 */
export async function getDominantColor(
  cacheKey: string,
  imageUrl: string | null,
  titleForFallback: string
): Promise<string> {
  const cached = colorCache.get(cacheKey);
  if (cached) return cached;

  let color: string;
  if (!imageUrl) {
    color = fallbackColor(titleForFallback);
  } else {
    try {
      color = await sampleAverageColor(imageUrl);
    } catch {
      color = fallbackColor(titleForFallback);
    }
  }

  colorCache.set(cacheKey, color);
  return color;
}

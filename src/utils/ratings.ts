/**
 * Backloggd stores "no rating given" as a raw 0, not null — confirmed
 * (same export format, same finding as the GameVault sibling project,
 * GLIP): every rating=0 entry also has zero logged hours, including
 * entries marked "completed", which rules out 0 being a genuine score.
 * Backloggd's own UI can't assign a 0-star rating in the first place.
 *
 * Every read of a Backloggd rating value should go through this function
 * rather than using the raw number directly.
 */
export function effectiveRating(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (raw === 0) return null;
  return raw;
}

/** Stars = Rating / 2, rounded to the nearest half star (spec section 5B/5I). */
export function ratingToStars(rating: number | null | undefined): number | null {
  const effective = effectiveRating(rating ?? null);
  if (effective === null) return null;
  return Math.round((effective / 2) * 2) / 2;
}

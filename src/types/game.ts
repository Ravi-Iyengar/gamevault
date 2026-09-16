export interface Game {
  id: string;

  title: string;

  releaseDate?: string;
  releaseYear?: number;

  summary?: string;
  coverArtUrl?: string;
  franchises?: string[];

  playthroughCount?: number;
  hasFinishedPlaythrough?: boolean;
  latestRating?: number;
  totalHoursPlayed?: number;
  dateAdded?: string;

  isFavorite?: boolean;
  isLiked?: boolean;
  isWishlist?: boolean;
  isBacklog?: boolean;
  isPlaying?: boolean;
  statusRaw?: string;

  genres?: string[];
}

/**
 * Derived, not stored (spec 5J) — computed here from UserGames.StatusRaw
 * (Backloggd's own status string) plus the raw is_backlog/is_playing/
 * is_wishlist flags and playthrough completion evidence.
 *
 * Precedence (revised — see the note below on why):
 *
 *   1. is_backlog AND is_playing together -> Unfinished (started while
 *      clearing the backlog, not done yet — distinct from either flag
 *      alone)
 *   2. is_backlog AND NOT hasFinishedPlaythrough -> Backlog, regardless
 *      of what StatusRaw says (see below)
 *   3. is_playing alone -> Playing
 *   4. Backloggd's own status string, mapped as confirmed:
 *        completed -> Completed
 *        abandoned -> Abandoned
 *        shelved   -> Shelved
 *        retired   -> Retired   (no defined ending, done with it, not
 *                                 disliked — e.g. an old sports title
 *                                 you're not returning to)
 *        played    -> Endless   (no defined ending, still returning to
 *                                 it depending on mood — e.g. a live
 *                                 service or sandbox game)
 *   5. is_backlog (remaining — e.g. a finished playthrough despite the
 *      flag, but no StatusRaw at all) -> Backlog
 *   6. is_wishlist -> Wishlist
 *   7. hasFinishedPlaythrough (no flags, no StatusRaw) -> Completed
 *   8. has playthroughs, none finished -> Dropped
 *   9. otherwise -> Unknown
 *
 * WHY #2 EXISTS — an earlier version of this function checked StatusRaw
 * first, on the reasoning that it's a deliberate classification the user
 * already made and shouldn't be second-guessed. That reasoning was
 * wrong in one specific, checkable way: cross-tabulating status against
 * is_backlog and finish dates across the real 408-game export showed
 * that every single is_backlog=true game (all 114 of them) ALSO carries
 * a non-null StatusRaw — 52 marked "completed" with zero finished
 * playthroughs, 32 marked "played" with zero playthroughs at all, 20
 * more marked "played" with playthroughs but none finished, 10 marked
 * "completed" with no playthroughs at all. With the old precedence,
 * every one of those 114 games got swallowed into Completed/Endless
 * instead of ever showing as Backlog — which is exactly the bug
 * reported (Backlog empty, Endless/Completed containing games that were
 * still unplayed, e.g. Nioh and Super Meat Boy). Since none of those
 * conflicting rows have ANY completion evidence backing the status
 * string, trusting is_backlog over StatusRaw in that specific situation
 * isn't a guess — it's the reading the evidence actually supports. If a
 * future re-import ever produces an is_backlog=true game that DOES have
 * a finished playthrough, this rule steps aside (see precedence #2's
 * condition) and StatusRaw drives it as before.
 */
export type GameStatus =
  | "Unfinished"
  | "Completed"
  | "Abandoned"
  | "Shelved"
  | "Retired"
  | "Endless"
  | "Playing"
  | "Backlog"
  | "Wishlist"
  | "Dropped"
  | "Unknown";

const STATUS_RAW_MAP: Record<string, GameStatus> = {
  completed: "Completed",
  abandoned: "Abandoned",
  shelved: "Shelved",
  retired: "Retired",
  played: "Endless",
};

export function deriveStatus(
  game: Pick<Game, "isBacklog" | "isPlaying" | "isWishlist" | "statusRaw" | "hasFinishedPlaythrough" | "playthroughCount">
): GameStatus {
  if (game.isBacklog && game.isPlaying) return "Unfinished";
  if (game.isBacklog && !game.hasFinishedPlaythrough) return "Backlog";
  if (game.isPlaying) return "Playing";

  const fromStatusRaw = game.statusRaw ? STATUS_RAW_MAP[game.statusRaw.toLowerCase()] : undefined;
  if (fromStatusRaw) return fromStatusRaw;

  if (game.isBacklog) return "Backlog";
  if (game.isWishlist) return "Wishlist";
  if (game.hasFinishedPlaythrough) return "Completed";
  if ((game.playthroughCount ?? 0) > 0) return "Dropped";
  return "Unknown";
}

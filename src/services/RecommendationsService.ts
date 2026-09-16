import type { DbClient } from "../database/database";

/**
 * Powers the Recommendations page's three sections. All three lean on
 * data already in the schema — played-game ratings/hours, GLIP's
 * Recommendations table (when present), and Favorite/Liked/DesireToPlay
 * — rather than anything new. Nothing here calls IGDB or GLIP directly;
 * it's pure read/aggregate logic over what's already been imported.
 */

export interface GroupSuggestion {
  groupType: "franchise" | "collection";
  groupId: number;
  groupName: string;
  avgRating: number; // 0-10, same scale as Playthroughs.Rating
  gamesPlayed: number;
  candidateGameId: string;
  candidateTitle: string;
  candidateCoverArtUrl: string | null;
  candidateHasRecommendation: boolean;
}

export interface BacklogSuggestion {
  gameId: string;
  title: string;
  coverArtUrl: string | null;
  recommendationScore: number | null;
  predictedRating: number | null;
  topFactors: string[];
  desireToPlay: number | null;
}

export interface ComfortPick {
  gameId: string;
  title: string;
  coverArtUrl: string | null;
  rating: number | null;
  isFavorite: boolean;
  isLiked: boolean;
  comfortScore: number | null; // explicit 1-5 Comfort Quiz answer, if this game has one
}

/** Shared with GameDetail's identical parsing of GLIP's SHAP-style
 * explanation JSON — kept as a small local copy rather than a shared
 * import since GameDetail's version is inlined in JSX and not currently
 * exported; behavior is intentionally identical. */
function parseTopFactors(explanationJson: string | null): string[] {
  if (!explanationJson) return [];
  try {
    const parsed = JSON.parse(explanationJson);
    const factors: { feature?: string }[] = parsed.top_factors ?? [];
    return factors.map((f) => f.feature).filter((f): f is string => Boolean(f));
  } catch {
    return [];
  }
}

interface GroupMemberRow {
  GroupId: number;
  GroupName: string;
  GameId: string;
  Title: string;
  CoverArtUrl: string | null;
  Rating: number | null;
  HasFinished: number;
  RecommendationScore: number | null;
  DesireToPlay: number | null;
}

async function computeGroupSuggestions(
  db: DbClient,
  groupTable: "Franchises" | "Collections",
  joinTable: "GameFranchises" | "GameCollections",
  groupIdCol: "FranchiseId" | "CollectionId",
  groupType: "franchise" | "collection"
): Promise<GroupSuggestion[]> {
  const rows = await db.select<GroupMemberRow>(`
    SELECT
      gr.Id AS GroupId,
      gr.Name AS GroupName,
      g.Id AS GameId,
      g.Title AS Title,
      g.CoverArtUrl AS CoverArtUrl,
      bestRating.Rating AS Rating,
      COALESCE(bestRating.HasFinished, 0) AS HasFinished,
      rec.RecommendationScore AS RecommendationScore,
      ug.DesireToPlay AS DesireToPlay
    FROM ${groupTable} gr
    JOIN ${joinTable} j ON j.${groupIdCol} = gr.Id
    JOIN Games g ON g.Id = j.GameId
    LEFT JOIN UserGames ug ON ug.GameId = g.Id
    LEFT JOIN (
      SELECT GameId, MAX(Rating) AS Rating, MAX(CASE WHEN FinishDate IS NOT NULL THEN 1 ELSE 0 END) AS HasFinished
      FROM Playthroughs GROUP BY GameId
    ) bestRating ON bestRating.GameId = g.Id
    LEFT JOIN Recommendations rec ON rec.GameId = g.Id
  `);

  const byGroup = new Map<number, GroupMemberRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.GroupId) ?? [];
    list.push(row);
    byGroup.set(row.GroupId, list);
  }

  const suggestions: GroupSuggestion[] = [];
  for (const [groupId, members] of byGroup) {
    const played = members.filter((m) => m.HasFinished === 1 && m.Rating != null);
    if (played.length === 0) continue; // no basis to judge preference for this group

    const avgRating = played.reduce((sum, m) => sum + (m.Rating as number), 0) / played.length;

    const candidates = members.filter((m) => m.HasFinished === 0);
    if (candidates.length === 0) continue; // nothing left unplayed in this group to suggest

    candidates.sort((a, b) => {
      const scoreA = a.RecommendationScore ?? -Infinity;
      const scoreB = b.RecommendationScore ?? -Infinity;
      if (scoreA !== scoreB) return scoreB - scoreA;
      const desireA = a.DesireToPlay ?? -1;
      const desireB = b.DesireToPlay ?? -1;
      if (desireA !== desireB) return desireB - desireA;
      return a.Title.localeCompare(b.Title);
    });
    const best = candidates[0];

    suggestions.push({
      groupType,
      groupId,
      groupName: members[0].GroupName,
      avgRating,
      gamesPlayed: played.length,
      candidateGameId: best.GameId,
      candidateTitle: best.Title,
      candidateCoverArtUrl: best.CoverArtUrl,
      candidateHasRecommendation: best.RecommendationScore != null,
    });
  }

  return suggestions;
}

/**
 * "Suggested franchise/collection to play" — ranks every franchise and
 * collection with at least one finished, rated game by average rating,
 * then pairs each with the best unplayed candidate already in the
 * library from that same group (preferring a GLIP recommendation if one
 * exists, then DesireToPlay). A group with nothing left unplayed is
 * left out entirely — there's nothing to suggest. Franchise and
 * collection results are merged and deduped by candidate game (the
 * higher-scoring group wins if the same game would otherwise be
 * suggested twice), then sorted by average rating.
 */
export async function getFranchiseSuggestions(db: DbClient, limit = 6): Promise<GroupSuggestion[]> {
  const [franchiseSuggestions, collectionSuggestions] = await Promise.all([
    computeGroupSuggestions(db, "Franchises", "GameFranchises", "FranchiseId", "franchise"),
    computeGroupSuggestions(db, "Collections", "GameCollections", "CollectionId", "collection"),
  ]);

  const combined = [...franchiseSuggestions, ...collectionSuggestions];
  combined.sort((a, b) => b.avgRating - a.avgRating || b.gamesPlayed - a.gamesPlayed);

  const seenGameIds = new Set<string>();
  const deduped: GroupSuggestion[] = [];
  for (const s of combined) {
    if (seenGameIds.has(s.candidateGameId)) continue;
    seenGameIds.add(s.candidateGameId);
    deduped.push(s);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

interface BacklogRow {
  GameId: string;
  Title: string;
  CoverArtUrl: string | null;
  RecommendationScore: number | null;
  PredictedRating: number | null;
  ExplanationJson: string | null;
  DesireToPlay: number | null;
}

/** Shared by both "not yet finished" (backlog) and "wishlist" suggestion
 * queries: GLIP's Recommendations lead when present, ranked by
 * RecommendationScore; anything without one still shows up after,
 * ranked by DesireToPlay instead of being left out entirely — most
 * libraries won't have run GLIP retraining (and wishlist recommendations
 * specifically may not exist yet even for libraries that have — see the
 * module doc comment), so an empty section would be a worse default
 * than a DesireToPlay-ranked one. */
function rankByRecommendationThenDesire(rows: BacklogRow[], limit: number): BacklogSuggestion[] {
  const withRecommendation = rows
    .filter((r) => r.RecommendationScore != null)
    .sort((a, b) => (b.RecommendationScore as number) - (a.RecommendationScore as number));
  const withoutRecommendation = rows
    .filter((r) => r.RecommendationScore == null)
    .sort((a, b) => (b.DesireToPlay ?? -1) - (a.DesireToPlay ?? -1));

  return [...withRecommendation, ...withoutRecommendation].slice(0, limit).map((r) => ({
    gameId: r.GameId,
    title: r.Title,
    coverArtUrl: r.CoverArtUrl,
    recommendationScore: r.RecommendationScore,
    predictedRating: r.PredictedRating,
    topFactors: parseTopFactors(r.ExplanationJson),
    desireToPlay: r.DesireToPlay,
  }));
}

/**
 * "Suggested new games" — games with no finished playthrough.
 */
export async function getBacklogSuggestions(db: DbClient, limit = 10): Promise<BacklogSuggestion[]> {
  const rows = await db.select<BacklogRow>(`
    SELECT
      g.Id AS GameId,
      g.Title AS Title,
      g.CoverArtUrl AS CoverArtUrl,
      rec.RecommendationScore AS RecommendationScore,
      rec.PredictedRating AS PredictedRating,
      rec.ExplanationJson AS ExplanationJson,
      ug.DesireToPlay AS DesireToPlay
    FROM Games g
    JOIN UserGames ug ON ug.GameId = g.Id
    LEFT JOIN Recommendations rec ON rec.GameId = g.Id
    LEFT JOIN (
      SELECT GameId, MAX(CASE WHEN FinishDate IS NOT NULL THEN 1 ELSE 0 END) AS HasFinished
      FROM Playthroughs GROUP BY GameId
    ) pt ON pt.GameId = g.Id
    WHERE COALESCE(pt.HasFinished, 0) = 0
  `);

  return rankByRecommendationThenDesire(rows, limit);
}

/**
 * "Suggested wishlist games" — same ranking as the backlog section
 * (GLIP's Recommendations first, DesireToPlay as fallback), scoped to
 * UserGames.IsWishlist instead of "no finished playthrough."
 *
 * Confirmed by reading GLIP's own source directly (not guessed): its
 * candidate_pool.py deliberately excludes wishlist games from the
 * recommendation candidate pool — the docstring there calls wishlist "a
 * future acquisition pool, not part of recommendation evaluation." So
 * this isn't a matter of GLIP's export not including wishlist data yet;
 * it's an intentional filter in GLIP's own code. This section still
 * works via the DesireToPlay fallback regardless, but a GLIP-scored
 * wishlist section specifically would need that filter removed on the
 * Python side — not something fixable purely here.
 */
export async function getWishlistSuggestions(db: DbClient, limit = 12): Promise<BacklogSuggestion[]> {
  const rows = await db.select<BacklogRow>(`
    SELECT
      g.Id AS GameId,
      g.Title AS Title,
      g.CoverArtUrl AS CoverArtUrl,
      rec.RecommendationScore AS RecommendationScore,
      rec.PredictedRating AS PredictedRating,
      rec.ExplanationJson AS ExplanationJson,
      ug.DesireToPlay AS DesireToPlay
    FROM Games g
    JOIN UserGames ug ON ug.GameId = g.Id
    LEFT JOIN Recommendations rec ON rec.GameId = g.Id
    WHERE ug.IsWishlist = 1
  `);

  return rankByRecommendationThenDesire(rows, limit);
}

interface ComfortRow {
  GameId: string;
  Title: string;
  CoverArtUrl: string | null;
  Rating: number | null;
  Favorite: number | null;
  Liked: number | null;
  ComfortScore: number | null;
}

/** Threshold on the 0-10 rating scale (Playthroughs.Rating) — 8 is
 * "4 stars" via StarRating's rating/2 display. Only used as a fallback
 * now, for games that haven't been through the Comfort Quiz yet — see
 * getComfortPicks below. */
const COMFORT_RATING_THRESHOLD = 8;

/** 1-5 explicit comfort score (see ComfortRatings in schema.ts) — 4+
 * counts as a real "yes" for the comfort pool. */
const COMFORT_SCORE_THRESHOLD = 4;

/**
 * "Suggested comfort picks" — the full qualifying pool, returned in
 * full so the UI can feature one and cycle through the rest
 * client-side without refetching on every shuffle click.
 *
 * Two signals, with the explicit one always winning: a game the user
 * has actually answered in the Comfort Quiz (ComfortRatings) is
 * included only if they rated it 4-5, and excluded even if it would
 * otherwise match the heuristic below — the whole point of the quiz is
 * that star rating and "this specifically feels cozy" aren't the same
 * thing, so an explicit "no" should stick. Games never quizzed fall
 * back to the original heuristic (finished + highly rated or marked
 * Favorite/Liked), so the section isn't empty before anyone's taken
 * the quiz.
 */
export async function getComfortPicks(db: DbClient): Promise<ComfortPick[]> {
  const rows = await db.select<ComfortRow>(`
    SELECT
      g.Id AS GameId,
      g.Title AS Title,
      g.CoverArtUrl AS CoverArtUrl,
      bestRating.Rating AS Rating,
      ug.Favorite AS Favorite,
      ug.Liked AS Liked,
      cr.ComfortScore AS ComfortScore
    FROM Games g
    JOIN UserGames ug ON ug.GameId = g.Id
    LEFT JOIN (
      SELECT GameId, MAX(Rating) AS Rating, MAX(CASE WHEN FinishDate IS NOT NULL THEN 1 ELSE 0 END) AS HasFinished
      FROM Playthroughs GROUP BY GameId
    ) bestRating ON bestRating.GameId = g.Id
    LEFT JOIN ComfortRatings cr ON cr.GameId = g.Id
    WHERE bestRating.HasFinished = 1
      AND (
        cr.ComfortScore >= ${COMFORT_SCORE_THRESHOLD}
        OR (
          cr.GameId IS NULL
          AND (
            (bestRating.Rating IS NOT NULL AND bestRating.Rating >= ${COMFORT_RATING_THRESHOLD})
            OR ug.Favorite = 1
            OR ug.Liked = 1
          )
        )
      )
  `);

  return rows
    .map((r) => ({
      gameId: r.GameId,
      title: r.Title,
      coverArtUrl: r.CoverArtUrl,
      rating: r.Rating,
      isFavorite: r.Favorite === 1,
      isLiked: r.Liked === 1,
      comfortScore: r.ComfortScore,
    }))
    .sort((a, b) => (b.comfortScore ?? b.rating ?? 0) - (a.comfortScore ?? a.rating ?? 0));
}

export interface ComfortQuizCandidate {
  gameId: string;
  title: string;
  coverArtUrl: string | null;
  rating: number | null;
}

/**
 * Finished games with no explicit Comfort Quiz answer yet — the
 * candidate pool the quiz works through. Ordered by star rating
 * descending, since a highly-rated finished game is the most plausible
 * comfort-pick candidate to ask about first (not a guarantee — that's
 * the whole reason the quiz exists — just a reasonable ordering for
 * which to ask about first).
 */
export async function getComfortQuizCandidates(db: DbClient, limit = 20): Promise<ComfortQuizCandidate[]> {
  const rows = await db.select<{ GameId: string; Title: string; CoverArtUrl: string | null; Rating: number | null }>(
    `
    SELECT g.Id AS GameId, g.Title AS Title, g.CoverArtUrl AS CoverArtUrl, bestRating.Rating AS Rating
    FROM Games g
    JOIN UserGames ug ON ug.GameId = g.Id
    LEFT JOIN (
      SELECT GameId, MAX(Rating) AS Rating, MAX(CASE WHEN FinishDate IS NOT NULL THEN 1 ELSE 0 END) AS HasFinished
      FROM Playthroughs GROUP BY GameId
    ) bestRating ON bestRating.GameId = g.Id
    LEFT JOIN ComfortRatings cr ON cr.GameId = g.Id
    WHERE bestRating.HasFinished = 1 AND cr.GameId IS NULL
    ORDER BY bestRating.Rating DESC
    LIMIT ?
    `,
    [limit]
  );
  return rows.map((r) => ({ gameId: r.GameId, title: r.Title, coverArtUrl: r.CoverArtUrl, rating: r.Rating }));
}

/** How many finished games still have no Comfort Quiz answer — for a
 * "you've rated X of Y" progress indicator that doesn't require pulling
 * every remaining candidate just to count them. */
export async function getComfortQuizRemainingCount(db: DbClient): Promise<number> {
  const rows = await db.select<{ Count: number }>(`
    SELECT COUNT(*) AS Count
    FROM Games g
    JOIN UserGames ug ON ug.GameId = g.Id
    LEFT JOIN (
      SELECT GameId, MAX(CASE WHEN FinishDate IS NOT NULL THEN 1 ELSE 0 END) AS HasFinished
      FROM Playthroughs GROUP BY GameId
    ) bestRating ON bestRating.GameId = g.Id
    LEFT JOIN ComfortRatings cr ON cr.GameId = g.Id
    WHERE bestRating.HasFinished = 1 AND cr.GameId IS NULL
  `);
  return rows[0]?.Count ?? 0;
}

export async function setComfortRating(db: DbClient, gameId: string, score: number): Promise<void> {
  await db.execute(
    `
    INSERT INTO ComfortRatings (GameId, ComfortScore) VALUES (?, ?)
    ON CONFLICT(GameId) DO UPDATE SET ComfortScore = excluded.ComfortScore
    `,
    [gameId, score]
  );
}

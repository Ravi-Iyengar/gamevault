import { Game } from "../types/game";
import { selectQuery } from "../database/database";

/**
 * The Playthroughs and Genres data are aggregated via subqueries, not
 * direct joins against Games. Joining Playthroughs AND GameGenres in the
 * same query and grouping by Games.Id would fan out: a game with 2
 * playthroughs and 3 genres produces 2x3=6 joined rows before the
 * GROUP BY, which would make SUM(HoursPlayed) triple-count each
 * playthrough's hours (once per genre row). Aggregating each relation
 * in its own subquery first avoids that entirely.
 */
const GAMES_QUERY = `
  SELECT
    g.Id,
    g.Title,
    g.ReleaseDate,
    g.ReleaseYear,
    g.Summary,
    g.CoverArtUrl,

    ug.Favorite,
    ug.Liked,
    ug.IsWishlist,
    ug.IsBacklog,
    ug.IsPlaying,
    ug.StatusRaw,
    ug.DateAdded,

    COALESCE(pt.PlaythroughCount, 0) AS PlaythroughCount,
    COALESCE(pt.HasFinishedPlaythrough, 0) AS HasFinishedPlaythrough,
    MAX(COALESCE(pt.TotalHoursPlayed, 0), COALESCE(ug.TotalHours, 0)) AS TotalHoursPlayed,
    pt.LatestRating,

    gen.GenreNames,
    fran.FranchiseNames

  FROM Games g
  LEFT JOIN UserGames ug ON ug.GameId = g.Id
  -- TotalHoursPlayed takes MAX(playthrough-summed hours, UserGames.TotalHours)
  -- rather than either alone — see the UserGames.TotalHours comment in
  -- schema.ts for why: Backloggd's own aggregate and the playthrough-level
  -- sum disagree for ~15% of games in the real export, in both directions,
  -- and neither one is reliably the more complete source.
  LEFT JOIN (
    SELECT
      GameId,
      COUNT(*) AS PlaythroughCount,
      MAX(CASE WHEN FinishDate IS NOT NULL THEN 1 ELSE 0 END) AS HasFinishedPlaythrough,
      COALESCE(SUM(HoursPlayed), 0) AS TotalHoursPlayed,
      MAX(Rating) AS LatestRating
    FROM Playthroughs
    GROUP BY GameId
  ) pt ON pt.GameId = g.Id
  LEFT JOIN (
    SELECT gg.GameId, GROUP_CONCAT(genres.Name) AS GenreNames
    FROM GameGenres gg
    JOIN Genres genres ON genres.Id = gg.GenreId
    GROUP BY gg.GameId
  ) gen ON gen.GameId = g.Id
  -- Same fan-out-avoidance reasoning as GenreNames above, now that
  -- Franchise is normalized (a game can genuinely belong to more than
  -- one) instead of the single-column simplification it used to be.
  LEFT JOIN (
    SELECT gf.GameId, GROUP_CONCAT(franchises.Name) AS FranchiseNames
    FROM GameFranchises gf
    JOIN Franchises franchises ON franchises.Id = gf.FranchiseId
    GROUP BY gf.GameId
  ) fran ON fran.GameId = g.Id
`;

interface GameRow {
  Id: string;
  Title: string;
  ReleaseDate: string | null;
  ReleaseYear: number | null;
  Summary: string | null;
  CoverArtUrl: string | null;
  Favorite: number | null;
  Liked: number | null;
  IsWishlist: number | null;
  IsBacklog: number | null;
  IsPlaying: number | null;
  StatusRaw: string | null;
  DateAdded: string | null;
  PlaythroughCount: number;
  HasFinishedPlaythrough: number;
  TotalHoursPlayed: number;
  LatestRating: number | null;
  GenreNames: string | null;
  FranchiseNames: string | null;
}

function rowToGame(row: GameRow): Game {
  return {
    id: row.Id,
    title: row.Title,
    releaseDate: row.ReleaseDate ?? undefined,
    releaseYear: row.ReleaseYear ?? undefined,
    summary: row.Summary ?? undefined,
    coverArtUrl: row.CoverArtUrl ?? undefined,
    franchises: row.FranchiseNames ? row.FranchiseNames.split(",") : [],
    isFavorite: row.Favorite === 1,
    isLiked: row.Liked === 1,
    isWishlist: row.IsWishlist === 1,
    isBacklog: row.IsBacklog === 1,
    isPlaying: row.IsPlaying === 1,
    statusRaw: row.StatusRaw ?? undefined,
    dateAdded: row.DateAdded ?? undefined,
    playthroughCount: row.PlaythroughCount,
    hasFinishedPlaythrough: row.HasFinishedPlaythrough === 1,
    totalHoursPlayed: row.TotalHoursPlayed,
    latestRating: row.LatestRating ?? undefined,
    genres: row.GenreNames ? row.GenreNames.split(",") : [],
  };
}

export async function getGames(): Promise<Game[]> {
  const rows = await selectQuery<GameRow>(GAMES_QUERY);
  return rows.map(rowToGame);
}

export async function getFavorites(limit = 5): Promise<Game[]> {
  const rows = await selectQuery<GameRow>(`${GAMES_QUERY} WHERE ug.Favorite = 1 LIMIT ?`, [limit]);
  return rows.map(rowToGame);
}

export async function getCurrentlyPlaying(limit = 5): Promise<Game[]> {
  const rows = await selectQuery<GameRow>(`${GAMES_QUERY} WHERE ug.IsPlaying = 1 LIMIT ?`, [limit]);
  return rows.map(rowToGame);
}

/** "Most Returned To" per spec Section 8 — ranked by replay count. */
export async function getMostReturnedTo(limit = 5): Promise<Game[]> {
  const rows = await selectQuery<GameRow & { ReplayCount: number }>(
    `
    SELECT g2.*, COALESCE(rp.ReplayCount, 0) AS ReplayCount FROM (${GAMES_QUERY}) g2
    LEFT JOIN (
      SELECT GameId, SUM(CASE WHEN Replay = 1 THEN 1 ELSE 0 END) AS ReplayCount
      FROM Playthroughs GROUP BY GameId
    ) rp ON rp.GameId = g2.Id
    WHERE COALESCE(rp.ReplayCount, 0) > 0
    ORDER BY ReplayCount DESC
    LIMIT ?
    `,
    [limit]
  );
  return rows.map(rowToGame);
}

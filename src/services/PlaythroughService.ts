import { selectQuery } from "../database/database";
import { Playthrough } from "../types/playthrough";

export async function getPlaythroughsByGameId(
  gameId: string
): Promise<Playthrough[]> {
  const rows = await selectQuery(
    `
    SELECT *
    FROM Playthroughs
    WHERE GameId = ?
    ORDER BY StartDate DESC
    `, 
    [gameId]
  );

  return rows.map((row: any) => ({
    id: row.Id,
    gameId: row.GameId,

    title: row.Title,

    startDate: row.StartDate,
    finishDate: row.FinishDate,

    rating: row.Rating,

    review: row.Review,

    replay: row.Replay === 1,
    mastered: row.Mastered === 1,

    hoursPlayed: row.HoursPlayed
  }));
}

export async function getGameStatistics(
  gameId: string
) {
  const rows = await selectQuery(
    `
    SELECT
      COUNT(*) AS PlaythroughCount,

      -- MAX(playthrough-summed hours, UserGames.TotalHours) rather than
      -- the playthrough sum alone — see the UserGames.TotalHours comment
      -- in schema.ts and GameService.ts's identical correction. Without
      -- this, this panel disagreed with the figure shown everywhere else
      -- in the app (Library, Dashboard, Analytics) for the ~60 games
      -- where Backloggd's own aggregate and the playthrough-level sum
      -- don't match — a real, previously-open inconsistency.
      MAX(
        COALESCE((SELECT SUM(HoursPlayed) FROM Playthroughs WHERE GameId = ?), 0),
        COALESCE((SELECT TotalHours FROM UserGames WHERE GameId = ?), 0)
      ) AS TotalHours,

      MAX(Rating) AS LatestRating,

      SUM(
        CASE
          WHEN Replay = 1
          THEN 1
          ELSE 0
        END
      ) AS ReplayCount,

      MIN(StartDate) AS FirstPlayed,

      MAX(FinishDate) AS LastPlayed,

      COALESCE(
        MAX(
          CASE
            WHEN FinishDate IS NOT NULL
            THEN 1
            ELSE 0
          END
        ),
        0
      ) AS HasFinishedPlaythrough

    FROM Playthroughs

    WHERE GameId = ?
    `,
    [gameId, gameId, gameId]
  );

  return rows[0];
}

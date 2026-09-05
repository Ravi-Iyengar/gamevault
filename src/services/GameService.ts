import { Game } from "../types/game";
import { selectQuery } from "../database/database";

export async function getGames(): Promise<Game[]> {
  const rows = await selectQuery(`
    SELECT
      g.Id,
      g.Title,

      COUNT(p.Id) AS PlaythroughCount,

      COALESCE(SUM(p.HoursPlayed), 0) AS TotalHoursPlayed,

      MAX(p.Rating) AS LatestRating

    FROM Games g

    LEFT JOIN Playthroughs p
      ON g.Id = p.GameId

    GROUP BY g.Id, g.Title
  `);

  return rows.map((row: any) => ({
    id: row.Id,
    title: row.Title,

    playthroughCount: row.PlaythroughCount,
    latestRating: row.LatestRating,
    totalHoursPlayed: row.TotalHoursPlayed
  }));
}
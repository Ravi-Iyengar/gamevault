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
    ORDER BY StartDate
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
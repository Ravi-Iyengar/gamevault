import { selectQuery } from "../database/database";
import { PlaySession } from "../types/playSession";

export async function getSessionsByPlaythroughId(
  playthroughId: string
): Promise<PlaySession[]> {
  const rows = await selectQuery(
    `
    SELECT *
    FROM PlaySessions
    WHERE PlaythroughId = ?
    ORDER BY SessionDate DESC
    `,
    [playthroughId]
  );

  return rows.map((row: any) => ({
    id: row.Id,

    playthroughId: row.PlaythroughId,

    sessionDate: row.SessionDate,

    hours: row.Hours,

    minutes: row.Minutes,

    note: row.Note,
  }));
}
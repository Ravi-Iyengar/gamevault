import { Game } from "../types/game";
import { selectQuery } from "../database/database";

export async function getGames(): Promise<Game[]> {
  const rows = await selectQuery(
    "SELECT * FROM Games"
  );

  return rows.map((row: any) => ({
    id: row.Id,
    title: row.Title,
    releaseYear: row.ReleaseYear,
  }));
}
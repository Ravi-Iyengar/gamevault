import { executeQuery, selectQuery } from "../database/database";
import bg3Test from "../importers/Sample Data/bg3-test.json"

export { bg3Test };


export async function importGame(gameData: any) { 
  await executeQuery(
    `
    INSERT OR IGNORE INTO Games (
      Id,
      Title
    )
    VALUES (?, ?)
    `,
    [
      gameData.id,
      gameData.name
    ]
  );

  const playthroughs = Object.values(
    gameData.playthroughs ?? {}
  );

  for (const playthrough of playthroughs) {
    await importPlaythrough(
      gameData.id,
      playthrough
    );
  }

  console.log(`Imported Game: ${gameData.name}`);
 
}

async function importPlaythrough(
  gameId: string,
  playthrough: any
) {
  await executeQuery(
    `
    INSERT OR IGNORE INTO Playthroughs (
      Id,
      GameId,
      Title,
      StartDate,
      FinishDate,
      Rating,
      Review,
      ReviewSpoilers,
      Replay,
      Mastered,
      HoursPlayed,
      HoursFinished,
      HoursMastered
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      String(playthrough.id),
      gameId,

      playthrough.title,

      playthrough.start_date,
      playthrough.finish_date,

      playthrough.rating,

      playthrough.review,

      playthrough.review_spoilers ? 1 : 0,

      playthrough.is_replay ? 1 : 0,
      playthrough.is_master ? 1 : 0,

      playthrough.hours_played,
      playthrough.hours_finished,
      playthrough.hours_mastered
    ]
  );

  console.log(
    `Imported Playthrough: ${playthrough.title}`
  );
}
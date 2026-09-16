import type { DbClient } from "../database/database";
import { updateUserGameFields } from "./GameEditService";

/**
 * Manual session/playthrough creation — the "so I don't have to keep
 * relying on exports" day-to-day flow. Both playthrough and session ids
 * use a `manual-<uuid>` prefix, same reasoning as Games' manual id
 * scheme in GameEditService.ts: Backloggd's own playthrough/session ids
 * (used by BackloggdJsonImporter) are always plain small integers as
 * strings, so a UUID-based id can never collide with one a future
 * re-import might introduce.
 *
 * No IsManuallyEdited flag needed on Playthroughs/PlaySessions rows
 * themselves — confirmed while designing this (see the note on
 * BackloggdJsonImporter's importPlaythrough/importPlaySession): both use
 * INSERT OR IGNORE, so a re-import can never overwrite an existing row
 * of either regardless. That protection only mattered for Games/
 * UserGames, which do get overwritten on conflict.
 */

export interface LogSessionInput {
  date: string; // YYYY-MM-DD
  hours: number | null;
  minutes: number | null;
  note: string | null;
}

/**
 * Logs a single day's play. Attaches to whichever playthrough for this
 * game is still in progress (FinishDate IS NULL), most recently started
 * first — the common case if you're actively playing something. If
 * there's no in-progress playthrough at all (a fresh game, or every
 * existing playthrough is already finished), creates a new one first,
 * started on this session's date.
 *
 * Also marks the game as currently playing (UserGames.IsPlaying = 1) —
 * a reasonable side effect of "you just logged time on this," and goes
 * through updateUserGameFields so that edit is protected from a future
 * re-import the same as any other manual UserGames edit.
 */
export async function logSession(db: DbClient, gameId: string, input: LogSessionInput): Promise<void> {
  const inProgress = await db.select<{ Id: string }>(
    `SELECT Id FROM Playthroughs WHERE GameId = ? AND FinishDate IS NULL ORDER BY StartDate DESC LIMIT 1`,
    [gameId]
  );

  let playthroughId: string;
  if (inProgress.length > 0) {
    playthroughId = inProgress[0].Id;
  } else {
    playthroughId = `manual-${crypto.randomUUID()}`;
    await db.execute(`INSERT INTO Playthroughs (Id, GameId, StartDate) VALUES (?, ?, ?)`, [
      playthroughId,
      gameId,
      input.date,
    ]);
  }

  const sessionId = `manual-${crypto.randomUUID()}`;
  await db.execute(`INSERT INTO PlaySessions (Id, PlaythroughId, SessionDate, Hours, Minutes, Note) VALUES (?, ?, ?, ?, ?, ?)`, [
    sessionId,
    playthroughId,
    input.date,
    input.hours,
    input.minutes,
    input.note,
  ]);

  await updateUserGameFields(db, gameId, { isPlaying: true });
}

export interface NewPlaythroughInput {
  title: string | null;
  startDate: string | null;
  finishDate: string | null;
  rating: number | null;
  review: string | null;
  replay: boolean;
  mastered: boolean;
  hoursPlayed: number | null;
  playedPlatformId: number | null;
  storefrontId: number | null;
}

/**
 * Creates a full playthrough directly — for logging a completed run
 * (with a rating/review/finish date) rather than the lighter
 * logSession flow above, which is for ongoing day-to-day play. Doesn't
 * touch UserGames at all — a finished playthrough's own FinishDate is
 * what downstream logic (deriveStatus, Recommendations, etc.) already
 * uses to know a game's been beaten, not a UserGames flag.
 */
export async function createPlaythrough(db: DbClient, gameId: string, input: NewPlaythroughInput): Promise<string> {
  const playthroughId = `manual-${crypto.randomUUID()}`;
  await db.execute(
    `
    INSERT INTO Playthroughs (
      Id, GameId, Title, StartDate, FinishDate, Rating, Review,
      Replay, Mastered, HoursPlayed, PlayedPlatformId, StorefrontId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      playthroughId,
      gameId,
      input.title,
      input.startDate,
      input.finishDate,
      input.rating,
      input.review,
      input.replay ? 1 : 0,
      input.mastered ? 1 : 0,
      input.hoursPlayed,
      input.playedPlatformId,
      input.storefrontId,
    ]
  );
  return playthroughId;
}

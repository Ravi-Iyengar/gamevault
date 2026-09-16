import type { DbClient } from "../database/database";
import { effectiveRating } from "../utils/ratings";

/**
 * Backloggd JSON importer.
 *
 * Rewritten from the previous version, which only handled a single
 * hardcoded test game (`bg3-test.json`, which doesn't actually exist in
 * this project — the reference was broken and would have crashed on
 * startup). This version imports the full library export.
 *
 * Design notes:
 *
 * - Takes a `DbClient` as a parameter rather than importing the Tauri
 *   database singleton directly, so this whole module can be unit-tested
 *   without the Tauri runtime — see src/importers/__tests__.
 *
 * - GameVault is a historical archive (per spec: "Historical Accuracy" is
 *   a core design principle), so every playthrough is imported regardless
 *   of whether it looks "complete" — there is no has-been-played filtering
 *   here the way there was in GLIP's ML training set. This project has no
 *   model to protect from bad labels; it just needs to preserve what
 *   happened.
 *
 * - Platform ids (`platform`/`played_platform` in the source data) are
 *   IGDB's own numeric platform ids — a public, resolvable reference, but
 *   not resolved here. That's an IGDB metadata-retrieval concern (Section 4
 *   of the spec), a separate later step. This importer stores the raw id
 *   and leaves Platforms.Name NULL until that step fills it in.
 *
 * - Storefront ids (`storefront_id`) and medium ids (`medium_id`, mapped to
 *   AcquisitionMethod) are Backloggd-internal, undocumented numeric codes —
 *   there is no public reference to resolve them against. Guessing labels
 *   (e.g. assuming storefront_id 16 means "Steam") risks silently mislabeling
 *   real purchase history, which is exactly the kind of historical
 *   inaccuracy the spec's "Historical Accuracy" principle exists to avoid.
 *   These are imported as raw numeric ids with a NULL name; a Settings-page
 *   feature to let the user label them once (see ROADMAP note) is the
 *   honest way to resolve this, not a guess made now.
 */

// --- Raw Backloggd JSON shapes (only the fields this importer reads) -----

interface RawPlayDate {
  id: number | string;
  range_start_date?: string | null;
  hours?: number | null;
  minutes?: number | null;
  note?: string | null;
}

interface RawPlaythrough {
  id: number | string;
  title?: string | null;
  start_date?: string | null;
  finish_date?: string | null;
  rating?: number | null;
  review?: string | null;
  review_spoilers?: boolean | null;
  is_replay?: boolean | null;
  is_master?: boolean | null;
  hours_played?: number | null;
  mins_played?: number | null;
  hours_finished?: number | null;
  mins_finished?: number | null;
  hours_mastered?: number | null;
  mins_mastered?: number | null;
  played_platform?: number | null;
  platform?: number | null;
  storefront_id?: number | null;
  medium_id?: number | null;
  play_dates?: RawPlayDate[] | null;
}

interface RawGameLog {
  status?: string | null;
  rating?: number | null;
  is_playing?: boolean | null;
  is_backlog?: boolean | null;
  is_wishlist?: boolean | null;
  game_liked?: boolean | null;
  total_hours?: number | null;
  total_minutes?: number | null;
  last_edited_at?: number | string | null;
}

export interface RawBackloggdGame {
  id: number | string;
  name: string;
  game_log?: RawGameLog | null;
  playthroughs?: Record<string, RawPlaythrough> | null;
}

export interface ImportSummary {
  games: number;
  playthroughs: number;
  sessions: number;
  skipped: number;
}

// --- Helpers ---------------------------------------------------------

function hoursFromParts(hours?: number | null, minutes?: number | null): number | null {
  if (hours === null || hours === undefined) return null;
  return hours + (minutes ?? 0) / 60;
}

function toIntFlag(value: boolean | null | undefined): number {
  return value ? 1 : 0;
}

/**
 * Ensures a row exists in a lookup table (Platforms/Storefronts/
 * AcquisitionMethods) for a given raw numeric id. Uses INSERT OR IGNORE so
 * an existing Name (set by a later enrichment/labeling step) is never
 * clobbered by re-importing.
 */
async function ensureLookupRow(db: DbClient, table: string, id: number): Promise<void> {
  await db.execute(`INSERT OR IGNORE INTO ${table} (Id, Name) VALUES (?, NULL)`, [id]);
}

// --- Import functions ---------------------------------------------------

async function importUserGame(db: DbClient, gameId: string, gameLog: RawGameLog | null | undefined): Promise<void> {
  const log = gameLog ?? {};

  // ON CONFLICT UPDATE gated on IsManuallyEdited = 0 — same reasoning
  // as importGame's Games upsert above: once the user edits this row
  // in-app (toggling backlog/playing/wishlist status, etc. — see
  // GameEditService.ts), a re-import must not silently revert it.
  await db.execute(
    `
    INSERT INTO UserGames (
      Id, GameId, DateAdded, Favorite, Liked, DesireToPlay,
      IsWishlist, IsBacklog, IsPlaying, StatusRaw, TotalHours, Notes
    ) VALUES (?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(Id) DO UPDATE SET
      DateAdded = excluded.DateAdded,
      Liked = excluded.Liked,
      IsWishlist = excluded.IsWishlist,
      IsBacklog = excluded.IsBacklog,
      IsPlaying = excluded.IsPlaying,
      StatusRaw = excluded.StatusRaw,
      TotalHours = excluded.TotalHours
    WHERE UserGames.IsManuallyEdited = 0
    `,
    [
      gameId, // UserGames.Id: 1:1 with GameId for a single-user app, so reusing GameId keeps this simple (schema allows a separate id, but nothing needs it distinct here)
      gameId,
      log.last_edited_at != null ? String(log.last_edited_at) : null,
      toIntFlag(log.game_liked),
      toIntFlag(log.is_wishlist),
      toIntFlag(log.is_backlog),
      toIntFlag(log.is_playing),
      log.status ?? null,
      hoursFromParts(log.total_hours, log.total_minutes),
    ]
  );
}

async function importPlaySession(db: DbClient, playthroughId: string, playDate: RawPlayDate): Promise<void> {
  await db.execute(
    `
    INSERT OR IGNORE INTO PlaySessions (
      Id, PlaythroughId, SessionDate, Hours, Minutes, Note
    ) VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      String(playDate.id),
      playthroughId,
      playDate.range_start_date ?? null,
      playDate.hours ?? null,
      playDate.minutes ?? null,
      playDate.note ?? null,
    ]
  );
}

async function importPlaythrough(db: DbClient, gameId: string, playthrough: RawPlaythrough): Promise<number> {
  const playedPlatformId = playthrough.played_platform ?? playthrough.platform ?? null;
  if (playedPlatformId !== null) {
    await ensureLookupRow(db, "Platforms", playedPlatformId);
  }

  if (playthrough.storefront_id !== null && playthrough.storefront_id !== undefined) {
    await ensureLookupRow(db, "Storefronts", playthrough.storefront_id);
  }

  if (playthrough.medium_id !== null && playthrough.medium_id !== undefined) {
    await ensureLookupRow(db, "AcquisitionMethods", playthrough.medium_id);
  }

  const playthroughId = String(playthrough.id);

  await db.execute(
    `
    INSERT OR IGNORE INTO Playthroughs (
      Id, GameId, Title, StartDate, FinishDate, Rating, Review, ReviewSpoilers,
      Replay, Mastered, HoursPlayed, HoursFinished, HoursMastered,
      PlayedPlatformId, AcquisitionMethodId, StorefrontId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      playthroughId,
      gameId,
      playthrough.title ?? null,
      playthrough.start_date ?? null,
      playthrough.finish_date ?? null,
      effectiveRating(playthrough.rating ?? null),
      playthrough.review ?? null,
      toIntFlag(playthrough.review_spoilers),
      toIntFlag(playthrough.is_replay),
      toIntFlag(playthrough.is_master),
      hoursFromParts(playthrough.hours_played, playthrough.mins_played),
      hoursFromParts(playthrough.hours_finished, playthrough.mins_finished),
      hoursFromParts(playthrough.hours_mastered, playthrough.mins_mastered),
      playedPlatformId,
      playthrough.medium_id ?? null,
      playthrough.storefront_id ?? null,
    ]
  );

  let sessionCount = 0;
  for (const playDate of playthrough.play_dates ?? []) {
    await importPlaySession(db, playthroughId, playDate);
    sessionCount += 1;
  }

  return sessionCount;
}

async function importGame(db: DbClient, gameData: RawBackloggdGame): Promise<{ playthroughs: number; sessions: number }> {
  const gameId = String(gameData.id);

  // Backloggd's own id IS the IGDB id (confirmed against the source spec
  // this export format comes from) — so IGDBId is populated directly from
  // the same value, not left for a later lookup step.
  //
  // The ON CONFLICT UPDATE is gated on IsManuallyEdited = 0: once a game
  // has been edited in-app (see GameEditService.ts), a re-import must
  // not silently revert that edit back to whatever Backloggd's export
  // says. IsManualEntry always stays 0 here — this whole function is
  // the import path, so any row it touches came from Backloggd by
  // definition.
  await db.execute(
    `
    INSERT INTO Games (Id, IGDBId, Title)
    VALUES (?, ?, ?)
    ON CONFLICT(Id) DO UPDATE SET Title = excluded.Title, IGDBId = excluded.IGDBId
    WHERE Games.IsManuallyEdited = 0
    `,
    [gameId, Number(gameData.id), gameData.name]
  );

  await importUserGame(db, gameId, gameData.game_log);

  let playthroughCount = 0;
  let sessionCount = 0;

  for (const playthrough of Object.values(gameData.playthroughs ?? {})) {
    sessionCount += await importPlaythrough(db, gameId, playthrough);
    playthroughCount += 1;
  }

  return { playthroughs: playthroughCount, sessions: sessionCount };
}

/**
 * Imports a full Backloggd library export. Wraps the whole import in a
/**
 * Imports a full Backloggd library export.
 *
 * NOT wrapped in a manual BEGIN/COMMIT transaction, despite that being the
 * obvious thing to reach for at ~400 games / several thousand statements.
 * @tauri-apps/plugin-sql is built on sqlx with pooled connections, and
 * there's no guarantee that a `BEGIN`, the statements after it, and a final
 * `COMMIT` — each issued as separate `execute()` calls — land on the same
 * physical connection. In practice this is exactly what broke: `BEGIN`
 * locked the writer on whichever connection it happened to acquire, the
 * next game's insert got routed to a different pooled connection and
 * blocked behind that lock, and since `COMMIT` was never going to fire
 * until all 408 games were processed, it eventually timed out — leaving
 * only whatever ran on the very first connection actually committed.
 *
 * Removed rather than patched: every statement now autocommits
 * individually. Slower for a full re-import (thousands of individual
 * commits instead of one batched one), but correct, and the importer was
 * already written to be idempotent (INSERT OR IGNORE / ON CONFLICT
 * throughout), so nothing about that changes.
 *
 * Each game is also now processed in its own try/catch: one malformed
 * record is counted as skipped and logged, rather than silently aborting
 * every game after it in the array — which is the other way the old
 * version could have produced a near-empty-looking library from a single
 * bad record partway through.
 */
export async function importLibrary(db: DbClient, games: RawBackloggdGame[]): Promise<ImportSummary> {
  const summary: ImportSummary = { games: 0, playthroughs: 0, sessions: 0, skipped: 0 };

  for (const gameData of games) {
    if (gameData.id === undefined || gameData.id === null) {
      summary.skipped += 1;
      continue;
    }

    try {
      const { playthroughs, sessions } = await importGame(db, gameData);
      summary.games += 1;
      summary.playthroughs += playthroughs;
      summary.sessions += sessions;
    } catch (error) {
      summary.skipped += 1;
      console.error(`Failed to import game ${gameData.id} (${gameData.name}):`, error);
    }
  }

  return summary;
}

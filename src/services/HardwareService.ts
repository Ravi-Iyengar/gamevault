import type { DbClient } from "../database/database";
import { ensurePlatformNameUniqueness } from "./EnrichmentService";

/**
 * Powers the Hardware page. Distinct from two things that sound similar
 * but answer different questions:
 *  - UserGames.OwnedPlatformId: which platform a specific GAME is owned
 *    on (spreadsheet-driven).
 *  - Playthroughs.PlayedPlatformId: which platform a specific PAST
 *    playthrough happened on.
 *  - Platforms.CurrentlyOwned (new): whether you currently have working
 *    HARDWARE for that platform at all, independent of any game.
 *
 * "Unplayable right now" = a game whose owned platform (falling back to
 * the platform of its most recent playthrough, if no spreadsheet
 * ownership was ever recorded) points at a platform you've unchecked
 * here. Games with no platform information at all either way are left
 * out of both playable and unplayable — there's nothing to judge
 * playability from, and guessing would risk false positives.
 */

export interface PlatformOwnership {
  id: number;
  name: string | null;
  logoUrl: string | null;
  currentlyOwned: boolean;
  ownedGameCount: number;
}

export async function getPlatformsWithOwnership(db: DbClient): Promise<PlatformOwnership[]> {
  // Self-heals any duplicate Platforms rows (and, going forward,
  // prevents new ones) every time this page's data is actually loaded —
  // not just when the user happens to run enrichment from Settings. See
  // ensurePlatformNameUniqueness's own doc comment for the full story;
  // this was previously a merge pass only, which could recur since it
  // was cleaning up after a missing UNIQUE constraint rather than fixing
  // it — now it also creates that constraint, so duplicates can't
  // re-form once this has run once on a given database.
  await ensurePlatformNameUniqueness(db);

  const platforms = await db.select<{ Id: number; Name: string | null; LogoUrl: string | null; CurrentlyOwned: number }>(
    `SELECT Id, Name, LogoUrl, CurrentlyOwned FROM Platforms ORDER BY Name`
  );
  const counts = await db.select<{ OwnedPlatformId: number; Count: number }>(`
    SELECT OwnedPlatformId, COUNT(*) AS Count
    FROM UserGames
    WHERE OwnedPlatformId IS NOT NULL
    GROUP BY OwnedPlatformId
  `);
  const countByPlatform = new Map(counts.map((c) => [c.OwnedPlatformId, c.Count]));

  return platforms
    .filter((p) => p.Name != null) // unresolved/unlabeled platform ids aren't meaningful to show here
    .map((p) => ({
      id: p.Id,
      name: p.Name,
      logoUrl: p.LogoUrl,
      currentlyOwned: p.CurrentlyOwned === 1,
      ownedGameCount: countByPlatform.get(p.Id) ?? 0,
    }));
}

export async function setPlatformOwned(db: DbClient, platformId: number, owned: boolean): Promise<void> {
  await db.execute(`UPDATE Platforms SET CurrentlyOwned = ? WHERE Id = ?`, [owned ? 1 : 0, platformId]);
}

export interface UnplayableGame {
  gameId: string;
  title: string;
  coverArtUrl: string | null;
  platformName: string;
  viaFallback: boolean; // true if this used the most-recent-playthrough fallback, not spreadsheet ownership
}

interface GameOwnershipRow {
  GameId: string;
  Title: string;
  CoverArtUrl: string | null;
  OwnedPlatformId: number | null;
}

interface PlaythroughPlatformRow {
  GameId: string;
  PlayedPlatformId: number | null;
  StartDate: string | null;
  FinishDate: string | null;
}

/** Picks each game's most recently played platform, for games with no
 * spreadsheet-driven OwnedPlatformId to fall back on. Done in JS rather
 * than a correlated SQL subquery — simpler to read, and this project's
 * existing pattern (see TimeGalleryService's grouping) for "pick the
 * best row per game" style problems. */
function mostRecentPlatformByGame(rows: PlaythroughPlatformRow[]): Map<string, number> {
  const best = new Map<string, { platformId: number; date: string }>();
  for (const row of rows) {
    if (row.PlayedPlatformId == null) continue;
    const date = row.FinishDate ?? row.StartDate;
    if (!date) continue;
    const existing = best.get(row.GameId);
    if (!existing || date > existing.date) {
      best.set(row.GameId, { platformId: row.PlayedPlatformId, date });
    }
  }
  const result = new Map<string, number>();
  for (const [gameId, entry] of best) result.set(gameId, entry.platformId);
  return result;
}

export async function getUnplayableGames(db: DbClient): Promise<UnplayableGame[]> {
  const games = await db.select<GameOwnershipRow>(`
    SELECT g.Id AS GameId, g.Title AS Title, g.CoverArtUrl AS CoverArtUrl, ug.OwnedPlatformId AS OwnedPlatformId
    FROM Games g
    JOIN UserGames ug ON ug.GameId = g.Id
  `);
  const playthroughPlatforms = await db.select<PlaythroughPlatformRow>(
    `SELECT GameId, PlayedPlatformId, StartDate, FinishDate FROM Playthroughs`
  );
  const fallbackByGame = mostRecentPlatformByGame(playthroughPlatforms);

  const platforms = await db.select<{ Id: number; Name: string | null; CurrentlyOwned: number }>(
    `SELECT Id, Name, CurrentlyOwned FROM Platforms`
  );
  const platformById = new Map(platforms.map((p) => [p.Id, p]));

  const unplayable: UnplayableGame[] = [];
  for (const game of games) {
    const viaFallback = game.OwnedPlatformId == null;
    const platformId = game.OwnedPlatformId ?? fallbackByGame.get(game.GameId) ?? null;
    if (platformId == null) continue; // no platform info at all — can't judge, so don't flag

    const platform = platformById.get(platformId);
    if (!platform || platform.Name == null) continue; // unresolved platform name — same reasoning
    if (platform.CurrentlyOwned === 1) continue; // hardware present, playable

    unplayable.push({
      gameId: game.GameId,
      title: game.Title,
      coverArtUrl: game.CoverArtUrl,
      platformName: platform.Name,
      viaFallback,
    });
  }

  unplayable.sort((a, b) => a.title.localeCompare(b.title));
  return unplayable;
}

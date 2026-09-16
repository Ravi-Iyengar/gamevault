import type { DbClient } from "../database/database";
import type { IgdbClient } from "./IgdbClient";
import { igdbCoverUrl } from "./IgdbClient";

/**
 * In-app editing for Games and UserGames. Every write here sets
 * IsManuallyEdited = 1 on the row it touches — that's what tells
 * BackloggdJsonImporter's re-import upserts to leave this row alone
 * (see the WHERE IsManuallyEdited = 0 gate on both its Games and
 * UserGames ON CONFLICT clauses). Verified directly against real
 * SQLite (3.45.1) during design, not just assumed: a manually-edited
 * row survives a simulated re-import attempt; an untouched row still
 * updates normally.
 *
 * Deliberately row-level protection, not field-level — editing any one
 * field protects the whole row from future re-import overwrites. Matches
 * what was actually asked for ("track which rows were manually
 * touched") rather than the considerably more complex alternative of
 * tracking protection per individual column.
 */

export interface UserGameEditableFields {
  favorite?: boolean;
  liked?: boolean;
  desireToPlay?: number;
  isWishlist?: boolean;
  isBacklog?: boolean;
  isPlaying?: boolean;
  statusRaw?: string | null;
  totalHours?: number | null;
  ownedPlatformId?: number | null;
  ownedStorefrontId?: number | null;
  notes?: string | null;
}

const USER_GAME_COLUMN_BY_FIELD: Record<keyof UserGameEditableFields, string> = {
  favorite: "Favorite",
  liked: "Liked",
  desireToPlay: "DesireToPlay",
  isWishlist: "IsWishlist",
  isBacklog: "IsBacklog",
  isPlaying: "IsPlaying",
  statusRaw: "StatusRaw",
  totalHours: "TotalHours",
  ownedPlatformId: "OwnedPlatformId",
  ownedStorefrontId: "OwnedStorefrontId",
  notes: "Notes",
};

function toSqlValue(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

/**
 * Updates any subset of UserGames' editable fields for one game, and
 * marks the row as manually edited in the same statement. Only the
 * fields actually present in `fields` are touched — omit a field to
 * leave it as-is, don't pass `undefined` meaning "clear this."
 */
export async function updateUserGameFields(
  db: DbClient,
  gameId: string,
  fields: UserGameEditableFields
): Promise<void> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined) as [
    keyof UserGameEditableFields,
    unknown
  ][];
  if (entries.length === 0) return;

  const setClauses = entries.map(([field]) => `${USER_GAME_COLUMN_BY_FIELD[field]} = ?`);
  const values = entries.map(([, value]) => toSqlValue(value));

  await db.execute(
    `UPDATE UserGames SET ${setClauses.join(", ")}, IsManuallyEdited = 1 WHERE GameId = ?`,
    [...values, gameId]
  );
}

/**
 * Updates a game's title and marks it as manually edited. Kept as its
 * own function rather than folded into a generic "edit Games fields"
 * helper — title is the one Games field both realistically worth
 * hand-editing (fixing a bad import, or naming a fully manual entry)
 * and actually at risk of being overwritten by a re-import (see
 * importGame's ON CONFLICT clause). Other Games fields (cover art,
 * ratings, etc.) are enrichment-owned and edited by re-running
 * enrichment, not by hand.
 */
export async function updateGameTitle(db: DbClient, gameId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  await db.execute(`UPDATE Games SET Title = ?, IsManuallyEdited = 1 WHERE Id = ?`, [trimmed, gameId]);
}

export interface NewManualGame {
  title: string;
  igdbId?: number;
  coverArtUrl?: string | null;
  status: "backlog" | "playing" | "wishlist" | "none";
}

/**
 * Creates a brand-new Games row (and its required UserGames row —
 * every game has exactly one, matching how the importers always create
 * both together) for a game the user is adding directly, not through
 * any import.
 *
 * Id is `manual-<uuid>`, never a bare number: Backloggd's own game ids
 * (used as Games.Id by BackloggdJsonImporter) are always plain small
 * integers as strings, so a UUID-based id can never collide with one
 * a future re-import might introduce — no coordination with the
 * importer needed to guarantee that.
 *
 * If `igdbId` is given, IGDBId is set immediately and the cover art
 * URL passed along from the search result is stored right away too —
 * full enrichment (genres, ratings, time-to-beat, etc.) is a separate
 * follow-up call to enrichSingleGame in EnrichmentService.ts, not done
 * here, since that needs a live IgdbClient and this function is a pure
 * DB write.
 */
export async function createManualGame(db: DbClient, game: NewManualGame): Promise<string> {
  const trimmed = game.title.trim();
  if (!trimmed) throw new Error("A title is required.");

  const gameId = `manual-${crypto.randomUUID()}`;

  await db.execute(
    `
    INSERT INTO Games (Id, IGDBId, Title, CoverArtUrl, IsManualEntry, IsManuallyEdited)
    VALUES (?, ?, ?, ?, 1, 1)
    `,
    [gameId, game.igdbId ?? null, trimmed, game.coverArtUrl ?? null]
  );

  await db.execute(
    `
    INSERT INTO UserGames (Id, GameId, DateAdded, IsBacklog, IsPlaying, IsWishlist, IsManuallyEdited)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    `,
    [
      gameId,
      gameId,
      new Date().toISOString(),
      game.status === "backlog" ? 1 : 0,
      game.status === "playing" ? 1 : 0,
      game.status === "wishlist" ? 1 : 0,
    ]
  );

  return gameId;
}

export interface GameSearchResult {
  igdbId: number;
  title: string;
  releaseYear: number | null;
  coverArtUrl: string | null;
  platforms: string;
  genres: string;
  isRemakeOrRemaster: boolean;
}

/**
 * Wraps IgdbClient.searchGamesByTitle into a shape the Add Game UI can
 * render directly — release year instead of a raw unix timestamp, a
 * joined platform/genre string instead of nested arrays, and a plain
 * boolean for "this is a remake or remaster" (category 8 or 9 — same
 * enum used for Series Completion's equivalence detection) as a small
 * visual hint in search results, since a search for a well-known
 * franchise often surfaces both an original and a remaster.
 */
export async function searchGamesForAdd(client: IgdbClient, title: string): Promise<GameSearchResult[]> {
  const results = await client.searchGamesByTitle(title);
  return results.map((r) => {
    const releaseYear = r.first_release_date
      ? new Date(r.first_release_date * 1000).getUTCFullYear()
      : null;
    return {
      igdbId: r.id,
      title: r.name ?? "Untitled",
      releaseYear,
      coverArtUrl: r.cover?.image_id ? igdbCoverUrl(r.cover.image_id) : null,
      platforms: (r.platforms ?? []).map((p) => p.name).join(", "),
      genres: (r.genres ?? []).map((g) => g.name).join(", "),
      isRemakeOrRemaster: r.category === 8 || r.category === 9,
    };
  });
}

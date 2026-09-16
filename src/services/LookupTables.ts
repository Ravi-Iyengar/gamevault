import type { DbClient } from "../database/database";

/**
 * Ensures a row exists in a name-keyed lookup table (Genres/Themes/
 * Developers/Publishers/Franchises/Keywords/Collections/GameModes/
 * PlayerPerspectives) and returns its id.
 *
 * Extracted out of EnrichmentService.ts (where it originated for live
 * IGDB enrichment) since GlipImporter.ts needs the exact same behavior
 * for backfilling data already sitting in GLIP's database — the same
 * genre/theme/franchise/etc. rows should end up identical however they
 * got populated, and duplicating this logic in two places risked them
 * drifting apart.
 */
export async function getOrCreateNamedLookupId(db: DbClient, table: string, name: string): Promise<number> {
  await db.execute(`INSERT OR IGNORE INTO ${table} (Name) VALUES (?)`, [name]);
  const rows = await db.select<{ Id: number }>(`SELECT Id FROM ${table} WHERE Name = ?`, [name]);
  return rows[0].Id;
}

/**
 * Collections-specific variant of getOrCreateNamedLookupId: also records
 * IGDB's own collection id, which the generic name-keyed lookup doesn't
 * need for anything else (Genres, Themes, etc. have no reason to keep
 * their IGDB id around) but Series Completion does — it's what lets
 * SeriesService.ts ask IGDB "what else belongs to this collection"
 * rather than being limited to games already in the library. Backfills
 * the id onto an existing row too, in case a collection was first
 * created before this existed (e.g. via the GLIP importer, which has no
 * IGDB id to offer at all) and only later seen again with one attached.
 */
export async function getOrCreateCollectionId(
  db: DbClient,
  name: string,
  igdbCollectionId: number | null
): Promise<number> {
  await db.execute(`INSERT OR IGNORE INTO Collections (Name, IGDBCollectionId) VALUES (?, ?)`, [
    name,
    igdbCollectionId,
  ]);
  if (igdbCollectionId != null) {
    await db.execute(
      `UPDATE Collections SET IGDBCollectionId = ? WHERE Name = ? AND IGDBCollectionId IS NULL`,
      [igdbCollectionId, name]
    );
  }
  const rows = await db.select<{ Id: number }>(`SELECT Id FROM Collections WHERE Name = ?`, [name]);
  return rows[0].Id;
}

export async function linkGameToLookup(
  db: DbClient,
  joinTable: string,
  gameColumn: string,
  lookupColumn: string,
  gameId: string,
  lookupId: number
): Promise<void> {
  await db.execute(
    `INSERT OR IGNORE INTO ${joinTable} (${gameColumn}, ${lookupColumn}) VALUES (?, ?)`,
    [gameId, lookupId]
  );
}

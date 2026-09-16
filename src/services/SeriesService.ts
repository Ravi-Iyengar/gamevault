import type { DbClient } from "../database/database";
import { IgdbClient, igdbCoverUrl } from "./IgdbClient";

/**
 * Powers Series Completion: "how many games in the Dark Souls series
 * have I played, and which ones haven't I?" — including games not in
 * the library at all, grayed out.
 *
 * Two-layer equivalence, matching what was discussed and confirmed:
 *  1. Automatic — IGDB's own `category` (remake=8/remaster=9/port=11/
 *     expanded_game=10) and `parent_game`/`version_parent` fields on a
 *     game. If a catalog entry is itself a remake of another catalog
 *     entry, they collapse into one canonical slot. If a LOCAL (owned)
 *     game is a remake/remaster/port of something, owning it satisfies
 *     that original's slot even if the local game was never itself
 *     imported as part of this series' catalog.
 *  2. Manual — GameSeriesOverrides, for whatever automatic detection
 *     doesn't catch (an edition IGDB doesn't formally link back, or a
 *     wrong automatic match). Always layered on top of, never instead
 *     of, the automatic pass.
 *
 * Performance note (fixed after the first real run): getSeriesList
 * originally called what's now computeSlotsForCollection once PER
 * collection, each call re-querying the entire Games table and entire
 * GameSeriesOverrides table from scratch — for a library with even a
 * moderate number of IGDB collections tagged (IGDB tags many minor
 * collections per game, not just well-known franchises), that's
 * potentially hundreds of redundant sequential round-trips and was the
 * cause of the Series Completion page appearing stuck on "Loading...".
 * Every "raw data" table (Games, GameSeriesOverrides, SeriesCatalogGames,
 * the owned-games/collection links) is now fetched exactly once per
 * getSeriesList call, and every collection's completion is computed
 * in-memory from that shared data instead.
 */

export interface SeriesSummary {
  collectionId: number;
  name: string;
  igdbCollectionId: number | null;
  catalogFetchedAt: string | null;
  ownedCount: number;
  totalCount: number;
}

export interface SeriesSlot {
  canonicalIgdbId: number;
  title: string;
  releaseYear: number | null;
  coverArtUrl: string | null;
  owned: boolean;
  ownedGameId: string | null;
  ownedViaOverride: boolean;
}

interface CatalogRow {
  IGDBGameId: number;
  Title: string;
  ReleaseYear: number | null;
  CoverArtUrl: string | null;
  IGDBCategory: number | null;
  IGDBParentGameId: number | null;
}

interface LocalGameRow {
  Id: string;
  IGDBId: number | null;
  IGDBParentGameId: number | null;
  IGDBVersionParentId: number | null;
}

interface OwnedLinkRow {
  Id: string;
  IGDBId: number | null;
  Title: string;
  ReleaseYear: number | null;
  CoverArtUrl: string | null;
}

/** Everything computeSlotsForCollection needs, fetched once regardless
 * of how many collections are being computed for. */
interface RawData {
  localGames: LocalGameRow[];
  overrideByGameId: Map<string, number>;
}

async function loadRawData(db: DbClient): Promise<RawData> {
  const localGames = await db.select<LocalGameRow>(
    `SELECT Id, IGDBId, IGDBParentGameId, IGDBVersionParentId FROM Games`
  );
  const overrides = await db.select<{ GameId: string; CanonicalIGDBGameId: number }>(
    `SELECT GameId, CanonicalIGDBGameId FROM GameSeriesOverrides`
  );
  return { localGames, overrideByGameId: new Map(overrides.map((o) => [o.GameId, o.CanonicalIGDBGameId])) };
}

/**
 * Collapses catalog rows into canonical slots: a row whose parent is
 * ALSO in this same catalog folds into the parent's slot rather than
 * standing alone (the "is Dark Souls Remastered its own slot or part of
 * Dark Souls's" question — resolved by whether IGDB's own catalog data
 * links them, not guessed).
 */
function buildSlotRoots(rows: CatalogRow[]): Map<number, number> {
  const idsInCatalog = new Set(rows.map((r) => r.IGDBGameId));
  const rootOf = new Map<number, number>();
  for (const row of rows) {
    const root =
      row.IGDBParentGameId && idsInCatalog.has(row.IGDBParentGameId) ? row.IGDBParentGameId : row.IGDBGameId;
    rootOf.set(row.IGDBGameId, root);
  }
  return rootOf;
}

/** Pure in-memory computation — no DB access — so it can be reused for
 * both a single collection (getSeriesCompletion) and every collection at
 * once (getSeriesList) without re-querying shared data each time. */
function computeSlotsForCollection(catalogRows: CatalogRow[], raw: RawData): SeriesSlot[] {
  const rootOf = buildSlotRoots(catalogRows);

  const rowsByRoot = new Map<number, CatalogRow[]>();
  for (const row of catalogRows) {
    const root = rootOf.get(row.IGDBGameId)!;
    const list = rowsByRoot.get(root) ?? [];
    list.push(row);
    rowsByRoot.set(root, list);
  }

  const slots: SeriesSlot[] = [];
  for (const [root, members] of rowsByRoot) {
    const memberIds = new Set(members.map((m) => m.IGDBGameId));
    const display =
      members.find((m) => m.IGDBGameId === root) ??
      members.find((m) => m.IGDBCategory == null || m.IGDBCategory === 0) ??
      members[0];

    let ownedGameId: string | null = null;
    let ownedViaOverride = false;
    for (const g of raw.localGames) {
      const overrideTarget = raw.overrideByGameId.get(g.Id);
      const matchesDirect = g.IGDBId != null && memberIds.has(g.IGDBId);
      const matchesAutoParent = g.IGDBParentGameId != null && memberIds.has(g.IGDBParentGameId);
      const matchesAutoVersion = g.IGDBVersionParentId != null && memberIds.has(g.IGDBVersionParentId);
      const matchesOverride = overrideTarget != null && memberIds.has(overrideTarget);

      if (matchesDirect || matchesAutoParent || matchesAutoVersion) {
        ownedGameId = g.Id;
        ownedViaOverride = false;
        break;
      }
      if (matchesOverride && !ownedGameId) {
        ownedGameId = g.Id;
        ownedViaOverride = true;
        // Keep scanning — a direct/automatic match elsewhere should
        // still win over an override if one exists.
      }
    }

    slots.push({
      canonicalIgdbId: root,
      title: display.Title,
      releaseYear: display.ReleaseYear,
      coverArtUrl: display.CoverArtUrl,
      owned: ownedGameId != null,
      ownedGameId,
      ownedViaOverride,
    });
  }

  slots.sort((a, b) => (a.releaseYear ?? 9999) - (b.releaseYear ?? 9999));
  return slots;
}

function slotsFromOwnedOnly(owned: OwnedLinkRow[]): SeriesSlot[] {
  return owned
    .filter((g): g is OwnedLinkRow & { IGDBId: number } => g.IGDBId != null)
    .map((g) => ({
      canonicalIgdbId: g.IGDBId,
      title: g.Title,
      releaseYear: g.ReleaseYear,
      coverArtUrl: g.CoverArtUrl,
      owned: true,
      ownedGameId: g.Id,
      ownedViaOverride: false,
    }));
}

/**
 * Every series (Collection) with at least one game already in the
 * library — the candidate list for a series picker. A Collection with
 * zero owned games isn't something the user has any reason to see here;
 * IGDB has thousands of collections for series they've never touched.
 *
 * Fetches every table it needs exactly once (see the performance note
 * above), then computes each collection's slots in-memory.
 */
export async function getSeriesList(db: DbClient): Promise<SeriesSummary[]> {
  const collections = await db.select<{
    Id: number;
    Name: string;
    IGDBCollectionId: number | null;
    SeriesCatalogFetchedAt: string | null;
  }>(`
    SELECT DISTINCT c.Id, c.Name, c.IGDBCollectionId, c.SeriesCatalogFetchedAt
    FROM Collections c
    JOIN GameCollections gc ON gc.CollectionId = c.Id
    ORDER BY c.Name
  `);

  const allCatalogRows = await db.select<CatalogRow & { CollectionId: number }>(
    `SELECT CollectionId, IGDBGameId, Title, ReleaseYear, CoverArtUrl, IGDBCategory, IGDBParentGameId FROM SeriesCatalogGames`
  );
  const catalogByCollection = new Map<number, CatalogRow[]>();
  for (const row of allCatalogRows) {
    const list = catalogByCollection.get(row.CollectionId) ?? [];
    list.push(row);
    catalogByCollection.set(row.CollectionId, list);
  }

  const allOwnedLinks = await db.select<OwnedLinkRow & { CollectionId: number }>(`
    SELECT gc.CollectionId, g.Id, g.IGDBId, g.Title, g.ReleaseYear, g.CoverArtUrl
    FROM Games g
    JOIN GameCollections gc ON gc.GameId = g.Id
  `);
  const ownedByCollection = new Map<number, OwnedLinkRow[]>();
  for (const row of allOwnedLinks) {
    const list = ownedByCollection.get(row.CollectionId) ?? [];
    list.push(row);
    ownedByCollection.set(row.CollectionId, list);
  }

  const raw = await loadRawData(db);

  return collections.map((row) => {
    const catalogRows = catalogByCollection.get(row.Id) ?? [];
    const slots =
      catalogRows.length > 0
        ? computeSlotsForCollection(catalogRows, raw)
        : slotsFromOwnedOnly(ownedByCollection.get(row.Id) ?? []);

    return {
      collectionId: row.Id,
      name: row.Name,
      igdbCollectionId: row.IGDBCollectionId,
      catalogFetchedAt: row.SeriesCatalogFetchedAt,
      ownedCount: slots.filter((s) => s.owned).length,
      totalCount: slots.length,
    };
  });
}

/**
 * Fetches a series' full member list from IGDB (via the collection's
 * own `games` relation) and caches it into SeriesCatalogGames — a
 * one-time refresh, not something run automatically on every view.
 * Safe to re-run: upserts rather than duplicating.
 */
export async function refreshSeriesCatalog(
  db: DbClient,
  client: IgdbClient,
  collectionId: number,
  igdbCollectionId: number
): Promise<number> {
  const [collectionData] = await client.getCollectionsWithGames([igdbCollectionId]);
  const members = collectionData?.games ?? [];

  for (const member of members) {
    const releaseYear = member.first_release_date
      ? new Date(member.first_release_date * 1000).getUTCFullYear()
      : null;
    const coverUrl = member.cover?.image_id ? igdbCoverUrl(member.cover.image_id) : null;

    await db.execute(
      `
      INSERT INTO SeriesCatalogGames (CollectionId, IGDBGameId, Title, ReleaseYear, CoverArtUrl, IGDBCategory, IGDBParentGameId)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(CollectionId, IGDBGameId) DO UPDATE SET
        Title = excluded.Title,
        ReleaseYear = excluded.ReleaseYear,
        CoverArtUrl = excluded.CoverArtUrl,
        IGDBCategory = excluded.IGDBCategory,
        IGDBParentGameId = excluded.IGDBParentGameId
      `,
      [
        collectionId,
        member.id,
        member.name ?? `Untitled (IGDB #${member.id})`,
        releaseYear,
        coverUrl,
        member.category ?? null,
        member.parent_game ?? null,
      ]
    );
  }

  await db.execute(`UPDATE Collections SET SeriesCatalogFetchedAt = ? WHERE Id = ?`, [
    new Date().toISOString(),
    collectionId,
  ]);

  return members.length;
}

/**
 * Single-collection completion — used when the user selects a series in
 * the UI. Falls back to the games already linked to this collection via
 * GameCollections (the pre-existing, library-only join) when the fuller
 * SeriesCatalogGames cache hasn't been fetched yet for this series — so
 * the page still shows something useful before the first "Refresh
 * Catalog" click, just without the unowned/grayed-out entries that only
 * the real catalog provides.
 */
export async function getSeriesCompletion(db: DbClient, collectionId: number): Promise<SeriesSlot[]> {
  const catalogRows = await db.select<CatalogRow>(
    `SELECT IGDBGameId, Title, ReleaseYear, CoverArtUrl, IGDBCategory, IGDBParentGameId
     FROM SeriesCatalogGames WHERE CollectionId = ?`,
    [collectionId]
  );

  if (catalogRows.length === 0) {
    const owned = await db.select<OwnedLinkRow>(
      `
      SELECT g.Id, g.IGDBId, g.Title, g.ReleaseYear, g.CoverArtUrl
      FROM Games g
      JOIN GameCollections gc ON gc.GameId = g.Id
      WHERE gc.CollectionId = ?
      `,
      [collectionId]
    );
    return slotsFromOwnedOnly(owned);
  }

  const raw = await loadRawData(db);
  return computeSlotsForCollection(catalogRows, raw);
}

/** Sets (or clears, when canonicalIgdbId is null) a manual equivalence
 * override for one local game. */
export async function setSeriesOverride(
  db: DbClient,
  gameId: string,
  canonicalIgdbId: number | null
): Promise<void> {
  if (canonicalIgdbId == null) {
    await db.execute(`DELETE FROM GameSeriesOverrides WHERE GameId = ?`, [gameId]);
    return;
  }
  await db.execute(
    `
    INSERT INTO GameSeriesOverrides (GameId, CanonicalIGDBGameId) VALUES (?, ?)
    ON CONFLICT(GameId) DO UPDATE SET CanonicalIGDBGameId = excluded.CanonicalIGDBGameId
    `,
    [gameId, canonicalIgdbId]
  );
}

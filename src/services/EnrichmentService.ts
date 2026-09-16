import type { DbClient } from "../database/database";
import { IgdbClient, IgdbGame, IgdbTimeToBeat, igdbCoverUrl, igdbPlatformLogoUrl, secondsToHours } from "./IgdbClient";
import { getOrCreateNamedLookupId, getOrCreateCollectionId, linkGameToLookup } from "./LookupTables";

const BATCH_SIZE = 500; // IGDB's per-request limit.

export interface EnrichmentSummary {
  requested: number;
  matched: number;
  notFound: number;
}

async function applyGameMetadata(db: DbClient, gameId: string, raw: IgdbGame): Promise<void> {
  const releaseDate = raw.first_release_date
    ? new Date(raw.first_release_date * 1000).toISOString().slice(0, 10)
    : null;
  const releaseYear = releaseDate ? Number(releaseDate.slice(0, 4)) : null;
  const coverUrl = raw.cover?.image_id ? igdbCoverUrl(raw.cover.image_id) : null;

  await db.execute(
    `
    UPDATE Games SET
      ReleaseDate = ?,
      ReleaseYear = ?,
      CoverArtUrl = ?,
      IGDBUserRating = ?,
      IGDBUserRatingCount = ?,
      AggregatedRating = ?,
      AggregatedRatingCount = ?,
      IGDBCategory = ?,
      IGDBParentGameId = ?,
      IGDBVersionParentId = ?,
      MetadataRetrievedAt = ?
    WHERE Id = ?
    `,
    [
      releaseDate,
      releaseYear,
      coverUrl,
      raw.rating ?? null,
      raw.rating_count ?? null,
      raw.aggregated_rating ?? null,
      raw.aggregated_rating_count ?? null,
      raw.category ?? null,
      raw.parent_game ?? null,
      raw.version_parent ?? null,
      new Date().toISOString(),
      gameId,
    ]
  );

  for (const genre of raw.genres ?? []) {
    const id = await getOrCreateNamedLookupId(db, "Genres", genre.name);
    await linkGameToLookup(db, "GameGenres", "GameId", "GenreId", gameId, id);
  }

  for (const theme of raw.themes ?? []) {
    const id = await getOrCreateNamedLookupId(db, "Themes", theme.name);
    await linkGameToLookup(db, "GameThemes", "GameId", "ThemeId", gameId, id);
  }

  // Franchises used to be a single Games.Franchise TEXT column (first one
  // only) — normalized now, and correctly capturing every franchise a
  // game belongs to, not just the first, since GLIP's unification is
  // exactly what revealed some games genuinely have more than one.
  for (const franchise of raw.franchises ?? []) {
    const id = await getOrCreateNamedLookupId(db, "Franchises", franchise.name);
    await linkGameToLookup(db, "GameFranchises", "GameId", "FranchiseId", gameId, id);
  }

  for (const keyword of raw.keywords ?? []) {
    const id = await getOrCreateNamedLookupId(db, "Keywords", keyword.name);
    await linkGameToLookup(db, "GameKeywords", "GameId", "KeywordId", gameId, id);
  }

  for (const collection of raw.collections ?? []) {
    const id = await getOrCreateCollectionId(db, collection.name, collection.id ?? null);
    await linkGameToLookup(db, "GameCollections", "GameId", "CollectionId", gameId, id);
  }

  for (const mode of raw.game_modes ?? []) {
    const id = await getOrCreateNamedLookupId(db, "GameModes", mode.name);
    await linkGameToLookup(db, "GameGameModes", "GameId", "GameModeId", gameId, id);
  }

  for (const perspective of raw.player_perspectives ?? []) {
    const id = await getOrCreateNamedLookupId(db, "PlayerPerspectives", perspective.name);
    await linkGameToLookup(db, "GamePlayerPerspectives", "GameId", "PlayerPerspectiveId", gameId, id);
  }

  for (const company of raw.involved_companies ?? []) {
    if (!company.company?.name) continue;
    if (company.developer) {
      const id = await getOrCreateNamedLookupId(db, "Developers", company.company.name);
      await linkGameToLookup(db, "GameDevelopers", "GameId", "DeveloperId", gameId, id);
    }
    if (company.publisher) {
      const id = await getOrCreateNamedLookupId(db, "Publishers", company.company.name);
      await linkGameToLookup(db, "GamePublishers", "GameId", "PublisherId", gameId, id);
    }
  }
}

async function applyTimeToBeat(db: DbClient, gameId: string, raw: IgdbTimeToBeat): Promise<void> {
  await db.execute(
    `
    UPDATE Games SET
      TimeToBeatHastily = ?,
      TimeToBeatNormally = ?,
      TimeToBeatCompletely = ?,
      TimeToBeatCount = ?
    WHERE Id = ?
    `,
    [
      secondsToHours(raw.hastily),
      secondsToHours(raw.normally),
      secondsToHours(raw.completely),
      raw.count ?? null,
      gameId,
    ]
  );
}

/**
 * Enriches every game that doesn't have metadata yet (MetadataRetrievedAt
 * IS NULL) with IGDB data: genres, themes, developers, publishers,
 * franchise, release date, cover art, IGDB's own user rating, and
 * time-to-beat (Hastily/Normally/Completely, from the separate
 * game_time_to_beats endpoint — see IgdbClient.ts for why that's a
 * distinct query rather than a field on the main /games response).
 *
 * This is what replaced the original HLTB/Metacritic-via-web-search plan
 * (see the comment on Games.TimeToBeatHastily in schema.ts for the full
 * reasoning) — structured, id-keyed IGDB data instead of hundreds of
 * individually-verified name-matched lookups. HLTBMainStory/
 * HLTBCompletionist/MetacriticScore/OpenCriticScore remain in the schema,
 * still populated by the personal-spreadsheet importer, untouched by this
 * function.
 */
/**
 * Enriches exactly one game right away, given a known IGDB id —
 * for the Add Game flow, where the user has just picked a specific IGDB
 * search result and the whole point is seeing real cover art/genre
 * data immediately rather than waiting for the next batch "Fetch
 * Metadata" run. Reuses applyGameMetadata directly (the same function
 * enrichGames' batch path calls) so a game enriched this way ends up
 * identical to one enriched through the normal flow — no separate
 * write path to keep in sync.
 */
export async function enrichSingleGame(db: DbClient, client: IgdbClient, gameId: string, igdbId: number): Promise<void> {
  const [raw] = await client.getGamesByIds([igdbId]);
  if (raw) {
    await applyGameMetadata(db, gameId, raw);
  }

  const [timeToBeat] = await client.getTimeToBeatByGameIds([igdbId]);
  if (timeToBeat) {
    await applyTimeToBeat(db, gameId, timeToBeat);
  }
}

export async function enrichGames(db: DbClient, client: IgdbClient, force = false): Promise<EnrichmentSummary> {
  const whereClause = force ? "" : "WHERE MetadataRetrievedAt IS NULL";
  const pending = await db.select<{ Id: string; IGDBId: number }>(
    `SELECT Id, IGDBId FROM Games ${whereClause}`
  );

  if (pending.length === 0) {
    return { requested: 0, matched: 0, notFound: 0 };
  }

  let matched = 0;
  const foundIds = new Set<number>();

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const igdbIds = batch.map((row) => row.IGDBId);
    const results = await client.getGamesByIds(igdbIds);

    for (const raw of results) {
      const localRow = batch.find((row) => row.IGDBId === raw.id);
      if (!localRow) continue;
      await applyGameMetadata(db, localRow.Id, raw);
      matched += 1;
      foundIds.add(raw.id);
    }

    // Same batch of ids, second endpoint — time-to-beat isn't part of the
    // /games response at all (see IgdbClient.ts), so this is necessarily
    // a separate request even though it's the same games.
    const timeToBeatResults = await client.getTimeToBeatByGameIds(igdbIds);
    for (const raw of timeToBeatResults) {
      const localRow = batch.find((row) => row.IGDBId === raw.game_id);
      if (!localRow) continue;
      await applyTimeToBeat(db, localRow.Id, raw);
    }
  }

  const notFoundRows = pending.filter((row) => !foundIds.has(row.IGDBId));
  if (notFoundRows.length > 0) {
    const now = new Date().toISOString();
    for (const row of notFoundRows) {
      // Stamp as attempted so these don't get re-queried every run — same
      // reasoning as GLIP's enrichment step: retry only via --force.
      await db.execute(`UPDATE Games SET MetadataRetrievedAt = ? WHERE Id = ?`, [now, row.Id]);
    }
  }

  return { requested: pending.length, matched, notFound: notFoundRows.length };
}

/**
 * Resolves names for any Platforms rows still missing one, via IGDB's
 * public /platforms reference. Separate from enrichGames() because it
 * operates on a different table and has nothing to do with per-game
 * metadata — called alongside it from Settings, not instead of it.
 */
export async function enrichPlatformNames(db: DbClient, client: IgdbClient): Promise<number> {
  // OR LogoUrl IS NULL (not just Name IS NULL): platforms named before
  // the Hardware page's logo support existed would otherwise never be
  // revisited here — the same "already enriched, never re-checked" gap
  // fixed for Games via the force re-fetch option, but this one doesn't
  // need a manual force button at all: unlike full game metadata
  // (ratings, etc.) a logo doesn't go stale, so it's safe to just always
  // backfill whatever's missing without asking.
  const unresolved = await db.select<{ Id: number }>(
    `SELECT Id FROM Platforms WHERE Name IS NULL OR LogoUrl IS NULL`
  );

  let resolved = 0;
  if (unresolved.length > 0) {
    for (let i = 0; i < unresolved.length; i += BATCH_SIZE) {
      const batch = unresolved.slice(i, i + BATCH_SIZE);
      const results = await client.getPlatformsByIds(batch.map((row) => row.Id));
      for (const platform of results) {
        const logoUrl = platform.logoImageId ? igdbPlatformLogoUrl(platform.logoImageId) : null;
        await db.execute(`UPDATE Platforms SET Name = ?, LogoUrl = ? WHERE Id = ?`, [
          platform.name,
          logoUrl,
          platform.id,
        ]);
        resolved += 1;
      }
    }
  }

  await ensurePlatformNameUniqueness(db);
  return resolved;
}

/**
 * Fixes a real, confirmed bug — twice reported recurring, which is why
 * this is now a structural fix and not just a cleanup pass. Platforms
 * was the one lookup table in this schema without a UNIQUE constraint
 * on Name (every other one — Genres, Themes, Collections, etc. — has
 * had it from the start, which is exactly why none of them have ever
 * had this problem). Without that constraint, two independent code
 * paths — the spreadsheet importer's getOrCreatePlatformIdByName
 * (creates by name, synthetic negative id if nothing matches yet) and
 * the JSON importer's ensureLookupRow (creates by IGDB's numeric id,
 * Name left NULL until later) — could each create a row for the same
 * real-world platform without ever knowing about each other, e.g. two
 * "PC (Microsoft Windows)" rows.
 *
 * This function now does two things, in order:
 *  1. Merges any existing duplicates (same as before) — repoints every
 *     UserGames/Playthroughs reference to one surviving row, prefers a
 *     real IGDB id over a synthetic placeholder, deletes the rest.
 *  2. Creates a UNIQUE index on Platforms.Name — the actual structural
 *     fix. CREATE_PLATFORMS_TABLE now declares Name UNIQUE too, but
 *     that only helps *fresh* databases (CREATE TABLE IF NOT EXISTS is
 *     a no-op on one that already exists); this index is what gives an
 *     existing database the same guarantee, and it can only succeed
 *     once step 1 has actually removed any duplicates — hence the
 *     order. Once this index exists, getOrCreatePlatformIdByName's
 *     INSERT can no longer create a duplicate even if its own by-name
 *     lookup somehow misses one.
 *
 * Exported so HardwareService can also call this when the Hardware
 * page loads — self-healing at the point the data is actually looked
 * at, not only when the user happens to run enrichment from Settings.
 */
export async function ensurePlatformNameUniqueness(db: DbClient): Promise<void> {
  await mergeDuplicateLookupRows(
    db,
    "Platforms",
    [
      { table: "UserGames", column: "OwnedPlatformId" },
      { table: "Playthroughs", column: "PlayedPlatformId" },
    ],
    [{ column: "CurrentlyOwned", preserveNonDefault: "high" }]
  );
  try {
    await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_platforms_name ON Platforms(Name)`);
  } catch (e) {
    // Non-fatal: worst case this database keeps relying on the merge
    // pass above running periodically, same as before this fix existed.
    console.error("Failed to create unique index on Platforms.Name:", e);
  }
}

/** Shared by ensurePlatformNameUniqueness and
 * ensureStorefrontNameUniqueness below — same merge logic, parameterized
 * by table and by which foreign-key columns elsewhere reference it. */
interface FlagColumn {
  column: string;
  // "high": the deliberate/meaningful value is 1, default is 0 (e.g.
  //   CurrentlyOwned, IsSubscription) — merge via MAX, so if either row
  //   was ever flagged true, the survivor is too.
  // "low": the deliberate/meaningful value is 0, default is 1 (e.g.
  //   IsCurrentlyActive, which defaults to active) — merge via MIN, so
  //   an explicit "turned this off" on either row isn't silently lost
  //   by MAX preferring whichever row happened to still be at its
  //   untouched default.
  preserveNonDefault: "high" | "low";
}

async function mergeDuplicateLookupRows(
  db: DbClient,
  table: string,
  references: { table: string; column: string }[],
  flagColumns: FlagColumn[] = []
): Promise<void> {
  const rows = await db.select<{ Id: number; Name: string | null }>(
    `SELECT Id, Name FROM ${table} WHERE Name IS NOT NULL`
  );

  const byName = new Map<string, { Id: number; Name: string | null }[]>();
  for (const r of rows) {
    const key = (r.Name as string).trim().toLowerCase();
    const list = byName.get(key) ?? [];
    list.push(r);
    byName.set(key, list);
  }

  for (const group of byName.values()) {
    if (group.length <= 1) continue;

    const positiveIds = group.filter((r) => r.Id > 0);
    const keeper = positiveIds.length > 0 ? positiveIds[0] : group.reduce((a, b) => (a.Id < b.Id ? a : b));
    const losers = group.filter((r) => r.Id !== keeper.Id);

    for (const loser of losers) {
      // Before deleting the loser, fold any flag it carried into the
      // keeper — deleting it outright without this would silently
      // discard whichever toggle state happened to live on the row
      // that didn't survive, which is a real risk for duplicates that
      // already exist right now (not just a hypothetical future one).
      for (const flag of flagColumns) {
        const aggFn = flag.preserveNonDefault === "high" ? "MAX" : "MIN";
        await db.execute(
          `UPDATE ${table} SET ${flag.column} = (SELECT ${aggFn}(${flag.column}) FROM ${table} WHERE Id IN (?, ?)) WHERE Id = ?`,
          [keeper.Id, loser.Id, keeper.Id]
        );
      }

      for (const ref of references) {
        await db.execute(`UPDATE ${ref.table} SET ${ref.column} = ? WHERE ${ref.column} = ?`, [
          keeper.Id,
          loser.Id,
        ]);
      }
      await db.execute(`DELETE FROM ${table} WHERE Id = ?`, [loser.Id]);
    }
  }
}

/** Storefronts' equivalent of ensurePlatformNameUniqueness above — same
 * gap, same fix, same two-step (merge existing duplicates, then create
 * a UNIQUE index so new ones can't form). Exported so both
 * SubscriptionService (read path) and Settings' manual storefront
 * labeling (write path — see setStorefrontLabel below) can call it. */
export async function ensureStorefrontNameUniqueness(db: DbClient): Promise<void> {
  await mergeDuplicateLookupRows(
    db,
    "Storefronts",
    [
      { table: "UserGames", column: "OwnedStorefrontId" },
      { table: "Playthroughs", column: "StorefrontId" },
    ],
    [
      { column: "IsSubscription", preserveNonDefault: "high" },
      { column: "IsCurrentlyActive", preserveNonDefault: "low" },
    ]
  );
  try {
    await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_storefronts_name ON Storefronts(Name)`);
  } catch (e) {
    console.error("Failed to create unique index on Storefronts.Name:", e);
  }
}

/**
 * Manual storefront labeling (Settings' "unknown-storefront-code
 * labeling" UI) used to be a plain UPDATE — which, once
 * Storefronts.Name has a UNIQUE constraint, would throw if the label
 * the user picks already belongs to another row (e.g. labeling an
 * unlabeled Backloggd-numeric-id row "Steam" when a separate
 * spreadsheet-created "Steam" row already exists). Rather than let that
 * throw, this checks for an existing same-named row first and merges
 * into it directly — the same outcome ensureStorefrontNameUniqueness
 * would eventually reach, just done immediately instead of relying on
 * that cleanup running again afterward.
 */
export async function setStorefrontLabel(db: DbClient, storefrontId: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;

  const existing = await db.select<{ Id: number }>(
    `SELECT Id FROM Storefronts WHERE LOWER(Name) = LOWER(?) AND Id != ? LIMIT 1`,
    [trimmed, storefrontId]
  );

  if (existing.length > 0) {
    const keeperId = existing[0].Id;
    await db.execute(`UPDATE UserGames SET OwnedStorefrontId = ? WHERE OwnedStorefrontId = ?`, [
      keeperId,
      storefrontId,
    ]);
    await db.execute(`UPDATE Playthroughs SET StorefrontId = ? WHERE StorefrontId = ?`, [
      keeperId,
      storefrontId,
    ]);
    await db.execute(`DELETE FROM Storefronts WHERE Id = ?`, [storefrontId]);
    return;
  }

  await db.execute(`UPDATE Storefronts SET Name = ? WHERE Id = ?`, [trimmed, storefrontId]);
}

/** Re-exported from schema.ts, which is where this now lives (it's static
 * seed data, no IGDB dependency — see the comment there for why). Kept
 * here too so nothing importing it from EnrichmentService breaks. */
export { seedKnownAcquisitionMethods } from "../database/schema";

export interface StorefrontSuggestion {
  storefrontId: number;
  suggestedName: string | null;
  confidence: number; // fraction of games under this storefront_id sharing the majority platform
  gameCount: number;
  samplePlatform: string | null;
  sampleGameTitles: string[];
}

/**
 * Storefront ids in the export only ever appear for subscription-medium
 * games (confirmed directly), and Backloggd gives no public reference for
 * what each numeric id means. But subscription services are essentially
 * platform-exclusive (Game Pass -> PC/Xbox, PS Plus -> PlayStation, NSO ->
 * Switch), so cross-referencing each storefront_id against the platforms
 * of the games carrying it gives a strong, checkable suggestion — never
 * applied automatically, only surfaced for confirmation in Settings.
 */
export async function suggestStorefrontLabels(db: DbClient): Promise<StorefrontSuggestion[]> {
  // WHERE Name IS NULL: without this, every already-labeled storefront
  // showed up here too — including ones the spreadsheet importer creates
  // with a real name already set at creation time (Riot, GOG, Ubisoft,
  // etc., via getOrCreateStorefrontIdByName in SpreadsheetImporter.ts).
  // Those have no Playthroughs rows referencing them at all (Playthroughs.
  // StorefrontId only ever comes from Backloggd's raw numeric codes, never
  // from a spreadsheet-sourced synthetic id), so the cross-reference below
  // always found zero games for them — surfacing as a confusing "0 games,
  // unresolved platform, 0% consistent" for entries that were already
  // correctly labeled and needed no suggestion at all. This filter means
  // only genuinely-unlabeled storefronts (raw numeric codes straight from
  // Backloggd, or anything not yet manually confirmed) show up here.
  const storefronts = await db.select<{ Id: number; Name: string | null }>(
    `SELECT Id, Name FROM Storefronts WHERE Name IS NULL`
  );

  const suggestions: StorefrontSuggestion[] = [];

  for (const storefront of storefronts) {
    const rows = await db.select<{ PlatformName: string | null; Title: string }>(
      `
      SELECT pl.Name AS PlatformName, g.Title AS Title
      FROM Playthroughs p
      JOIN Games g ON g.Id = p.GameId
      LEFT JOIN Platforms pl ON pl.Id = p.PlayedPlatformId
      WHERE p.StorefrontId = ?
      `,
      [storefront.Id]
    );

    const platformCounts = new Map<string, number>();
    for (const row of rows) {
      const name = row.PlatformName ?? "Unknown platform";
      platformCounts.set(name, (platformCounts.get(name) ?? 0) + 1);
    }

    let majorityPlatform: string | null = null;
    let majorityCount = 0;
    for (const [name, count] of platformCounts) {
      if (count > majorityCount) {
        majorityPlatform = name;
        majorityCount = count;
      }
    }

    // Common platform -> likely subscription service names. This is a
    // suggestion aid, not an authoritative mapping — surfaced to the user
    // to confirm or correct, never applied automatically.
    const PLATFORM_TO_LIKELY_SERVICE: Record<string, string> = {
      "Nintendo Switch": "Nintendo Switch Online",
      "PlayStation 4": "PlayStation Plus",
      "PlayStation 5": "PlayStation Plus",
      "PC (Microsoft Windows)": "Xbox Game Pass",
      "Xbox One": "Xbox Game Pass",
      "Xbox Series X|S": "Xbox Game Pass",
    };

    suggestions.push({
      storefrontId: storefront.Id,
      suggestedName: storefront.Name ?? (majorityPlatform ? PLATFORM_TO_LIKELY_SERVICE[majorityPlatform] ?? null : null),
      confidence: rows.length > 0 ? majorityCount / rows.length : 0,
      gameCount: rows.length,
      samplePlatform: majorityPlatform,
      sampleGameTitles: rows.slice(0, 5).map((r) => r.Title),
    });
  }

  return suggestions;
}

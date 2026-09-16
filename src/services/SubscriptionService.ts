import { getDatabase, selectQuery, executeQuery } from "../database/database";
import { ensureStorefrontNameUniqueness } from "./EnrichmentService";

export interface SubscriptionStorefront {
  id: number;
  name: string;
  isActive: boolean;
  gameCount: number;
}

/** All storefronts flagged as subscription services (Xbox Game Pass,
 * PlayStation Plus, Nintendo Switch Online — auto-detected by name in
 * SpreadsheetImporter.ts), with the user's current active/inactive
 * toggle and how many games are tied to each. Settings uses this to
 * render the toggle list.
 *
 * Runs ensureStorefrontNameUniqueness first — self-heals any duplicate
 * Storefronts rows every time this is loaded, the same "fix it at the
 * point of use, not just during import" reasoning as
 * HardwareService.getPlatformsWithOwnership for the identical Platforms
 * bug. */
export async function getSubscriptionStorefronts(): Promise<SubscriptionStorefront[]> {
  await ensureStorefrontNameUniqueness(await getDatabase());
  return selectQuery<SubscriptionStorefront>(`
    SELECT
      s.Id AS id,
      s.Name AS name,
      s.IsCurrentlyActive AS isActive,
      COUNT(ug.GameId) AS gameCount
    FROM Storefronts s
    LEFT JOIN UserGames ug ON ug.OwnedStorefrontId = s.Id
    WHERE s.IsSubscription = 1
    GROUP BY s.Id
    ORDER BY s.Name
  `);
}

export async function setSubscriptionActive(storefrontId: number, isActive: boolean): Promise<void> {
  await executeQuery(`UPDATE Storefronts SET IsCurrentlyActive = ? WHERE Id = ?`, [isActive ? 1 : 0, storefrontId]);
}

export interface ExpiredSubscriptionGame {
  gameId: string;
  title: string;
  coverArtUrl: string | null;
  storefrontName: string;
  hasFinishedPlaythrough: boolean;
}

/**
 * Games owned via a subscription storefront the user has since unticked
 * in Settings — i.e. "you no longer have access to these unless you
 * resubscribe." Only ever driven by Storefronts.IsCurrentlyActive, which
 * defaults to 1 (active) — nothing shows up here until the user
 * explicitly says a subscription has lapsed, so a fresh install never
 * shows a false "everything expired" list.
 *
 * Also runs ensureStorefrontNameUniqueness first — this page never goes
 * through getSubscriptionStorefronts above, so it needs its own call to
 * get the same self-healing coverage.
 */
export async function getExpiredSubscriptionGames(): Promise<ExpiredSubscriptionGame[]> {
  await ensureStorefrontNameUniqueness(await getDatabase());
  return selectQuery<ExpiredSubscriptionGame>(`
    SELECT
      g.Id AS gameId,
      g.Title AS title,
      g.CoverArtUrl AS coverArtUrl,
      s.Name AS storefrontName,
      COALESCE((
        SELECT MAX(CASE WHEN p.FinishDate IS NOT NULL THEN 1 ELSE 0 END)
        FROM Playthroughs p WHERE p.GameId = g.Id
      ), 0) AS hasFinishedPlaythrough
    FROM UserGames ug
    JOIN Games g ON g.Id = ug.GameId
    JOIN Storefronts s ON s.Id = ug.OwnedStorefrontId
    WHERE s.IsSubscription = 1 AND s.IsCurrentlyActive = 0
    ORDER BY g.Title
  `);
}

import { selectQuery } from "../database/database";
import { estimateSessionHours } from "../utils/sessionHours";

/**
 * All analytics queries live here rather than inline in Analytics.tsx, so
 * they can be reasoned about (and in principle tested) independently of
 * React. Every query is read-only against data already imported/enriched —
 * nothing here writes to the database.
 */

export interface GenreHours {
  genre: string;
  hours: number;
  avgRating: number | null;
  gameCount: number;
}

export async function getHoursByGenre(): Promise<GenreHours[]> {
  return selectQuery<GenreHours>(`
    SELECT
      genres.Name AS genre,
      SUM(MAX(COALESCE(pt.TotalHoursPlayed, 0), COALESCE(ug.TotalHours, 0))) AS hours,
      AVG(pt.LatestRating) AS avgRating,
      COUNT(DISTINCT g.Id) AS gameCount
    FROM Games g
    JOIN GameGenres gg ON gg.GameId = g.Id
    JOIN Genres genres ON genres.Id = gg.GenreId
    LEFT JOIN UserGames ug ON ug.GameId = g.Id
    LEFT JOIN (
      SELECT GameId, SUM(HoursPlayed) AS TotalHoursPlayed, MAX(Rating) AS LatestRating
      FROM Playthroughs GROUP BY GameId
    ) pt ON pt.GameId = g.Id
    GROUP BY genres.Name
    ORDER BY hours DESC
  `);
}

export interface FranchiseStats {
  franchise: string;
  hours: number;
  avgRating: number | null;
  gameCount: number;
}

export async function getFranchisePreferences(): Promise<FranchiseStats[]> {
  return selectQuery<FranchiseStats>(`
    SELECT
      franchises.Name AS franchise,
      SUM(MAX(COALESCE(pt.TotalHoursPlayed, 0), COALESCE(ug.TotalHours, 0))) AS hours,
      AVG(pt.LatestRating) AS avgRating,
      COUNT(DISTINCT g.Id) AS gameCount
    FROM Games g
    JOIN GameFranchises gf ON gf.GameId = g.Id
    JOIN Franchises franchises ON franchises.Id = gf.FranchiseId
    LEFT JOIN UserGames ug ON ug.GameId = g.Id
    LEFT JOIN (
      SELECT GameId, SUM(HoursPlayed) AS TotalHoursPlayed, MAX(Rating) AS LatestRating
      FROM Playthroughs GROUP BY GameId
    ) pt ON pt.GameId = g.Id
    GROUP BY franchises.Name
    HAVING gameCount >= 2
    ORDER BY hours DESC
  `);
}

export interface PlatformStats {
  platform: string;
  hours: number;
  gameCount: number;
}

export async function getHoursByPlatform(): Promise<PlatformStats[]> {
  // Real bug, found during an audit pass: this previously summed raw
  // Playthroughs.HoursPlayed directly, with no MAX-correction against
  // UserGames.TotalHours — the same undercounting affecting ~15% of
  // games (see GameService.ts's comment) would have silently propagated
  // into this chart too.
  //
  // The fix isn't a blind substitution though: UserGames.TotalHours is
  // one aggregate for the whole game, not tied to any specific
  // playthrough's platform, so if a game was played across *multiple*
  // platforms (different playthroughs), there's no way to know which
  // platform the "extra" hours implied by the correction actually
  // belong to. So: single-platform games (the common case) get the full
  // correction, attributed unambiguously to their one platform.
  // Multi-platform games keep their raw per-playthrough sums, uncorrected
  // — an honest limitation rather than a guessed allocation.
  return selectQuery<PlatformStats>(`
    SELECT platform, SUM(hours) AS hours, COUNT(DISTINCT gameId) AS gameCount
    FROM (
      SELECT
        COALESCE(pl.Name, 'Platform #' || onlyPlatform.PlatformId) AS platform,
        MAX(COALESCE(gameHours.PlaythroughSum, 0), COALESCE(ug.TotalHours, 0)) AS hours,
        onlyPlatform.GameId AS gameId
      FROM (
        SELECT GameId, MIN(PlayedPlatformId) AS PlatformId
        FROM Playthroughs
        WHERE PlayedPlatformId IS NOT NULL
        GROUP BY GameId
        HAVING COUNT(DISTINCT PlayedPlatformId) = 1
      ) onlyPlatform
      LEFT JOIN Platforms pl ON pl.Id = onlyPlatform.PlatformId
      LEFT JOIN UserGames ug ON ug.GameId = onlyPlatform.GameId
      LEFT JOIN (
        SELECT GameId, SUM(HoursPlayed) AS PlaythroughSum FROM Playthroughs GROUP BY GameId
      ) gameHours ON gameHours.GameId = onlyPlatform.GameId

      UNION ALL

      SELECT
        COALESCE(pl.Name, 'Platform #' || p.PlayedPlatformId) AS platform,
        p.HoursPlayed AS hours,
        p.GameId AS gameId
      FROM Playthroughs p
      LEFT JOIN Platforms pl ON pl.Id = p.PlayedPlatformId
      WHERE p.PlayedPlatformId IS NOT NULL
        AND p.GameId IN (
          SELECT GameId FROM Playthroughs
          WHERE PlayedPlatformId IS NOT NULL
          GROUP BY GameId
          HAVING COUNT(DISTINCT PlayedPlatformId) > 1
        )
    )
    GROUP BY platform
    ORDER BY hours DESC
  `);
}

export interface OwnershipDistribution {
  label: string;
  gameCount: number;
}

/**
 * Games owned per platform, from UserGames.OwnedPlatformId — deliberately
 * different from getHoursByPlatform() above, which only reflects
 * Playthroughs.PlayedPlatformId (actual play history). A backlog game has
 * no playthrough at all, so it would never show up in that query no
 * matter how comprehensive your library is. Ownership data comes from
 * the personal spreadsheet import (see SpreadsheetImporter.ts) and
 * covers backlog games too, so this is "how is my whole library
 * distributed," not just "what have I actually played."
 */
export async function getGamesByOwnedPlatform(): Promise<OwnershipDistribution[]> {
  return selectQuery<OwnershipDistribution>(`
    SELECT pl.Name AS label, COUNT(*) AS gameCount
    FROM UserGames ug
    JOIN Platforms pl ON pl.Id = ug.OwnedPlatformId
    GROUP BY ug.OwnedPlatformId
    ORDER BY gameCount DESC
  `);
}

export async function getGamesByOwnedStorefront(): Promise<OwnershipDistribution[]> {
  return selectQuery<OwnershipDistribution>(`
    SELECT s.Name AS label, COUNT(*) AS gameCount
    FROM UserGames ug
    JOIN Storefronts s ON s.Id = ug.OwnedStorefrontId
    GROUP BY ug.OwnedStorefrontId
    ORDER BY gameCount DESC
  `);
}

export interface RatingBucket {
  rating: number;
  count: number;
}

export async function getRatingDistribution(): Promise<RatingBucket[]> {
  return selectQuery<RatingBucket>(`
    SELECT Rating AS rating, COUNT(*) AS count
    FROM Playthroughs
    WHERE Rating IS NOT NULL
    GROUP BY Rating
    ORDER BY Rating ASC
  `);
}

export interface CompletionMetrics {
  totalGames: number;
  completedGames: number;
  droppedGames: number;
  backlogGames: number;
  wishlistGames: number;
  completionRate: number;
}

export async function getCompletionMetrics(): Promise<CompletionMetrics> {
  const rows = await selectQuery<{
    totalGames: number;
    completedGames: number;
    droppedGames: number;
    backlogGames: number;
    wishlistGames: number;
  }>(`
    SELECT
      COUNT(DISTINCT g.Id) AS totalGames,
      COUNT(DISTINCT CASE WHEN pt.HasFinishedPlaythrough = 1 THEN g.Id END) AS completedGames,
      COUNT(DISTINCT CASE WHEN pt.HasFinishedPlaythrough IS NOT 1 AND pt.PlaythroughCount > 0 THEN g.Id END) AS droppedGames,
      COUNT(DISTINCT CASE WHEN (pt.PlaythroughCount IS NULL OR pt.PlaythroughCount = 0) AND ug.IsBacklog = 1 THEN g.Id END) AS backlogGames,
      COUNT(DISTINCT CASE WHEN (pt.PlaythroughCount IS NULL OR pt.PlaythroughCount = 0) AND ug.IsWishlist = 1 THEN g.Id END) AS wishlistGames
    FROM Games g
    LEFT JOIN UserGames ug ON ug.GameId = g.Id
    LEFT JOIN (
      SELECT GameId, COUNT(*) AS PlaythroughCount,
        MAX(CASE WHEN FinishDate IS NOT NULL THEN 1 ELSE 0 END) AS HasFinishedPlaythrough
      FROM Playthroughs GROUP BY GameId
    ) pt ON pt.GameId = g.Id
  `);

  const row = rows[0];
  return {
    ...row,
    completionRate: row.totalGames > 0 ? row.completedGames / row.totalGames : 0,
  };
}

export interface GenreYearHours {
  year: number;
  genre: string;
  hours: number;
}

/**
 * Genre hours broken down by year, keyed off each Playthrough's
 * StartDate — the "genres played over time" chart from the request.
 * A multi-genre game contributes its full hours to each of its genres for
 * that year (not divided across them) — same one-hot convention GLIP used
 * for the equivalent analysis, kept consistent across both projects.
 */
export async function getGenreHoursByYear(): Promise<GenreYearHours[]> {
  return selectQuery<GenreYearHours>(`
    SELECT
      CAST(strftime('%Y', p.StartDate) AS INTEGER) AS year,
      genres.Name AS genre,
      SUM(p.HoursPlayed) AS hours
    FROM Playthroughs p
    JOIN GameGenres gg ON gg.GameId = p.GameId
    JOIN Genres genres ON genres.Id = gg.GenreId
    WHERE p.StartDate IS NOT NULL AND p.HoursPlayed IS NOT NULL
    GROUP BY year, genres.Name
    ORDER BY year ASC, hours DESC
  `);
}

export interface FranchiseYearHours {
  year: number;
  franchise: string;
  hours: number;
}

export async function getFranchiseHoursByYear(): Promise<FranchiseYearHours[]> {
  return selectQuery<FranchiseYearHours>(`
    SELECT
      CAST(strftime('%Y', p.StartDate) AS INTEGER) AS year,
      franchises.Name AS franchise,
      SUM(p.HoursPlayed) AS hours
    FROM Playthroughs p
    JOIN Games g ON g.Id = p.GameId
    JOIN GameFranchises gf ON gf.GameId = g.Id
    JOIN Franchises franchises ON franchises.Id = gf.FranchiseId
    WHERE p.StartDate IS NOT NULL AND p.HoursPlayed IS NOT NULL
    GROUP BY year, franchises.Name
    ORDER BY year ASC, hours DESC
  `);
}

export interface CompletionsByYear {
  year: number;
  count: number;
}

export async function getCompletionsByYear(): Promise<CompletionsByYear[]> {
  return selectQuery<CompletionsByYear>(`
    SELECT CAST(strftime('%Y', FinishDate) AS INTEGER) AS year, COUNT(*) AS count
    FROM Playthroughs
    WHERE FinishDate IS NOT NULL
    GROUP BY year
    ORDER BY year ASC
  `);
}

export interface DeveloperStats {
  developer: string;
  hours: number;
  avgRating: number | null;
  gameCount: number;
}

export async function getDeveloperPreferences(): Promise<DeveloperStats[]> {
  return selectQuery<DeveloperStats>(`
    SELECT
      dev.Name AS developer,
      SUM(MAX(COALESCE(pt.TotalHoursPlayed, 0), COALESCE(ug.TotalHours, 0))) AS hours,
      AVG(pt.LatestRating) AS avgRating,
      COUNT(DISTINCT g.Id) AS gameCount
    FROM Games g
    JOIN GameDevelopers gd ON gd.GameId = g.Id
    JOIN Developers dev ON dev.Id = gd.DeveloperId
    LEFT JOIN UserGames ug ON ug.GameId = g.Id
    LEFT JOIN (
      SELECT GameId, SUM(HoursPlayed) AS TotalHoursPlayed, MAX(Rating) AS LatestRating
      FROM Playthroughs GROUP BY GameId
    ) pt ON pt.GameId = g.Id
    GROUP BY dev.Name
    HAVING gameCount >= 2
    ORDER BY hours DESC
  `);
}

export interface ThemeStats {
  theme: string;
  hours: number;
  avgRating: number | null;
  gameCount: number;
}

/** Same shape as getHoursByGenre, but for Themes — a distinct axis IGDB
 * provides alongside genres (e.g. a game can be genre "RPG" and theme
 * "Horror" at once), and one you specifically asked to see more of. */
export async function getHoursByTheme(): Promise<ThemeStats[]> {
  return selectQuery<ThemeStats>(`
    SELECT
      themes.Name AS theme,
      SUM(MAX(COALESCE(pt.TotalHoursPlayed, 0), COALESCE(ug.TotalHours, 0))) AS hours,
      AVG(pt.LatestRating) AS avgRating,
      COUNT(DISTINCT g.Id) AS gameCount
    FROM Games g
    JOIN GameThemes gt ON gt.GameId = g.Id
    JOIN Themes themes ON themes.Id = gt.ThemeId
    LEFT JOIN UserGames ug ON ug.GameId = g.Id
    LEFT JOIN (
      SELECT GameId, SUM(HoursPlayed) AS TotalHoursPlayed, MAX(Rating) AS LatestRating
      FROM Playthroughs GROUP BY GameId
    ) pt ON pt.GameId = g.Id
    GROUP BY themes.Name
    ORDER BY hours DESC
  `);
}

export interface RatingTrendPoint {
  releaseYear: number;
  avgRating: number;
  gameCount: number;
}

/** Average rating grouped by the GAME'S release year (Games.ReleaseYear),
 * not when you played it — "do I rate older games differently than new
 * releases?" Needs enrichment to have run (ReleaseYear comes from IGDB). */
export async function getAverageRatingByReleaseYear(): Promise<RatingTrendPoint[]> {
  return selectQuery<RatingTrendPoint>(`
    SELECT
      g.ReleaseYear AS releaseYear,
      AVG(p.Rating) AS avgRating,
      COUNT(*) AS gameCount
    FROM Playthroughs p
    JOIN Games g ON g.Id = p.GameId
    WHERE g.ReleaseYear IS NOT NULL AND p.Rating IS NOT NULL
    GROUP BY g.ReleaseYear
    ORDER BY g.ReleaseYear ASC
  `);
}

export interface WeekdayActivity {
  weekday: string;
  sessionDayCount: number;
  medianHoursWhenLogged: number;
  meanHoursWhenLogged: number;
  daysWithDuration: number;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Day-of-week activity — rewritten twice, and worth documenting why.
 *
 * V1 bug: a plain SUM with no division, so "Monday: 83 hours" was the
 * entire cumulative total of every Monday ever logged across years of
 * history, not a per-day figure.
 *
 * V2 attempt: switched to MEDIAN of per-calendar-day totals, to fix V1 and
 * be robust to a single binge session skewing a "typical day" figure.
 * Tested against the real 408-game library and found a second, bigger
 * problem: 93.2% of all 3,374 PlaySession rows have zero recorded
 * duration — only 169 of 2,184 distinct session-days have any hours at
 * all. That's not a skew a median can fix; the median of a dataset that's
 * 93% zeros is just zero, for every single weekday, which is exactly
 * what testing showed. The play_dates entries in the source export are
 * overwhelmingly pure date-markers ("I played on this day") with no
 * duration ever attached, not an occasional gap.
 *
 * V3 (this version): reframed rather than patched again. The honest,
 * well-supported question this data can answer is which days you tend to
 * log a session AT ALL (sessionDayCount — uses all 2,184 real days, no
 * data-quality caveat needed, since it's just counting occurrences).
 * "How many hours" is only answerable at all for the ~170 days that
 * happen to have duration recorded, so that's returned separately
 * (medianHoursWhenLogged etc.) and should be presented as clearly-scoped
 * supplementary detail, not the headline number — the UI should say
 * "of N session-days, M had duration logged" rather than implying full
 * coverage.
 */
/**
 * V4 (this version): folds in a fix for the root cause behind V3's "93%
 * zero-duration sessions" finding rather than just working around it.
 * Many of those zero-duration sessions belong to playthroughs that DO
 * have a real total (Playthroughs.HoursPlayed) — the user logged which
 * days they played without logging how long each time. estimateSessionHours()
 * (see utils/sessionHours.ts) detects exactly that pattern per playthrough
 * and splits the real total evenly across its sessions — never touching
 * the stored PlaySessions.Hours values, just computing a display estimate.
 * Playthroughs with genuine partial per-session data (some real numbers,
 * some zeros) are left alone, since a real zero there is more likely a
 * short session than a logging gap.
 *
 * This doesn't make daysWithDuration reach 100% — playthroughs with no
 * recorded total at all still can't be estimated — but it recovers real
 * signal for a large share of what V3 had to leave out, which is why
 * this is still worth keeping medianHoursWhenLogged/daysWithDuration
 * around: the UI should keep being honest about partial coverage rather
 * than implying the estimate applies everywhere.
 */
export async function getWeekdayActivity(): Promise<WeekdayActivity[]> {
  const sessions = await selectQuery<{
    playthroughId: string;
    day: string;
    hours: number | null;
    minutes: number | null;
    playthroughTotalHours: number | null;
  }>(`
    SELECT
      s.PlaythroughId AS playthroughId,
      date(s.SessionDate) AS day,
      s.Hours AS hours,
      s.Minutes AS minutes,
      p.HoursPlayed AS playthroughTotalHours
    FROM PlaySessions s
    JOIN Playthroughs p ON p.Id = s.PlaythroughId
    WHERE s.SessionDate IS NOT NULL
  `);

  // Group by playthrough so estimateSessionHours() sees each playthrough's
  // full set of sessions together (it needs "are ALL of this playthrough's
  // sessions zero" — a fact that only makes sense per playthrough, not
  // per individual row).
  const byPlaythrough = new Map<string, typeof sessions>();
  for (const row of sessions) {
    const group = byPlaythrough.get(row.playthroughId) ?? [];
    group.push(row);
    byPlaythrough.set(row.playthroughId, group);
  }

  const byWeekday: number[][] = [[], [], [], [], [], [], []];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];

  for (const group of byPlaythrough.values()) {
    const estimated = estimateSessionHours(
      group.map((s) => ({ hours: s.hours, minutes: s.minutes })),
      group[0].playthroughTotalHours
    );

    group.forEach((row, i) => {
      const weekday = new Date(row.day).getDay();
      dayCounts[weekday] += 1;
      byWeekday[weekday].push(estimated[i]);
    });
  }

  return WEEKDAY_NAMES.map((name, i) => {
    const withDuration = byWeekday[i].filter((h) => h > 0);
    return {
      weekday: name,
      sessionDayCount: dayCounts[i],
      medianHoursWhenLogged: median(withDuration),
      meanHoursWhenLogged: withDuration.length
        ? withDuration.reduce((a, b) => a + b, 0) / withDuration.length
        : 0,
      daysWithDuration: withDuration.length,
    };
  });
}

export interface MostReplayedGame {
  gameId: string;
  title: string;
  replayCount: number;
  totalHours: number;
}

/** Ranked by replay count directly from Playthroughs.Replay — needs no
 * IGDB enrichment at all, so unlike most other analytics here this one
 * has real data to show even before you've fetched metadata. */
export async function getMostReplayedGames(limit = 10): Promise<MostReplayedGame[]> {
  return selectQuery<MostReplayedGame>(
    `
    SELECT
      g.Id AS gameId,
      g.Title AS title,
      SUM(CASE WHEN p.Replay = 1 THEN 1 ELSE 0 END) AS replayCount,
      SUM(COALESCE(p.HoursPlayed, 0)) AS totalHours
    FROM Playthroughs p
    JOIN Games g ON g.Id = p.GameId
    GROUP BY g.Id
    HAVING replayCount > 0
    ORDER BY replayCount DESC, totalHours DESC
    LIMIT ?
    `,
    [limit]
  );
}

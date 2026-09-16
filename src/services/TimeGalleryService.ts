import { selectQuery } from "../database/database";
import { estimateSessionHours } from "../utils/sessionHours";

/**
 * Powers the Time Gallery (Spotify-Wrapped-style, but quarterly rather
 * than monthly — a full year of daily/monthly granularity would be far
 * too much to browse, and quarters give enough texture to show "you
 * picked Warframe back up that spring" without drowning in noise).
 *
 * A game appears once per quarter it was actually active in — not once
 * total, and not once per session. Multiple playthroughs of the same
 * game contributing to the same quarter are merged into one entry for
 * that quarter.
 */

export interface QuarterMoment {
  gameId: string;
  title: string;
  coverArtUrl: string | null;
  franchise: string | null;
  genres: string[];
  themes: string[];
  keywords: string[];
  collections: string[];
  gameModes: string[];
  year: number;
  quarter: 1 | 2 | 3 | 4;
  hoursThisQuarter: number;
  sessionCount: number;
  dominantPlatform: string | null;
  rating: number | null;
  ratingIsFallback: boolean;
  isLongGapFinish: boolean;
  longGapQuarterSpan: number;
}

function quarterOf(dateStr: string): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const quarter = (Math.floor(d.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  return { year, quarter };
}

function quarterKey(year: number, quarter: number): string {
  return `${year}-Q${quarter}`;
}

function quarterIndex(year: number, quarter: number): number {
  return year * 4 + (quarter - 1);
}

interface RawPlaythroughRow {
  PlaythroughId: string;
  GameId: string;
  Title: string;
  CoverArtUrl: string | null;
  Franchise: string | null;
  GenreNames: string | null;
  ThemeNames: string | null;
  KeywordNames: string | null;
  CollectionNames: string | null;
  GameModeNames: string | null;
  StartDate: string | null;
  FinishDate: string | null;
  Rating: number | null;
  HoursPlayed: number | null;
  PlayedPlatformId: number | null;
  PlatformName: string | null;
}

interface RawSessionRow {
  PlaythroughId: string;
  SessionDate: string | null;
  Hours: number | null;
  Minutes: number | null;
}

export async function getQuarterMoments(): Promise<QuarterMoment[]> {
  const playthroughs = await selectQuery<RawPlaythroughRow>(`
    SELECT
      p.Id AS PlaythroughId,
      p.GameId AS GameId,
      g.Title AS Title,
      g.CoverArtUrl AS CoverArtUrl,
      franchiseAgg.Names AS Franchise,
      genreAgg.Names AS GenreNames,
      themeAgg.Names AS ThemeNames,
      keywordAgg.Names AS KeywordNames,
      collectionAgg.Names AS CollectionNames,
      gameModeAgg.Names AS GameModeNames,
      p.StartDate AS StartDate,
      p.FinishDate AS FinishDate,
      p.Rating AS Rating,
      p.HoursPlayed AS HoursPlayed,
      p.PlayedPlatformId AS PlayedPlatformId,
      pl.Name AS PlatformName
    FROM Playthroughs p
    JOIN Games g ON g.Id = p.GameId
    LEFT JOIN Platforms pl ON pl.Id = p.PlayedPlatformId
    LEFT JOIN (
      SELECT gg.GameId, GROUP_CONCAT(genres.Name) AS Names
      FROM GameGenres gg JOIN Genres genres ON genres.Id = gg.GenreId
      GROUP BY gg.GameId
    ) genreAgg ON genreAgg.GameId = g.Id
    LEFT JOIN (
      SELECT gt.GameId, GROUP_CONCAT(themes.Name) AS Names
      FROM GameThemes gt JOIN Themes themes ON themes.Id = gt.ThemeId
      GROUP BY gt.GameId
    ) themeAgg ON themeAgg.GameId = g.Id
    LEFT JOIN (
      SELECT gf.GameId, GROUP_CONCAT(franchises.Name) AS Names
      FROM GameFranchises gf JOIN Franchises franchises ON franchises.Id = gf.FranchiseId
      GROUP BY gf.GameId
    ) franchiseAgg ON franchiseAgg.GameId = g.Id
    LEFT JOIN (
      SELECT gk.GameId, GROUP_CONCAT(keywords.Name) AS Names
      FROM GameKeywords gk JOIN Keywords keywords ON keywords.Id = gk.KeywordId
      GROUP BY gk.GameId
    ) keywordAgg ON keywordAgg.GameId = g.Id
    LEFT JOIN (
      SELECT gc.GameId, GROUP_CONCAT(collections.Name) AS Names
      FROM GameCollections gc JOIN Collections collections ON collections.Id = gc.CollectionId
      GROUP BY gc.GameId
    ) collectionAgg ON collectionAgg.GameId = g.Id
    LEFT JOIN (
      SELECT ggm.GameId, GROUP_CONCAT(gameModes.Name) AS Names
      FROM GameGameModes ggm JOIN GameModes gameModes ON gameModes.Id = ggm.GameModeId
      GROUP BY ggm.GameId
    ) gameModeAgg ON gameModeAgg.GameId = g.Id
  `);

  const sessions = await selectQuery<RawSessionRow>(`
    SELECT PlaythroughId, SessionDate, Hours, Minutes FROM PlaySessions WHERE SessionDate IS NOT NULL
  `);

  const sessionsByPlaythrough = new Map<string, RawSessionRow[]>();
  for (const s of sessions) {
    const list = sessionsByPlaythrough.get(s.PlaythroughId) ?? [];
    list.push(s);
    sessionsByPlaythrough.set(s.PlaythroughId, list);
  }

  const bestRatingByGame = new Map<string, number>();
  for (const pt of playthroughs) {
    if (pt.Rating == null) continue;
    const current = bestRatingByGame.get(pt.GameId);
    if (current === undefined || pt.Rating > current) bestRatingByGame.set(pt.GameId, pt.Rating);
  }

  interface Bucket {
    hours: number;
    sessionCount: number;
    platformCounts: Map<string, number>;
    ratingThisQuarter: number | null;
    isLongGapFinish: boolean;
    longGapQuarterSpan: number;
  }

  const buckets = new Map<string, Map<string, Bucket>>();

  function getBucket(gameId: string, year: number, quarter: number): Bucket {
    const gameMap = buckets.get(gameId) ?? new Map<string, Bucket>();
    buckets.set(gameId, gameMap);
    const key = quarterKey(year, quarter);
    const existing = gameMap.get(key);
    if (existing) return existing;
    const fresh: Bucket = {
      hours: 0,
      sessionCount: 0,
      platformCounts: new Map(),
      ratingThisQuarter: null,
      isLongGapFinish: false,
      longGapQuarterSpan: 0,
    };
    gameMap.set(key, fresh);
    return fresh;
  }

  for (const pt of playthroughs) {
    const ptSessions = (sessionsByPlaythrough.get(pt.PlaythroughId) ?? []).filter((s) => s.SessionDate);
    const platform = pt.PlatformName;

    // Backloggd playthroughs sometimes have a FinishDate but no StartDate
    // even when individual sessions were dated — the earliest of those is
    // a reasonable stand-in, and lets more playthroughs qualify for
    // long-gap detection below than pt.StartDate alone would.
    const inferredStartDate =
      pt.StartDate ??
      (ptSessions.length > 0
        ? ptSessions.reduce(
            (earliest, s) => (s.SessionDate! < earliest ? s.SessionDate! : earliest),
            ptSessions[0].SessionDate!
          )
        : null);

    if (ptSessions.length > 0) {
      const estimated = estimateSessionHours(
        ptSessions.map((s) => ({ hours: s.Hours, minutes: s.Minutes })),
        pt.HoursPlayed
      );
      ptSessions.forEach((s, i) => {
        const { year, quarter } = quarterOf(s.SessionDate as string);
        const bucket = getBucket(pt.GameId, year, quarter);
        bucket.hours += estimated[i];
        bucket.sessionCount += 1;
        if (platform) bucket.platformCounts.set(platform, (bucket.platformCounts.get(platform) ?? 0) + 1);
      });
    } else if (pt.FinishDate || pt.StartDate) {
      const dateStr = pt.FinishDate ?? pt.StartDate!;
      const { year, quarter } = quarterOf(dateStr);
      const bucket = getBucket(pt.GameId, year, quarter);
      bucket.hours += pt.HoursPlayed ?? 0;
      if (platform) bucket.platformCounts.set(platform, (bucket.platformCounts.get(platform) ?? 0) + 1);
    }

    if (pt.FinishDate) {
      const { year, quarter } = quarterOf(pt.FinishDate);
      const bucket = getBucket(pt.GameId, year, quarter);

      if (pt.Rating != null) {
        bucket.ratingThisQuarter = pt.Rating;
      }

      if (inferredStartDate) {
        const startQ = quarterOf(inferredStartDate);
        const finishQ = quarterOf(pt.FinishDate);
        const span = quarterIndex(finishQ.year, finishQ.quarter) - quarterIndex(startQ.year, startQ.quarter);
        if (span >= 3) {
          bucket.isLongGapFinish = true;
          bucket.longGapQuarterSpan = span;
        }
      }
    }
  }

  const gameMetaById = new Map<string, RawPlaythroughRow>();
  for (const pt of playthroughs) {
    if (!gameMetaById.has(pt.GameId)) gameMetaById.set(pt.GameId, pt);
  }

  const moments: QuarterMoment[] = [];
  for (const [gameId, quarterMap] of buckets) {
    const meta = gameMetaById.get(gameId)!;
    for (const [key, bucket] of quarterMap) {
      const [yearStr, qStr] = key.split("-Q");
      const dominantPlatform =
        [...bucket.platformCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      const rating = bucket.ratingThisQuarter ?? bestRatingByGame.get(gameId) ?? null;
      const ratingIsFallback = bucket.ratingThisQuarter == null && rating != null;

      moments.push({
        gameId,
        title: meta.Title,
        coverArtUrl: meta.CoverArtUrl,
        franchise: meta.Franchise,
        genres: meta.GenreNames ? meta.GenreNames.split(",") : [],
        themes: meta.ThemeNames ? meta.ThemeNames.split(",") : [],
        keywords: meta.KeywordNames ? meta.KeywordNames.split(",") : [],
        collections: meta.CollectionNames ? meta.CollectionNames.split(",") : [],
        gameModes: meta.GameModeNames ? meta.GameModeNames.split(",") : [],
        year: Number(yearStr),
        quarter: Number(qStr) as 1 | 2 | 3 | 4,
        hoursThisQuarter: Math.round(bucket.hours * 10) / 10,
        sessionCount: bucket.sessionCount,
        dominantPlatform,
        rating,
        ratingIsFallback,
        isLongGapFinish: bucket.isLongGapFinish,
        longGapQuarterSpan: bucket.longGapQuarterSpan,
      });
    }
  }

  moments.sort((a, b) => quarterIndex(a.year, a.quarter) - quarterIndex(b.year, b.quarter));
  return moments;
}

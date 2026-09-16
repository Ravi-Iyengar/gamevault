import type { DbClient } from "../database/database";
import { getOrCreateNamedLookupId, linkGameToLookup } from "../services/LookupTables";

/**
 * Imports GLIP's already-enriched data (keywords, collections,
 * franchises, game modes, player perspectives, aggregated rating, ML
 * feature vectors, and recommendations) into GameVault's unified schema.
 *
 * The point of this importer specifically: GLIP's Python enrichment
 * already pulled keyword/collection/game-mode/player-perspective data
 * for your whole library (GameVault's own enrichment never has), so
 * re-fetching all of that from IGDB again would just burn rate limit for
 * data that's already sitting in glip.db. This reads it straight across
 * instead.
 *
 * Matching is by IGDBId — GLIP's `igdb_id` and GameVault's `Games.IGDBId`
 * are the exact same value (both ultimately come from Backloggd's own
 * export, where the game's own `id` field IS the IGDB id). No fuzzy
 * title-matching needed here, unlike the personal-spreadsheet importer —
 * this is a clean, reliable numeric join.
 *
 * WASM loading: sql.js's WASM binary is served from public/sql-wasm.wasm
 * (copied there automatically by scripts/copy-sql-wasm.mjs, run via
 * package.json's postinstall). An earlier version imported it directly
 * from node_modules via Vite's `?url` suffix — confirmed on a real run
 * to cause the import to hang indefinitely (no error, no success, just
 * stuck on "Importing...") rather than fail loudly. A plain public/
 * static file is Vite's most standard asset mechanism and doesn't have
 * that failure mode. See getSqlJs() below for the timeout guard added
 * alongside this fix, so any future WASM-loading problem surfaces as a
 * clear error instead of another silent hang.
 */

export interface GlipGameRow {
  igdbId: number;
  keywords: string[];
  collections: string[];
  franchises: string[];
  gameModes: string[];
  playerPerspectives: string[];
  aggregatedRating: number | null;
  aggregatedRatingCount: number | null;
}

export interface GlipFeatureRow {
  igdbId: number;
  genreAffinity: number | null;
  themeAffinity: number | null;
  developerAffinity: number | null;
  publisherAffinity: number | null;
  franchiseAffinity: number | null;
  featureJson: string;
  computedAt: string | null;
}

export interface GlipRecommendationRow {
  igdbId: number;
  predictedRating: number | null;
  predictedCompletionProb: number | null;
  predictedReplayProb: number | null;
  predictedEngagement: number | null;
  recommendationScore: number | null;
  explanationJson: string | null;
  generatedAt: string | null;
}

export interface GlipData {
  games: GlipGameRow[];
  features: GlipFeatureRow[];
  recommendations: GlipRecommendationRow[];
}

export interface GlipImportSummary {
  gamesMatched: number;
  gamesNotFound: number;
  featuresWritten: number;
  recommendationsWritten: number;
}

function parseJsonArray(text: string | null): string[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const SQL_JS_LOAD_TIMEOUT_MS = 15000;

/**
 * Wraps a promise with a timeout so a hang (WASM fetch that never
 * resolves or rejects — the exact failure mode that motivated this
 * function) surfaces as a real, readable error instead of leaving the
 * UI stuck on "Importing..." forever with no way to tell what's wrong.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function getSqlJs() {
  const initSqlJs = (await import("sql.js")).default;
  return withTimeout(
    initSqlJs({ locateFile: () => "/sql-wasm.wasm" }),
    SQL_JS_LOAD_TIMEOUT_MS,
    `Timed out loading sql.js's WASM engine after ${
      SQL_JS_LOAD_TIMEOUT_MS / 1000
    }s. This usually means public/sql-wasm.wasm is missing — it should be copied there automatically by \`npm install\` (scripts/copy-sql-wasm.mjs). Try running \`npm install\` again; if it still fails, check the terminal output from that command for a warning from copy-sql-wasm.`
  );
}

/**
 * Reads glip.db (a real SQLite file) entirely in the webview via sql.js
 * (a WASM SQLite build) — no Rust/native dependency needed, same reason
 * `xlsx` was chosen for the spreadsheet importer over anything requiring
 * a Tauri plugin.
 */
export async function parseGlipDatabase(buffer: ArrayBuffer): Promise<GlipData> {
  const SQL = await getSqlJs();

  const db = new SQL.Database(new Uint8Array(buffer));

  function queryAll(sql: string): Record<string, unknown>[] {
    const result = db.exec(sql);
    if (result.length === 0) return [];
    const { columns, values } = result[0];
    return values.map((row: unknown[]) =>
      Object.fromEntries(columns.map((col: string, i: number) => [col, row[i]]))
    );
  }

  const gameRows = queryAll(
    `SELECT igdb_id, keywords, collections, franchises, game_modes, player_perspectives, aggregated_rating, aggregated_rating_count FROM games`
  );
  const games: GlipGameRow[] = gameRows.map((r) => ({
    igdbId: Number(r.igdb_id),
    keywords: parseJsonArray(r.keywords as string | null),
    collections: parseJsonArray(r.collections as string | null),
    franchises: parseJsonArray(r.franchises as string | null),
    gameModes: parseJsonArray(r.game_modes as string | null),
    playerPerspectives: parseJsonArray(r.player_perspectives as string | null),
    aggregatedRating: r.aggregated_rating != null ? Number(r.aggregated_rating) : null,
    aggregatedRatingCount: r.aggregated_rating_count != null ? Number(r.aggregated_rating_count) : null,
  }));

  const featureRows = queryAll(`SELECT igdb_id, feature_json, computed_at FROM features`);
  const features: GlipFeatureRow[] = featureRows.map((r) => {
    const fj = JSON.parse(r.feature_json as string);
    return {
      igdbId: Number(r.igdb_id),
      genreAffinity: fj.genre_affinity ?? null,
      themeAffinity: fj.theme_affinity ?? null,
      developerAffinity: fj.developer_affinity ?? null,
      publisherAffinity: fj.publisher_affinity ?? null,
      franchiseAffinity: fj.franchise_affinity ?? null,
      featureJson: r.feature_json as string,
      computedAt: (r.computed_at as string) ?? null,
    };
  });

  const recRows = queryAll(
    `SELECT igdb_id, predicted_rating, predicted_completion_prob, predicted_replay_prob, predicted_engagement, recommendation_score, explanation_json, generated_at FROM recommendations`
  );
  const recommendations: GlipRecommendationRow[] = recRows.map((r) => ({
    igdbId: Number(r.igdb_id),
    predictedRating: r.predicted_rating != null ? Number(r.predicted_rating) : null,
    predictedCompletionProb: r.predicted_completion_prob != null ? Number(r.predicted_completion_prob) : null,
    predictedReplayProb: r.predicted_replay_prob != null ? Number(r.predicted_replay_prob) : null,
    predictedEngagement: r.predicted_engagement != null ? Number(r.predicted_engagement) : null,
    recommendationScore: r.recommendation_score != null ? Number(r.recommendation_score) : null,
    explanationJson: (r.explanation_json as string) ?? null,
    generatedAt: (r.generated_at as string) ?? null,
  }));

  db.close();
  return { games, features, recommendations };
}

/**
 * Applies already-parsed GLIP data to the GameVault database. Separated
 * from parseGlipDatabase specifically so this half — the actual writing
 * logic, where correctness matters most — could be tested against real
 * data without needing sql.js at all.
 */
export async function applyGlipData(db: DbClient, data: GlipData): Promise<GlipImportSummary> {
  const gameIdByIgdbId = new Map<number, string>();
  const allGames = await db.select<{ Id: string; IGDBId: number }>(
    `SELECT Id, IGDBId FROM Games WHERE IGDBId IS NOT NULL`
  );
  for (const g of allGames) gameIdByIgdbId.set(g.IGDBId, g.Id);

  let gamesMatched = 0;
  let gamesNotFound = 0;

  for (const glipGame of data.games) {
    const gameId = gameIdByIgdbId.get(glipGame.igdbId);
    if (!gameId) {
      gamesNotFound += 1;
      continue;
    }
    gamesMatched += 1;

    if (glipGame.aggregatedRating != null) {
      await db.execute(
        `UPDATE Games SET AggregatedRating = COALESCE(AggregatedRating, ?), AggregatedRatingCount = COALESCE(AggregatedRatingCount, ?) WHERE Id = ?`,
        [glipGame.aggregatedRating, glipGame.aggregatedRatingCount, gameId]
      );
    }

    for (const name of glipGame.keywords) {
      const id = await getOrCreateNamedLookupId(db, "Keywords", name);
      await linkGameToLookup(db, "GameKeywords", "GameId", "KeywordId", gameId, id);
    }
    for (const name of glipGame.collections) {
      const id = await getOrCreateNamedLookupId(db, "Collections", name);
      await linkGameToLookup(db, "GameCollections", "GameId", "CollectionId", gameId, id);
    }
    for (const name of glipGame.franchises) {
      const id = await getOrCreateNamedLookupId(db, "Franchises", name);
      await linkGameToLookup(db, "GameFranchises", "GameId", "FranchiseId", gameId, id);
    }
    for (const name of glipGame.gameModes) {
      const id = await getOrCreateNamedLookupId(db, "GameModes", name);
      await linkGameToLookup(db, "GameGameModes", "GameId", "GameModeId", gameId, id);
    }
    for (const name of glipGame.playerPerspectives) {
      const id = await getOrCreateNamedLookupId(db, "PlayerPerspectives", name);
      await linkGameToLookup(db, "GamePlayerPerspectives", "GameId", "PlayerPerspectiveId", gameId, id);
    }
  }

  let featuresWritten = 0;
  for (const f of data.features) {
    const gameId = gameIdByIgdbId.get(f.igdbId);
    if (!gameId) continue;
    await db.execute(
      `
      INSERT INTO Features (GameId, GenreAffinity, ThemeAffinity, DeveloperAffinity, PublisherAffinity, FranchiseAffinity, FeatureJson, ComputedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(GameId) DO UPDATE SET
        GenreAffinity = excluded.GenreAffinity,
        ThemeAffinity = excluded.ThemeAffinity,
        DeveloperAffinity = excluded.DeveloperAffinity,
        PublisherAffinity = excluded.PublisherAffinity,
        FranchiseAffinity = excluded.FranchiseAffinity,
        FeatureJson = excluded.FeatureJson,
        ComputedAt = excluded.ComputedAt
      `,
      [gameId, f.genreAffinity, f.themeAffinity, f.developerAffinity, f.publisherAffinity, f.franchiseAffinity, f.featureJson, f.computedAt]
    );
    featuresWritten += 1;
  }

  let recommendationsWritten = 0;
  for (const r of data.recommendations) {
    const gameId = gameIdByIgdbId.get(r.igdbId);
    if (!gameId) continue;
    await db.execute(
      `
      INSERT INTO Recommendations (GameId, PredictedRating, PredictedCompletionProb, PredictedReplayProb, PredictedEngagement, RecommendationScore, ExplanationJson, GeneratedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(GameId) DO UPDATE SET
        PredictedRating = excluded.PredictedRating,
        PredictedCompletionProb = excluded.PredictedCompletionProb,
        PredictedReplayProb = excluded.PredictedReplayProb,
        PredictedEngagement = excluded.PredictedEngagement,
        RecommendationScore = excluded.RecommendationScore,
        ExplanationJson = excluded.ExplanationJson,
        GeneratedAt = excluded.GeneratedAt
      `,
      [gameId, r.predictedRating, r.predictedCompletionProb, r.predictedReplayProb, r.predictedEngagement, r.recommendationScore, r.explanationJson, r.generatedAt]
    );
    recommendationsWritten += 1;
  }

  return { gamesMatched, gamesNotFound, featuresWritten, recommendationsWritten };
}

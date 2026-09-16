import { invoke } from "@tauri-apps/api/core";
import { getDatabase } from "../database/database";
import { parseGlipDatabase, applyGlipData, GlipImportSummary } from "../importers/GlipImporter";

/**
 * Drives the "bigger, deliberately-deferred half of the unification"
 * (per the project handoff, Section 9.3): actually retraining GLIP's
 * models so they learn from GameVault's ownership/DesireToPlay signal,
 * rather than just displaying the stale pre-unification recommendations
 * the one-time backfill importer brought across.
 *
 * GLIP already ships real CLI entry points for this
 * (scripts/run_ml_training.py, scripts/run_recommendations.py) that
 * both default to reading/writing data/processed/glip.db relative to
 * the GLIP project root — this just shells out to them via Rust
 * (see run_python_script in src-tauri/src/lib.rs) in the same working
 * directory, exactly as if you'd run them by hand from a terminal.
 *
 * After both scripts succeed, the freshly-rewritten glip.db is read
 * back from disk (read_binary_file) and pushed through the exact same
 * parseGlipDatabase/applyGlipData pipeline the manual "Choose GLIP
 * Database" import in Settings already uses — no separate/duplicated
 * write path into Features/Recommendations.
 *
 * UNVERIFIED end-to-end: built without the ability to actually run
 * python3 or a real training pass in this environment. The two CLI
 * scripts' argument shapes were read directly from GLIP's own source
 * (scripts/run_ml_training.py, scripts/run_recommendations.py), so
 * those should be right, but a real run is the first real test.
 */

export interface PyRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type RetrainStage =
  | "training"
  | "recommendations"
  | "reimporting"
  | "done";

export interface RetrainProgress {
  stage: RetrainStage;
  trainingResult?: PyRunResult;
  recommendationsResult?: PyRunResult;
  importSummary?: GlipImportSummary;
}

/** Relative to the GLIP project root, matching both scripts' own `--db`
 * default — kept as a constant here rather than a setting, since
 * changing it would also require changing where GLIP itself looks. */
const GLIP_DB_RELATIVE_PATH = "data/processed/glip.db";

function joinPath(base: string, relative: string): string {
  const trimmedBase = base.replace(/[\\/]+$/, "");
  return `${trimmedBase}/${relative}`;
}

/**
 * Runs the full retrain -> regenerate-recommendations -> reimport loop.
 * `onProgress` fires as each stage starts, so the UI can show which of
 * the (potentially slow, especially training) steps is currently
 * running.
 */
export async function retrainGlipModels(
  glipProjectPath: string,
  pythonPath: string,
  onProgress?: (progress: RetrainProgress) => void
): Promise<RetrainProgress> {
  if (!glipProjectPath.trim()) {
    throw new Error("Set the GLIP project path in Settings first.");
  }
  const python = pythonPath.trim() || "python3";
  const dbPath = joinPath(glipProjectPath, GLIP_DB_RELATIVE_PATH);

  onProgress?.({ stage: "training" });
  const trainingResult = await invoke<PyRunResult>("run_python_script", {
    pythonPath: python,
    cwd: glipProjectPath,
    scriptRelativePath: "scripts/run_ml_training.py",
    args: ["--db", GLIP_DB_RELATIVE_PATH],
  });
  if (!trainingResult.success) {
    return { stage: "training", trainingResult };
  }

  onProgress?.({ stage: "recommendations", trainingResult });
  const recommendationsResult = await invoke<PyRunResult>("run_python_script", {
    pythonPath: python,
    cwd: glipProjectPath,
    scriptRelativePath: "scripts/run_recommendations.py",
    args: ["--db", GLIP_DB_RELATIVE_PATH],
  });
  if (!recommendationsResult.success) {
    return { stage: "recommendations", trainingResult, recommendationsResult };
  }

  onProgress?.({ stage: "reimporting", trainingResult, recommendationsResult });
  const bytes = await invoke<number[]>("read_binary_file", { path: dbPath });
  const buffer = new Uint8Array(bytes).buffer;
  const data = await parseGlipDatabase(buffer);
  const db = await getDatabase();
  const importSummary = await applyGlipData(db, data);

  return {
    stage: "done",
    trainingResult,
    recommendationsResult,
    importSummary,
  };
}

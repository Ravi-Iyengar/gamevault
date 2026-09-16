import Database from "@tauri-apps/plugin-sql";

import { ALL_TABLE_STATEMENTS, CREATE_INDEXES, seedKnownAcquisitionMethods } from "./schema";

/**
 * The minimal interface the rest of the app depends on, rather than
 * depending on `@tauri-apps/plugin-sql`'s Database type directly.
 *
 * Why this exists: `@tauri-apps/plugin-sql` only works inside a running
 * Tauri shell (it talks to Rust over IPC). Code that depends on the
 * concrete Database type can only be exercised by actually launching the
 * desktop app. Depending on this interface instead means the importer and
 * services can be unit-tested against any SQLite-backed implementation —
 * including a plain Node `node:sqlite` adapter in tests — without needing
 * Tauri or a Rust toolchain at all. See src/importers/__tests__ for that
 * test harness.
 */
export interface DbClient {
  execute(query: string, values?: unknown[]): Promise<unknown>;
  select<T = unknown>(query: string, values?: unknown[]): Promise<T[]>;
}

let db: DbClient | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Fixes a real concurrency bug: React's StrictMode (main.tsx wraps the
 * app in it) deliberately double-invokes effects in development mode to
 * help surface exactly this kind of issue. App.tsx's mount effect calls
 * initializeDatabase() once per invocation — under StrictMode that's
 * twice, back to back. The old code only guarded on `if (db) return`,
 * checked *before* the first call's `await Database.load(...)` had
 * finished — so both invocations saw `db` as null and both proceeded to
 * open the file and run schema creation concurrently. Two connections
 * racing to write-initialize the same SQLite file is exactly what
 * produces "database is locked" (SQLITE_BUSY, code 5).
 *
 * The fix: cache the in-flight *promise* immediately, not just the
 * eventual result. A second concurrent call awaits the same promise
 * instead of starting a second `Database.load()` + schema run.
 */
export async function initializeDatabase(): Promise<void> {
  if (db) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const loaded = await Database.load("sqlite:gamevault.db");
    const client = loaded as unknown as DbClient;

    // Defensive, independent of the race-condition fix above: WAL mode
    // lets readers and a writer proceed concurrently instead of taking an
    // exclusive lock for the whole database on every write, and
    // busy_timeout makes SQLite retry for a bit instead of immediately
    // throwing SQLITE_BUSY on any remaining brief contention (e.g. during
    // Vite's hot-reload in dev, where a previous connection can briefly
    // overlap with a new one). Both are standard practice for a
    // Tauri+SQLite app, not specific to the bug above.
    await client.execute("PRAGMA journal_mode=WAL;");
    await client.execute("PRAGMA busy_timeout=5000;");

    await runSchema(client);
    db = client;

    console.log("GameVault database initialized");
  })();

  return initPromise;
}

async function runSchema(client: DbClient): Promise<void> {
  for (const statement of ALL_TABLE_STATEMENTS) {
    await client.execute(statement);
  }

  // Migration step must run BEFORE index creation below, not after —
  // confirmed by testing against a simulated old database: CREATE_INDEXES
  // includes `CREATE INDEX ... ON Games(IGDBId)`, and on a database
  // created before IGDBId existed, that statement fails outright with
  // "no such column: IGDBId" if it runs before this step adds the column.
  //
  // Migration for a real, systemic bug: `CREATE TABLE IF NOT EXISTS`
  // above is a no-op once a table already exists — it never adds columns
  // to an existing table. This schema has gained several columns on
  // Games and UserGames since this project started (IGDBId, CoverArtUrl,
  // Franchise, the HLTB/Metacritic columns, IsWishlist/IsBacklog/
  // IsPlaying, TotalHours, StatusRaw), and anyone whose database was
  // created before one of those additions would have that column
  // silently missing forever, surfacing as "no such column" errors on
  // whatever query first touches it — exactly what happened with
  // StatusRaw. This runs for every table (not just the two known
  // offenders) so any future schema addition gets this safety net
  // automatically too, as long as it's added to ALL_TABLE_STATEMENTS
  // like everything else already is.
  for (const statement of ALL_TABLE_STATEMENTS) {
    await ensureColumnsExist(client, statement);
  }

  // One-time migration, not a repeating "ensure" step like the one above:
  // Games.Franchise (a single TEXT column) was replaced by the normalized
  // Franchises/GameFranchises pair during the GLIP unification, since some
  // games genuinely belong to more than one franchise and the old column
  // could only ever hold one. Move any existing value across before
  // dropping the column, so nothing already recorded is lost.
  await migrateFranchiseColumn(client);

  // Indexes are a single multi-statement string (harmless to run
  // every launch — CREATE INDEX IF NOT EXISTS is idempotent).
  for (const statement of splitStatements(CREATE_INDEXES)) {
    await client.execute(statement);
  }

  // Known-good seed data (never guessed) — safe and idempotent to run
  // on every launch, so it just always happens rather than needing a
  // manual Settings button someone might never click.
  await seedKnownAcquisitionMethods(client);
}

/**
 * Parses one CREATE TABLE statement to find its declared columns, checks
 * which of them the real table (already created, possibly a long time
 * ago under an older version of this schema) is actually missing via
 * `PRAGMA table_info`, and adds any gaps with `ALTER TABLE ... ADD
 * COLUMN`. Derives the expected columns directly from the same SQL
 * string that creates the table — the single source of truth — rather
 * than maintaining a separate parallel list that could drift out of
 * sync with it over time.
 */
/** Splits a string on commas, but only at paren-nesting depth 0 — so
 * "GameId TEXT, PRIMARY KEY (GameId, GenreId)" splits into two entries,
 * not three. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth++;
    if (char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) parts.push(current);
  return parts;
}

async function ensureColumnsExist(client: DbClient, createTableSql: string): Promise<void> {
  const tableMatch = createTableSql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
  if (!tableMatch) return;
  const table = tableMatch[1];

  const bodyMatch = createTableSql.match(/\(([\s\S]*)\)\s*;\s*$/);
  if (!bodyMatch) return;

  // Split on top-level commas only — a naive split(",") breaks on
  // composite constraints like "PRIMARY KEY (GameId, GenreId)" (used by
  // every join table), since the comma inside those parens isn't a
  // column separator. Confirmed by testing this against every table in
  // the schema: all six join tables failed with a SQL syntax error
  // before this fix, because the naive split produced a fragment like
  // "GenreId)" that got misread as a new column name.
  const entries = splitTopLevel(bodyMatch[1])
    .map((e) => e.trim())
    .filter((e) => e.length > 0)
    .filter((e) => !/^(PRIMARY KEY|FOREIGN KEY)/i.test(e));

  const existingColumns = new Set(
    (await client.select<{ name: string }>(`PRAGMA table_info(${table})`)).map((row) => row.name)
  );

  for (const entry of entries) {
    const columnName = entry.split(/\s+/)[0];
    if (existingColumns.has(columnName)) continue;

    // PRIMARY KEY columns are set at table creation and can't be added
    // to an existing table via ALTER TABLE — if one's missing, the table
    // itself was never created, which CREATE TABLE IF NOT EXISTS above
    // already handles; nothing to do here.
    if (/PRIMARY KEY/i.test(entry)) continue;

    // SQLite genuinely does not allow ALTER TABLE ADD COLUMN with a
    // UNIQUE constraint inline (confirmed by testing this migration
    // against a simulated old database — it fails outright with "Cannot
    // add a UNIQUE column"). Add the column without it, then create a
    // separate unique index to enforce the same constraint — behaviorally
    // equivalent, just expressed as two statements instead of one.
    const hasUnique = /\bUNIQUE\b/i.test(entry);
    const columnDef = entry.replace(/\bUNIQUE\b/i, "").trim();

    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);

    if (hasUnique) {
      await client.execute(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_${columnName}_unique ON ${table}(${columnName})`
      );
    }
  }
}

function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s + ";");
}

/**
 * Runs once per database, cheaply — checks `PRAGMA table_info(Games)` for
 * a lingering `Franchise` column and does nothing at all if it's not
 * there (true for any database created after this migration was added).
 * On a database that still has it: for every non-empty value, finds or
 * creates the matching `Franchises` row and links it via
 * `GameFranchises`, then drops the old column. SQLite has supported
 * `ALTER TABLE ... DROP COLUMN` since 3.35 (2021), so this doesn't need
 * the rebuild-the-whole-table workaround older SQLite versions required.
 */
async function migrateFranchiseColumn(client: DbClient): Promise<void> {
  const columns = await client.select<{ name: string }>(`PRAGMA table_info(Games)`);
  if (!columns.some((c) => c.name === "Franchise")) return;

  const rows = await client.select<{ Id: string; Franchise: string | null }>(
    `SELECT Id, Franchise FROM Games WHERE Franchise IS NOT NULL AND Franchise != ''`
  );

  for (const row of rows) {
    await client.execute(`INSERT OR IGNORE INTO Franchises (Name) VALUES (?)`, [row.Franchise]);
    const franchiseRows = await client.select<{ Id: number }>(`SELECT Id FROM Franchises WHERE Name = ?`, [
      row.Franchise,
    ]);
    await client.execute(`INSERT OR IGNORE INTO GameFranchises (GameId, FranchiseId) VALUES (?, ?)`, [
      row.Id,
      franchiseRows[0].Id,
    ]);
  }

  await client.execute(`ALTER TABLE Games DROP COLUMN Franchise`);
}

export async function getDatabase(): Promise<DbClient> {
  if (!db) {
    await initializeDatabase();
  }
  return db as DbClient;
}

export async function executeQuery(query: string, values: unknown[] = []): Promise<unknown> {
  const database = await getDatabase();
  return database.execute(query, values);
}

export async function selectQuery<T = unknown>(query: string, values: unknown[] = []): Promise<T[]> {
  const database = await getDatabase();
  return database.select<T>(query, values);
}

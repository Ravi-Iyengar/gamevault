// sql.js ships plain JS with no bundled .d.ts and there's no
// well-maintained @types/sql.js to depend on instead, so this declares
// just the surface GlipImporter.ts actually uses. `strict`/`noEmit`
// tsc (as run by `npm run build`, which `tauri build` gates on) fails
// the whole build without this — `tauri dev` never surfaced it because
// Vite's dev server doesn't typecheck, only transpiles.
declare module "sql.js" {
  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export class Database {
    constructor(data?: Uint8Array);
    exec(sql: string): QueryExecResult[];
    close(): void;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}

// Copies sql.js's WASM binary into public/, run automatically after every
// `npm install` (see package.json's "postinstall" script).
//
// This replaced importing the file directly from node_modules via Vite's
// `sql.js/dist/sql-wasm.wasm?url` suffix (see git history / prior version
// of GlipImporter.ts) — that approach was never actually confirmed
// working end-to-end (this project's sandbox has no way to run a real
// Vite dev server), and on a real run it produced a GLIP import that hung
// indefinitely instead of erroring: sql.js's internal WASM fetch appears
// to just never resolve against whatever URL that import shape actually
// produced, rather than failing loudly.
//
// A plain public/ file is Vite's most standard, most-tested static-asset
// mechanism — served at the exact path it's copied to, in both `tauri
// dev` and a production build, with no special resolution behavior to
// second-guess. Copying it here (rather than committing the binary
// itself) keeps it in sync with whatever sql.js version package.json
// pins, without needing to remember to update a committed copy by hand.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const src = join(projectRoot, "node_modules", "sql.js", "dist", "sql-wasm.wasm");
const destDir = join(projectRoot, "public");
const dest = join(destDir, "sql-wasm.wasm");

if (!existsSync(src)) {
  // Not fatal — package.json's postinstall still lets `npm install`
  // finish, since a missing GLIP-import dependency shouldn't block
  // building/running the rest of the app. But it's worth a loud
  // warning: without this file in place, the GLIP importer's
  // initSqlJs() call will fail (or, previously, hang) the first time
  // it's used, and the console log here is the natural first place to
  // check if that happens.
  console.warn(
    "[copy-sql-wasm] node_modules/sql.js/dist/sql-wasm.wasm not found — skipping.\n" +
      "  The GLIP database importer (Settings → Import GLIP Analysis Data / Retrain GLIP Models)\n" +
      "  will not work until this file exists at public/sql-wasm.wasm. Try running `npm install`\n" +
      "  again, or check that sql.js installed correctly."
  );
  process.exit(0);
}

if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log("[copy-sql-wasm] Copied sql-wasm.wasm to public/ for the GLIP importer.");

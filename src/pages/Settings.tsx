import { useEffect, useState } from "react";
import { getDatabase } from "../database/database";
import { importLibrary, ImportSummary, RawBackloggdGame } from "../importers/BackloggdJsonImporter";
import {
  parseSpreadsheet,
  matchSpreadsheetRows,
  applySpreadsheetMatch,
  MatchResult,
} from "../importers/SpreadsheetImporter";
import { getSetting, getIgdbCredentials, setSetting, getRomFolders, setRomFolders, SETTINGS_KEYS } from "../services/SettingsService";
import { IgdbClient } from "../services/IgdbClient";
import { enrichGames, enrichPlatformNames, suggestStorefrontLabels, setStorefrontLabel, EnrichmentSummary, StorefrontSuggestion } from "../services/EnrichmentService";
import { getSubscriptionStorefronts, setSubscriptionActive, SubscriptionStorefront } from "../services/SubscriptionService";
import { parseGlipDatabase, applyGlipData, GlipImportSummary } from "../importers/GlipImporter";
import { retrainGlipModels, RetrainProgress, RetrainStage } from "../services/GlipRetrainService";
import CoverArt from "../components/CoverArt";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-xl bg-gray-800/60 p-6 ring-1 ring-white/5">
      <h2 className="text-lg font-semibold text-gray-100">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Button({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={
        "rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50 " +
        (props.className ?? "")
      }
    />
  );
}

/** A plain HTML file input rather than Tauri's dialog plugin — this needs
 * no Tauri plugin, no capability entry, and no Cargo dependency at all.
 * The webview's own native file picker handles it; we just read the
 * resulting File via the standard web File API. */
function FileButton({
  label,
  accept,
  onFile,
}: {
  label: string;
  accept: string;
  onFile: (file: File) => void;
}) {
  return (
    <label className="inline-block cursor-pointer rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-amber-400">
      {label}
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = ""; // allow picking the same file again later
        }}
      />
    </label>
  );
}

/** Cheap heuristic, not a parser — good enough to catch the common
 * "wrong Python interpreter" case (ModuleNotFoundError / ImportError for
 * a package that IS installed, just not in whatever environment
 * python_path points at) without needing to actually understand Python
 * tracebacks. */
function looksLikeMissingPackage(stderr: string): boolean {
  return /ModuleNotFoundError|No module named/i.test(stderr);
}

export default function Settings() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [credentialsSaved, setCredentialsSaved] = useState(false);

  const [importStatus, setImportStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [enrichStatus, setEnrichStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [enrichSummary, setEnrichSummary] = useState<EnrichmentSummary | null>(null);
  const [platformsResolved, setPlatformsResolved] = useState<number | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  const [storefronts, setStorefronts] = useState<StorefrontSuggestion[]>([]);
  const [storefrontEdits, setStorefrontEdits] = useState<Record<number, string>>({});
  const [storefrontSaved, setStorefrontSaved] = useState(false);

  const [sheetStatus, setSheetStatus] = useState<"idle" | "running" | "review" | "error">("idle");
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetResults, setSheetResults] = useState<MatchResult[]>([]);
  const [sheetApplied, setSheetApplied] = useState(0);
  const [allGamesForSearch, setAllGamesForSearch] = useState<{ id: string; title: string; coverArtUrl: string | null }[]>([]);
  const [searchOpenFor, setSearchOpenFor] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [subscriptions, setSubscriptions] = useState<SubscriptionStorefront[]>([]);

  const [glipStatus, setGlipStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [glipError, setGlipError] = useState<string | null>(null);
  const [glipSummary, setGlipSummary] = useState<GlipImportSummary | null>(null);

  const [glipProjectPath, setGlipProjectPath] = useState("");
  const [glipPythonPath, setGlipPythonPath] = useState("python3");
  const [glipPathsSaved, setGlipPathsSaved] = useState(false);
  const [retrainStatus, setRetrainStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [retrainStage, setRetrainStage] = useState<RetrainStage | null>(null);
  const [retrainResult, setRetrainResult] = useState<RetrainProgress | null>(null);
  const [retrainError, setRetrainError] = useState<string | null>(null);

  const [steamPathOverride, setSteamPathOverride] = useState("");
  const [romFolders, setRomFoldersState] = useState<string[]>([]);
  const [newRomFolder, setNewRomFolder] = useState("");
  const [detectSettingsSaved, setDetectSettingsSaved] = useState(false);

  useEffect(() => {
    getIgdbCredentials()
      .then((creds) => {
        if (creds) {
          setClientId(creds.clientId);
          setClientSecret(creds.clientSecret);
        }
      })
      .catch((e) => console.error("Failed to load saved IGDB credentials:", e));
    getSetting(SETTINGS_KEYS.GLIP_PROJECT_PATH)
      .then((path) => path && setGlipProjectPath(path))
      .catch((e) => console.error("Failed to load saved GLIP project path:", e));
    getSetting(SETTINGS_KEYS.GLIP_PYTHON_PATH)
      .then((path) => path && setGlipPythonPath(path))
      .catch((e) => console.error("Failed to load saved GLIP python path:", e));
    getSetting(SETTINGS_KEYS.STEAM_PATH_OVERRIDE)
      .then((path) => path && setSteamPathOverride(path))
      .catch((e) => console.error("Failed to load saved Steam path override:", e));
    getRomFolders()
      .then(setRomFoldersState)
      .catch((e) => console.error("Failed to load saved ROM folders:", e));
    loadStorefrontSuggestions().catch((e) => console.error("Failed to load storefront suggestions:", e));
    loadSubscriptions().catch((e) => console.error("Failed to load subscriptions:", e));
  }, []);

  async function loadStorefrontSuggestions() {
    const db = await getDatabase();
    const suggestions = await suggestStorefrontLabels(db);
    setStorefronts(suggestions);
  }

  async function loadSubscriptions() {
    setSubscriptions(await getSubscriptionStorefronts());
  }

  async function handleToggleSubscription(storefrontId: number, isActive: boolean) {
    await setSubscriptionActive(storefrontId, isActive);
    loadSubscriptions();
  }

  async function handleGlipFile(file: File) {
    setGlipStatus("running");
    setGlipError(null);
    try {
      const buffer = await file.arrayBuffer();
      const data = await parseGlipDatabase(buffer);
      const db = await getDatabase();
      const summary = await applyGlipData(db, data);
      setGlipSummary(summary);
      setGlipStatus("done");
    } catch (error) {
      setGlipError(String(error));
      setGlipStatus("error");
    }
  }

  async function handleSaveGlipPaths() {
    await setSetting(SETTINGS_KEYS.GLIP_PROJECT_PATH, glipProjectPath.trim());
    await setSetting(SETTINGS_KEYS.GLIP_PYTHON_PATH, glipPythonPath.trim() || "python3");
    setGlipPathsSaved(true);
    setTimeout(() => setGlipPathsSaved(false), 2000);
  }

  async function handleSaveDetectSettings() {
    await setSetting(SETTINGS_KEYS.STEAM_PATH_OVERRIDE, steamPathOverride.trim());
    setDetectSettingsSaved(true);
    setTimeout(() => setDetectSettingsSaved(false), 2000);
  }

  async function handleAddRomFolder() {
    const folder = newRomFolder.trim();
    if (!folder || romFolders.includes(folder)) return;
    const updated = [...romFolders, folder];
    setRomFoldersState(updated);
    setNewRomFolder("");
    await setRomFolders(updated);
  }

  async function handleRemoveRomFolder(folder: string) {
    const updated = romFolders.filter((f) => f !== folder);
    setRomFoldersState(updated);
    await setRomFolders(updated);
  }

  async function handleRetrain() {
    setRetrainStatus("running");
    setRetrainError(null);
    setRetrainResult(null);
    try {
      const result = await retrainGlipModels(glipProjectPath, glipPythonPath, (progress) => {
        setRetrainStage(progress.stage);
        setRetrainResult(progress);
      });
      setRetrainResult(result);
      if (result.stage === "done") {
        setRetrainStatus("done");
        if (result.importSummary) setGlipSummary(result.importSummary);
      } else {
        // A stage's Python script ran but exited non-zero — its stdout/stderr
        // is already in retrainResult for the UI to show.
        setRetrainStatus("error");
        setRetrainError(`${result.stage} step failed — see output below.`);
      }
    } catch (error) {
      setRetrainError(String(error));
      setRetrainStatus("error");
    }
  }

  async function handleSaveCredentials() {
    await setSetting(SETTINGS_KEYS.IGDB_CLIENT_ID, clientId.trim());
    await setSetting(SETTINGS_KEYS.IGDB_CLIENT_SECRET, clientSecret.trim());
    setCredentialsSaved(true);
    setTimeout(() => setCredentialsSaved(false), 2000);
  }

  async function handleImportFile(file: File) {
    setImportStatus("running");
    setImportError(null);
    try {
      const text = await file.text();
      const games = JSON.parse(text) as RawBackloggdGame[];
      const db = await getDatabase();
      const result = await importLibrary(db, games);
      setImportSummary(result);
      setImportStatus("done");
      loadStorefrontSuggestions();
    } catch (error) {
      setImportError(String(error));
      setImportStatus("error");
    }
  }

  async function handleEnrich(force = false) {
    setEnrichStatus("running");
    setEnrichError(null);
    try {
      const creds = await getIgdbCredentials();
      if (!creds) {
        throw new Error("Save your IGDB Client ID and Secret above first.");
      }
      const db = await getDatabase();
      const client = new IgdbClient(creds.clientId, creds.clientSecret);
      const result = await enrichGames(db, client, force);
      setEnrichSummary(result);
      const platformCount = await enrichPlatformNames(db, client);
      setPlatformsResolved(platformCount);
      setEnrichStatus("done");
      loadStorefrontSuggestions();
    } catch (error) {
      setEnrichError(String(error));
      setEnrichStatus("error");
    }
  }

  async function handleSaveStorefrontLabels() {
    const db = await getDatabase();
    for (const [idStr, name] of Object.entries(storefrontEdits)) {
      if (!name || !name.trim()) continue;
      // setStorefrontLabel rather than a raw UPDATE: Storefronts.Name is
      // now UNIQUE, so labeling an unlabeled row with a name that
      // already belongs to another row (e.g. a spreadsheet-created
      // "Steam" row existing before this numeric-id row gets labeled
      // "Steam" too) needs to merge the two rows, not just fail.
      await setStorefrontLabel(db, Number(idStr), name.trim());
    }
    setStorefrontSaved(true);
    setTimeout(() => setStorefrontSaved(false), 2000);
    loadStorefrontSuggestions();
  }

  async function handleSpreadsheetFile(file: File) {
    setSheetStatus("running");
    setSheetError(null);
    try {
      const buffer = await file.arrayBuffer();
      const rows = parseSpreadsheet(buffer);
      const db = await getDatabase();
      const existingGames = await db.select<{ Id: string; Title: string; CoverArtUrl: string | null }>(
        `SELECT Id, Title, CoverArtUrl FROM Games`
      );
      setAllGamesForSearch(
        existingGames.map((g) => ({ id: g.Id, title: g.Title, coverArtUrl: g.CoverArtUrl }))
      );
      const results = matchSpreadsheetRows(
        rows,
        existingGames.map((g) => ({ id: g.Id, title: g.Title }))
      );

      // Auto-apply everything the matcher was confident about.
      let applied = 0;
      for (const result of results) {
        if (result.matchedGameId) {
          await applySpreadsheetMatch(db, result.matchedGameId, result.row);
          applied += 1;
        }
      }
      setSheetApplied(applied);
      setSheetResults(results.filter((r) => !r.matchedGameId && r.matchedGameTitle));
      setSheetStatus("review");
      loadSubscriptions();
    } catch (error) {
      setSheetError(String(error));
      setSheetStatus("error");
    }
  }

  async function handleConfirmReviewRow(index: number, gameId: string | null, row: MatchResult["row"]) {
    if (gameId) {
      const db = await getDatabase();
      await applySpreadsheetMatch(db, gameId, row);
      setSheetApplied((n) => n + 1);
      loadSubscriptions();
    }
    setSheetResults((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      <Card title="IGDB Credentials">
        <p className="text-sm text-gray-400">
          Used to fetch genres, themes, developers, publishers, franchise, cover art, and platform
          names. Get a free Client ID and Secret from a Twitch Developer application at{" "}
          <span className="text-amber-400">dev.twitch.tv/console/apps</span>. Stored only in your
          local database — never sent anywhere except directly to Twitch/IGDB.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <input
            className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
            placeholder="Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <input
            className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
            placeholder="Client Secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
          <Button onClick={handleSaveCredentials} className="self-start">
            {credentialsSaved ? "Saved!" : "Save Credentials"}
          </Button>
        </div>
      </Card>

      <Card title="Import Library">
        <p className="text-sm text-gray-400">
          Pick your Backloggd JSON export. Safe to run more than once — existing games,
          playthroughs, and sessions are matched by id and won&apos;t be duplicated.
        </p>
        <div className="mt-4">
          <FileButton label={importStatus === "running" ? "Importing..." : "Choose Backloggd Export (.json)"} accept=".json" onFile={handleImportFile} />
        </div>
        {importStatus === "done" && importSummary && (
          <p className="mt-3 text-sm text-emerald-400">
            Imported {importSummary.games} games, {importSummary.playthroughs} playthroughs,{" "}
            {importSummary.sessions} sessions.
            {importSummary.skipped > 0 && ` (${importSummary.skipped} entries skipped — see console for details.)`}
          </p>
        )}
        {importStatus === "error" && (
          <p className="mt-3 text-sm text-red-400">Import failed: {importError}</p>
        )}
      </Card>

      <Card title="Fetch Metadata &amp; Cover Art">
        <p className="text-sm text-gray-400">
          Fetches genres, themes, developers, publishers, franchise, cover art, platform names,
          IGDB's own user rating, and time-to-beat (Hastily/Normally/Completely) from IGDB for
          anything that doesn&apos;t have it yet. Requires internet access and the credentials
          above. Cover art is cached to disk on first view, so it's available offline after that.
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          <div className="flex flex-col gap-1">
            <Button onClick={() => handleEnrich(false)} disabled={enrichStatus === "running"}>
              {enrichStatus === "running" ? "Fetching..." : "Fetch Metadata & Cover Art"}
            </Button>
            <p className="max-w-[16rem] text-xs text-gray-500">Only new/never-enriched games.</p>
          </div>
          <div className="flex flex-col gap-1">
            <Button onClick={() => handleEnrich(true)} disabled={enrichStatus === "running"}>
              {enrichStatus === "running" ? "Fetching..." : "Re-fetch All (force)"}
            </Button>
            <p className="max-w-[16rem] text-xs text-gray-500">
              Every game, even already-enriched ones — slower, uses more IGDB requests.
            </p>
          </div>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          "Fetch Metadata & Cover Art" only pulls games that have never been enriched — once a game
          has metadata, it's skipped on every later click, even if this app version now fetches more
          fields than it used to (e.g. the series/collection data Series Completion needs). Use
          "Re-fetch All" to re-pull already-enriched games too and pick up anything new.
        </p>
        {enrichStatus === "done" && enrichSummary && (
          <p className="mt-3 text-sm text-emerald-400">
            Games — requested {enrichSummary.requested}, matched {enrichSummary.matched}, not
            found on IGDB: {enrichSummary.notFound}.
            {platformsResolved !== null && ` Platform names resolved: ${platformsResolved}.`}
          </p>
        )}
        {enrichStatus === "error" && (
          <p className="mt-3 text-sm text-red-400">Enrichment failed: {enrichError}</p>
        )}
      </Card>

      <Card title="Personal Spreadsheet (HLTB / Metacritic / Desire to Play / Ownership)">
        <p className="text-sm text-gray-400">
          Merges in your own backlog spreadsheet — platform, storefront, and ROM-ownership notes,
          plus your HLTB/Metacritic/Desire-to-Play numbers. These are your own estimates (not
          scraped exact figures), so treat them as roughly-accurate reference, not precise lookups.
          Titles are matched automatically where confident; anything uncertain is queued below for
          you to confirm, so a wrong guess never silently overwrites the wrong game&apos;s data.
        </p>
        <div className="mt-4">
          <FileButton
            label={sheetStatus === "running" ? "Processing..." : "Choose Spreadsheet (.xlsx)"}
            accept=".xlsx"
            onFile={handleSpreadsheetFile}
          />
        </div>
        {sheetStatus === "error" && <p className="mt-3 text-sm text-red-400">{sheetError}</p>}
        {(sheetStatus === "review" || sheetApplied > 0) && (
          <p className="mt-3 text-sm text-emerald-400">Applied {sheetApplied} confident matches automatically.</p>
        )}
        {sheetStatus === "review" && sheetResults.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {sheetResults.length} rows need a quick confirmation
            </p>
            {sheetResults.map((result, i) => {
              const bestGuess = allGamesForSearch.find((g) => g.title === result.matchedGameTitle);
              const isSearching = searchOpenFor === i;
              const searchMatches = isSearching
                ? allGamesForSearch
                    .filter((g) => g.title.toLowerCase().includes(searchQuery.toLowerCase()))
                    .slice(0, 8)
                : [];

              return (
                <div key={i} className="rounded-lg bg-gray-900 p-3 text-sm">
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-10 flex-shrink-0 overflow-hidden rounded bg-gray-800">
                      {bestGuess?.coverArtUrl && (
                        <CoverArt
                          gameId={bestGuess.id}
                          url={bestGuess.coverArtUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <span className="flex-1 text-gray-300">
                      &quot;{result.spreadsheetTitle}&quot; → <span className="text-gray-100">{result.matchedGameTitle}</span>
                      <span className="ml-2 text-xs text-gray-500">({Math.round(result.confidence * 100)}% match)</span>
                    </span>
                    <Button
                      className="!bg-emerald-600 hover:!bg-emerald-500"
                      onClick={() => handleConfirmReviewRow(i, bestGuess?.id ?? null, result.row)}
                    >
                      Confirm
                    </Button>
                    <Button
                      className="!bg-gray-700 hover:!bg-gray-600"
                      onClick={() => {
                        setSearchOpenFor(isSearching ? null : i);
                        setSearchQuery("");
                      }}
                    >
                      {isSearching ? "Cancel" : "Wrong game?"}
                    </Button>
                    <Button
                      className="!bg-gray-800 hover:!bg-gray-700"
                      onClick={() => handleConfirmReviewRow(i, null, result.row)}
                    >
                      Skip
                    </Button>
                  </div>

                  {isSearching && (
                    <div className="mt-3 border-t border-white/10 pt-3">
                      <input
                        autoFocus
                        className="w-full rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-100 ring-1 ring-white/10"
                        placeholder="Search your library by title..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      <div className="mt-2 flex flex-col gap-1">
                        {searchMatches.map((g) => (
                          <button
                            key={g.id}
                            className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-gray-200 hover:bg-gray-800"
                            onClick={() => {
                              handleConfirmReviewRow(i, g.id, result.row);
                              setSearchOpenFor(null);
                            }}
                          >
                            <div className="h-10 w-7 flex-shrink-0 overflow-hidden rounded bg-gray-800">
                              {g.coverArtUrl && (
                                <CoverArt gameId={g.id} url={g.coverArtUrl} alt="" className="h-full w-full object-cover" />
                              )}
                            </div>
                            {g.title}
                          </button>
                        ))}
                        {searchQuery && searchMatches.length === 0 && (
                          <p className="px-2 py-1.5 text-xs text-gray-500">No games match &quot;{searchQuery}&quot;.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {sheetStatus === "review" && sheetResults.length === 0 && (
          <p className="mt-3 text-sm text-gray-500">No rows need review.</p>
        )}
      </Card>

      <Card title="Unknown Platform/Storefront Codes">
        <p className="text-sm text-gray-400">
          Storefront ids in Backloggd&apos;s export only ever appear for subscription-service
          games, and Backloggd gives no public reference for what each number means. Suggestions
          below are inferred by cross-referencing each code against the platform of the games
          carrying it (subscription services are essentially platform-exclusive) — confirm or
          correct them, they&apos;re never applied automatically.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {storefronts.map((s) => (
            <div key={s.storefrontId} className="rounded-lg bg-gray-900 p-3 text-sm">
              <div className="flex items-center gap-3">
                <span className="w-24 text-gray-400">Storefront #{s.storefrontId}</span>
                <input
                  className="flex-1 rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-100 ring-1 ring-white/10"
                  placeholder={s.suggestedName ?? "Unlabeled"}
                  defaultValue={s.suggestedName ?? ""}
                  onChange={(e) =>
                    setStorefrontEdits((prev) => ({ ...prev, [s.storefrontId]: e.target.value }))
                  }
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {s.gameCount} game{s.gameCount === 1 ? "" : "s"}, mostly on {s.samplePlatform ?? "an unresolved platform"}{" "}
                ({Math.round(s.confidence * 100)}% consistent) — e.g. {s.sampleGameTitles.slice(0, 3).join(", ")}
              </p>
            </div>
          ))}
          {storefronts.length === 0 && <p className="text-sm text-gray-500">No storefront codes found yet.</p>}
          {storefronts.length > 0 && (
            <Button onClick={handleSaveStorefrontLabels} className="self-start">
              {storefrontSaved ? "Saved!" : "Save Labels"}
            </Button>
          )}
        </div>
      </Card>

      <Card title="Active Subscriptions">
        <p className="text-sm text-gray-400">
          Untick a subscription you no longer have — games owned through it will show up under{" "}
          <span className="text-gray-200">Expired Subscriptions</span> instead of your regular
          library. Nothing shows there until you untick something here; a subscription starts
          ticked as soon as it's detected.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {subscriptions.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-3 rounded-lg bg-gray-900 p-3 text-sm text-gray-200"
            >
              <input
                type="checkbox"
                checked={s.isActive}
                onChange={(e) => handleToggleSubscription(s.id, e.target.checked)}
                className="h-4 w-4 accent-amber-500"
              />
              <span className="flex-1">{s.name}</span>
              <span className="text-xs text-gray-500">
                {s.gameCount} game{s.gameCount === 1 ? "" : "s"}
              </span>
            </label>
          ))}
          {subscriptions.length === 0 && (
            <p className="text-sm text-gray-500">
              No subscription storefronts detected yet — import your personal spreadsheet with
              Game Pass/PS Plus/Nintendo Online entries in the Storefront column first.
            </p>
          )}
        </div>
      </Card>

      <Card title="Import GLIP Analysis Data">
        <p className="text-sm text-gray-400">
          If you've used GLIP (the companion Python analysis tool) to enrich and analyze this same
          library, pick its database file (<code>glip.db</code>, usually under{" "}
          <code>data/processed/</code>) to bring across everything GameVault's own enrichment
          doesn't fetch — keywords, collections, game modes, player perspectives, critic-aggregate
          ratings — plus GLIP's computed feature vectors and any trained-model recommendations for
          your backlog. Matched by IGDB id, so this only fills in games GameVault already has
          imported. Safe to run more than once; re-importing updates rather than duplicates.
        </p>
        <div className="mt-4">
          <FileButton
            label={glipStatus === "running" ? "Importing..." : "Choose GLIP Database (.db)"}
            accept=".db,.sqlite,.sqlite3"
            onFile={handleGlipFile}
          />
        </div>
        {glipStatus === "done" && glipSummary && (
          <p className="mt-3 text-sm text-emerald-400">
            Matched {glipSummary.gamesMatched} games ({glipSummary.gamesNotFound} not found in
            your library), wrote {glipSummary.featuresWritten} feature vectors and{" "}
            {glipSummary.recommendationsWritten} recommendations.
          </p>
        )}
        {glipStatus === "error" && (
          <p className="mt-3 text-sm text-red-400">GLIP import failed: {glipError}</p>
        )}
      </Card>

      <Card title="Retrain GLIP Models">
        <p className="text-sm text-gray-400">
          Runs GLIP's own training and recommendation-generation scripts against your library's
          current data — including ownership and Desire to Play, which didn't exist when GLIP's
          recommendations were first computed — then automatically pulls the fresh results back in
          the same way as a manual GLIP import above. Needs Python (with GLIP's dependencies
          already installed in that environment) and the path to your local GLIP project folder.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <input
            className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
            placeholder="GLIP project path (e.g. /Users/you/projects/game-library-intelligence)"
            value={glipProjectPath}
            onChange={(e) => setGlipProjectPath(e.target.value)}
          />
          <input
            className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
            placeholder="Python executable (default: python3)"
            value={glipPythonPath}
            onChange={(e) => setGlipPythonPath(e.target.value)}
          />
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1">
              <Button onClick={handleSaveGlipPaths} className="self-start">
                {glipPathsSaved ? "Saved!" : "Save Paths"}
              </Button>
              <p className="max-w-[14rem] text-xs text-gray-500">Just remembers the two fields above for next time.</p>
            </div>
            <div className="flex flex-col gap-1">
              <Button
                onClick={handleRetrain}
                disabled={retrainStatus === "running" || !glipProjectPath.trim()}
                className="self-start"
              >
                {retrainStatus === "running"
                  ? retrainStage === "training"
                    ? "Training models..."
                    : retrainStage === "recommendations"
                    ? "Generating recommendations..."
                    : retrainStage === "reimporting"
                    ? "Importing results..."
                    : "Running..."
                  : "Retrain & Import"}
              </Button>
              <p className="max-w-[14rem] text-xs text-gray-500">
                Actually runs GLIP's Python scripts and pulls the results in — the real, slower action.
              </p>
            </div>
          </div>
        </div>
        {retrainStatus === "done" && retrainResult?.importSummary && (
          <p className="mt-3 text-sm text-emerald-400">
            Retrained and re-imported: matched {retrainResult.importSummary.gamesMatched} games,
            wrote {retrainResult.importSummary.featuresWritten} feature vectors and{" "}
            {retrainResult.importSummary.recommendationsWritten} recommendations.
          </p>
        )}
        {retrainStatus === "error" && (
          <div className="mt-3 text-sm text-red-400">
            <p>{retrainError}</p>
            {retrainResult?.trainingResult && !retrainResult.trainingResult.success && (
              <>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-300">
                  {retrainResult.trainingResult.stderr || retrainResult.trainingResult.stdout}
                </pre>
                {looksLikeMissingPackage(retrainResult.trainingResult.stderr) && (
                  <p className="mt-2 text-xs text-amber-400">
                    "No module named ..." usually means the "Python executable" field above is
                    pointing at a different Python install than the one with GLIP's dependencies
                    installed (e.g. the system Python instead of your project's venv). Point it at
                    the venv's python.exe directly — e.g.{" "}
                    <code className="text-gray-300">
                      &lt;your project folder&gt;\venv\Scripts\python.exe
                    </code>{" "}
                    on Windows — rather than just "python" or "python3".
                  </p>
                )}
              </>
            )}
            {retrainResult?.recommendationsResult && !retrainResult.recommendationsResult.success && (
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-300">
                {retrainResult.recommendationsResult.stderr || retrainResult.recommendationsResult.stdout}
              </pre>
            )}
          </div>
        )}
        {retrainStatus === "done" && retrainResult?.trainingResult?.stdout && (
          <details className="mt-3 text-xs text-gray-400">
            <summary className="cursor-pointer text-gray-300">Training output</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-900 p-3">
              {retrainResult.trainingResult.stdout}
            </pre>
          </details>
        )}
      </Card>

      <Card title="Installed Games & ROM Detection">
        <p className="text-sm text-gray-400">
          Configuration for detecting what's actually installed on this machine — see the
          "Installed & ROMs" tab on the Hardware page for the scan itself. Steam's install path is
          usually found automatically; only set it manually if that fails. ROM folders are a list
          (not just one) since collections are often split across drives.
        </p>
        <div className="mt-4 flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-400">
            Steam install path (optional — leave blank to auto-detect)
          </label>
          <input
            className="max-w-md rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
            placeholder="e.g. C:\Program Files (x86)\Steam"
            value={steamPathOverride}
            onChange={(e) => setSteamPathOverride(e.target.value)}
          />
        </div>
        <Button onClick={handleSaveDetectSettings} className="mt-2">
          {detectSettingsSaved ? "Saved!" : "Save Steam Path"}
        </Button>

        <div className="mt-6">
          <label className="text-xs font-medium text-gray-400">ROM folders</label>
          <div className="mt-2 flex flex-col gap-2">
            {romFolders.length === 0 && <p className="text-sm text-gray-500">None configured yet.</p>}
            {romFolders.map((folder) => (
              <div
                key={folder}
                className="flex items-center justify-between rounded-lg bg-gray-800/60 px-3 py-2 ring-1 ring-white/10"
              >
                <span className="truncate text-sm text-gray-300">{folder}</span>
                <button
                  onClick={() => handleRemoveRomFolder(folder)}
                  className="ml-3 flex-shrink-0 text-xs text-gray-500 hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input
              className="max-w-md flex-1 rounded-lg bg-gray-900 px-3 py-2 text-sm text-gray-100 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
              placeholder="e.g. D:\Emulation\ROMs"
              value={newRomFolder}
              onChange={(e) => setNewRomFolder(e.target.value)}
            />
            <Button onClick={handleAddRomFolder}>Add Folder</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

# GameVault

A local-first personal gaming archive, collection manager, and analytics
platform — see `Specifications/` for the full spec this was built against.
GameVault preserves and explores your gaming history: the library is the
entry point, the playthrough history is the product, the analytics are
the reward.

## Prerequisites

- **Node.js** (v18+) and npm
- **Rust** and **Cargo** — required to build the Tauri desktop shell.
  Install via [rustup.rs](https://rustup.rs) if you don't have it.
- Platform-specific Tauri prerequisites — see
  [Tauri's prerequisites guide](https://v2.tauri.app/start/prerequisites/)
  for your OS (WebView2 on Windows, Xcode CLT on macOS, a handful of dev
  packages on Linux).

## Setup

```bash
npm install
npm run tauri dev
```

That's it for a first run — `npm install` pulls in everything, including
Tailwind CSS v4, Recharts, and the Tauri dialog-free HTTP plugin that were
added during this pass and haven't been installed yet in this checkout.
**This is the one thing genuinely worth double-checking yourself**: this
project was worked on in a sandbox with no internet access and no Rust
toolchain, so while every piece of TypeScript logic that *could* be
checked without those two things has been (see "What's been tested"
below), `npm install` + `cargo build` succeeding, and the app actually
launching, has not been verified end-to-end. If something doesn't build,
it's most likely a small dependency-version or capability-permission
mismatch — check the error against `src-tauri/capabilities/default.json`
and `src-tauri/Cargo.toml` first.

## First launch

1. Go to **Settings**.
2. Enter your IGDB Client ID and Client Secret (free — create a Twitch
   Developer application at `dev.twitch.tv/console/apps`). These are
   stored only in your local database, never anywhere else.
3. Click **Choose Backloggd Export (.json)** and pick your export file —
   a real file picker (a plain HTML file input, needs no Tauri plugin at
   all), not a bundled sample.
4. Click **Fetch Metadata & Cover Art** to pull genres, themes,
   developers, publishers, franchise, cover art, platform names, IGDB's
   own user rating, and time-to-beat (Hastily/Normally/Completely) from
   IGDB. This needs internet access and takes a little while for a few
   hundred games (IGDB is rate-limited to 4 requests/second) — it now
   makes two requests per batch instead of one, since time-to-beat lives
   on a separate IGDB endpoint from the rest of the game data.
5. Optional: under **Personal Spreadsheet**, pick your backlog `.xlsx` to
   merge in HLTB/Metacritic/Desire-to-Play/platform/storefront notes.
   Confident title matches apply automatically; anything uncertain is
   queued for review with a cover-art thumbnail so you can spot the right
   game at a glance — click **Confirm** to accept the best guess,
   **Wrong game?** to search your library and pick a different one
   instead (also with thumbnails), or **Skip** to leave that row alone.
   Nothing is ever auto-applied silently. Platform/Storefront values feed
   real ownership tracking (ownership, not just play history — covers
   backlog games too), and Game Pass/PS Plus/Nintendo Switch Online are
   auto-detected as subscriptions.
6. Optional: under **Unknown Platform/Storefront Codes**, review the
   suggested labels for subscription-storefront codes (inferred from
   which platform each code's games were played on) and correct/confirm
   them.
7. Optional: under **Active Subscriptions**, untick any subscription you
   no longer have — games owned through it move to the new **Expired
   Subscriptions** page instead of showing as normally available.
8. Browse the Dashboard, Library, Analytics, and Expired Subscriptions
   pages. Library now has a sort dropdown (Date Added, Title, Hours
   Played, Playthroughs, Rating, Release Year) alongside the existing
   status/genre filters. Analytics is now organized into five tabs
   (Overview, Genres & Themes, Franchises & Developers, Platforms &
   Ownership, Time & Trends) instead of one long scroll. GameDetail shows
   a star rating, status badge, and platform/storefront badges right
   under the title.

The Analytics page has 10 charts total: hours by genre/platform/theme,
genres-played-over-time, games-completed-by-year, rating distribution,
average-rating-by-release-year, gaming activity by day of week,
franchise preferences, developer preferences, and a most-replayed-games
list. The platform/rating/completion/weekday/most-replayed charts work
immediately after import; genre/theme/franchise/developer/release-year
charts need step 4 first.

## GLIP unification

GameVault's schema is now the single source of truth shared with GLIP
(the companion Python ML/analysis tool) — one database, not two. The
Streamlit app itself is not part of this integration; only its
already-computed data is brought across.

- **Settings → Import GLIP Analysis Data**: pick your `glip.db` file to
  backfill keywords, collections, game modes, player perspectives, and
  critic-aggregate ratings (all things GameVault's own IGDB enrichment
  never fetched, now added to `IgdbClient.ts` too, so both paths agree
  going forward) — plus GLIP's computed feature vectors (`Features`
  table) and any trained-model recommendations for your backlog
  (`Recommendations` table, shown on GameDetail for games that have one).
  Matched by IGDB id (a clean, reliable numeric join — no fuzzy
  title-matching needed, unlike the personal-spreadsheet importer).
  Safe to re-run; updates rather than duplicates.
- **`Games.Franchise` was removed** in favor of normalized `Franchises`/
  `GameFranchises` tables — some games genuinely belong to more than one
  franchise, which the old single-column design couldn't represent at
  all. Existing data migrates automatically on first launch after
  updating; nothing is lost.
- **What's genuinely untested**: the SQLite-file-reading step itself
  (`parseGlipDatabase`, via `sql.js`) couldn't be exercised in the
  sandbox this was built in — no network access to install `sql.js`
  there. What could be verified, and was, is everything downstream of
  that — the actual data-writing logic (`applyGlipData`) — tested against
  your real `glip.db`'s actual contents (extracted to JSON via Python,
  which was available) matched against a real GameVault database built
  from your real Backloggd export. All 408 games matched correctly by
  IGDB id, all 408 feature vectors written, all 114 recommendations
  written, confirmed idempotent on a second run. The one piece most
  worth a sanity check on first real use is specifically the file-picker
  → `sql.js` → parsed-data handoff, not the logic that follows it.
- **Retraining the models themselves** (so they actually learn from your
  ownership/DesireToPlay data, not just display GLIP's existing
  predictions) is a separate, bigger piece of work — invoking the Python
  scripts as a subprocess from Tauri — not built yet.

A quarterly, Spotify-Wrapped-style retrospective of your library —
`src/services/TimeGalleryService.ts` for the data (which games were
active in which quarter, deduplicated so a game you returned to shows up
again each quarter you actually came back to it, not once total) and
`src/services/TimeGalleryFlavorText.ts` for the per-card text.

A few design decisions worth knowing about:

- **A game "counts" for a quarter based on logged session dates first**,
  falling back to a playthrough's Start/FinishDate range only when that
  playthrough has no individual session detail at all. Calendar quarters
  (Jan–Mar / Apr–Jun / Jul–Sep / Oct–Dec).
- **Hours-per-quarter reuses `estimateSessionHours()`** (the same
  zero-duration-session backfill built for the weekday-activity chart)
  rather than a separate calculation — same logic, same reasoning,
  applied here too.
- **Ratings fall back to the game's best rating** across all its
  playthroughs when the specific quarter shown isn't the one that
  actually got rated — confirmed this is what you wanted rather than
  leaving it blank. Cards using the fallback are marked "(overall)" so
  it's not presented as if that quarter itself earned that score.
- **Long-gap finishes** (playthroughs whose Start→Finish gap spans 3+
  quarters) get their own dedicated set of templates on the finish
  quarter specifically — not on every quarter the playthrough spanned —
  with the Metal Gear Solid nod and general "backlog boss" gaming-culture
  framing you asked for. Found 10 real examples in your library this
  way, including a 19-quarter gap on Apex Legends.
- **Flavor text is local template-based, not LLM-generated** (confirmed
  preference) — genre/theme drive a tone (serious/playful/sporty/tense/
  tactical/cozy/adventurous), sports titles get a lighter title-keyword
  sub-classification (FIFA → "the pitch", NBA → "the court", etc.) since
  IGDB's "Sport" genre doesn't distinguish which sport, and a small
  franchise-nod dictionary adds light easter eggs (Warframe → "Tenno",
  Dark Souls → "Undead," etc.) for recognized series. Selection is
  deterministic per card (seeded by game + quarter) rather than
  re-randomized on every view, so a card is stable if you come back to
  it, while different quarters of the same game land on different lines.
  Tested against your real 408-game library: 470 game-quarter moments,
  99%+ unique lines, zero unreplaced template placeholders.
- **Seasons assume the Northern Hemisphere** (Q2 = "spring," etc.) — not
  detected from your actual location, since that felt like a separate
  question not worth blocking this on. Easy to flip if it's wrong for
  you.
- **Not an actual RAM concern in practice** — the full quarter-moment
  dataset for a library this size is a few hundred small summary objects,
  trivial to hold in memory. What actually scales with scrolling is DOM
  nodes and cover-art images, so that's what's paginated: only a window
  of quarters renders at a time, growing via an IntersectionObserver
  sentinel as you scroll, with cover art additionally using the
  browser's native lazy-loading.
- **A real bug caught while building this**: extracting the star-rating
  display into a shared component (needed since Time Gallery shows many
  at once, unlike GameDetail's single rating) surfaced an SVG gradient-id
  collision that GameDetail's single-instance usage had been hiding —
  fixed with `useId()`. Full details in "Real bugs" below.

## What's been tested

This sandbox had no Rust toolchain and no internet access, which shaped
what could actually be verified vs. what's correct-by-careful-reading.
Rather than blur that line, here's the honest split — and this pass
also lost the local `node_modules` (deleted before the previous zip to
shrink it, and there's no network here to restore it), so the
whole-project `tsc` check I ran last time couldn't be repeated this
round; the new/changed files were reviewed by eye instead, alongside
what could still be checked in isolation:

**Verified against your real 408-game export**, using Node's built-in
`node:sqlite` as a stand-in for the Tauri SQL plugin (same schema, same
SQL, no Tauri-specific code involved):
- Full schema creation, including `seedKnownAcquisitionMethods()` running
  correctly both before and after import
- The complete importer — game/playthrough/session counts, idempotency
  on re-import, rating semantics (`0` = unrated, not a real score),
  `IGDBId` population, lookup table population, per-game error resilience
  (verified by deliberately injecting a mid-import failure: 407 games
  still imported correctly, 1 correctly counted as skipped)
- Every `AnalyticsService` query, including the weekday-activity backfill
  logic — this one specifically by stubbing `database.ts`'s `selectQuery`
  against a real populated SQLite file and running the actual compiled
  service code, not just the raw SQL, so the JS-side grouping and
  estimation logic is genuinely exercised, not just the query strings
- `SpreadsheetImporter.ts`'s title-matching logic (`normalizeTitle`,
  `titleSimilarity`, `matchSpreadsheetRows`) — pure functions, tested
  directly against the real title lists from both your export and your
  spreadsheet (see the matching-threshold bug above)
- Earlier in this project, `TypeScript` compiled clean across the whole
  project (`npx tsc --noEmit`) aside from packages this sandbox couldn't
  install. `node_modules` was later deleted to shrink a zip and hasn't
  been restorable since (no network access here) — so files written
  after that point, including all of `Settings.tsx`'s new file-picker and
  review UI, are reviewed by eye rather than compiler-checked. Worth
  running `npx tsc --noEmit` yourself after `npm install`, as a first
  sanity check before `npm run tauri dev`.

**Written carefully, but not run**: the actual Tauri build (no Cargo
here), the IGDB client's real network calls (no internet here), and
therefore the whole cover-art-fetching path end to end. The auth flow and
Apicalypse query shape mirror a Python IGDB client already verified
against real IGDB traffic in a sibling project (same account, same API,
same rate limits) — but this is a different language and a different
HTTP stack, and its first real test is your machine, not this one.

## Real bugs found and fixed along the way

- **GLIP unification: three real bugs caught by testing against your
  actual `glip.db`, not synthetic data.** (1) `Games.Franchise` was a
  single-value column that could only ever hold the first franchise a
  game belonged to — GLIP's own data showed this was actively wrong for
  real games (e.g. Persona and Shin Megami Tensei titles both properly
  belong under "Megami Tensei," invisible under the old single-column
  design). Normalized into `Franchises`/`GameFranchises`, with a one-time
  migration that moves any existing value across and drops the old
  column (tested against both a fresh database and a simulated old one
  with real franchise data — confirmed idempotent). (2) `IgdbClient.ts`
  was already fetching `aggregated_rating` in its query and had been for
  a while — sitting right there on the `IgdbGame` interface — but nothing
  ever wrote it to a column. Fetched over the network, silently discarded,
  every single enrichment run. Not a GLIP-specific gap, but the
  unification is what surfaced it. (3) The initial test of the GLIP
  importer showed every single game failing to match (`gamesMatched: 0`
  against 408 real games) despite `recommendationsWritten: 114`
  succeeding via the exact same lookup map — traced to `games.igdb_id`
  being stored as TEXT in glip.db while `recommendations.igdb_id` wasn't,
  and my own test-data extraction script casting one but not the other.
  The real import code (`GlipImporter.ts`) already defensively casts with
  `Number(...)` regardless of source type, so this was a test-harness bug
  specifically, not an app bug — but it's exactly the kind of type-drift
  issue that would have caused a real, silent failure if the defensive
  cast hadn't already been there.
- **`getFranchiseHoursByYear()` was dead code referencing the now-removed
  column** — found during the Franchise sweep. Unused anywhere in the
  UI, but fixed to the new normalized structure rather than left as a
  landmine for whenever it does get wired up.

- **A latent SVG gradient-id collision, caught while extracting
  `StarRating` into a shared component.** GameDetail only ever shows one
  star rating per page, so a gradient `id` that varied only by star
  index (1–5) was invisible there. Time Gallery renders dozens of star
  ratings on screen at once, and `url(#star-fill-1)` in SVG resolves to
  whichever definition appears *first* in the DOM — so every card after
  the first star rating could have silently shown the wrong fill
  percentage. Fixed with React's `useId()`, giving each instance a
  unique gradient-id prefix.
- **Time Gallery cards initially claimed fake "0.0h" durations.** Some
  quarters have a real data gap — a session logged with a date but no
  duration anywhere, and no aggregate total on the playthrough to
  estimate from either (the normal `estimateSessionHours()` backfill
  only works when there *is* a total to distribute). Sentences like "you
  wandered through Pursuit Force for 0.0h" read oddly — that's not a
  real zero, it's missing data presented as if it were a fact. Added a
  dedicated set of templates that acknowledge the gap honestly ("no
  duration on record, but it was there") instead of claiming a number
  that isn't real.

- **"Unknown Platform/Storefront Codes" showed spreadsheet-labeled
  storefronts (Riot, GOG, Ubisoft) as unresolved, negative-id, "0 games,
  0% consistent."** Root cause: `suggestStorefrontLabels()` queried
  every row in `Storefronts` with no `WHERE` clause, including the
  synthetic negative-id rows the spreadsheet importer creates with a
  real name already set. Those have zero `Playthroughs` rows referencing
  them (that column only ever comes from Backloggd's raw numeric codes,
  never from a spreadsheet-sourced id), so the cross-reference always
  found nothing — surfacing as a confusing suggestion for entries that
  were already correctly labeled and needed no suggestion at all. Fixed
  with `WHERE Name IS NULL`, so only genuinely-unlabeled storefronts show
  up here now. Verified against a mixed scenario (one real unlabeled
  numeric code plus a spreadsheet-created "Steam" entry): only the
  numeric one appears afterward.
- **Analytics captions could visually overlap the section below them** —
  not just the weekday chart, four charts total. `ChartCard`'s chart area
  has a fixed-height box so Recharts' `ResponsiveContainer` has something
  concrete to size against, but captions were being passed in as an
  extra child mixed into that same fixed box — chart + caption text
  together needed more height than the box allowed, and with no overflow
  handling, the caption spilled out past the bottom edge into whatever
  followed. Fixed by giving `ChartCard` a dedicated `caption` prop
  rendered in its own block after (not inside) the fixed-height chart
  div, so the card's total height grows to fit both pieces instead of
  clipping one against the other.

- **A real idempotency bug in the spreadsheet importer, found while
  building ownership tracking, not asked about directly** — but it
  directly answers "if I change Dead Cells from Game Pass to Steam and
  re-import, does it update?" honestly rather than just asserting yes.
  The old code appended a new Notes fragment (`"Platform (spreadsheet):
  X"`) on every import without removing the previous one — so
  re-importing after changing a game's platform/storefront in the
  spreadsheet would leave BOTH the old and new value concatenated in
  Notes forever, never actually reflecting the update. Fixed properly:
  Platform/Storefront now resolve to real `UserGames.OwnedPlatformId`/
  `OwnedStorefrontId` columns via plain `UPDATE`s (separate from
  `Playthroughs.PlayedPlatformId`/`StorefrontId`, which represent what a
  specific *playthrough* happened on, not current ownership — a
  distinction that matters because backlog games have no playthrough at
  all, so ownership needed its own home). Verified the exact scenario
  with a real test: first import records Game Pass, second import
  (simulating an edited spreadsheet) correctly updates to Steam with the
  old value fully replaced, not duplicated.
- **Platform/storefront name resolution reuses IGDB-resolved rows where
  possible** ("PC" in your spreadsheet matches the existing "PC
  (Microsoft Windows)" row IGDB enrichment already created) rather than
  creating visually-duplicate rows — verified this reuse actually
  happens, not just designed to. Anything with no IGDB equivalent (e.g.
  "Emulated") gets a synthetic negative id, chosen specifically because
  real IGDB platform ids are always positive and can never collide with
  it.
- **Subscription detection and "Expired Subscriptions" verified against
  your exact example**: seeded three games across Game Pass/PS
  Plus/NSO, unticked Game Pass and PS Plus keeping only NSO active, and
  got back precisely the two expected games while the NSO one correctly
  stayed out of the list. `IsCurrentlyActive` defaults to on, so a fresh
  install or a newly-discovered subscription never shows a false
  "everything's expired" list before you've actually unticked anything.
- **The Library's default game order was never really "last edited"** —
  it was un-ordered raw database row order, which happened to loosely
  track Backloggd's own export array order (which itself seems to be
  sorted by `last_edited_at` descending — confirmed directly:
  `last_edited_at` is a raw Unix timestamp, and Silksong having the
  single largest value across your whole library is exactly why it
  always appeared first). The new "Date Added" sort option is a real,
  explicit sort on that same timestamp rather than an accidental
  byproduct of import order — compared numerically, not as a string
  (which would coincidentally work today since every value is 10 digits,
  but isn't something to rely on going forward).

- **HLTB/Metacritic scraping was abandoned in favor of IGDB's own
  time-to-beat and rating data — a real plan change, not just an
  optimization.** The original plan (search the web for each game's
  HowLongToBeat and Metacritic figures) turned out to be a genuine
  mistake in practice: even a well-known franchise game (the original
  2015 Dying Light) produced noisy, ambiguous search results requiring
  careful manual disambiguation to avoid pulling numbers from *Dying
  Light 2* or *Dying Light: The Beast* instead. At that rate, an
  accurate pass across the full library would have meant hundreds of
  individually-verified lookups. Replaced with IGDB's own
  `game_time_to_beats` endpoint (Hastily/Normally/Completely, each
  clearly labeled — never just "time to beat") and its `rating`/
  `rating_count` fields — structured, id-keyed data with no name-matching
  step at all, reusing the same enrichment pass and credentials already
  in place. Confirmed the exact endpoint and field names (`game_id`,
  `hastily`, `normally`, `completely`, `count`) directly against IGDB's
  own published proto schema (`api.igdb.com/v4/igdbapi.proto`) rather
  than trusting a third-party wrapper — one older wrapper had the field
  spelled `hastly`, which would have silently returned nothing. One
  thing still flagged as unverified rather than assumed: whether these
  durations come back in seconds (division by 3600 is implemented on
  that basis, matching IGDB's usual convention and community reports of
  the same "why is this 72000?" gotcha on this endpoint, but this is the
  first thing worth sanity-checking against a game you know the length
  of on first real run). The `count` field — number of submissions
  behind each figure — is surfaced directly next to "Completely" with a
  visible warning below 10 submissions, specifically for outlier cases
  like a 100+ hour game showing an inflated "Completely" driven by a
  handful of players treating it as their forever-game. This doesn't
  touch `HLTBMainStory`/`MetacriticScore` — those remain in the schema,
  still populated by the personal-spreadsheet importer for your own
  tracked estimates.
- **Status was wrong for every one of your 114 backlog games** — Nioh
  showing as Endless, Super Meat Boy showing as Completed, Backlog
  appearing empty in the Library filter, Unfinished empty too. Rather
  than guess at a fix, cross-tabulated status/is_backlog/is_playing/
  finished-playthrough across your actual 408-game export first. That
  turned up the real, exact cause: **every single one of your 114
  is_backlog=true games also carries a non-null StatusRaw** — 52 marked
  "completed" with zero finished playthroughs, 32 marked "played" with
  zero playthroughs at all, 20 more marked "played" with playthroughs
  but none finished, 10 marked "completed" with no playthroughs
  whatsoever. `deriveStatus()` checked StatusRaw before is_backlog, so
  all 114 got swallowed into Completed/Endless and Backlog was
  structurally guaranteed to be empty — not a rare edge case, the norm
  for every backlog game you have. Fixed by checking is_backlog first
  when there's no completion evidence backing the status string (full
  reasoning in the doc comment on `deriveStatus()` in `types/game.ts`).
  Verified after the fix: all six status buckets now sum to exactly 408
  with no games unaccounted for, and Nioh/Super Meat Boy both correctly
  show as Backlog.
- **Session list was an unreadable flat wall of day numbers** for any
  game with a lot of sessions (Warframe has hundreds) — no month or year
  grouping, so a "23" gave no way to tell which month it was from.
  Replaced with `components/SessionCalendar.tsx`, a real month-grid
  calendar with prev/next navigation, defaulting to the most recent
  month with a logged session. The grid math (day-of-week alignment
  across different month lengths and leap years) was checked
  independently before wiring it in, not just visually eyeballed.
- **Your spreadsheet's HLTB/Metacritic/Desire-to-Play/ownership data was
  being written to the database and then never shown anywhere** — fully
  hidden after import. Added a "From Your Spreadsheet" section to
  GameDetail, with the personal-estimate caveat kept visible next to the
  numbers rather than presenting them as precise lookups.

Worth knowing about, since a couple of these reflect real properties of
your data, not just code mistakes:

- **The exact bug you hit: "no such column: ug.StatusRaw."** Root cause
  is systemic, not a one-off: `CREATE TABLE IF NOT EXISTS` is a no-op
  once a table already exists — it never adds columns to an existing
  table. This schema has gained several columns on `Games` and
  `UserGames` since the project started (`IGDBId`, `CoverArtUrl`,
  `Franchise`, the HLTB/Metacritic columns, `IsWishlist`/`IsBacklog`/
  `IsPlaying`, `TotalHours`, `StatusRaw`), and your database — created
  before some of those existed — never had them added, no matter how
  many times the app relaunched. Fixed with a real migration step
  (`ensureColumnsExist()` in `database.ts`) that parses each table's own
  `CREATE TABLE` statement (so the expected-columns list can never drift
  out of sync with it), checks what the real table actually has via
  `PRAGMA table_info`, and adds anything missing via `ALTER TABLE ADD
  COLUMN` — for every table, not just the two known offenders, so any
  future schema change gets this safety net automatically. This one
  took three real bugs to get right, each caught by testing against
  increasingly realistic scenarios before shipping: SQLite flatly
  refuses `ALTER TABLE ADD COLUMN` with an inline `UNIQUE` constraint
  (caught by simulating your exact old-database shape) — fixed by adding
  the column plain and creating a separate unique index instead; a naive
  comma-split broke on composite `PRIMARY KEY (GameId, GenreId)`
  constraints in every join table, since the comma inside those
  parentheses isn't a column separator (caught by testing against every
  table, not just the two I assumed were the only ones affected) —
  fixed with a paren-aware split; and the migration originally ran
  *after* index creation, which fails outright on an old database since
  one of the indexes references a column (`IGDBId`) that doesn't exist
  until the migration adds it (caught by finally testing the complete
  old-database-plus-real-import path end to end) — fixed by reordering.
  Verified afterward against the exact failing query pattern, on a
  database seeded to match your real old schema, with existing data
  (favorites, notes) confirmed to survive the migration untouched.

- **Library and GameDetail could get stuck on "Loading..." forever, with
  no visible error.** This turned out to be a downstream symptom of the
  `StatusRaw` migration bug above — the query threw, and there was a
  separate, real gap that made the failure invisible instead of showing
  an error: none of Dashboard's, Library's, GameDetail's, or Analytics's
  initial data-loading effects had a `.catch()` handler on their
  promises. If any query threw for *any* reason, the rejection went
  completely unhandled — `loading` never flipped to `false`, and the
  only trace was an "Uncaught (in promise)" warning in devtools that
  nothing in the UI surfaced. Added proper `.catch()` + error state to
  all four pages, so a real failure now shows an actual error message
  instead of an infinite spinner — this is what actually surfaced the
  "no such column: ug.StatusRaw" text in the first place, which is what
  made diagnosing the real bug above possible rather than just guessing
  at connection-pooling theories.

- **93.2% of all 3,374 session entries have zero recorded duration.**
  Discovered while testing a "gaming activity by weekday" chart — the raw
  data isn't a rare gap, it's the norm: Backloggd lets you log which days
  you played without logging how long each time. Fixed with
  `utils/sessionHours.ts`: when a whole playthrough's sessions are all
  zero but the playthrough itself has a real total, that total is split
  evenly across its sessions as a display estimate — never overwriting
  the stored zeros. Recovered real numbers for 73.7% of session-days
  (up from 7.7%), and the resulting weekday medians (~2–2.3h) are now
  genuinely meaningful instead of an artifact of the zero-inflation.
- **A spreadsheet title-matching threshold that let real problems hide
  among false alarms.** The first pass flagged 74 of 379 rows for manual
  review — including both obviously-correct matches blocked by "The "
  prefixes and accented characters, *and* genuinely wrong guesses
  (`'Witcher 3'` briefly matching `'Watch Dogs 2'` at 0.417 confidence).
  Burying real problems under easy confirmations defeats the point of a
  review queue. Improved title normalization (strip leading articles,
  fold accents, normalize `&`/"and") cut it to 56 — a smaller, more
  honest queue where the remaining cases are the ones that actually need
  your judgment.
- **`seedKnownAcquisitionMethods()` was written but never called anywhere.**
  Found while reviewing the codebase for what was actually wired up vs.
  just defined. Moved to `schema.ts` (it's static seed data with no IGDB
  dependency, so it doesn't belong in `EnrichmentService.ts`) and now
  runs automatically during database initialization.
- **`xlsx` (the spreadsheet-parsing package) was imported by
  `SpreadsheetImporter.ts` but never added to `package.json`** — would
  have failed immediately on `npm install`. Added — then, after you
  reported `npm audit` flagging it as a high-severity vulnerability
  (prototype pollution + ReDoS) with "no fix available," pointed at the
  actual fixed release instead. The nuance: SheetJS genuinely fixed both
  issues (0.19.3 and 0.20.x respectively), but stopped publishing patched
  versions to the npm registry itself — the registry is permanently
  stuck at the vulnerable 0.18.5, and "no fix available" is npm audit
  telling the truth about the registry specifically, not about whether a
  fix exists anywhere. `package.json` now points `xlsx` directly at
  SheetJS's own CDN tarball
  (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), which `npm`
  supports natively as a dependency source — the package still installs
  and imports as `xlsx`, so no other code changes were needed. Worth
  knowing separately: the actual vulnerability only matters for
  workflows parsing untrusted/maliciously-crafted files, and GameVault
  only ever parses a spreadsheet you pick yourself locally — so the
  practical exposure here was low even before this fix, but it cost
  nothing to close properly rather than leave it.
- **"database is locked" on first launch.** React's `StrictMode`
  (`main.tsx` wraps the app in it) deliberately double-invokes effects in
  development mode to help surface exactly this kind of bug. The old
  `initializeDatabase()` only guarded with `if (db) return` — checked
  *before* the first call's `Database.load(...)` had finished — so both
  invocations saw `db` as still null and both tried to open and
  write-initialize the same SQLite file at once. Fixed by caching the
  in-flight *promise* the moment it starts, not just the eventual result,
  so a second concurrent call awaits the same promise instead of racing
  a fresh one. Also added `PRAGMA journal_mode=WAL` and
  `PRAGMA busy_timeout=5000` on connection, independent of that fix —
  standard practice for a Tauri+SQLite app, and cheap insurance against
  any other brief lock contention (e.g. around Vite's hot-reload in dev).
- **Import silently stopped after one game.** `importLibrary()` wrapped
  the whole 408-game import in a manual `BEGIN TRANSACTION` / `COMMIT`,
  which doesn't work reliably with `@tauri-apps/plugin-sql` — it's built
  on `sqlx` with pooled connections, and separate `execute()` calls
  aren't guaranteed to land on the same physical connection. In practice:
  `BEGIN` locked the writer on whichever connection it acquired, the next
  game's insert got routed to a different pooled connection and blocked
  behind that lock, and since `COMMIT` was never going to fire until all
  408 games were done, it eventually timed out — leaving only whatever
  ran on that first connection actually committed. Fixed by removing the
  manual transaction entirely (each statement now autocommits
  individually — slower, but correct) and additionally wrapping each
  game's import in its own try/catch, so one bad record is now counted
  as skipped and logged rather than silently aborting every game after
  it in the array.

- **The app couldn't have started.** `App.tsx` imported a test fixture
  (`bg3-test.json`) that didn't exist anywhere in the project.
- **Every `.select()` call would have been silently denied.** The Tauri
  capability file was missing the `sql:allow-select` permission.
- **`src-tauri/` was missing from the upload entirely** — recovered from
  git history (`git checkout HEAD -- src-tauri`); nothing was lost, it
  just hadn't made it into the zip.
- **The schema couldn't distinguish "on my wishlist" from "in my
  backlog" from "no relationship to this game at all"** for the many
  games with zero playthroughs. Fixed by adding `IsWishlist`/`IsBacklog`/
  `IsPlaying` columns to `UserGames` — a deliberate, documented extension
  beyond the literal spec appendix (see the comment above
  `CREATE_USER_GAMES_TABLE` in `schema.ts`).
- **Backloggd's own aggregate hours and the sum of individual
  playthrough hours disagree for 62 of your 408 games**, in both
  directions — some games have real hours logged at the game level with
  no playthrough breakdown at all (and two go the other way). Fixed by
  storing both (`UserGames.TotalHours` alongside `Playthroughs.HoursPlayed`)
  and taking whichever is larger, rather than silently dropping either.
- **A join fan-out bug that would have silently multiplied hours-played
  by genre count** in `GameService`'s main query — caught by testing
  with a game seeded to have 2 genres before it ever went into a
  Dashboard/Library query. Fixed by aggregating each relation in its own
  subquery rather than joining Playthroughs and Genres directly against
  Games in the same query.

## Known follow-ups (not done, and why)

- **Local cover art caching.** Cover art is displayed directly from
  IGDB's image CDN, not cached to disk — viewing it needs internet each
  time. Local-first in spirit but not to the letter for images
  specifically; a deliberate simplification given the risk of getting
  Tauri's asset-protocol scoping wrong without being able to test it
  here. Genuinely worth doing later; the spec's own "Future Expansion"
  list treats this kind of thing as optional, not blocking.
- **HowLongToBeat / Metacritic / OpenCritic exact figures.** The
  spreadsheet importer brings in your own personal estimates for these
  (confirmed to be rough — some rounded, some from memory), which is
  genuinely useful and now wired up, but a precise scraped/API-sourced
  figure would need separate integrations — HLTB has no official API,
  Metacritic/OpenCritic have none at all (only fragile scraping). A
  separate, riskier piece of work than what's here, not bundled in
  silently.
- **Gaming streaks / heatmaps.** A basic "current consecutive-days
  streak" is implemented; the full spec'd calendar heatmap visualization
  isn't.
- **`GameDetail`'s per-game stats panel** still uses only the
  playthrough-summed hours, not the `MAX()`-corrected figure the rest of
  the app uses (see the hours-mismatch bug above) — for the ~60 affected
  games this one panel could undercount slightly. Small, known,
  documented, not yet fixed.

## Project structure

```
src/
├── database/         Schema (schema.ts, incl. seedKnownAcquisitionMethods)
│                      + connection (database.ts)
├── importers/
│   ├── BackloggdJsonImporter.ts   Main library import
│   └── SpreadsheetImporter.ts     Personal xlsx merge (title matching, HLTB/
│                                  Metacritic/Desire-to-Play/platform notes)
├── services/          All data access — one file per concern
│   ├── GameService.ts         Library-level game queries
│   ├── PlaythroughService.ts  Per-game playthrough queries
│   ├── PlaySessionService.ts  Per-playthrough session queries
│   ├── AnalyticsService.ts    All Analytics-page queries
│   ├── DashboardService.ts    Recent completions, hours-this-month, streak
│   ├── SettingsService.ts     Local key-value settings (IGDB credentials)
│   ├── IgdbClient.ts          IGDB API client (OAuth + Apicalypse)
│   └── EnrichmentService.ts   Applies IGDB data (games + platform names +
│                              storefront-label suggestions) to the database
├── types/              Shared TypeScript types + derived-status logic
├── utils/
│   ├── ratings.ts       effectiveRating() — rating=0-means-unrated fix
│   └── sessionHours.ts  estimateSessionHours() — zero-duration backfill
├── components/         Shared UI (GameCard)
└── pages/              Dashboard, Library, GameDetail, Analytics, Settings
```

// GameVault database schema.
//
// This is the full schema from GameVault_Specification_v1.3 (Appendix v1.3A) —
// the previous version of this file only had Games/Playthroughs/PlaySessions,
// a subset that predates most of the current spec. Restored here:
//   - UserGames (favorite/liked/desire-to-play/notes — currently missing entirely,
//     so favoriting and wishlist tracking had nowhere to live)
//   - Genres/Themes/Developers/Publishers/Platforms/Storefronts/AcquisitionMethods/
//     Tags as proper lookup tables, plus their many-to-many join tables
//   - The metadata columns on Games (CoverArtUrl, Franchise, HLTB*, *Score,
//     MetadataRetrievedAt) needed for IGDB/HLTB/Metacritic/OpenCritic enrichment
//
// Each statement is its own exported string (rather than one big migration)
// so database.ts can run them individually and log which one fails, if any.

export const CREATE_GAMES_TABLE = `
CREATE TABLE IF NOT EXISTS Games (
    Id TEXT PRIMARY KEY,
    IGDBId INTEGER UNIQUE,
    Title TEXT NOT NULL,
    ReleaseDate TEXT,
    ReleaseYear INTEGER,
    Summary TEXT,
    CoverArtUrl TEXT,
    HLTBMainStory REAL,
    HLTBCompletionist REAL,
    MetacriticScore INTEGER,
    OpenCriticScore INTEGER,
    TimeToBeatHastily REAL,
    TimeToBeatNormally REAL,
    TimeToBeatCompletely REAL,
    TimeToBeatCount INTEGER,
    IGDBUserRating REAL,
    IGDBUserRatingCount INTEGER,
    AggregatedRating REAL,
    AggregatedRatingCount INTEGER,
    IGDBCategory INTEGER,
    IGDBParentGameId INTEGER,
    IGDBVersionParentId INTEGER,
    MetadataRetrievedAt TEXT,
    IsManuallyEdited INTEGER NOT NULL DEFAULT 0,
    IsManualEntry INTEGER NOT NULL DEFAULT 0
);
`;
// IsManuallyEdited: added for in-app editing. BackloggdJsonImporter's
// Games upsert unconditionally overwrites Title/IGDBId on every
// re-import (ON CONFLICT DO UPDATE) — without this flag, manually
// correcting a game's title in-app would get silently reverted the next
// time you re-import. Once set (by the edit itself, not by import),
// the importer's UPDATE is gated on this being 0, protecting the whole
// row rather than tracking which specific field was touched — simpler,
// and matches what was actually asked for ("track which rows were
// manually touched").
//
// IsManualEntry: distinguishes a game added entirely in-app (no
// Backloggd id at all — see GameEditService.ts for the Id scheme used)
// from one that came from an import and was later edited. Not used for
// the overwrite-protection logic itself (a manual entry's Id can never
// collide with a real Backloggd id regardless), but useful for the UI
// to know which games have no import lineage at all.
// IGDBCategory/IGDBParentGameId/IGDBVersionParentId: added for Series
// Completion (a game's automatic membership in a canonical series slot —
// see SeriesService.ts). IGDB's own `category` enum on a game
// distinguishes a remake (8) or remaster (9) from a main_game (0), and
// `parent_game` on a remake/remaster points back at the original it's
// based on; `version_parent` separately groups same-era edition variants
// (Standard/Deluxe/GOTY) that aren't remasters at all. Storing the raw
// IGDB ids here (not a local foreign key) is deliberate: the parent game
// this points at may not be something the user owns or has imported at
// all — Series Completion needs to compare against IGDB's canonical
// series catalog, not just the user's own library.
// Franchise moved out of this table entirely (was a single TEXT column,
// only ever holding the first franchise a game belonged to) — normalized
// into Franchises/GameFranchises below instead, matching the
// Genres/GameGenres pattern, since some games genuinely belong to more
// than one (confirmed during the GLIP unification: GLIP's own franchises
// field is a list, and GameVault's single-column version was silently
// dropping every franchise after the first). Migrating any existing
// single-franchise value into the new join table, and dropping this
// column from any database that still has it, is handled as a one-time
// step in database.ts — SQLite has supported DROP COLUMN since 3.35, so
// this doesn't leave the old column sitting around unused forever.
//
// AggregatedRating/AggregatedRatingCount: IGDB's critic-score aggregate,
// distinct from IGDBUserRating (the crowd rating) above. Found while
// building the GLIP unification that IgdbClient.ts already fetches
// `aggregated_rating` in its query and has for a while — it's sitting
// right there on the IgdbGame interface — but nothing ever wrote it to a
// column. It was being pulled over the network and silently discarded on
// every single enrichment run. Not a GLIP-specific gap; would have been
// worth fixing regardless.
// TimeToBeat* / IGDBUserRating* replace the original plan of chasing down
// HowLongToBeat and Metacritic figures one game at a time via web search.
// That plan turned out to be a real mistake in practice, not just slow:
// even a well-known franchise game (the original Dying Light) produced
// noisy, ambiguous search results requiring careful manual disambiguation
// per game, and would have meant hundreds of individually-verified
// lookups for the full library. IGDB's own game_time_to_beats endpoint
// and its rating/rating_count fields solve the actual problem underneath
// that plan (a rough sense of "how long is this" and "is it good") with
// structured, id-keyed data — no name-matching, no ambiguity, and it
// reuses the enrichment pass and credentials already in place. HLTBMainStory/
// HLTBCompletionist/MetacriticScore above are UNCHANGED and still populated
// by the personal-spreadsheet importer — this doesn't replace that path,
// which still has value for your own tracked estimates; it just replaces
// the "have Claude go look these up one by one" plan specifically.

// UserGames: per-game user relationship data.
//
// IsWishlist/IsBacklog/IsPlaying are a deliberate addition beyond the literal
// spec appendix, flagged here rather than silently added: the spec (5J) says
// "Status" should be derived, not stored — correct, and this doesn't store
// Status. But deriving it needs raw ingredients, and for a game with zero
// playthroughs (never actually started — true of many wishlist/backlog
// entries), there is nothing in Playthroughs to derive from. These three
// columns are that missing raw signal, sourced directly from Backloggd's
// game_log on import. Status itself is still computed on read, not stored.
//
// DesireToPlay is NOT populated by the JSON importer — per spec v1.2
// section 3, it's scoped to the personal-spreadsheet enrichment step (see
// SpreadsheetImporter.ts), a separate import source from the Backloggd
// JSON. Favorite is left to the user to set inside the app; there's no
// equivalent flag in either import source.
//
// TotalHours is also a deliberate addition beyond the literal spec
// appendix: Backloggd's game_log.total_hours (its own aggregate hours
// figure) doesn't always match the sum of that game's individual
// playthroughs' hours_played — confirmed against the real export: 62 of
// 408 games disagree, almost always because some hours were logged at the
// game level without ever being broken into a playthrough. Dropping
// either number would silently lose real historical data (the spec's
// "Historical Accuracy" principle), so both are preserved: this raw
// aggregate here, and the playthrough-level detail in Playthroughs. The
// UI should show whichever is larger for a given game, not just the
// playthrough sum.
//
// StatusRaw stores Backloggd's own status string (completed/abandoned/
// shelved/retired/played) verbatim on import. This was deliberately NOT
// stored in earlier versions of this schema — the spec says "derive
// status, don't store it," which is right in general, but Backloggd's
// status field isn't something to re-derive from scratch: it's a
// deliberate classification the user already made, with real distinctions
// (confirmed directly: abandoned = chose to quit, shelved = intend to
// return, retired = no defined ending and not going back but not disliked
// either, played = no defined ending and still returning depending on
// mood) that a cruder re-derivation from just start/finish dates would
// throw away. GameVault's displayed Status is still computed (see
// StatusService.ts), just primarily FROM this raw field now rather than
// only from playthrough dates.
export const CREATE_USER_GAMES_TABLE = `
CREATE TABLE IF NOT EXISTS UserGames (
    Id TEXT PRIMARY KEY,
    GameId TEXT NOT NULL,
    DateAdded TEXT,
    Favorite INTEGER DEFAULT 0,
    Liked INTEGER DEFAULT 0,
    DesireToPlay INTEGER DEFAULT 0,
    IsWishlist INTEGER DEFAULT 0,
    IsBacklog INTEGER DEFAULT 0,
    IsPlaying INTEGER DEFAULT 0,
    StatusRaw TEXT,
    TotalHours REAL,
    OwnedPlatformId INTEGER,
    OwnedStorefrontId INTEGER,
    Notes TEXT,
    IsManuallyEdited INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (OwnedPlatformId) REFERENCES Platforms(Id),
    FOREIGN KEY (OwnedStorefrontId) REFERENCES Storefronts(Id)
);
`;
// IsManuallyEdited: same protection mechanism as Games.IsManuallyEdited
// above, for the same reason — BackloggdJsonImporter's UserGames upsert
// unconditionally overwrites DateAdded/Liked/IsWishlist/IsBacklog/
// IsPlaying/StatusRaw/TotalHours on every re-import. Once the user edits
// any of this row's fields in-app, the importer's UPDATE is gated on
// this being 0 — protects the whole row, not just the field that was
// actually touched.
// OwnedPlatformId/OwnedStorefrontId: deliberately separate from
// Playthroughs.PlayedPlatformId/StorefrontId, which represent what
// platform/storefront a specific PLAYTHROUGH actually happened on. These
// represent current OWNERSHIP instead — "where do I have access to this
// game right now" — which matters for two reasons a per-playthrough
// field can't cover: (1) backlog games have no playthrough at all yet
// there's nowhere else to record where you'd play them, and (2) ownership
// can change independently of play history (e.g. Dead Cells originally
// via Game Pass, later bought on Steam) — re-importing an updated
// spreadsheet should update this without touching historical playthrough
// records. Populated from the personal spreadsheet's Platform/Storefront
// columns (see SpreadsheetImporter.ts).

export const CREATE_PLAYTHROUGHS_TABLE = `
CREATE TABLE IF NOT EXISTS Playthroughs (
    Id TEXT PRIMARY KEY,
    GameId TEXT NOT NULL,

    Title TEXT,

    StartDate TEXT,
    FinishDate TEXT,

    Rating REAL,

    Review TEXT,

    ReviewSpoilers INTEGER,

    Replay INTEGER,
    Mastered INTEGER,

    HoursPlayed REAL,
    HoursFinished REAL,
    HoursMastered REAL,

    PlayedPlatformId INTEGER,

    AcquisitionMethodId INTEGER,
    StorefrontId INTEGER,

    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (PlayedPlatformId) REFERENCES Platforms(Id),
    FOREIGN KEY (AcquisitionMethodId) REFERENCES AcquisitionMethods(Id),
    FOREIGN KEY (StorefrontId) REFERENCES Storefronts(Id)
);
`;

export const CREATE_PLAY_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS PlaySessions (
    Id TEXT PRIMARY KEY,

    PlaythroughId TEXT NOT NULL,

    SessionDate TEXT,

    Hours REAL,

    Minutes INTEGER,

    Note TEXT,

    FOREIGN KEY (PlaythroughId) REFERENCES Playthroughs(Id)
);
`;

// --- Lookup tables -----------------------------------------------------
// Platforms/Storefronts/AcquisitionMethods are keyed by whatever numeric id
// the source data uses (IGDB platform ids, Backloggd's internal storefront/
// medium ids). Name starts NULL and is filled in later — either by IGDB
// enrichment (for platforms, since IGDB's platform ids are a public,
// resolvable reference) or by the user themselves in Settings (for
// storefront/medium ids, which are Backloggd-internal and undocumented —
// see the importer for why these can't be safely guessed at import time).

export const CREATE_PLATFORMS_TABLE = `
CREATE TABLE IF NOT EXISTS Platforms (
    Id INTEGER PRIMARY KEY,
    Name TEXT UNIQUE,
    CurrentlyOwned INTEGER NOT NULL DEFAULT 0,
    LogoUrl TEXT
);
`;
// Name UNIQUE: the actual structural fix for the platform-duplicate bug
// (not just the mergeDuplicatePlatforms cleanup pass in
// EnrichmentService.ts, which was fighting the symptom). Every other
// lookup table in this schema (Genres, Themes, Collections, etc.) has
// had Name UNIQUE from the start, which is exactly why none of them
// have ever had this problem — getOrCreateNamedLookupId's `INSERT OR
// IGNORE` only actually prevents a duplicate insert *because* of that
// constraint; without it, "OR IGNORE" has nothing to ignore. Platforms
// was the one table storing a real external id (IGDB's numeric id) as
// its primary key instead of a local autoincrement one, so it never got
// this safety net originally — worth noting for any *future* lookup
// table built the same way.
//
// This column definition only helps fresh databases (CREATE TABLE IF
// NOT EXISTS is a no-op on one that already exists) — existing
// databases get the equivalent protection via a UNIQUE INDEX created
// after de-duplicating, see ensurePlatformNameUniqueness() in
// EnrichmentService.ts.
// CurrentlyOwned: added for the Hardware page — "which platforms do I
// currently have working hardware for," distinct from
// UserGames.OwnedPlatformId (which platform a *specific game* is owned
// on) and Playthroughs.PlayedPlatformId (which platform a specific past
// playthrough happened on). Deliberately defaults to 0/false, unlike
// Storefronts.IsCurrentlyActive's default-true: a newly-discovered
// platform (e.g. IGDB enrichment surfacing "Sega Saturn" because some
// game was once released on it) defaulting to "owned" would silently
// mark everything playable and defeat the point of the feature — better
// to start everything unconfirmed and have the user check the hardware
// they actually have than to assume ownership and hide real gaps.
//
// LogoUrl: also added for the Hardware page's shelf visuals — IGDB has a
// real platform_logos endpoint (same image_id/CDN pattern as game cover
// art), so platform logos are sourced the same way covers already are,
// rather than needing some separate image source or hand-picked assets.

export const CREATE_STOREFRONTS_TABLE = `
CREATE TABLE IF NOT EXISTS Storefronts (
    Id INTEGER PRIMARY KEY,
    Name TEXT UNIQUE,
    IsSubscription INTEGER DEFAULT 0,
    IsCurrentlyActive INTEGER DEFAULT 1
);
`;
// Name UNIQUE: same structural fix applied to Platforms and for the same
// reason — Storefronts has the identical dual-creation-path risk
// (BackloggdJsonImporter's ensureLookupRow creates a row by Backloggd's
// own numeric storefront_id with Name left NULL; SpreadsheetImporter's
// getOrCreateStorefrontIdByName creates one by name with a synthetic
// negative id) and, before this fix, no constraint stopping the same
// real-world storefront ending up as two rows. See
// EnrichmentService.ensureStorefrontNameUniqueness for the migration
// path on existing databases (this column definition alone only helps
// fresh ones).
// IsSubscription distinguishes "PS Plus"/"Game Pass"/"Nintendo Switch
// Online" from one-time-purchase storefronts (Steam, GOG, Physical) that
// happen to live in this same table — set automatically by name whenever
// a storefront is resolved (see SpreadsheetImporter.ts), not something
// the user has to flag manually. IsCurrentlyActive is the user's own
// toggle (Settings) for which subscriptions they currently hold — drives
// the "Expired Subscriptions" page (games owned via a subscription
// storefront that's since been unticked). Defaults to 1 (active)
// deliberately: a freshly-labeled subscription storefront shouldn't make
// games look "expired" until the user has actually said they don't have
// it anymore.

export const CREATE_ACQUISITION_METHODS_TABLE = `
CREATE TABLE IF NOT EXISTS AcquisitionMethods (
    Id INTEGER PRIMARY KEY,
    Name TEXT
);
`;

export const CREATE_TAGS_TABLE = `
CREATE TABLE IF NOT EXISTS Tags (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE NOT NULL
);
`;

export const CREATE_GENRES_TABLE = `
CREATE TABLE IF NOT EXISTS Genres (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE NOT NULL
);
`;

export const CREATE_THEMES_TABLE = `
CREATE TABLE IF NOT EXISTS Themes (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE NOT NULL
);
`;

export const CREATE_DEVELOPERS_TABLE = `
CREATE TABLE IF NOT EXISTS Developers (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE NOT NULL
);
`;

export const CREATE_PUBLISHERS_TABLE = `
CREATE TABLE IF NOT EXISTS Publishers (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE NOT NULL
);
`;

// New from the GLIP unification — GLIP's Python-side enrichment was
// already pulling all five of these for every game and storing them as
// flat JSON-array-string columns; normalizing them here (rather than
// carrying that representation forward) matches how Genres/Themes/
// Developers/Publishers already work, so Analytics can query across them
// the same way.
export const CREATE_FRANCHISES_TABLE = `
CREATE TABLE IF NOT EXISTS Franchises (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE NOT NULL
);
`;

export const CREATE_KEYWORDS_TABLE = `
CREATE TABLE IF NOT EXISTS Keywords (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE NOT NULL
);
`;

export const CREATE_COLLECTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS Collections (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE NOT NULL,
    IGDBCollectionId INTEGER,
    SeriesCatalogFetchedAt TEXT
);
`;
// IGDBCollectionId/SeriesCatalogFetchedAt: added for Series Completion.
// The existing GameCollections join only ever links collections to games
// already in the user's library — Series Completion additionally needs
// IGDB's own collection id (to query "every game IGDB lists under this
// collection", not just the ones already owned) and a timestamp so the
// UI can show when a series' full catalog was last refreshed rather than
// re-fetching on every view.

export const CREATE_GAME_MODES_TABLE = `
CREATE TABLE IF NOT EXISTS GameModes (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE NOT NULL
);
`;

export const CREATE_PLAYER_PERSPECTIVES_TABLE = `
CREATE TABLE IF NOT EXISTS PlayerPerspectives (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    Name TEXT UNIQUE NOT NULL
);
`;

// --- Join tables ---------------------------------------------------------

export const CREATE_USER_GAME_TAGS_TABLE = `
CREATE TABLE IF NOT EXISTS UserGameTags (
    UserGameId TEXT NOT NULL,
    TagId INTEGER NOT NULL,
    PRIMARY KEY (UserGameId, TagId),
    FOREIGN KEY (UserGameId) REFERENCES UserGames(Id),
    FOREIGN KEY (TagId) REFERENCES Tags(Id)
);
`;

export const CREATE_GAME_GENRES_TABLE = `
CREATE TABLE IF NOT EXISTS GameGenres (
    GameId TEXT NOT NULL,
    GenreId INTEGER NOT NULL,
    PRIMARY KEY (GameId, GenreId),
    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (GenreId) REFERENCES Genres(Id)
);
`;

export const CREATE_GAME_THEMES_TABLE = `
CREATE TABLE IF NOT EXISTS GameThemes (
    GameId TEXT NOT NULL,
    ThemeId INTEGER NOT NULL,
    PRIMARY KEY (GameId, ThemeId),
    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (ThemeId) REFERENCES Themes(Id)
);
`;

export const CREATE_GAME_DEVELOPERS_TABLE = `
CREATE TABLE IF NOT EXISTS GameDevelopers (
    GameId TEXT NOT NULL,
    DeveloperId INTEGER NOT NULL,
    PRIMARY KEY (GameId, DeveloperId),
    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (DeveloperId) REFERENCES Developers(Id)
);
`;

export const CREATE_GAME_PUBLISHERS_TABLE = `
CREATE TABLE IF NOT EXISTS GamePublishers (
    GameId TEXT NOT NULL,
    PublisherId INTEGER NOT NULL,
    PRIMARY KEY (GameId, PublisherId),
    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (PublisherId) REFERENCES Publishers(Id)
);
`;

export const CREATE_GAME_FRANCHISES_TABLE = `
CREATE TABLE IF NOT EXISTS GameFranchises (
    GameId TEXT NOT NULL,
    FranchiseId INTEGER NOT NULL,
    PRIMARY KEY (GameId, FranchiseId),
    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (FranchiseId) REFERENCES Franchises(Id)
);
`;

export const CREATE_GAME_KEYWORDS_TABLE = `
CREATE TABLE IF NOT EXISTS GameKeywords (
    GameId TEXT NOT NULL,
    KeywordId INTEGER NOT NULL,
    PRIMARY KEY (GameId, KeywordId),
    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (KeywordId) REFERENCES Keywords(Id)
);
`;

export const CREATE_GAME_COLLECTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS GameCollections (
    GameId TEXT NOT NULL,
    CollectionId INTEGER NOT NULL,
    PRIMARY KEY (GameId, CollectionId),
    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (CollectionId) REFERENCES Collections(Id)
);
`;

export const CREATE_GAME_GAME_MODES_TABLE = `
CREATE TABLE IF NOT EXISTS GameGameModes (
    GameId TEXT NOT NULL,
    GameModeId INTEGER NOT NULL,
    PRIMARY KEY (GameId, GameModeId),
    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (GameModeId) REFERENCES GameModes(Id)
);
`;

export const CREATE_GAME_PLAYER_PERSPECTIVES_TABLE = `
CREATE TABLE IF NOT EXISTS GamePlayerPerspectives (
    GameId TEXT NOT NULL,
    PlayerPerspectiveId INTEGER NOT NULL,
    PRIMARY KEY (GameId, PlayerPerspectiveId),
    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (PlayerPerspectiveId) REFERENCES PlayerPerspectives(Id)
);
`;

export const CREATE_GAME_PLATFORMS_TABLE = `
CREATE TABLE IF NOT EXISTS GamePlatforms (
    GameId TEXT NOT NULL,
    PlatformId INTEGER NOT NULL,
    PRIMARY KEY (GameId, PlatformId),
    FOREIGN KEY (GameId) REFERENCES Games(Id),
    FOREIGN KEY (PlatformId) REFERENCES Platforms(Id)
);
`;

// --- Indexes ---------------------------------------------------------
// Per spec appendix "Recommended Indexes".

export const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_games_igdbid ON Games(IGDBId);
CREATE INDEX IF NOT EXISTS idx_games_title ON Games(Title);
CREATE INDEX IF NOT EXISTS idx_playthroughs_gameid ON Playthroughs(GameId);
CREATE INDEX IF NOT EXISTS idx_playthroughs_startdate ON Playthroughs(StartDate);
CREATE INDEX IF NOT EXISTS idx_playsessions_playthroughid ON PlaySessions(PlaythroughId);
CREATE INDEX IF NOT EXISTS idx_playsessions_sessiondate ON PlaySessions(SessionDate);
CREATE INDEX IF NOT EXISTS idx_usergames_favorite ON UserGames(Favorite);
CREATE INDEX IF NOT EXISTS idx_usergames_desiretoplay ON UserGames(DesireToPlay);
CREATE INDEX IF NOT EXISTS idx_usergames_gameid ON UserGames(GameId);
`;

// --- Series Completion -----------------------------------------------
//
// SeriesCatalogGames: a cached copy of every game IGDB lists as a member
// of a given collection — including ones the user doesn't own at all.
// This is what makes it possible to show a series' unowned entries
// grayed out rather than only ever displaying games already in the
// library: GameCollections (above) only ever links a collection to games
// GameVault already knows about, which is the wrong data for "show me
// everything in this series." Fetched on demand (an explicit refresh,
// not automatic on every enrichment run) via SeriesService.ts, and
// cached like everything else in this schema rather than re-queried live
// on every view — series membership changes rarely.
//
// IGDBCategory/IGDBParentGameId mirror the same fields on Games, for the
// same reason: a catalog entry that's itself a remake/remaster of
// another catalog entry (e.g. both "Dark Souls" and "Dark Souls:
// Remastered" being separately listed under the Dark Souls Collection)
// needs to collapse into one canonical slot rather than displaying as
// two, which is exactly the "is DS1 Remastered = DS1" question this
// feature exists to answer automatically where IGDB's data allows it.
export const CREATE_SERIES_CATALOG_GAMES_TABLE = `
CREATE TABLE IF NOT EXISTS SeriesCatalogGames (
    CollectionId INTEGER NOT NULL,
    IGDBGameId INTEGER NOT NULL,
    Title TEXT NOT NULL,
    ReleaseYear INTEGER,
    CoverArtUrl TEXT,
    IGDBCategory INTEGER,
    IGDBParentGameId INTEGER,
    PRIMARY KEY (CollectionId, IGDBGameId),
    FOREIGN KEY (CollectionId) REFERENCES Collections(Id)
);
`;

// GameSeriesOverrides: manual equivalence, for whenever IGDB's own
// parent_game/version_parent/category data doesn't capture a real
// equivalence (or gets it wrong). One row per local game that the user
// has explicitly said satisfies a specific canonical IGDB game id's slot
// — e.g. an unusual regional re-release IGDB doesn't formally link back
// to the original. Automatic detection (Games.IGDBParentGameId /
// IGDBVersionParentId) always applies first; this is the escape hatch
// layered on top, not a replacement for it.
export const CREATE_GAME_SERIES_OVERRIDES_TABLE = `
CREATE TABLE IF NOT EXISTS GameSeriesOverrides (
    GameId TEXT PRIMARY KEY,
    CanonicalIGDBGameId INTEGER NOT NULL,
    FOREIGN KEY (GameId) REFERENCES Games(Id)
);
`;

// DetectedGameOverrides: manual matches for the Hardware page's
// Installed & ROMs scan, for whenever the automatic normalized-title
// match either misses (title genuinely differs, e.g. a ROM filename
// abbreviation) or gets it wrong. SourceId is whatever uniquely
// identifies the detected item within its SourceType — a Steam appid,
// an Epic AppName, or a ROM's full file path. Scan results aren't
// persisted anywhere (recomputed live on every "Scan Now" click), but
// this override table is, so a manual match made once keeps applying
// on every future scan without needing to be redone.
export const CREATE_DETECTED_GAME_OVERRIDES_TABLE = `
CREATE TABLE IF NOT EXISTS DetectedGameOverrides (
    SourceType TEXT NOT NULL,
    SourceId TEXT NOT NULL,
    GameId TEXT NOT NULL,
    PRIMARY KEY (SourceType, SourceId),
    FOREIGN KEY (GameId) REFERENCES Games(Id)
);
`;

// InstalledGameStatus: a point-in-time snapshot of "as of the last
// Hardware page scan, these games were actually found installed"
// (Steam, Epic, or a matched ROM). Written by Hardware.tsx right after
// a scan completes, using the same matched results (including manual
// overrides) the Hardware page itself displays — this is what lets the
// Recommendations page's Installed tab show the same data without
// needing to re-run a filesystem scan itself. Fully replaced (DELETE
// then re-INSERT) on every scan rather than merged, since "installed"
// is inherently a snapshot — a game uninstalled since the last scan
// should stop showing up, not linger as stale data.
export const CREATE_INSTALLED_GAME_STATUS_TABLE = `
CREATE TABLE IF NOT EXISTS InstalledGameStatus (
    GameId TEXT PRIMARY KEY,
    Source TEXT NOT NULL,
    DetectedAt TEXT NOT NULL,
    FOREIGN KEY (GameId) REFERENCES Games(Id)
);
`;

// ComfortRatings: explicit user-set "how much of a comfort game is
// this" score (1-5), collected via the Recommendations page's Comfort
// Quiz — a real, user-stated signal rather than inferring comfort
// purely from star rating/Favorite/Liked, which conflates "I rated this
// highly" with "this specifically feels cozy" (a game can be a 9/10 and
// not remotely a comfort pick, e.g. a great but intense horror game).
// See RecommendationsService.ts's getComfortPicks for how this and the
// older heuristic combine: an explicit score always wins over the
// heuristic for a game that has one.
export const CREATE_COMFORT_RATINGS_TABLE = `
CREATE TABLE IF NOT EXISTS ComfortRatings (
    GameId TEXT PRIMARY KEY,
    ComfortScore INTEGER NOT NULL,
    FOREIGN KEY (GameId) REFERENCES Games(Id)
);
`;

export const CREATE_APP_SETTINGS_TABLE = `
CREATE TABLE IF NOT EXISTS AppSettings (
    Key TEXT PRIMARY KEY,
    Value TEXT
);
`;

// From the GLIP unification. Features holds the ML feature vector per
// game — the affinity scores are pulled into real columns (rather than
// left inside the JSON blob) specifically so they can be recalculated
// individually later without needing to touch the rest of the vector.
// The remaining one-hot/embedding-style fields don't have the same case
// for individual columns (there's no reason to ever query "just the
// horror-genre one-hot bit" on its own the way you might want to sort by
// GenreAffinity), so they stay in FeatureJson.
export const CREATE_FEATURES_TABLE = `
CREATE TABLE IF NOT EXISTS Features (
    GameId TEXT PRIMARY KEY,
    GenreAffinity REAL,
    ThemeAffinity REAL,
    DeveloperAffinity REAL,
    PublisherAffinity REAL,
    FranchiseAffinity REAL,
    FeatureJson TEXT,
    ComputedAt TEXT,
    FOREIGN KEY (GameId) REFERENCES Games(Id)
);
`;

// Output of GLIP's trained models — predicted rating/completion/replay/
// engagement plus a combined recommendation score and a SHAP-based
// explanation, one row per game (in practice, populated only for the
// backlog: games you haven't settled an outcome on yet).
export const CREATE_RECOMMENDATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS Recommendations (
    GameId TEXT PRIMARY KEY,
    PredictedRating REAL,
    PredictedCompletionProb REAL,
    PredictedReplayProb REAL,
    PredictedEngagement REAL,
    RecommendationScore REAL,
    ExplanationJson TEXT,
    GeneratedAt TEXT,
    FOREIGN KEY (GameId) REFERENCES Games(Id)
);
`;

/**
 * Confirmed directly (not guessed): 0=Owned, 1=Watched, 2=Borrowed,
 * 3=Subscription. Unlike storefront_id, medium_id has a real, known
 * answer, so it's seeded here rather than routed through the manual-
 * labeling flow. Lives in schema.ts (not EnrichmentService.ts) because
 * it's static seed data with no IGDB dependency — keeping it here means
 * database.ts's initialization doesn't need to import anything that
 * pulls in the HTTP plugin just to seed four rows.
 */
const KNOWN_ACQUISITION_METHODS: Record<number, string> = {
  0: "Owned",
  1: "Watched",
  2: "Borrowed",
  3: "Subscription",
};

export async function seedKnownAcquisitionMethods(client: {
  execute(query: string, values?: unknown[]): Promise<unknown>;
}): Promise<void> {
  for (const [id, name] of Object.entries(KNOWN_ACQUISITION_METHODS)) {
    await client.execute(`INSERT OR IGNORE INTO AcquisitionMethods (Id, Name) VALUES (?, ?)`, [Number(id), name]);
    await client.execute(`UPDATE AcquisitionMethods SET Name = ? WHERE Id = ? AND Name IS NULL`, [name, Number(id)]);
  }
}

// Order matters: tables referenced by foreign keys must be created first.
export const ALL_TABLE_STATEMENTS = [
  CREATE_GAMES_TABLE,
  CREATE_PLATFORMS_TABLE,
  CREATE_STOREFRONTS_TABLE,
  CREATE_ACQUISITION_METHODS_TABLE,
  CREATE_TAGS_TABLE,
  CREATE_GENRES_TABLE,
  CREATE_THEMES_TABLE,
  CREATE_DEVELOPERS_TABLE,
  CREATE_PUBLISHERS_TABLE,
  CREATE_FRANCHISES_TABLE,
  CREATE_KEYWORDS_TABLE,
  CREATE_COLLECTIONS_TABLE,
  CREATE_GAME_MODES_TABLE,
  CREATE_PLAYER_PERSPECTIVES_TABLE,
  CREATE_USER_GAMES_TABLE,
  CREATE_PLAYTHROUGHS_TABLE,
  CREATE_PLAY_SESSIONS_TABLE,
  CREATE_USER_GAME_TAGS_TABLE,
  CREATE_GAME_GENRES_TABLE,
  CREATE_GAME_THEMES_TABLE,
  CREATE_GAME_DEVELOPERS_TABLE,
  CREATE_GAME_PUBLISHERS_TABLE,
  CREATE_GAME_FRANCHISES_TABLE,
  CREATE_GAME_KEYWORDS_TABLE,
  CREATE_GAME_COLLECTIONS_TABLE,
  CREATE_GAME_GAME_MODES_TABLE,
  CREATE_GAME_PLAYER_PERSPECTIVES_TABLE,
  CREATE_GAME_PLATFORMS_TABLE,
  CREATE_SERIES_CATALOG_GAMES_TABLE,
  CREATE_GAME_SERIES_OVERRIDES_TABLE,
  CREATE_DETECTED_GAME_OVERRIDES_TABLE,
  CREATE_INSTALLED_GAME_STATUS_TABLE,
  CREATE_COMFORT_RATINGS_TABLE,
  CREATE_APP_SETTINGS_TABLE,
  CREATE_FEATURES_TABLE,
  CREATE_RECOMMENDATIONS_TABLE,
];

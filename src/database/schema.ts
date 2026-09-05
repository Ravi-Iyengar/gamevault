export const CREATE_GAMES_TABLE = `
CREATE TABLE IF NOT EXISTS Games (
    Id TEXT PRIMARY KEY,
    IGDBId INTEGER UNIQUE,
    Title TEXT NOT NULL,
    ReleaseDate TEXT,
    ReleaseYear INTEGER,
    Summary TEXT
);
`;
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
    StorefrontId INTEGER
);
`;
export const CREATE_PLAY_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS PlaySessions (
    Id TEXT PRIMARY KEY,

    PlaythroughId TEXT NOT NULL,

    SessionDate TEXT,

    Hours REAL,

    Minutes INTEGER,

    Note TEXT
);
`;
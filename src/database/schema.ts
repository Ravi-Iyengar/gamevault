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
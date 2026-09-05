import Database from "@tauri-apps/plugin-sql";

import {
  CREATE_GAMES_TABLE,
  CREATE_PLAYTHROUGHS_TABLE,
  CREATE_PLAY_SESSIONS_TABLE,
} from "./schema";

let db: any = null;

export async function initializeDatabase() {
  try {
    if (db) return;

    db = await Database.load("sqlite:gamevault.db");

    await db.execute(CREATE_GAMES_TABLE);
    await db.execute(CREATE_PLAYTHROUGHS_TABLE);
    await db.execute(CREATE_PLAY_SESSIONS_TABLE);

    console.log("GameVault database initialized");
  } catch (error) {
    console.error("Database initialization failed:", error);
    throw error;
  }
}

export async function getDatabase() {
  if (!db) {
    await initializeDatabase();
  }

  return db;
}

export async function executeQuery(
  query: string,
  values: any[] = []
) {
  const database = await getDatabase();

  return database.execute(query, values);
}

export async function selectQuery(
  query: string,
  values: any[] = []
) {
  const database = await getDatabase();

  return database.select(query, values);
}

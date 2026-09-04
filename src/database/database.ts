import Database from "@tauri-apps/plugin-sql";
import { CREATE_GAMES_TABLE } from "./schema";

let db: any = null;

export async function initializeDatabase() {
  try {
    if (db) return;

    db = await Database.load("sqlite:gamevault.db");

    await db.execute(CREATE_GAMES_TABLE);

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
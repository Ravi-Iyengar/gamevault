import Database from "@tauri-apps/plugin-sql";
import { CREATE_GAMES_TABLE } from "./schema";

let db: any = null;

export async function initializeDatabase() {
  if (db) return;

  db = await Database.load("sqlite:gamevault.db");

  await db.execute(CREATE_GAMES_TABLE);

  alert("Database initialized");;
}

export async function getDatabase() {
  if (!db) {
    await initializeDatabase();
  }

  return db;
}
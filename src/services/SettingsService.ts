import { getDatabase } from "../database/database";

/**
 * Simple local key-value store for app configuration — currently just the
 * IGDB/Twitch API credentials. Deliberately NOT hardcoded anywhere in
 * source: the user enters them once in Settings, and they're stored only
 * in the local SQLite database (never committed, never sent anywhere
 * except directly to Twitch/IGDB for the credentials' own purpose).
 */

export const SETTINGS_KEYS = {
  IGDB_CLIENT_ID: "igdb_client_id",
  IGDB_CLIENT_SECRET: "igdb_client_secret",
  GLIP_PROJECT_PATH: "glip_project_path",
  GLIP_PYTHON_PATH: "glip_python_path",
  STEAM_PATH_OVERRIDE: "steam_path_override",
  ROM_FOLDERS: "rom_folders", // JSON-stringified string[] — see getRomFolders/setRomFolders below
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDatabase();
  const rows = await db.select<{ Value: string | null }>(
    "SELECT Value FROM AppSettings WHERE Key = ?",
    [key]
  );
  return rows[0]?.Value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `
    INSERT INTO AppSettings (Key, Value) VALUES (?, ?)
    ON CONFLICT(Key) DO UPDATE SET Value = excluded.Value
    `,
    [key, value]
  );
}

export async function getIgdbCredentials(): Promise<{ clientId: string; clientSecret: string } | null> {
  const clientId = await getSetting(SETTINGS_KEYS.IGDB_CLIENT_ID);
  const clientSecret = await getSetting(SETTINGS_KEYS.IGDB_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** ROM folders is the one setting here that's a list, not a plain
 * string — supports multiple folders (e.g. one per drive) rather than
 * a single configured path. */
export async function getRomFolders(): Promise<string[]> {
  const raw = await getSetting(SETTINGS_KEYS.ROM_FOLDERS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

export async function setRomFolders(folders: string[]): Promise<void> {
  await setSetting(SETTINGS_KEYS.ROM_FOLDERS, JSON.stringify(folders));
}

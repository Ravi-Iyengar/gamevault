import { fetch } from "@tauri-apps/plugin-http";

/**
 * IGDB API client (v4), via Twitch OAuth client_credentials.
 *
 * Uses @tauri-apps/plugin-http's fetch rather than the browser's built-in
 * fetch. This isn't a style choice — IGDB's API has no CORS headers for
 * arbitrary browser origins (it's designed for server-side use), so a
 * plain `fetch()` call from the React frontend would be blocked by the
 * browser's CORS policy regardless of this app's own CSP settings. The
 * Tauri http plugin routes the request through the Rust process instead,
 * which isn't subject to the browser's CORS model at all — this is Tauri's
 * own documented solution for exactly this situation.
 *
 * The auth flow, rate limiting (4 req/s, IGDB's documented limit), and
 * Apicalypse query shape mirror the Python IGDB client already built and
 * verified against real IGDB traffic for GLIP (the sibling project) —
 * same account, same API, same constraints. What's NOT verified: this
 * TypeScript port has never actually been run against the network, since
 * this sandbox has neither a Rust toolchain nor internet access. The auth
 * flow and query shape should be correct, but this file is the one most
 * worth testing first when you actually run the app.
 */

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_BASE_URL = "https://api.igdb.com/v4";
const MIN_MS_BETWEEN_REQUESTS = 300; // IGDB's documented limit is 4 req/s; a small safety margin under that.

export interface IgdbGame {
  id: number;
  name?: string;
  genres?: { name: string }[];
  themes?: { name: string }[];
  franchises?: { name: string }[];
  keywords?: { name: string }[];
  collections?: { id: number; name: string }[];
  game_modes?: { name: string }[];
  player_perspectives?: { name: string }[];
  involved_companies?: {
    developer?: boolean;
    publisher?: boolean;
    company?: { name: string };
  }[];
  first_release_date?: number;
  aggregated_rating?: number;
  aggregated_rating_count?: number;
  rating?: number;
  rating_count?: number;
  cover?: { image_id: string };
  // Only ever requested by searchGamesByTitle below (a search result
  // showing which platforms a game is on helps disambiguate same-named
  // games) — no other query on this client asks for it.
  platforms?: { name: string }[];
  // Series Completion fields — see the comment on Games.IGDBCategory in
  // schema.ts. `category` and the two parent fields are scalar/bare
  // relation fields (no dot-expansion), so IGDB returns them as plain
  // numbers directly on the game, not nested objects.
  category?: number;
  parent_game?: number;
  version_parent?: number;
}

/** A single game as listed under an IGDB collection — the shape returned
 * by the `games.*` sub-fields on a /collections query, distinct from the
 * fuller IgdbGame shape above (this is deliberately a smaller field set:
 * Series Completion only needs enough to display and to resolve
 * equivalence, not full enrichment data for games the user may not even
 * own). */
export interface IgdbCollectionMember {
  id: number;
  name?: string;
  first_release_date?: number;
  cover?: { image_id: string };
  category?: number;
  parent_game?: number;
}

export interface IgdbCollectionWithGames {
  id: number;
  name?: string;
  games?: IgdbCollectionMember[];
}

export interface IgdbTimeToBeat {
  game_id: number;
  hastily?: number;
  normally?: number;
  completely?: number;
  count?: number;
}

export class IgdbClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private lastRequestAt = 0;

  constructor(private clientId: string, private clientSecret: string) {}

  private async ensureToken(): Promise<void> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) return;

    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
    });

    const response = await fetch(`${TWITCH_TOKEN_URL}?${params.toString()}`, { method: "POST" });
    if (!response.ok) {
      throw new Error(`Twitch token request failed (${response.status}): ${await response.text()}`);
    }

    const payload = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = payload.access_token;
    // Refresh a little early rather than exactly at expiry.
    this.tokenExpiresAt = Date.now() + (payload.expires_in - 60) * 1000;
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < MIN_MS_BETWEEN_REQUESTS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_MS_BETWEEN_REQUESTS - elapsed));
    }
  }

  /**
   * Fetches metadata for a batch of IGDB ids (max 500 per IGDB's own
   * per-request limit). Ids not found on IGDB simply won't appear in the
   * returned array — that's IGDB's own behavior, not an error condition.
   */
  async getGamesByIds(igdbIds: number[]): Promise<IgdbGame[]> {
    await this.ensureToken();
    await this.throttle();

    const query = `
      fields name, genres.name, themes.name, franchises.name,
        keywords.name, collections.id, collections.name, game_modes.name, player_perspectives.name,
        involved_companies.company.name, involved_companies.developer, involved_companies.publisher,
        first_release_date, aggregated_rating, aggregated_rating_count, rating, rating_count, cover.image_id,
        category, parent_game, version_parent;
      where id = (${igdbIds.join(",")});
      limit 500;
    `;

    this.lastRequestAt = Date.now();
    const response = await fetch(`${IGDB_BASE_URL}/games`, {
      method: "POST",
      headers: {
        "Client-ID": this.clientId,
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
      body: query,
    });

    if (!response.ok) {
      throw new Error(`IGDB query failed (${response.status}): ${await response.text()}`);
    }

    return (await response.json()) as IgdbGame[];
  }

  /**
   * Free-text search by title — for the "Add Game" flow, where there's
   * no IGDB id yet to look up (that's the whole point of searching).
   * Every other method on this client is id-based; this is the first
   * one that isn't.
   *
   * Uses IGDB's `search "..."` Apicalypse keyword rather than a `where
   * name ~ *"..."*` filter — confirmed via IGDB API documentation and
   * multiple third-party wrapper libraries before writing this, not
   * guessed. Two things specific to `search` worth knowing: results
   * come back already ranked by relevance, and — confirmed by more than
   * one source — `search` doesn't work combined with a `sort` clause,
   * which is why there isn't one here.
   */
  async searchGamesByTitle(title: string, limit = 10): Promise<IgdbGame[]> {
    await this.ensureToken();
    await this.throttle();

    const escaped = title.replace(/"/g, '\\"');
    const query = `
      search "${escaped}";
      fields name, first_release_date, cover.image_id, platforms.name,
        genres.name, category, parent_game;
      limit ${limit};
    `;

    this.lastRequestAt = Date.now();
    const response = await fetch(`${IGDB_BASE_URL}/games`, {
      method: "POST",
      headers: {
        "Client-ID": this.clientId,
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
      body: query,
    });

    if (!response.ok) {
      throw new Error(`IGDB search failed (${response.status}): ${await response.text()}`);
    }

    return (await response.json()) as IgdbGame[];
  }

  /**
   * Fetches platform names (and logos, for the Hardware page's shelf
   * visuals) for a batch of IGDB platform ids. Platform ids are a
   * public, resolvable IGDB reference (unlike storefront/medium ids,
   * which are Backloggd-internal and have no such reference) — this is
   * why platforms get resolved automatically here rather than needing
   * the same manual labeling flow storefronts do.
   */
  async getPlatformsByIds(
    platformIds: number[]
  ): Promise<{ id: number; name: string; logoImageId?: string }[]> {
    await this.ensureToken();
    await this.throttle();

    const query = `
      fields name, platform_logo.image_id;
      where id = (${platformIds.join(",")});
      limit 500;
    `;

    this.lastRequestAt = Date.now();
    const response = await fetch(`${IGDB_BASE_URL}/platforms`, {
      method: "POST",
      headers: {
        "Client-ID": this.clientId,
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
      body: query,
    });

    if (!response.ok) {
      throw new Error(`IGDB platforms query failed (${response.status}): ${await response.text()}`);
    }

    const raw = (await response.json()) as { id: number; name: string; platform_logo?: { image_id: string } }[];
    return raw.map((p) => ({ id: p.id, name: p.name, logoImageId: p.platform_logo?.image_id }));
  }

  /**
   * Fetches time-to-beat data for a batch of IGDB game ids from the
   * separate `game_time_to_beats` endpoint (not part of the main /games
   * response — a distinct query). `game_id` here is a plain integer field
   * on that endpoint, not a relation, so no `.` expansion is needed —
   * confirmed directly against IGDB's own published proto schema
   * (api.igdb.com/v4/igdbapi.proto) rather than assumed from a
   * third-party wrapper.
   *
   * UNVERIFIED (flagging honestly rather than guessing silently): the
   * proto only specifies these as int32, not their units. Every hour-like
   * duration elsewhere in IGDB's API is stored in seconds, and community
   * reports of this specific endpoint describe the same "why is this
   * 72000?" pattern — hastilyHours()/normallyHours()/completelyHours()
   * below divide by 3600 on that basis. This is the one thing most worth
   * checking against a real game you know the length of on first run —
   * if a well-known ~20-hour game comes back reading ~20 instead of an
   * absurd number, the seconds assumption was right.
   */
  async getTimeToBeatByGameIds(igdbIds: number[]): Promise<IgdbTimeToBeat[]> {
    await this.ensureToken();
    await this.throttle();

    const query = `
      fields game_id, hastily, normally, completely, count;
      where game_id = (${igdbIds.join(",")});
      limit 500;
    `;

    this.lastRequestAt = Date.now();
    const response = await fetch(`${IGDB_BASE_URL}/game_time_to_beats`, {
      method: "POST",
      headers: {
        "Client-ID": this.clientId,
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
      body: query,
    });

    if (!response.ok) {
      throw new Error(`IGDB time-to-beat query failed (${response.status}): ${await response.text()}`);
    }

    return (await response.json()) as IgdbTimeToBeat[];
  }

  /**
   * Fetches, for each given IGDB collection id, the full list of games
   * IGDB lists as members — including games the user has never imported
   * or owned at all. This is deliberately a different query from
   * getGamesByIds above: that one enriches games already in the
   * library; this one is a discovery/browse query for Series Completion,
   * which needs to know what a complete series looks like, not just
   * what's already been imported.
   */
  async getCollectionsWithGames(igdbCollectionIds: number[]): Promise<IgdbCollectionWithGames[]> {
    await this.ensureToken();
    await this.throttle();

    const query = `
      fields name, games.name, games.first_release_date, games.cover.image_id,
        games.category, games.parent_game;
      where id = (${igdbCollectionIds.join(",")});
      limit 500;
    `;

    this.lastRequestAt = Date.now();
    const response = await fetch(`${IGDB_BASE_URL}/collections`, {
      method: "POST",
      headers: {
        "Client-ID": this.clientId,
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
      },
      body: query,
    });

    if (!response.ok) {
      throw new Error(`IGDB collections query failed (${response.status}): ${await response.text()}`);
    }

    return (await response.json()) as IgdbCollectionWithGames[];
  }
}

const SECONDS_PER_HOUR = 3600;

/** See the UNVERIFIED note on getTimeToBeatByGameIds — converts assuming
 * seconds. Returns null rather than 0 for missing data, since 0 hours is
 * a real (if rare) possible value and shouldn't be conflated with "IGDB
 * has no data for this game." */
export function secondsToHours(seconds: number | null | undefined): number | null {
  if (seconds === null || seconds === undefined) return null;
  return Math.round((seconds / SECONDS_PER_HOUR) * 10) / 10;
}

/** Builds the actual cover image URL from IGDB's image_id. t_cover_big is
 * a good balance of quality vs size for a library grid; IGDB also offers
 * t_1080p for a larger version if the detail page wants one later. */
export function igdbCoverUrl(imageId: string, size: "t_cover_big" | "t_1080p" = "t_cover_big"): string {
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}

/** Platform logos specifically use IGDB's t_logo_med size preset and are
 * requested as PNG rather than JPG — most platform logos have a
 * transparent background (alpha_channel), which JPG can't represent and
 * would otherwise flatten to a solid (likely white) box that looks wrong
 * against the app's dark background. */
export function igdbPlatformLogoUrl(imageId: string): string {
  return `https://images.igdb.com/igdb/image/upload/t_logo_med/${imageId}.png`;
}

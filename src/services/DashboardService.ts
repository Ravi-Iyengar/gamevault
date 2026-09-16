import { selectQuery } from "../database/database";

export interface RecentCompletion {
  gameId: string;
  title: string;
  coverArtUrl: string | null;
  finishDate: string;
  rating: number | null;
}

export async function getRecentCompletions(limit = 5): Promise<RecentCompletion[]> {
  return selectQuery<RecentCompletion>(
    `
    SELECT g.Id AS gameId, g.Title AS title, g.CoverArtUrl AS coverArtUrl, p.FinishDate AS finishDate, p.Rating AS rating
    FROM Playthroughs p
    JOIN Games g ON g.Id = p.GameId
    WHERE p.FinishDate IS NOT NULL
    ORDER BY p.FinishDate DESC
    LIMIT ?
    `,
    [limit]
  );
}

export async function getHoursThisMonth(): Promise<number> {
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const rows = await selectQuery<{ total: number | null }>(
    `
    SELECT SUM(COALESCE(Hours, 0) + COALESCE(Minutes, 0) / 60.0) AS total
    FROM PlaySessions
    WHERE SessionDate LIKE ? || '%'
    `,
    [monthPrefix]
  );
  return rows[0]?.total ?? 0;
}

/**
 * Current gaming streak: consecutive days (ending today or yesterday —
 * a day off doesn't reset "current" retroactively past yesterday) with
 * at least one logged session. A simplified version of the spec's
 * "Gaming Streaks" — full calendar heatmaps are a documented follow-up,
 * not built here (see README).
 */
export async function getCurrentStreak(): Promise<number> {
  const rows = await selectQuery<{ day: string }>(
    `SELECT DISTINCT date(SessionDate) AS day FROM PlaySessions WHERE SessionDate IS NOT NULL ORDER BY day DESC`
  );
  if (rows.length === 0) return 0;

  const days = rows.map((r) => new Date(r.day).getTime());
  const oneDayMs = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const mostRecent = days[0];
  if (today.getTime() - mostRecent > oneDayMs) return 0; // most recent session was before yesterday

  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i - 1] - days[i] === oneDayMs) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

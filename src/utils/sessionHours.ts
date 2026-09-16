/**
 * Backloggd lets a session be logged with a date but no duration — many
 * playthroughs have their real hours recorded only at the aggregate level
 * (Playthroughs.HoursPlayed / UserGames.TotalHours), with individual
 * PlaySessions rows showing 0 for some or all sessions. That's not
 * missing data so much as differently-granular data: the user logged
 * *that they played* on those dates without logging *how long* each
 * time, sometimes for every session in a playthrough and sometimes only
 * for some of them (logging habits changing partway through is common).
 *
 * This never overwrites PlaySessions.Hours — same principle as
 * effectiveRating() in ratings.ts. The raw zeros stay exactly as
 * Backloggd recorded them; anything that needs a usable per-session
 * estimate (the weekday-activity chart, the session calendar, Time
 * Gallery's per-quarter hours) asks for it explicitly through this
 * function instead.
 *
 * Estimate: kicks in whenever the playthrough has a real total AND at
 * least one zero-duration session. The leftover — total minus whatever's
 * already accounted for by sessions with real logged hours — is split
 * evenly across just the zero sessions. When every session is zero,
 * that's the whole total split evenly (the original behavior); when
 * only some are, the ones with real hours are left untouched and only
 * the gap gets distributed. This replaced an earlier all-or-nothing gate
 * that only filled in a playthrough if literally every session was zero,
 * leaving partially-logged playthroughs' zero sessions understated at a
 * flat 0h — not claimed to be accurate for any single day either way,
 * only "good enough on average" across something that aggregates many
 * sessions (a chart, or a Time Gallery quarter).
 */

export interface SessionLike {
  hours: number | null;
  minutes: number | null;
}

/**
 * Returns estimated hours per session, in the same order as `sessions`.
 * `playthroughTotalHours` should be the playthrough's authoritative total
 * (ideally the same MAX(playthrough sum, UserGames.TotalHours) figure
 * used elsewhere — see GameService's comment on that).
 */
export function estimateSessionHours(
  sessions: SessionLike[],
  playthroughTotalHours: number | null
): number[] {
  if (sessions.length === 0) return [];

  const rawHours = sessions.map((s) => (s.hours ?? 0) + (s.minutes ?? 0) / 60);
  const hasRealTotal = playthroughTotalHours !== null && playthroughTotalHours > 0;
  if (!hasRealTotal) return rawHours;

  const zeroIndices: number[] = [];
  let knownTotal = 0;
  rawHours.forEach((h, i) => {
    if (h === 0) zeroIndices.push(i);
    else knownTotal += h;
  });
  if (zeroIndices.length === 0) return rawHours; // every session already has a real duration logged

  const remaining = Math.max((playthroughTotalHours as number) - knownTotal, 0);
  const perZeroSession = remaining / zeroIndices.length;
  return rawHours.map((h) => (h === 0 ? perZeroSession : h));
}

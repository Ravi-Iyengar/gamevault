import { useMemo, useState } from "react";
import { PlaySession } from "../types/playSession";

interface Props {
  sessions: PlaySession[];
  selectedSession: PlaySession | null;
  onSelectSession: (session: PlaySession) => void;
}

const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

/**
 * Replaces the old flat wrapped-row-of-buttons session list, which
 * became an unreadable wall of numbers for any game with a lot of
 * sessions (Warframe has hundreds) — no month or year grouping at all,
 * so a "23" in the list gave no way to tell which month or year it was
 * actually from without clicking through every one.
 */
export default function SessionCalendar({ sessions, selectedSession, onSelectSession }: Props) {
  const sessionsByDay = useMemo(() => {
    const map = new Map<string, PlaySession[]>();
    for (const s of sessions) {
      if (!s.sessionDate) continue;
      const day = s.sessionDate.slice(0, 10); // "YYYY-MM-DD"
      const existing = map.get(day) ?? [];
      existing.push(s);
      map.set(day, existing);
    }
    return map;
  }, [sessions]);

  const monthsWithSessions = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      if (s.sessionDate) set.add(monthKey(s.sessionDate));
    }
    return Array.from(set).sort();
  }, [sessions]);

  // Default to the most recent month with a session, not always January —
  // that's almost always the more relevant one to land on.
  const [monthIndex, setMonthIndex] = useState(monthsWithSessions.length - 1);

  if (monthsWithSessions.length === 0) {
    return <p className="text-xs text-gray-600">No session-level detail logged for this playthrough.</p>;
  }

  const clampedIndex = Math.min(Math.max(monthIndex, 0), monthsWithSessions.length - 1);
  const [year, month] = monthsWithSessions[clampedIndex].split("-").map(Number);
  const firstOfMonth = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startWeekday = firstOfMonth.getDay();

  const cells: (number | null)[] = [
    ...Array(startWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function dayKey(day: number): string {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => setMonthIndex(clampedIndex - 1)}
          disabled={clampedIndex === 0}
          className="rounded-lg bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600 disabled:opacity-30"
        >
          ← Prev
        </button>
        <span className="text-sm font-medium text-gray-200">
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <button
          onClick={() => setMonthIndex(clampedIndex + 1)}
          disabled={clampedIndex === monthsWithSessions.length - 1}
          className="rounded-lg bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600 disabled:opacity-30"
        >
          Next →
        </button>
      </div>

      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_HEADERS.map((d) => (
          <div key={d} className="text-xs text-gray-500">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`blank-${i}`} />;
          const key = dayKey(day);
          const daySessions = sessionsByDay.get(key) ?? [];
          const isSelected = daySessions.some((s) => s.id === selectedSession?.id);
          const totalHours = daySessions.reduce((sum, s) => sum + (s.hours ?? 0) + (s.minutes ?? 0) / 60, 0);

          return (
            <button
              key={key}
              disabled={daySessions.length === 0}
              onClick={() => daySessions[0] && onSelectSession(daySessions[0])}
              title={daySessions.length > 0 ? `${totalHours.toFixed(1)}h logged` : undefined}
              className={
                "flex aspect-square flex-col items-center justify-center rounded-lg text-xs transition " +
                (daySessions.length === 0
                  ? "text-gray-700"
                  : isSelected
                    ? "bg-amber-500 font-semibold text-gray-950"
                    : "bg-gray-700 text-gray-200 hover:bg-gray-600")
              }
            >
              {day}
              {daySessions.length > 1 && <span className="text-[9px] opacity-75">×{daySessions.length}</span>}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-gray-500">
        {monthsWithSessions.length} month{monthsWithSessions.length === 1 ? "" : "s"} with logged sessions —
        showing {clampedIndex + 1} of {monthsWithSessions.length}.
      </p>
    </div>
  );
}

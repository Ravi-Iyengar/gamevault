import { useEffect, useMemo, useState } from "react";
import { getQuarterMoments, QuarterMoment } from "../services/TimeGalleryService";
import TimeGalleryCard from "../components/TimeGalleryCard";
import { getDominantColor } from "../utils/dominantColor";
import { Game } from "../types/game";

interface Props {
  onSelectGame: (game: Game) => void;
}

interface QuarterGroup {
  key: string;
  label: string;
  quarter: number;
  moments: QuarterMoment[];
}

interface YearGroup {
  year: number;
  quarterGroups: QuarterGroup[];
  totalMoments: number;
}

function groupByYear(moments: QuarterMoment[]): YearGroup[] {
  const byYear = new Map<number, Map<number, QuarterMoment[]>>();
  for (const m of moments) {
    const quarterMap = byYear.get(m.year) ?? new Map<number, QuarterMoment[]>();
    byYear.set(m.year, quarterMap);
    const list = quarterMap.get(m.quarter) ?? [];
    list.push(m);
    quarterMap.set(m.quarter, list);
  }

  return [...byYear.entries()]
    .map(([year, quarterMap]) => {
      const quarterGroups = [...quarterMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([quarter, qMoments]) => ({
          key: `${year}-Q${quarter}`,
          label: `Q${quarter}`,
          quarter,
          moments: qMoments,
        }));
      return {
        year,
        quarterGroups,
        totalMoments: quarterGroups.reduce((sum, g) => sum + g.moments.length, 0),
      };
    })
    .sort((a, b) => b.year - a.year); // most recent year first
}

/** The moment with the highest rating in a year — used to pick that
 * year's background tint. Moments with no rating at all are ignored;
 * a year with nothing rated just gets the neutral default background. */
function topRatedMoment(moments: QuarterMoment[]): QuarterMoment | null {
  let best: QuarterMoment | null = null;
  for (const m of moments) {
    if (m.rating == null) continue;
    if (best === null || m.rating > (best.rating as number)) best = m;
  }
  return best;
}

/**
 * All quarter-moment data is fetched once — for a library this size
 * (hundreds of game-quarter entries, each a small summary object, not
 * raw session data) that's genuinely trivial to hold in memory, nowhere
 * near what "storing that much data in RAM" sounds like it's warning
 * against.
 *
 * Layout is tabs-per-year (a year is a natural, bounded unit — at most 4
 * quarter sections) with everything inside a year scrolling as one
 * continuous vertical page: quarters stack top to bottom and each
 * quarter's cards wrap into a grid, rather than each quarter having its
 * own separate horizontally-scrolling row (the original layout — fixed
 * on request, since nested horizontal scrollbars inside a vertically
 * scrolling page are awkward to actually use).
 *
 * Each year's background gets a subtle tint derived from that year's
 * highest-rated game's cover art (see utils/dominantColor.ts) — a soft
 * gradient, not a full reskin, so the dark theme and text contrast stay
 * intact underneath it.
 */
export default function TimeGallery({ onSelectGame }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moments, setMoments] = useState<QuarterMoment[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [yearTint, setYearTint] = useState<string | null>(null);

  useEffect(() => {
    getQuarterMoments()
      .then((m) => {
        setMoments(m);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  const yearGroups = useMemo(() => groupByYear(moments), [moments]);

  useEffect(() => {
    if (selectedYear === null && yearGroups.length > 0) {
      setSelectedYear(yearGroups[0].year);
    }
  }, [yearGroups, selectedYear]);

  useEffect(() => {
    const active = yearGroups.find((y) => y.year === selectedYear) ?? yearGroups[0];
    if (!active) {
      setYearTint(null);
      return;
    }
    const top = topRatedMoment(active.quarterGroups.flatMap((g) => g.moments));
    if (!top) {
      setYearTint(null);
      return;
    }
    let cancelled = false;
    getDominantColor(`year-${active.year}`, top.coverArtUrl, top.title).then((color) => {
      if (!cancelled) setYearTint(color);
    });
    return () => {
      cancelled = true;
    };
  }, [yearGroups, selectedYear]);

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (error) return <p className="text-red-400">Failed to load Time Gallery: {error}</p>;

  if (yearGroups.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Time Gallery</h1>
        <p className="mt-4 text-sm text-gray-500">
          Nothing to show yet — Time Gallery needs logged session dates or playthrough dates to
          build a quarterly timeline.
        </p>
      </div>
    );
  }

  const activeYear = yearGroups.find((y) => y.year === selectedYear) ?? yearGroups[0];
  const earliestYear = yearGroups[yearGroups.length - 1].year;
  const latestYear = yearGroups[0].year;

  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Time Gallery</h1>
      <p className="mt-2 text-sm text-gray-400">
        Your library, one year at a time — {earliestYear} through {latestYear}. A game reappears
        each quarter you actually came back to it.
      </p>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-white/10 pb-2">
        {yearGroups.map((yg) => (
          <button
            key={yg.year}
            onClick={() => setSelectedYear(yg.year)}
            className={
              "rounded-lg px-4 py-2 text-sm font-medium transition " +
              (yg.year === activeYear.year
                ? "bg-amber-500 text-gray-950"
                : "bg-gray-800/60 text-gray-400 hover:bg-gray-800 hover:text-gray-200")
            }
          >
            {yg.year}
            <span className="ml-2 text-xs opacity-70">{yg.totalMoments}</span>
          </button>
        ))}
      </div>

      <div
        className="mt-8 rounded-2xl p-6 transition-colors duration-700"
        style={{
          background: yearTint
            ? `linear-gradient(180deg, ${yearTint.replace("rgb(", "rgba(").replace(")", ", 0.16)")}, transparent 60%)`
            : undefined,
        }}
      >
        <div className="flex flex-col gap-10">
          {activeYear.quarterGroups.map((group) => (
            <section key={group.key}>
              <h2 className="text-lg font-semibold text-white">
                {group.label} {activeYear.year}
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {group.moments.map((m) => (
                  <TimeGalleryCard
                    key={`${m.gameId}-${m.year}-${m.quarter}`}
                    moment={m}
                    onClick={() => onSelectGame({ id: m.gameId, title: m.title })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

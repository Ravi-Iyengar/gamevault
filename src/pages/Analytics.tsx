import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, PieChart, Pie, Cell,
} from "recharts";
import {
  getHoursByGenre, getFranchisePreferences, getHoursByPlatform, getRatingDistribution,
  getCompletionMetrics, getGenreHoursByYear, getCompletionsByYear, getDeveloperPreferences,
  getHoursByTheme, getAverageRatingByReleaseYear, getWeekdayActivity, getMostReplayedGames,
  getGamesByOwnedPlatform, getGamesByOwnedStorefront,
  GenreHours, FranchiseStats, PlatformStats, RatingBucket, CompletionMetrics,
  GenreYearHours, CompletionsByYear, DeveloperStats, ThemeStats, RatingTrendPoint,
  WeekdayActivity, MostReplayedGame, OwnershipDistribution,
} from "../services/AnalyticsService";

const COLORS = ["#dc2626", "#22d3ee", "#f59e0b", "#ef4444", "#10b981", "#a855f7", "#ec4899", "#84cc16"];

/**
 * `caption` is a dedicated prop, not just another child mixed in with the
 * chart — this is a real fix, not a style choice. The chart area below
 * has a fixed height (h-64) so ResponsiveContainer has something concrete
 * to size against, but a caption paragraph doesn't fit inside that same
 * fixed box once you add its own height on top of the chart's — with no
 * overflow handling, the previous version (which passed the caption in
 * as an extra child alongside the chart, inside that same h-64 div)
 * spilled the caption text out past the box's bottom edge into whatever
 * followed in the layout. Rendering the caption in its own block after
 * (not inside) the fixed-height chart div means the card's total height
 * just grows to fit both pieces instead of clipping one against the
 * other.
 */
function ChartCard({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-gray-800/60 p-5 ring-1 ring-white/5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{title}</h2>
      <div className="mt-4 h-64">{children}</div>
      {caption && <p className="mt-3 text-xs leading-relaxed text-gray-500">{caption}</p>}
    </div>
  );
}

/** Pivots {year, genre, hours}[] into one row per year with one column per
 * genre, which is what Recharts' multi-line LineChart expects. */
function pivotByYear<T extends { year: number; hours: number }>(
  rows: T[],
  keyField: keyof T
): { rows: Record<string, number | string>[]; keys: string[] } {
  const years = Array.from(new Set(rows.map((r) => r.year))).sort();
  const keySet = new Set<string>();
  const byYear: Record<number, Record<string, number>> = {};

  for (const row of rows) {
    const key = String(row[keyField]);
    keySet.add(key);
    byYear[row.year] = byYear[row.year] ?? {};
    byYear[row.year][key] = row.hours;
  }

  const keys = Array.from(keySet);
  const totals = new Map<string, number>();
  for (const k of keys) totals.set(k, rows.filter((r) => String(r[keyField]) === k).reduce((s, r) => s + r.hours, 0));
  const topKeys = keys.sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0)).slice(0, 6);

  const pivoted = years.map((year) => ({
    year: String(year),
    ...Object.fromEntries(topKeys.map((k) => [k, byYear[year]?.[k] ?? 0])),
  }));

  return { rows: pivoted, keys: topKeys };
}

type Tab = "overview" | "genres" | "franchises" | "platforms" | "trends";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "genres", label: "Genres & Themes" },
  { key: "franchises", label: "Franchises & Developers" },
  { key: "platforms", label: "Platforms & Ownership" },
  { key: "trends", label: "Time & Trends" },
];

export default function Analytics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const [genreHours, setGenreHours] = useState<GenreHours[]>([]);
  const [franchises, setFranchises] = useState<FranchiseStats[]>([]);
  const [platforms, setPlatforms] = useState<PlatformStats[]>([]);
  const [ratings, setRatings] = useState<RatingBucket[]>([]);
  const [completion, setCompletion] = useState<CompletionMetrics | null>(null);
  const [genreByYear, setGenreByYear] = useState<GenreYearHours[]>([]);
  const [completionsByYear, setCompletionsByYear] = useState<CompletionsByYear[]>([]);
  const [developers, setDevelopers] = useState<DeveloperStats[]>([]);
  const [themes, setThemes] = useState<ThemeStats[]>([]);
  const [ratingTrend, setRatingTrend] = useState<RatingTrendPoint[]>([]);
  const [weekdayActivity, setWeekdayActivity] = useState<WeekdayActivity[]>([]);
  const [mostReplayed, setMostReplayed] = useState<MostReplayedGame[]>([]);
  const [ownedPlatforms, setOwnedPlatforms] = useState<OwnershipDistribution[]>([]);
  const [ownedStorefronts, setOwnedStorefronts] = useState<OwnershipDistribution[]>([]);

  useEffect(() => {
    Promise.all([
      getHoursByGenre(),
      getFranchisePreferences(),
      getHoursByPlatform(),
      getRatingDistribution(),
      getCompletionMetrics(),
      getGenreHoursByYear(),
      getCompletionsByYear(),
      getDeveloperPreferences(),
      getHoursByTheme(),
      getAverageRatingByReleaseYear(),
      getWeekdayActivity(),
      getMostReplayedGames(),
      getGamesByOwnedPlatform(),
      getGamesByOwnedStorefront(),
    ])
      .then(([g, f, p, r, c, gy, cy, d, th, rt, wd, mr, op, os]) => {
        setGenreHours(g);
        setFranchises(f);
        setPlatforms(p);
        setRatings(r);
        setCompletion(c);
        setGenreByYear(gy);
        setCompletionsByYear(cy);
        setDevelopers(d);
        setThemes(th);
        setRatingTrend(rt);
        setWeekdayActivity(wd);
        setMostReplayed(mr);
        setOwnedPlatforms(op);
        setOwnedStorefronts(os);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (error) return <p className="text-red-400">Failed to load analytics: {error}</p>;

  const noMetadata = genreHours.length === 0 && franchises.length === 0 && developers.length === 0;
  const genrePivot = pivotByYear(genreByYear, "genre");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-white">Analytics</h1>

      {noMetadata && (
        <p className="rounded-lg bg-amber-900/30 p-3 text-sm text-amber-300 ring-1 ring-amber-800">
          Genre/franchise/developer charts need metadata — fetch it from Settings first. Platform,
          rating, and completion charts work already (they don&apos;t need IGDB data).
        </p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-white/10 pb-px">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "rounded-t-lg px-4 py-2 text-sm font-medium transition " +
              (tab === t.key ? "bg-gray-800/60 text-white" : "text-gray-400 hover:text-gray-200")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          {completion && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ["Total Games", completion.totalGames],
                ["Completed", completion.completedGames],
                ["Completion Rate", `${(completion.completionRate * 100).toFixed(0)}%`],
                ["Backlog", completion.backlogGames],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-gray-800/60 p-4 ring-1 ring-white/5">
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="Rating Distribution">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ratings.map((r) => ({ ...r, rating: String(r.rating) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="rating" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} />
                  <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "none" }} />
                  <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Gaming Activity by Day of Week (median hours)"
              caption="Median hours per day logged (weekends highlighted). Most Backloggd session entries record only a date, not a duration — where a whole playthrough's sessions are all duration-less but the playthrough itself has a real total, that total is split evenly across its sessions as an estimate. Hover a bar to see exactly how many of that weekday's sessions the estimate could reach."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekdayActivity}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="weekday" stroke="#9ca3af" fontSize={11} tickFormatter={(d: string) => d.slice(0, 3)} />
                  <YAxis stroke="#9ca3af" fontSize={12} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1f2937", border: "none" }}
                    formatter={(value, _name, props) => {
                      const d = props.payload as WeekdayActivity;
                      const coverage = d.sessionDayCount > 0 ? Math.round((100 * d.daysWithDuration) / d.sessionDayCount) : 0;
                      return [
                        `${(value as number).toFixed(1)}h median (mean ${d.meanHoursWhenLogged.toFixed(1)}h) — ${d.daysWithDuration}/${d.sessionDayCount} days had a usable duration (${coverage}%)`,
                        "Typical session",
                      ];
                    }}
                  />
                  <Bar dataKey="medianHoursWhenLogged" radius={[4, 4, 0, 0]}>
                    {weekdayActivity.map((_, i) => (
                      <Cell key={i} fill={i === 0 || i === 6 ? "#f59e0b" : "#dc2626"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {mostReplayed.length > 0 && (
            <div className="rounded-xl bg-gray-800/60 p-5 ring-1 ring-white/5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
                Most Replayed Games (your &quot;comfort games&quot;)
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                Ranked by replay count — this works without any IGDB metadata, since it comes
                straight from your playthrough history.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                {mostReplayed.map((game, i) => (
                  <div key={game.gameId} className="flex items-center gap-3 text-sm">
                    <span className="w-5 text-right text-gray-500">{i + 1}.</span>
                    <span className="flex-1 text-gray-200">{game.title}</span>
                    <span className="text-amber-400">{game.replayCount}x replayed</span>
                    <span className="w-20 text-right text-gray-500">{game.totalHours.toFixed(0)}h</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {tab === "genres" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Hours by Genre">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={genreHours.slice(0, 10)} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" stroke="#9ca3af" fontSize={12} />
                <YAxis type="category" dataKey="genre" stroke="#9ca3af" fontSize={12} width={90} />
                <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "none" }} />
                <Bar dataKey="hours" fill="#dc2626" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Hours by Theme">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={themes.slice(0, 10)} layout="vertical" margin={{ left: 70 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" stroke="#9ca3af" fontSize={12} />
                <YAxis type="category" dataKey="theme" stroke="#9ca3af" fontSize={12} width={100} />
                <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "none" }} />
                <Bar dataKey="hours" fill="#ec4899" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Genres Played Over Time (hours/year)">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={genrePivot.rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="year" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "none" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {genrePivot.keys.map((key, i) => (
                  <Line key={key} type="monotone" dataKey={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      {tab === "franchises" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Franchise Preferences (top by hours)">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={franchises.slice(0, 8)}
                  dataKey="hours"
                  nameKey="franchise"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(entry: { franchise?: string }) => entry.franchise ?? ""}
                >
                  {franchises.slice(0, 8).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "none" }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          {developers.length > 0 && (
            <ChartCard title="Developer Preferences (top by hours)">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={developers.slice(0, 10)} layout="vertical" margin={{ left: 90 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis type="number" stroke="#9ca3af" fontSize={12} />
                  <YAxis type="category" dataKey="developer" stroke="#9ca3af" fontSize={12} width={140} />
                  <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "none" }} />
                  <Bar dataKey="hours" fill="#a855f7" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      {tab === "platforms" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Hours by Platform (played)">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={platforms.slice(0, 10)} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis type="number" stroke="#9ca3af" fontSize={12} />
                <YAxis type="category" dataKey="platform" stroke="#9ca3af" fontSize={12} width={110} />
                <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "none" }} />
                <Bar dataKey="hours" fill="#22d3ee" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {ownedPlatforms.length > 0 && (
            <ChartCard
              title="Library by Platform (ownership)"
              caption="Every game with a platform recorded — backlog included, not just what you've actually played. Comes from your personal spreadsheet import."
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={ownedPlatforms.slice(0, 8)}
                    dataKey="gameCount"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(entry: { label?: string }) => entry.label ?? ""}
                  >
                    {ownedPlatforms.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "none" }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {ownedStorefronts.length > 0 && (
            <ChartCard
              title="Library by Storefront (ownership)"
              caption="Includes subscription services (Game Pass, PS Plus, NSO) alongside one-time storefronts — check Settings → Active Subscriptions if a slice looks like it shouldn't count anymore."
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={ownedStorefronts.slice(0, 8)}
                    dataKey="gameCount"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(entry: { label?: string }) => entry.label ?? ""}
                  >
                    {ownedStorefronts.slice(0, 8).map((_, i) => (
                      <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "none" }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      )}

      {tab === "trends" && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title="Average Rating by Release Year"
            caption="Grouped by when each game came out, not when you played it — needs metadata fetched from Settings."
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ratingTrend.map((r) => ({ ...r, releaseYear: String(r.releaseYear) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="releaseYear" stroke="#9ca3af" fontSize={12} />
                <YAxis domain={[0, 10]} stroke="#9ca3af" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "none" }} />
                <Line type="monotone" dataKey="avgRating" stroke="#22d3ee" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Games Completed by Year">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={completionsByYear.map((r) => ({ ...r, year: String(r.year) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="year" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: "#1f2937", border: "none" }} />
                <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </div>
  );
}

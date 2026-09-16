import { useEffect, useState } from "react";

import { Playthrough } from "../types/playthrough";
import { getGameStatistics, getPlaythroughsByGameId } from "../services/PlaythroughService";

import { PlaySession } from "../types/playSession";
import { getSessionsByPlaythroughId } from "../services/PlaySessionService";
import { selectQuery, getDatabase } from "../database/database";
import { updateUserGameFields } from "../services/GameEditService";
import { logSession, createPlaythrough } from "../services/PlaythroughEditService";
import SessionCalendar from "../components/SessionCalendar";
import StarRating from "../components/StarRating";
import CoverArt from "../components/CoverArt";
import { deriveStatus } from "../types/game";

interface Props {
  gameId: string;
  gameTitle: string;
}

interface GameMeta {
  CoverArtUrl: string | null;
  FranchiseNames: string | null;
  ReleaseYear: number | null;
  Summary: string | null;
  HLTBMainStory: number | null;
  MetacriticScore: number | null;
  DesireToPlay: number | null;
  Notes: string | null;
  TimeToBeatHastily: number | null;
  TimeToBeatNormally: number | null;
  TimeToBeatCompletely: number | null;
  TimeToBeatCount: number | null;
  IGDBUserRating: number | null;
  IGDBUserRatingCount: number | null;
  IsBacklog: number | null;
  IsPlaying: number | null;
  IsWishlist: number | null;
  StatusRaw: string | null;
  OwnedPlatformName: string | null;
  OwnedStorefrontName: string | null;
  OwnedPlatformId: number | null;
  OwnedStorefrontId: number | null;
  Favorite: number | null;
  Liked: number | null;
}

interface RecommendationRow {
  PredictedRating: number | null;
  RecommendationScore: number | null;
  ExplanationJson: string | null;
}

function StatBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

/** Not a real brand-logo icon — those would mean bundling external
 * assets/logos for every platform and storefront, a much bigger and
 * license-sensitive undertaking than this needed. This is a small
 * colored-dot badge with the resolved name instead: a lightweight visual
 * marker that reads at a glance without pretending to be Steam's or
 * PlayStation's actual logo. */
function Badge({ label, dotColor }: { label: string; dotColor: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-800 px-2.5 py-1 text-xs text-gray-300 ring-1 ring-white/10">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: dotColor }} />
      {label}
    </span>
  );
}

const STATUS_BADGE_COLORS: Record<string, string> = {
  Playing: "#dc2626",
  Completed: "#10b981",
  Abandoned: "#ef4444",
  Shelved: "#f59e0b",
  Retired: "#a855f7",
  Endless: "#22d3ee",
  Backlog: "#9ca3af",
  Wishlist: "#ec4899",
  Dropped: "#f97316",
  Unfinished: "#eab308",
  Unknown: "#6b7280",
};

export default function GameDetail({ gameId, gameTitle }: Props) {
  const [meta, setMeta] = useState<GameMeta | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationRow | null>(null);
  const [playthroughs, setPlaythroughs] = useState<Playthrough[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{
    PlaythroughCount: number;
    TotalHours: number;
    LatestRating: number | null;
    ReplayCount: number;
    FirstPlayed: string | null;
    LastPlayed: string | null;
    HasFinishedPlaythrough: number;
  } | null>(null);
  const [sessions, setSessions] = useState<PlaySession[]>([]);
  const [selectedSession, setSelectedSession] = useState<PlaySession | null>(null);
  const [platformOptions, setPlatformOptions] = useState<{ Id: number; Name: string }[]>([]);
  const [storefrontOptions, setStorefrontOptions] = useState<{ Id: number; Name: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editStatus, setEditStatus] = useState<"backlog" | "playing" | "wishlist" | "none">("none");
  const [editFavorite, setEditFavorite] = useState(false);
  const [editLiked, setEditLiked] = useState(false);
  const [editDesireToPlay, setEditDesireToPlay] = useState(0);
  const [editNotes, setEditNotes] = useState("");
  const [editPlatformId, setEditPlatformId] = useState<number | "">("");
  const [editStorefrontId, setEditStorefrontId] = useState<number | "">("");

  const [logPanel, setLogPanel] = useState<"none" | "session" | "playthrough">("none");
  const [logSaving, setLogSaving] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const todayIso = new Date().toISOString().slice(0, 10);
  const [sessionDate, setSessionDate] = useState(todayIso);
  const [sessionHours, setSessionHours] = useState("");
  const [sessionMinutes, setSessionMinutes] = useState("");
  const [sessionNote, setSessionNote] = useState("");

  const [ptTitle, setPtTitle] = useState("");
  const [ptStartDate, setPtStartDate] = useState("");
  const [ptFinishDate, setPtFinishDate] = useState(todayIso);
  const [ptRating, setPtRating] = useState<number | "">("");
  const [ptReview, setPtReview] = useState("");
  const [ptReplay, setPtReplay] = useState(false);
  const [ptMastered, setPtMastered] = useState(false);
  const [ptHours, setPtHours] = useState("");
  const [ptPlatformId, setPtPlatformId] = useState<number | "">("");
  const [ptStorefrontId, setPtStorefrontId] = useState<number | "">("");

  useEffect(() => {
    loadAll();
  }, [gameId]);

  function loadAll() {
    setLoading(true);
    setError(null);
    Promise.all([
      getPlaythroughsByGameId(gameId),
      getGameStatistics(gameId),
      selectQuery<GameMeta>(
        `SELECT g.CoverArtUrl, g.ReleaseYear, g.Summary, g.HLTBMainStory, g.MetacriticScore,
                g.TimeToBeatHastily, g.TimeToBeatNormally, g.TimeToBeatCompletely, g.TimeToBeatCount,
                g.IGDBUserRating, g.IGDBUserRatingCount,
                ug.DesireToPlay, ug.Notes, ug.IsBacklog, ug.IsPlaying, ug.IsWishlist, ug.StatusRaw,
                ug.OwnedPlatformId, ug.OwnedStorefrontId, ug.Favorite, ug.Liked,
                pl.Name AS OwnedPlatformName, sf.Name AS OwnedStorefrontName,
                fran.FranchiseNames
         FROM Games g
         LEFT JOIN UserGames ug ON ug.GameId = g.Id
         LEFT JOIN Platforms pl ON pl.Id = ug.OwnedPlatformId
         LEFT JOIN Storefronts sf ON sf.Id = ug.OwnedStorefrontId
         LEFT JOIN (
           SELECT gf.GameId, GROUP_CONCAT(franchises.Name) AS FranchiseNames
           FROM GameFranchises gf
           JOIN Franchises franchises ON franchises.Id = gf.FranchiseId
           GROUP BY gf.GameId
         ) fran ON fran.GameId = g.Id
         WHERE g.Id = ?`,
        [gameId]
      ),
      selectQuery<RecommendationRow>(
        `SELECT PredictedRating, RecommendationScore, ExplanationJson FROM Recommendations WHERE GameId = ?`,
        [gameId]
      ),
      selectQuery<{ Id: number; Name: string }>(`SELECT Id, Name FROM Platforms WHERE Name IS NOT NULL ORDER BY Name`),
      selectQuery<{ Id: number; Name: string }>(`SELECT Id, Name FROM Storefronts WHERE Name IS NOT NULL ORDER BY Name`),
    ])
      .then(([pts, stat, metaRows, recRows, platforms, storefronts]) => {
        setPlaythroughs(pts);
        setStats(stat as any);
        setMeta(metaRows[0] ?? null);
        setRecommendation(recRows[0] ?? null);
        setPlatformOptions(platforms);
        setStorefrontOptions(storefronts);
        setSelectedIndex(0);
        setLoading(false);
      })
      .catch((e) => {
        // Previously each of these three fetches ran independently with
        // no .catch() at all — a throw in any one of them left this page
        // silently blank forever (no loading indicator existed to get
        // stuck on, but nothing populated either, which reads the same
        // way to the person looking at it).
        setError(String(e));
        setLoading(false);
      });
  }

  const selectedPlaythrough = playthroughs[selectedIndex];

  function handleOpenEdit() {
    setEditFavorite(meta?.Favorite === 1);
    setEditLiked(meta?.Liked === 1);
    setEditDesireToPlay(meta?.DesireToPlay ?? 0);
    setEditNotes(meta?.Notes ?? "");
    setEditPlatformId(meta?.OwnedPlatformId ?? "");
    setEditStorefrontId(meta?.OwnedStorefrontId ?? "");
    setEditStatus(meta?.IsBacklog === 1 ? "backlog" : meta?.IsPlaying === 1 ? "playing" : meta?.IsWishlist === 1 ? "wishlist" : "none");
    setEditing(true);
  }

  async function handleSaveEdit() {
    setEditSaving(true);
    try {
      const db = await getDatabase();
      await updateUserGameFields(db, gameId, {
        favorite: editFavorite,
        liked: editLiked,
        desireToPlay: editDesireToPlay,
        notes: editNotes || null,
        ownedPlatformId: editPlatformId === "" ? null : editPlatformId,
        ownedStorefrontId: editStorefrontId === "" ? null : editStorefrontId,
        isBacklog: editStatus === "backlog",
        isPlaying: editStatus === "playing",
        isWishlist: editStatus === "wishlist",
      });
      loadAll();
      setEditing(false);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleLogSession() {
    setLogSaving(true);
    setLogError(null);
    try {
      const db = await getDatabase();
      await logSession(db, gameId, {
        date: sessionDate,
        hours: sessionHours ? Number(sessionHours) : null,
        minutes: sessionMinutes ? Number(sessionMinutes) : null,
        note: sessionNote || null,
      });
      setSessionHours("");
      setSessionMinutes("");
      setSessionNote("");
      setLogPanel("none");
      loadAll();
    } catch (e) {
      setLogError(String(e));
    } finally {
      setLogSaving(false);
    }
  }

  async function handleAddPlaythrough() {
    setLogSaving(true);
    setLogError(null);
    try {
      const db = await getDatabase();
      await createPlaythrough(db, gameId, {
        title: ptTitle || null,
        startDate: ptStartDate || null,
        finishDate: ptFinishDate || null,
        rating: ptRating === "" ? null : ptRating,
        review: ptReview || null,
        replay: ptReplay,
        mastered: ptMastered,
        hoursPlayed: ptHours ? Number(ptHours) : null,
        playedPlatformId: ptPlatformId === "" ? null : ptPlatformId,
        storefrontId: ptStorefrontId === "" ? null : ptStorefrontId,
      });
      setPtTitle("");
      setPtStartDate("");
      setPtFinishDate(todayIso);
      setPtRating("");
      setPtReview("");
      setPtReplay(false);
      setPtMastered(false);
      setPtHours("");
      setPtPlatformId("");
      setPtStorefrontId("");
      setLogPanel("none");
      loadAll();
    } catch (e) {
      setLogError(String(e));
    } finally {
      setLogSaving(false);
    }
  }


  const status = meta
    ? deriveStatus({
        isBacklog: meta.IsBacklog === 1,
        isPlaying: meta.IsPlaying === 1,
        isWishlist: meta.IsWishlist === 1,
        statusRaw: meta.StatusRaw ?? undefined,
        hasFinishedPlaythrough: stats?.HasFinishedPlaythrough === 1,
        playthroughCount: stats?.PlaythroughCount ?? 0,
      })
    : null;

  useEffect(() => {
    if (!selectedPlaythrough) {
      setSessions([]);
      return;
    }
    getSessionsByPlaythroughId(selectedPlaythrough.id)
      .then(setSessions)
      .catch((e) => setError(String(e)));
    setSelectedSession(null);
  }, [selectedPlaythrough]);

  return (
    <div className="mx-auto max-w-4xl">
      {loading && <p className="text-gray-400">Loading...</p>}
      {error && <p className="text-red-400">Failed to load this game: {error}</p>}
      {!loading && !error && (
      <>
      <div className="flex gap-6">
        <div className="h-48 w-36 flex-shrink-0 overflow-hidden rounded-xl bg-gray-800 ring-1 ring-white/10">
          {meta?.CoverArtUrl ? (
            <CoverArt
              gameId={gameId}
              url={meta.CoverArtUrl}
              alt={gameTitle}
              className="h-full w-full object-cover"
              loading="eager"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-gray-500">
              {gameTitle}
            </div>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{gameTitle}</h1>
          {meta?.FranchiseNames && (
            <p className="mt-1 text-sm text-gray-400">{meta.FranchiseNames.split(",").join(" · ")}</p>
          )}
          {meta?.ReleaseYear && <p className="text-sm text-gray-500">{meta.ReleaseYear}</p>}
          {meta?.Summary && <p className="mt-3 max-w-xl text-sm text-gray-400">{meta.Summary}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {stats?.LatestRating != null && <StarRating rating={stats.LatestRating} />}
            {status && <Badge label={status} dotColor={STATUS_BADGE_COLORS[status] ?? "#6b7280"} />}
            {meta?.OwnedPlatformName && <Badge label={meta.OwnedPlatformName} dotColor="#dc2626" />}
            {meta?.OwnedStorefrontName && <Badge label={meta.OwnedStorefrontName} dotColor="#22d3ee" />}
            {meta?.Favorite === 1 && <Badge label="★ Favorite" dotColor="#f59e0b" />}
            {meta?.Liked === 1 && <Badge label="♥ Liked" dotColor="#f59e0b" />}
            <button
              onClick={handleOpenEdit}
              className="rounded-lg bg-gray-800 px-3 py-1 text-xs font-medium text-gray-300 ring-1 ring-white/10 hover:bg-gray-700"
            >
              Edit
            </button>
            <button
              onClick={() => setLogPanel(logPanel === "session" ? "none" : "session")}
              className="rounded-lg bg-gray-800 px-3 py-1 text-xs font-medium text-gray-300 ring-1 ring-white/10 hover:bg-gray-700"
            >
              + Log Session
            </button>
            <button
              onClick={() => setLogPanel(logPanel === "playthrough" ? "none" : "playthrough")}
              className="rounded-lg bg-gray-800 px-3 py-1 text-xs font-medium text-gray-300 ring-1 ring-white/10 hover:bg-gray-700"
            >
              + Add Playthrough
            </button>
          </div>

          {logPanel === "session" && (
            <div className="mt-4 max-w-md rounded-xl bg-gray-800/60 p-4 ring-1 ring-amber-500/30">
              <p className="text-xs text-gray-500">
                Attaches to whatever playthrough is still in progress, or starts a new one if there
                isn't one.
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-400">Date</label>
                  <input
                    type="date"
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400">Hours</label>
                  <input
                    type="number"
                    min={0}
                    value={sessionHours}
                    onChange={(e) => setSessionHours(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400">Minutes</label>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={sessionMinutes}
                    onChange={(e) => setSessionMinutes(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="text-xs font-medium text-gray-400">Note (optional)</label>
                <input
                  value={sessionNote}
                  onChange={(e) => setSessionNote(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
                />
              </div>
              {logError && <p className="mt-2 text-xs text-red-400">{logError}</p>}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleLogSession}
                  disabled={logSaving}
                  className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-medium text-gray-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {logSaving ? "Saving..." : "Log Session"}
                </button>
                <button
                  onClick={() => setLogPanel("none")}
                  className="rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {logPanel === "playthrough" && (
            <div className="mt-4 max-w-md rounded-xl bg-gray-800/60 p-4 ring-1 ring-amber-500/30">
              <p className="text-xs text-gray-500">For a completed (or otherwise fuller) run — rating, review, dates.</p>
              <div className="mt-3">
                <label className="text-xs font-medium text-gray-400">Title (optional)</label>
                <input
                  value={ptTitle}
                  onChange={(e) => setPtTitle(e.target.value)}
                  placeholder="e.g. First playthrough"
                  className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-400">Start Date</label>
                  <input
                    type="date"
                    value={ptStartDate}
                    onChange={(e) => setPtStartDate(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400">Finish Date</label>
                  <input
                    type="date"
                    value={ptFinishDate}
                    onChange={(e) => setPtFinishDate(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="text-xs font-medium text-gray-400">Rating (0–10)</label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Array.from({ length: 11 }, (_, n) => n).map((n) => (
                    <button
                      key={n}
                      onClick={() => setPtRating(n)}
                      className={
                        "h-6 w-6 rounded text-xs " +
                        (ptRating === n ? "bg-amber-500 text-gray-950" : "bg-gray-900 text-gray-400 hover:bg-gray-700")
                      }
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <label className="text-xs font-medium text-gray-400">Review (optional)</label>
                <textarea
                  value={ptReview}
                  onChange={(e) => setPtReview(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
                />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setPtReplay(!ptReplay)}
                  className={
                    "rounded-lg px-3 py-1.5 text-xs font-medium " +
                    (ptReplay ? "bg-amber-500 text-gray-950" : "bg-gray-900 text-gray-400 hover:bg-gray-700")
                  }
                >
                  Replay
                </button>
                <button
                  onClick={() => setPtMastered(!ptMastered)}
                  className={
                    "rounded-lg px-3 py-1.5 text-xs font-medium " +
                    (ptMastered ? "bg-amber-500 text-gray-950" : "bg-gray-900 text-gray-400 hover:bg-gray-700")
                  }
                >
                  Mastered
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-400">Hours</label>
                  <input
                    type="number"
                    min={0}
                    value={ptHours}
                    onChange={(e) => setPtHours(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400">Platform</label>
                  <select
                    value={ptPlatformId}
                    onChange={(e) => setPtPlatformId(e.target.value ? Number(e.target.value) : "")}
                    className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10"
                  >
                    <option value="">—</option>
                    {platformOptions.map((p) => (
                      <option key={p.Id} value={p.Id}>
                        {p.Name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400">Storefront</label>
                  <select
                    value={ptStorefrontId}
                    onChange={(e) => setPtStorefrontId(e.target.value ? Number(e.target.value) : "")}
                    className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10"
                  >
                    <option value="">—</option>
                    {storefrontOptions.map((s) => (
                      <option key={s.Id} value={s.Id}>
                        {s.Name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {logError && <p className="mt-2 text-xs text-red-400">{logError}</p>}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleAddPlaythrough}
                  disabled={logSaving}
                  className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-medium text-gray-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {logSaving ? "Saving..." : "Add Playthrough"}
                </button>
                <button
                  onClick={() => setLogPanel("none")}
                  className="rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {editing && (
            <div className="mt-4 max-w-md rounded-xl bg-gray-800/60 p-4 ring-1 ring-amber-500/30">
              <div className="flex flex-wrap gap-2">
                {(["none", "backlog", "playing", "wishlist"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setEditStatus(s)}
                    className={
                      "rounded-lg px-3 py-1.5 text-xs font-medium capitalize " +
                      (editStatus === s
                        ? "bg-amber-500 text-gray-950"
                        : "bg-gray-900 text-gray-400 hover:bg-gray-700 hover:text-gray-200")
                    }
                  >
                    {s === "none" ? "No status" : s}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setEditFavorite(!editFavorite)}
                  className={
                    "rounded-lg px-3 py-1.5 text-xs font-medium " +
                    (editFavorite ? "bg-amber-500 text-gray-950" : "bg-gray-900 text-gray-400 hover:bg-gray-700")
                  }
                >
                  ★ Favorite
                </button>
                <button
                  onClick={() => setEditLiked(!editLiked)}
                  className={
                    "rounded-lg px-3 py-1.5 text-xs font-medium " +
                    (editLiked ? "bg-amber-500 text-gray-950" : "bg-gray-900 text-gray-400 hover:bg-gray-700")
                  }
                >
                  ♥ Liked
                </button>
              </div>

              <div className="mt-3">
                <label className="text-xs font-medium text-gray-400">Desire to Play (0–5)</label>
                <div className="mt-1 flex gap-1.5">
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setEditDesireToPlay(n)}
                      className={
                        "h-7 w-7 rounded text-xs font-medium " +
                        (editDesireToPlay === n
                          ? "bg-amber-500 text-gray-950"
                          : "bg-gray-900 text-gray-400 hover:bg-gray-700")
                      }
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-gray-400">Owned Platform</label>
                  <select
                    value={editPlatformId}
                    onChange={(e) => setEditPlatformId(e.target.value ? Number(e.target.value) : "")}
                    className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10"
                  >
                    <option value="">—</option>
                    {platformOptions.map((p) => (
                      <option key={p.Id} value={p.Id}>
                        {p.Name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400">Owned Storefront</label>
                  <select
                    value={editStorefrontId}
                    onChange={(e) => setEditStorefrontId(e.target.value ? Number(e.target.value) : "")}
                    className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10"
                  >
                    <option value="">—</option>
                    {storefrontOptions.map((s) => (
                      <option key={s.Id} value={s.Id}>
                        {s.Name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-3">
                <label className="text-xs font-medium text-gray-400">Notes</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg bg-gray-900 px-2 py-1.5 text-xs text-gray-200 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
                />
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleSaveEdit}
                  disabled={editSaving}
                  className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-medium text-gray-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {editSaving ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {stats && (
        <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl bg-gray-800/60 p-5 ring-1 ring-white/5 sm:grid-cols-5">
          <StatBlock label="Playthroughs" value={stats.PlaythroughCount} />
          <StatBlock label="Total Hours" value={stats.TotalHours?.toFixed(0) ?? 0} />
          <StatBlock label="Latest Rating" value={stats.LatestRating != null ? `${stats.LatestRating}/10` : "—"} />
          <StatBlock label="Replays" value={stats.ReplayCount} />
          <StatBlock label="Last Played" value={stats.LastPlayed ?? "—"} />
        </div>
      )}

      {(meta?.TimeToBeatNormally != null || meta?.IGDBUserRating != null) && (
        <div className="mt-4 rounded-xl bg-gray-800/60 p-5 ring-1 ring-white/5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            IGDB Time to Beat &amp; Rating
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {meta?.TimeToBeatHastily != null && (
              <StatBlock label="Hastily" value={`${meta.TimeToBeatHastily}h`} />
            )}
            {meta?.TimeToBeatNormally != null && (
              <StatBlock label="Normally" value={`${meta.TimeToBeatNormally}h`} />
            )}
            {meta?.TimeToBeatCompletely != null && (
              <StatBlock label="Completely" value={`${meta.TimeToBeatCompletely}h`} />
            )}
            {meta?.IGDBUserRating != null && (
              <StatBlock
                label="IGDB User Rating"
                value={`${Math.round(meta.IGDBUserRating)}/100${
                  meta.IGDBUserRatingCount != null ? ` (${meta.IGDBUserRatingCount})` : ""
                }`}
              />
            )}
          </div>
          {meta?.TimeToBeatCount != null && (
            <p className="mt-3 text-xs text-gray-500">
              Based on {meta.TimeToBeatCount} IGDB submission{meta.TimeToBeatCount === 1 ? "" : "s"}.
              {meta.TimeToBeatCount < 10 && (
                <span className="text-amber-400">
                  {" "}
                  Low submission count — "Completely" especially can be skewed by a handful of people
                  treating this as their forever-game rather than a typical full clear. Worth a quick
                  sanity check if the number looks off.
                </span>
              )}
            </p>
          )}
        </div>
      )}

      {recommendation && (
        <div className="mt-4 rounded-xl bg-red-950/40 p-5 ring-1 ring-red-800/50">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-red-300">
            GLIP Recommendation
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {recommendation.PredictedRating != null && (
              <StatBlock label="Predicted Rating" value={`${recommendation.PredictedRating.toFixed(1)}/10`} />
            )}
            {recommendation.RecommendationScore != null && (
              <StatBlock label="Recommendation Score" value={recommendation.RecommendationScore.toFixed(0)} />
            )}
          </div>
          {recommendation.ExplanationJson &&
            (() => {
              try {
                const parsed = JSON.parse(recommendation.ExplanationJson);
                const factors: { feature?: string }[] = parsed.top_factors ?? [];
                if (factors.length === 0) return null;
                return (
                  <p className="mt-3 text-xs text-gray-400">
                    Top factors: {factors.map((f) => f.feature).filter(Boolean).join(", ")}
                  </p>
                );
              } catch {
                return null;
              }
            })()}
          <p className="mt-3 text-xs text-gray-600">
            From your GLIP analysis — a trained model's prediction, not a guarantee. Re-import an
            updated GLIP database from Settings after retraining to refresh this.
          </p>
        </div>
      )}

      {(meta?.HLTBMainStory != null || meta?.MetacriticScore != null || meta?.DesireToPlay != null || meta?.Notes) && (
        <div className="mt-4 rounded-xl bg-gray-800/60 p-5 ring-1 ring-white/5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            From Your Spreadsheet
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {meta?.HLTBMainStory != null && (
              <StatBlock label="HLTB (your estimate)" value={`${meta.HLTBMainStory}h`} />
            )}
            {meta?.MetacriticScore != null && (
              <StatBlock label="Metacritic (your estimate)" value={meta.MetacriticScore} />
            )}
            {meta?.DesireToPlay != null && <StatBlock label="Desire to Play" value={meta.DesireToPlay} />}
          </div>
          {meta?.Notes && (
            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="text-xs uppercase tracking-wide text-gray-500">Notes</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {meta.Notes.split(" | ").map((part, i) => (
                  <li key={i} className="text-sm text-gray-300">
                    {part}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-xs text-gray-600">
            HLTB and Metacritic figures here are your own rough personal estimates from the
            spreadsheet, not scraped exact values — treat them as reference, not precise lookups.
          </p>
        </div>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-gray-400">
        Playthrough Timeline
      </h2>

      {selectedPlaythrough && (
        <div className="mt-3 rounded-xl bg-gray-800/60 p-5 ring-1 ring-white/5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">
              {selectedPlaythrough.title || `Playthrough ${selectedIndex + 1}`}
            </h3>
            <span className="text-xs text-gray-500">
              {selectedIndex + 1} of {playthroughs.length}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-400">
            <span>Rating: {selectedPlaythrough.rating != null ? `${selectedPlaythrough.rating}/10` : "—"}</span>
            <span>Hours: {selectedPlaythrough.hoursPlayed ?? "—"}</span>
            <span>Start: {selectedPlaythrough.startDate ?? "—"}</span>
            <span>Finish: {selectedPlaythrough.finishDate ?? "—"}</span>
            {selectedPlaythrough.replay && <span className="text-amber-400">Replay</span>}
            {selectedPlaythrough.mastered && <span className="text-amber-400">Mastered</span>}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setSelectedIndex(Math.max(0, selectedIndex - 1))}
              disabled={selectedIndex === 0}
              className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setSelectedIndex(Math.min(playthroughs.length - 1, selectedIndex + 1))}
              disabled={selectedIndex === playthroughs.length - 1}
              className="rounded-lg bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-40"
            >
              Next
            </button>
          </div>

          {selectedPlaythrough.review && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-amber-400">View Review</summary>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-300">{selectedPlaythrough.review}</p>
            </details>
          )}

          <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Session Calendar
          </h4>
          <div className="mt-2">
            <SessionCalendar
              sessions={sessions}
              selectedSession={selectedSession}
              onSelectSession={setSelectedSession}
            />
          </div>

          {selectedSession && (
            <div className="mt-4 rounded-lg bg-gray-900 p-4">
              <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Session Details
              </h5>
              <p className="mt-1 text-sm text-gray-300">Date: {selectedSession.sessionDate}</p>
              <p className="text-sm text-gray-300">
                Duration: {selectedSession.hours ?? 0}h {selectedSession.minutes ?? 0}m
              </p>
              {selectedSession.note && <p className="text-sm text-gray-300">Note: {selectedSession.note}</p>}
            </div>
          )}
        </div>
      )}

      {playthroughs.length === 0 && (
        <p className="mt-3 text-sm text-gray-600">No playthroughs logged for this game.</p>
      )}
      </>
      )}
    </div>
  );
}

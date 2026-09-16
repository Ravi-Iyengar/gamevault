import { useEffect, useState } from "react";
import { getDatabase } from "../database/database";
import {
  getFranchiseSuggestions,
  getBacklogSuggestions,
  getWishlistSuggestions,
  getComfortPicks,
  getComfortQuizCandidates,
  getComfortQuizRemainingCount,
  setComfortRating,
  GroupSuggestion,
  BacklogSuggestion,
  ComfortPick,
  ComfortQuizCandidate,
} from "../services/RecommendationsService";
import { getInstalledGames, InstalledGame } from "../services/InstalledGamesService";
import { Game } from "../types/game";
import CoverArt from "../components/CoverArt";
import StarRating from "../components/StarRating";

interface Props {
  onSelectGame: (game: Game) => void;
}

type Tab = "franchises" | "backlog" | "wishlist" | "comfort" | "installed";

const TABS: { key: Tab; label: string }[] = [
  { key: "franchises", label: "Franchises & Collections" },
  { key: "backlog", label: "New Games" },
  { key: "wishlist", label: "Wishlist" },
  { key: "comfort", label: "Comfort Picks" },
  { key: "installed", label: "Installed" },
];

const COMFORT_QUIZ_OPTIONS: { score: number; label: string }[] = [
  { score: 1, label: "Not a comfort game" },
  { score: 2, label: "Rarely" },
  { score: 3, label: "Sometimes" },
  { score: 4, label: "Often" },
  { score: 5, label: "Always my comfort pick" },
];

/** Shared by "New Games" and "Wishlist" — identical card shape, just
 * different data and empty-state copy. */
function BacklogStyleGrid({
  suggestions,
  emptyMessage,
  onSelectGame,
}: {
  suggestions: BacklogSuggestion[];
  emptyMessage: string;
  onSelectGame: (game: Game) => void;
}) {
  if (suggestions.length === 0) {
    return <p className="mt-4 text-sm text-gray-500">{emptyMessage}</p>;
  }
  return (
    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {suggestions.map((s) => (
        <button
          key={s.gameId}
          onClick={() => onSelectGame({ id: s.gameId, title: s.title })}
          className="flex flex-col text-left"
        >
          <div className="aspect-[3/4] w-full overflow-hidden rounded-lg bg-gray-800 ring-1 ring-white/10 transition hover:ring-red-600">
            {s.coverArtUrl ? (
              <CoverArt gameId={s.gameId} url={s.coverArtUrl} alt={s.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-gray-500">
                {s.title}
              </div>
            )}
          </div>
          <p className="mt-1.5 truncate text-sm font-medium text-gray-200">{s.title}</p>
          {s.recommendationScore != null ? (
            <p className="text-xs text-amber-400">
              GLIP score {s.recommendationScore.toFixed(0)}
              {s.predictedRating != null && ` · predicted ${s.predictedRating.toFixed(1)}/10`}
            </p>
          ) : s.desireToPlay != null ? (
            <p className="text-xs text-gray-500">Desire to Play: {s.desireToPlay}</p>
          ) : (
            <p className="text-xs text-gray-600">No score set</p>
          )}
          {s.topFactors.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-gray-600">{s.topFactors.join(", ")}</p>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Four tabs, each drawing on data already in the schema rather than
 * anything computed live: franchise/collection preference (ratings of
 * what you've already finished), backlog picks, wishlist picks (same
 * ranking as backlog — GLIP's Recommendations table where present,
 * DesireToPlay otherwise — but scoped to UserGames.IsWishlist), and
 * comfort picks (finished + highly rated or Favorite/Liked, shuffled
 * client-side from the full qualifying pool). See
 * RecommendationsService.ts for the actual ranking logic.
 *
 * Worth knowing for the Wishlist tab specifically: GLIP's own
 * candidate_pool.py (src/recommendation/candidate_pool.py) deliberately
 * excludes wishlist games from the recommendation candidate pool — its
 * own docstring calls wishlist "a future acquisition pool, not part of
 * recommendation evaluation." This isn't a missing-export gap that a
 * fresh GLIP run fixes; it's an intentional design decision in GLIP's
 * code, confirmed by reading that file directly. So a "GLIP score"
 * badge won't show up here unless that filter is deliberately changed
 * on the Python side — this tab runs on the DesireToPlay fallback
 * either way, which is a real ranking, just not GLIP's trained one.
 */
export default function Recommendations({ onSelectGame }: Props) {
  const [tab, setTab] = useState<Tab>("franchises");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [franchiseSuggestions, setFranchiseSuggestions] = useState<GroupSuggestion[]>([]);
  const [backlogSuggestions, setBacklogSuggestions] = useState<BacklogSuggestion[]>([]);
  const [wishlistSuggestions, setWishlistSuggestions] = useState<BacklogSuggestion[]>([]);
  const [comfortPool, setComfortPool] = useState<ComfortPick[]>([]);
  const [comfortIndex, setComfortIndex] = useState(0);
  const [installed, setInstalled] = useState<InstalledGame[]>([]);

  const [quizCandidates, setQuizCandidates] = useState<ComfortQuizCandidate[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizRemainingCount, setQuizRemainingCount] = useState(0);
  const [quizDismissed, setQuizDismissed] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const db = await getDatabase();
      const [franchises, backlog, wishlist, comfort, installedGames, quizCands, remaining] = await Promise.all([
        getFranchiseSuggestions(db),
        getBacklogSuggestions(db),
        getWishlistSuggestions(db),
        getComfortPicks(db),
        getInstalledGames(db),
        getComfortQuizCandidates(db),
        getComfortQuizRemainingCount(db),
      ]);
      setFranchiseSuggestions(franchises);
      setBacklogSuggestions(backlog);
      setWishlistSuggestions(wishlist);
      setComfortPool(comfort);
      setComfortIndex(comfort.length > 0 ? Math.floor(Math.random() * comfort.length) : 0);
      setInstalled(installedGames);
      setQuizCandidates(quizCands);
      setQuizIndex(0);
      setQuizRemainingCount(remaining);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleAnswerQuiz(gameId: string, score: number) {
    const db = await getDatabase();
    await setComfortRating(db, gameId, score);
    setQuizRemainingCount((n) => Math.max(0, n - 1));
    if (quizIndex + 1 < quizCandidates.length) {
      setQuizIndex(quizIndex + 1);
    } else {
      // Ran out of the batch fetched at load time — re-fetch the next
      // batch rather than just stopping, so a long session can work
      // through more than the initial page size without a manual reload.
      const nextBatch = await getComfortQuizCandidates(db);
      setQuizCandidates(nextBatch);
      setQuizIndex(0);
    }
    // Refresh the comfort pool itself — an answer of 4-5 should be
    // reflected in the featured pick right away, not just next reload.
    const comfort = await getComfortPicks(db);
    setComfortPool(comfort);
  }

  function handleSkipQuizGame() {
    if (quizIndex + 1 < quizCandidates.length) {
      setQuizIndex(quizIndex + 1);
    }
  }

  function handleShuffleComfort() {
    if (comfortPool.length <= 1) return;
    let next = comfortIndex;
    // Avoid landing back on the same pick when there's more than one to
    // choose from — a "shuffle" that visibly does nothing reads as broken.
    while (next === comfortIndex) {
      next = Math.floor(Math.random() * comfortPool.length);
    }
    setComfortIndex(next);
  }

  if (loading) return <p className="text-gray-400">Loading...</p>;
  if (error) return <p className="text-red-400">Failed to load Recommendations: {error}</p>;

  const comfortPick = comfortPool[comfortIndex] ?? null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-white">Recommendations</h1>
      <p className="mt-2 text-sm text-gray-400">
        Built from your own play history — ratings, backlog, wishlist, and favorites — not fetched
        from anywhere new.
      </p>

      <div className="mt-6 flex flex-wrap gap-2 border-b border-red-900/40 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "rounded-lg px-4 py-2 text-sm font-medium transition " +
              (tab === t.key ? "bg-amber-500 text-gray-950" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "franchises" && (
        <div>
          <p className="mt-4 text-sm text-gray-400">
            Groups you've rated highly, paired with the best unplayed game already in your library
            from that same group.
          </p>
          {franchiseSuggestions.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">
              Nothing to suggest yet — needs at least one finished, rated game in a franchise or
              collection with something else unplayed still in your library.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {franchiseSuggestions.map((s) => (
                <button
                  key={`${s.groupType}-${s.groupId}`}
                  onClick={() => onSelectGame({ id: s.candidateGameId, title: s.candidateTitle })}
                  className="flex flex-col text-left"
                >
                  <div className="aspect-[3/4] w-full overflow-hidden rounded-lg bg-gray-800 ring-1 ring-white/10 transition hover:ring-red-600">
                    {s.candidateCoverArtUrl ? (
                      <CoverArt
                        gameId={s.candidateGameId}
                        url={s.candidateCoverArtUrl}
                        alt={s.candidateTitle}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-gray-500">
                        {s.candidateTitle}
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-sm font-medium text-gray-200">{s.candidateTitle}</p>
                  <p className="truncate text-xs text-amber-400">
                    {s.groupType === "franchise" ? "Franchise" : "Collection"}: {s.groupName}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <StarRating rating={s.avgRating} />
                    <span className="text-xs text-gray-500">
                      ({s.gamesPlayed} played{s.candidateHasRecommendation ? ", GLIP pick" : ""})
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "backlog" && (
        <div>
          <p className="mt-4 text-sm text-gray-400">
            From your backlog — GLIP's trained recommendations where available, ranked by Desire to
            Play otherwise.
          </p>
          <BacklogStyleGrid
            suggestions={backlogSuggestions}
            emptyMessage="Nothing in the backlog yet, or nothing with a Desire to Play score set."
            onSelectGame={onSelectGame}
          />
        </div>
      )}

      {tab === "wishlist" && (
        <div>
          <p className="mt-4 text-sm text-gray-400">
            Games on your wishlist — ranked by GLIP's recommendation score where one exists,
            Desire to Play otherwise. GLIP's own candidate_pool.py currently excludes wishlist
            games from scoring entirely, by deliberate design ("a future acquisition pool, not
            part of recommendation evaluation") — so this will run on Desire to Play alone unless
            that's changed on the Python side.
          </p>
          <BacklogStyleGrid
            suggestions={wishlistSuggestions}
            emptyMessage="Nothing on the wishlist yet, or nothing with a Desire to Play score set."
            onSelectGame={onSelectGame}
          />
        </div>
      )}

      {tab === "comfort" && (
        <div>
          <p className="mt-4 text-sm text-gray-400">
            Games you've explicitly said feel cozy, via the quiz below — star rating and Favorite/Liked
            fill in for anything you haven't answered yet, since a highly-rated game isn't always a
            comfort game (a great horror game, say).
          </p>

          {!quizDismissed && quizCandidates.length > 0 && (
            <div className="mt-4 rounded-xl bg-gray-800/60 p-5 ring-1 ring-amber-500/30">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Comfort Quiz</p>
                <p className="text-xs text-gray-500">{quizRemainingCount} left to answer</p>
              </div>
              {(() => {
                const candidate = quizCandidates[quizIndex];
                if (!candidate) return null;
                return (
                  <div className="mt-3 flex items-center gap-5">
                    <div className="h-32 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-gray-900 ring-1 ring-white/10">
                      {candidate.coverArtUrl ? (
                        <CoverArt
                          gameId={candidate.gameId}
                          url={candidate.coverArtUrl}
                          alt={candidate.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-gray-500">
                          {candidate.title}
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-base font-semibold text-white">{candidate.title}</p>
                      {candidate.rating != null && (
                        <div className="mt-1">
                          <StarRating rating={candidate.rating} />
                        </div>
                      )}
                      <p className="mt-2 text-sm text-gray-400">Is this a comfort game for you?</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {COMFORT_QUIZ_OPTIONS.map((opt) => (
                          <button
                            key={opt.score}
                            onClick={() => handleAnswerQuiz(candidate.gameId, opt.score)}
                            className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-gray-300 ring-1 ring-white/10 hover:bg-amber-500 hover:text-gray-950"
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <div className="mt-2 flex gap-3">
                        <button onClick={handleSkipQuizGame} className="text-xs text-gray-500 hover:text-gray-300">
                          Skip this one
                        </button>
                        <button onClick={() => setQuizDismissed(true)} className="text-xs text-gray-500 hover:text-gray-300">
                          Stop the quiz for now
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          {quizDismissed && quizRemainingCount > 0 && (
            <button
              onClick={() => setQuizDismissed(false)}
              className="mt-4 text-sm text-amber-400 underline hover:text-amber-300"
            >
              Resume the Comfort Quiz ({quizRemainingCount} left)
            </button>
          )}

          {comfortPick === null ? (
            <p className="mt-4 text-sm text-gray-500">
              Nothing qualifies yet — finish and rate a few games, mark some as Favorite or Liked, or
              answer a few rounds of the quiz above.
            </p>
          ) : (
            <div className="mt-4 flex items-center gap-6 rounded-xl bg-gray-800/60 p-5 ring-1 ring-white/10">
              <button
                onClick={() => onSelectGame({ id: comfortPick.gameId, title: comfortPick.title })}
                className="h-40 w-28 flex-shrink-0 overflow-hidden rounded-lg bg-gray-800 ring-1 ring-white/10 transition hover:ring-red-600"
              >
                {comfortPick.coverArtUrl ? (
                  <CoverArt
                    gameId={comfortPick.gameId}
                    url={comfortPick.coverArtUrl}
                    alt={comfortPick.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-gray-500">
                    {comfortPick.title}
                  </div>
                )}
              </button>
              <div className="flex-1">
                <p className="text-lg font-semibold text-white">{comfortPick.title}</p>
                <div className="mt-1 flex items-center gap-2">
                  {comfortPick.rating != null && <StarRating rating={comfortPick.rating} />}
                  {comfortPick.comfortScore != null && (
                    <span className="text-xs text-amber-400">Comfort Quiz: {comfortPick.comfortScore}/5</span>
                  )}
                  {comfortPick.isFavorite && <span className="text-xs text-amber-400">★ Favorite</span>}
                  {comfortPick.isLiked && <span className="text-xs text-amber-400">♥ Liked</span>}
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  {comfortPool.length} comfort pick{comfortPool.length === 1 ? "" : "s"} qualify — shuffle for another.
                </p>
              </div>
              <button
                onClick={handleShuffleComfort}
                disabled={comfortPool.length <= 1}
                className="flex-shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-gray-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Shuffle
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "installed" && (
        <div>
          <p className="mt-4 text-sm text-gray-400">
            Sourced from the Hardware page's last scan — visit Hardware → "Installed & ROMs" → "Scan
            Now" to refresh this list. Not scanned live from here.
          </p>
          {installed.length === 0 ? (
            <p className="mt-4 text-sm text-gray-500">
              Nothing yet — run a scan from the Hardware page's "Installed & ROMs" tab first.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {installed.map((g) => (
                <button
                  key={g.gameId}
                  onClick={() => onSelectGame({ id: g.gameId, title: g.title })}
                  className="flex flex-col text-left"
                >
                  <div className="aspect-[3/4] w-full overflow-hidden rounded-lg bg-gray-800 ring-1 ring-white/10 transition hover:ring-red-600">
                    {g.coverArtUrl ? (
                      <CoverArt gameId={g.gameId} url={g.coverArtUrl} alt={g.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-gray-500">
                        {g.title}
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-sm font-medium text-gray-200">{g.title}</p>
                  <p className="truncate text-xs text-amber-400 capitalize">{g.source}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

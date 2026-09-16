import { useEffect, useState } from "react";

import Dashboard from "./pages/Dashboard";
import Library from "./pages/Library";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import GameDetail from "./pages/GameDetail";
import ExpiredSubscriptions from "./pages/ExpiredSubscriptions";
import TimeGallery from "./pages/TimeGallery";
import SeriesCompletion from "./pages/SeriesCompletion";
import Recommendations from "./pages/Recommendations";
import Hardware from "./pages/Hardware";

import { initializeDatabase, getDatabase } from "./database/database";
import { Game } from "./types/game";

type Page =
  | "dashboard"
  | "library"
  | "game"
  | "analytics"
  | "settings"
  | "expired"
  | "timegallery"
  | "series"
  | "recommendations"
  | "hardware";

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const [selectedGameId, setSelectedGameId] = useState<string>("");
  const [selectedGameTitle, setSelectedGameTitle] = useState("");

  const [allGames, setAllGames] = useState<{ id: string; title: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    // NOTE: this used to also auto-import a hardcoded test file
    // (`bg3-test.json`) on every single app launch. That file didn't
    // actually exist in this project, so this effect was crashing on
    // startup with a broken module reference — and even if it had existed,
    // re-importing the same test game every time the app opens isn't
    // something a real import flow should do. Importing is now a
    // deliberate action the user takes from Settings (see Settings.tsx).
    initializeDatabase()
      .then(async () => {
        setDbReady(true);
        // One-time fetch for the sidebar's global search — a personal
        // library's title list is small enough to filter client-side on
        // every keystroke rather than round-tripping to SQLite each time,
        // the same reasoning already used for the smaller per-page
        // searches in Settings and Series Completion.
        const db = await getDatabase();
        const rows = await db.select<{ Id: string; Title: string }>(`SELECT Id, Title FROM Games ORDER BY Title`);
        setAllGames(rows.map((r) => ({ id: r.Id, title: r.Title })));
      })
      .catch((error) => setDbError(String(error)));
  }, []);

  function handleSelectGame(game: Game) {
    setSelectedGameId(game.id);
    setSelectedGameTitle(game.title);
    setPage("game");
  }

  const renderPage = () => {
    if (dbError) {
      return (
        <div className="text-red-400">
          <h2 className="text-lg font-semibold">Database failed to initialize</h2>
          <p className="mt-1 text-sm">{dbError}</p>
        </div>
      );
    }

    if (!dbReady) {
      return <p className="text-gray-400">Loading GameVault...</p>;
    }

    switch (page) {
      case "dashboard":
        return <Dashboard onGoToSettings={() => setPage("settings")} onSelectGame={handleSelectGame} />;

      case "library":
        return <Library onSelectGame={handleSelectGame} />;

      case "game":
        return selectedGameId ? (
          <GameDetail gameId={selectedGameId} gameTitle={selectedGameTitle} />
        ) : (
          <p className="text-gray-400">Select a game from the Library to see its details.</p>
        );

      case "analytics":
        return <Analytics />;

      case "expired":
        return <ExpiredSubscriptions onSelectGame={handleSelectGame} />;

      case "timegallery":
        return <TimeGallery onSelectGame={handleSelectGame} />;

      case "series":
        return <SeriesCompletion onSelectGame={handleSelectGame} />;

      case "recommendations":
        return <Recommendations onSelectGame={handleSelectGame} />;

      case "hardware":
        return <Hardware onSelectGame={handleSelectGame} />;

      case "settings":
        return <Settings />;

      default:
        return <Library onSelectGame={handleSelectGame} />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-950 text-white">
      <aside className="flex w-56 flex-col border-r border-red-900/40 bg-gray-900 p-5">
        <h1 className="bg-gradient-to-r from-red-500 to-amber-400 bg-clip-text text-xl font-bold tracking-tight text-transparent">
          GameVault
        </h1>

        <div className="mt-4 relative">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your library..."
            className="w-full rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-gray-100 ring-1 ring-white/10 focus:outline-none focus:ring-amber-500"
          />
          {searchQuery.trim() && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg bg-gray-800 py-1 ring-1 ring-white/10">
              {allGames
                .filter((g) => g.title.toLowerCase().includes(searchQuery.trim().toLowerCase()))
                .slice(0, 8)
                .map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      handleSelectGame(g);
                      setSearchQuery("");
                    }}
                    className="block w-full truncate px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-700"
                  >
                    {g.title}
                  </button>
                ))}
              {allGames.filter((g) => g.title.toLowerCase().includes(searchQuery.trim().toLowerCase())).length === 0 && (
                <p className="px-3 py-1.5 text-sm text-gray-500">No matches.</p>
              )}
            </div>
          )}
        </div>

        <nav className="mt-6 flex flex-col gap-1">
          {(
            [
              ["dashboard", "Dashboard"],
              ["library", "Library"],
              ["game", "Game Detail"],
              ["analytics", "Analytics"],
              ["timegallery", "Time Gallery"],
              ["series", "Series Completion"],
              ["recommendations", "Recommendations"],
              ["hardware", "Hardware"],
              ["expired", "Expired Subscriptions"],
              ["settings", "Settings"],
            ] as [Page, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPage(key)}
              className={
                "rounded-lg px-3 py-2 text-left text-sm font-medium transition " +
                (page === key
                  ? "bg-gradient-to-r from-red-600 to-amber-500 text-gray-950 font-semibold"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-200")
              }
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">{renderPage()}</main>
    </div>
  );
}

export default App;

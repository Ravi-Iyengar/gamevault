import { useEffect, useState } from "react";

import Dashboard from "./pages/Dashboard";
import Library from "./pages/Library";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import GameDetail from "./pages/GameDetail";

import { initializeDatabase } from "./database/database";

import {
  importGame,
  bg3Test
} from "./importers/BackloggdJsonImporter";

function App() {
  const [page, setPage] = useState("game");

  useEffect(() => {
    async function startup() {
      await initializeDatabase();

      await importGame(bg3Test);
    }

    startup();
  }, []);
const [selectedGameId, setSelectedGameId] =
  useState<string>("");

const [selectedGameTitle, setSelectedGameTitle] =
  useState("");
  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <Dashboard />;

      case "library":
        return <Library
  onSelectGame={(game) => {
    setSelectedGameId(game.id);
    setSelectedGameTitle(game.title);
    setPage("game");
  }}
/>

      case "game":
        return (
          <GameDetail
  gameId={selectedGameId}
  gameTitle={selectedGameTitle}
/>
        );

      case "analytics":
        return <Analytics />;

      case "settings":
        return <Settings />;

      default:
        return <Library
  onSelectGame={(game) => {
    setSelectedGameId(game.id);
    setSelectedGameTitle(game.title);
    setPage("game");
  }}
/>
    }
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: "#111827",
        color: "white",
      }}
    >
      <aside
        style={{
          width: "220px",
          padding: "20px",
          backgroundColor: "#1f2937",
          borderRight: "1px solid #374151",
        }}
      >
        <h1>GameVault</h1>

        <hr />

        <button onClick={() => setPage("dashboard")}>
          Dashboard
        </button>

        <br />
        <br />

        <button onClick={() => setPage("library")}>
          Library
        </button>

        <br />
        <br />

        <button onClick={() => setPage("game")}>
          Game Detail
        </button>

        <br />
        <br />

        <button onClick={() => setPage("analytics")}>
          Analytics
        </button>

        <br />
        <br />

        <button onClick={() => setPage("settings")}>
          Settings
        </button>
      </aside>

      <main
        style={{
          flex: 1,
          padding: "30px",
        }}
      >
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
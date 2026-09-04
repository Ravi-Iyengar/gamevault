import { useState } from "react";

import Dashboard from "./pages/Dashboard";
import Library from "./pages/Library";
import Analytics from "./pages/Analytics";
import Settings from "./pages/Settings";
import { useEffect } from "react";
import { initializeDatabase } from "./database/database";

function App() {
  useEffect(() => {
initializeDatabase();
}, []);
  const [page, setPage] = useState("library");

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <Dashboard />;
      case "library":
        return <Library />;
      case "analytics":
        return <Analytics />;
      case "settings":
        return <Settings />;
      default:
        return <Library />;
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
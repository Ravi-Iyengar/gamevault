import { useEffect, useState } from "react";
import { getGames } from "../services/GameService";
import { Game } from "../types/game";

export default function Library() {
  const [games, setGames] = useState<Game[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getGames().then(setGames);
  }, []);

  const filteredGames = games.filter((game) =>
    game.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <h1>Library</h1>

      <input
        type="text"
        placeholder="Search games..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {filteredGames.map((game) => (
        <div
          key={game.id}
          style={{
            padding: "16px",
            marginTop: "12px",
            borderRadius: "8px",
            backgroundColor: "#1f2937",
          }}
        >
          <h3>{game.title}</h3>
          <p>Released: {game.releaseYear}</p>
          <p>Rating: {game.rating}/10</p>
        </div>
      ))}
    </div>
  );
}
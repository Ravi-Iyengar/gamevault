import { useEffect, useState } from "react";
import { getGames } from "../services/GameService"; 
import { Game } from "../types/game";

export default function Library() {
  const [games, setGames] = useState<Game[]>([]);

  useEffect(() => {
    getGames().then(setGames);
  }, []);

  return (
    <div>
      <h1>Library</h1>

      {games.map((game) => (
        <div
          key={game.id}
          style={{
            padding: "16px",
            marginBottom: "12px",
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
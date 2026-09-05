import { useEffect, useState } from "react";
import { getGames } from "../services/GameService";
import { Game } from "../types/game";


interface Props {
  onSelectGame: (game: Game) => void;
}

export default function Library({
  onSelectGame,
}: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getGames().then(setGames);
  }, []);

  const filteredGames = games.filter((game) =>
    (game.title ?? "").toLowerCase().includes(search.toLowerCase())
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
          onClick = {() => onSelectGame(game)}
          style={{
            cursor: "pointer",
            padding: "16px",
            marginTop: "12px",
            borderRadius: "8px",
            backgroundColor: "#1f2937",
          }}
        >
          <h3>{game.title}</h3>
<p>Playthroughs: {game.playthroughCount}</p>
<p>Hours Played: {game.totalHoursPlayed}</p>
<p>Latest Rating: {game.latestRating}/10</p>        </div>
      ))}
    </div>
  );
}
import { useEffect, useState } from "react";

import { Playthrough } from "../types/playthrough";
import { getPlaythroughsByGameId } from "../services/PlaythroughService";

interface Props {
  gameId: string;
  gameTitle: string;
}

export default function GameDetail({
  gameId,
  gameTitle
}: Props) {
  const [playthroughs, setPlaythroughs] =
    useState<Playthrough[]>([]);

  useEffect(() => {
    getPlaythroughsByGameId(gameId)
      .then(setPlaythroughs);
  }, [gameId]);

  return (
    <div>
      <h1>{gameTitle}</h1>

      <h2>Playthroughs</h2>

      {playthroughs.map((playthrough) => (
        <div
          key={playthrough.id}
          style={{
            padding: "16px",
            marginTop: "12px",
            borderRadius: "8px",
            backgroundColor: "#1f2937",
          }}
        >
          <h3>{playthrough.title}</h3>

          <p>
            Rating: {playthrough.rating}/10
          </p>

          <p>
            Hours Played:
            {" "}
            {playthrough.hoursPlayed}
          </p>

          <p>
            Start:
            {" "}
            {playthrough.startDate}
          </p>

          <p>
            Finish:
            {" "}
            {playthrough.finishDate}
          </p>

          {playthrough.review && (
            <p>
              Review:
              {" "}
              {playthrough.review}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
import { useEffect, useState } from "react";

import { Playthrough } from "../types/playthrough";
import { getPlaythroughsByGameId } from "../services/PlaythroughService";

interface Props {
  gameId: string;
  gameTitle: string;
}

export default function GameDetail({
  gameId,
  gameTitle,
}: Props) {
  const [playthroughs, setPlaythroughs] =
    useState<Playthrough[]>([]);

  const [selectedIndex, setSelectedIndex] =
    useState(0);

  useEffect(() => {
    getPlaythroughsByGameId(gameId)
      .then(setPlaythroughs);
  }, [gameId]);

  const selectedPlaythrough =
    playthroughs[selectedIndex];

  return (
    <div>
      <h1>{gameTitle}</h1>

      <div
        style={{
          padding: "16px",
          marginBottom: "24px",
          borderRadius: "8px",
          backgroundColor: "#1f2937",
        }}
      >
        <h2>Statistics</h2>

        <p>
          Playthroughs: {playthroughs.length}
        </p>

        <p>
          Total Hours:{" "}
          {playthroughs.reduce(
            (sum, p) => sum + (p.hoursPlayed ?? 0),
            0
          )}
        </p>
      </div>

      <h2>Playthroughs</h2>

      {selectedPlaythrough && (
        <div
          style={{
            padding: "16px",
            borderRadius: "8px",
            backgroundColor: "#1f2937",
          }}
        >
          <h3>{selectedPlaythrough.title}</h3>

          <p>
            Rating: {selectedPlaythrough.rating}/10
          </p>

          <p>
            Hours Played:{" "}
            {selectedPlaythrough.hoursPlayed}
          </p>

          <p>
            Start:{" "}
            {selectedPlaythrough.startDate}
          </p>

          <p>
            Finish:{" "}
            {selectedPlaythrough.finishDate}
          </p>

          <div
            style={{
              marginTop: "16px",
              display: "flex",
              gap: "10px",
            }}
          >
            <button
              onClick={() =>
                setSelectedIndex(
                  Math.max(
                    0,
                    selectedIndex - 1
                  )
                )
              }
              disabled={selectedIndex === 0}
            >
              Previous
            </button>

            <button
              onClick={() =>
                setSelectedIndex(
                  Math.min(
                    playthroughs.length - 1,
                    selectedIndex + 1
                  )
                )
              }
              disabled={
                selectedIndex ===
                playthroughs.length - 1
              }
            >
              Next
            </button>
          </div>

          <p
            style={{
              marginTop: "12px",
              fontSize: "0.9rem",
              color: "#9ca3af",
            }}
          >
            Playthrough {selectedIndex + 1} of{" "}
            {playthroughs.length}
          </p>

          {selectedPlaythrough.review && (
            <details
              style={{
                marginTop: "16px",
              }}
            >
              <summary>View Review</summary>

              <p
                style={{
                  marginTop: "12px",
                }}
              >
                {selectedPlaythrough.review}
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
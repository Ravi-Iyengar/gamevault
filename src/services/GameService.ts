import { Game } from "../types/game";

export async function getGames(): Promise<Game[]> {
  return [
    {
      id: "1",
      title: "Baldur's Gate 3",
      releaseYear: 2023,
      rating: 10,
    },
    {
      id: "2",
      title: "Hollow Knight",
      releaseYear: 2017,
      rating: 9.5,
    },
    {
      id: "3",
      title: "Persona 5 Royal",
      releaseYear: 2020,
      rating: 9,
    },
  ];
}

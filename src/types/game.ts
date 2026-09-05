export interface Game {
  id: string;

  title: string;

  releaseDate?: string;
  releaseYear?: number;

  summary?: string;

  playthroughCount?: number;
  latestRating?: number;
  totalHoursPlayed?: number;
}
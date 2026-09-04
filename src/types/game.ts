export interface Game {
  id: string;
  igdbId?: number;

  title: string;

  releaseDate?: string;
  releaseYear?: number;

  summary?: string;

  rating?: number;
}
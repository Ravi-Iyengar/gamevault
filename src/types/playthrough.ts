export interface Playthrough {
  id: string;

  gameId: string;

  title?: string;

  startDate?: string;
  finishDate?: string;

  rating?: number;

  review?: string;

  replay?: boolean;
  mastered?: boolean;

  hoursPlayed?: number;
}
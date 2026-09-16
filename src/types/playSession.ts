export interface PlaySession {
  id: string;

  playthroughId: string;

  sessionDate: string;

  hours: number;

  minutes: number;

  note?: string;
}
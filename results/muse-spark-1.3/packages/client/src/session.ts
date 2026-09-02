import type { RoomState, SnapPlayer, SnapBalloon, Placement, GameMode, MapTheme } from '@splash/shared';

// Shared session across screens.
export const session: {
  room: RoomState | null;
  code: string | null;
  mode: GameMode;
  theme: MapTheme;
  roundsToWin: number;
  roundNo: number;
  castles: number[][];
  w: number;
  h: number;
  players: SnapPlayer[];
  balloons: SnapBalloon[];
  splashes: { x: number; y: number; ttl: number }[];
  powerups: { x: number; y: number; kind: string }[];
  tideRing: number;
  scores: Record<string, number>;
  placements: Placement[] | null;
  ratingDeltas: Record<string, number> | null;
  xp: Record<string, number> | null;
  queue: { mode: GameMode; elapsedS: number; searchRange: number } | null;
  countdown: string;
} = {
  room: null,
  code: null,
  mode: 'duel',
  theme: 'backyard',
  roundsToWin: 3,
  roundNo: 1,
  castles: [],
  w: 13,
  h: 11,
  players: [],
  balloons: [],
  splashes: [],
  powerups: [],
  tideRing: 0,
  scores: {},
  placements: null,
  ratingDeltas: null,
  xp: null,
  queue: null,
  countdown: '',
};

export function resetMatch(): void {
  session.placements = null;
  session.ratingDeltas = null;
  session.xp = null;
  session.scores = {};
  session.roundNo = 1;
}

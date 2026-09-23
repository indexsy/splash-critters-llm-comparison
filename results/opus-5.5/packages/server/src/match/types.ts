// Domain types shared by rooms, the match runner, the tutorial and the matchmaker.
import type {
  AnimalId,
  Difficulty,
  GameEvent,
  GeneratedMap,
  HatId,
  Mode,
  PlayerInput,
  RoundState,
  ThemeChoice,
  TierId,
} from '@splash/shared';

/**
 * Server-side AI brain (implemented in bots/bot.ts, see ARCHITECTURE.md section 5). Declared here
 * structurally so the game loop depends only on the interface; the composition root injects
 * the real `createBot`.
 */
export interface BotBrain {
  readonly slot: number;
  readonly difficulty: Difficulty;
  /** Called once per sim tick BEFORE simulateTick; returns this tick's input. */
  nextInput(state: RoundState): PlayerInput;
  /** Called at each round start. */
  reset(): void;
}

export type BotFactory = (
  slot: number,
  difficulty: Difficulty,
  seed: number,
  opts?: { passive?: boolean },
) => BotBrain;

/** What rooms and the matchmaker know about a connected human (fresh from the db on each use). */
export interface MemberInfo {
  playerId: string;
  name: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  level: number;
  hasNickname: boolean;
}

export type RoomKind = 'casual' | 'practice' | 'ranked' | 'tutorial';

/** One seated participant of a match: a human (playerId) or a bot (playerId null + difficulty). */
export interface MatchParticipant {
  slot: number;
  playerId: string | null;
  difficulty?: Difficulty;
  /** Tutorial bot: never places balloons. */
  passive?: boolean;
  name: string;
  tag: string;
  animal: AnimalId;
  hat: HatId;
  level: number;
  /** Ranked only. */
  rating?: number;
  tier?: TierId;
}

export interface MatchSetup {
  matchId: string;
  roomCode: string;
  kind: RoomKind;
  mode: Mode;
  /** Number of slots (arena spawn count). */
  size: number;
  /** Arena size sent in MatchConfig (mode arena, or the tutorial map). */
  w: number;
  h: number;
  roundsToWin: number;
  theme: ThemeChoice;
  participants: MatchParticipant[];
  /** Secret per-match seed: round map seeds derive from it and never leave the server. */
  seed: number;
}

/** Customisation points used by the tutorial sandbox. */
export interface MatchHooks {
  /** Map for a round (default: generateMap(mode, roundSeed)). */
  buildMap?: (roundSeed: number) => GeneratedMap;
  /**
   * Runs after every simulated tick, before the tick's events are broadcast. May mutate the
   * state (sandbox revives) and append events (e.g. a spawned power-up's powerup_revealed).
   */
  afterTick?: (state: RoundState, events: GameEvent[], now: number) => void;
  /** A player re-attached mid-match (after match_start / round_start were re-sent). */
  onResync?: (playerId: string) => void;
}

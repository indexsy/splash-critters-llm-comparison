// Read-only view of the match handed to the renderer once per frame. The game/ modules own
// the state; render/ modules only draw what a Scene describes.
import type { DirCode, MatchConfig, PlayerRoundSummary, RoundState, Theme } from '@splash/shared';
import type { MatchVerdict } from './verdict';

export type MatchPhase =
  /** No match config yet (screen opened before match_start, or a reconnect in progress). */
  | 'waiting'
  /** match_start received: VS card until the first round_start. */
  | 'intro'
  /** round_start received: 3-2-1, then "SPLASH!" until the round's first tick (see isRoundLive). */
  | 'countdown'
  | 'live'
  /** round_over event received, waiting for round_end (splashes settle). */
  | 'round_over'
  /** round_end received: result card until the next round_start or the match ends. */
  | 'result';

export interface RoundInfo {
  roundNo: number;
  theme: Theme;
  mapSeed: number;
  /** Server time of tick 0. */
  startTime: number;
  tideStartTick: number;
  /** True when this round_start re-attached us mid-round (no countdown, no intro). */
  resumed: boolean;
  /** Critters taking part when the round started (showdown needs the field to have narrowed). */
  contenders: number;
}

export interface RoundResult {
  roundNo: number;
  /** Winner of this round (-1 for a draw). */
  winner: number;
  scores: number[];
  summaries: PlayerRoundSummary[];
  matchOver: boolean;
  /** Who won the match (final round only; null otherwise). */
  verdict: MatchVerdict | null;
  /** performance.now() when round_end arrived. */
  atMs: number;
}

export interface SlotStatus {
  connected: boolean;
  replacedByBot: boolean;
  forfeited: boolean;
}

/** A critter (or its revenge duck) as it should be drawn this frame, in sub-units. */
export interface ActorView {
  slot: number;
  local: boolean;
  x: number;
  y: number;
  facing: DirCode;
  moving: boolean;
  alive: boolean;
  /** Revenge duck position (sub-units) while riding one. */
  duck: { x: number; y: number } | null;
  /** Ticks until the duck may lob again (0 = ready). */
  duckCooldown: number;
}

/** A balloon the local player just dropped, shown until the server's balloon arrives. */
export interface GhostDrop {
  tx: number;
  ty: number;
  slot: number;
  untilMs: number;
}

export interface Scene {
  nowMs: number;
  serverNow: number;
  /** Fractional server tick estimate (fuses, duck cooldowns, tide timer). */
  estTick: number;
  colorblind: boolean;
  showPing: boolean;
  config: MatchConfig;
  mySlot: number;
  phase: MatchPhase;
  introStartMs: number;
  round: RoundInfo | null;
  /** Predicted world: authoritative state plus the local player's predicted movement and kicks. */
  world: RoundState | null;
  actors: ActorView[];
  /**
   * Draw positions (sub-units) of the local player's own sliding balloons, predicted with the
   * critter; every other balloon is drawn from the snapshots.
   */
  ownSlides: ReadonlyMap<number, { x: number; y: number }>;
  drops: readonly GhostDrop[];
  scores: readonly number[];
  pings: readonly number[];
  status: ReadonlyMap<number, SlotStatus>;
  result: RoundResult | null;
}

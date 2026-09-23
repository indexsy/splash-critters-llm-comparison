// Was a bot's self-soak forced by an opponent, or its own blunder? The sim credits a soak to
// whoever set the fatal cascade off: a bot soaked by a cascade that its own balloon (or its own
// lingering splash) set off soaked itself, even when an opponent's balloon in that cascade
// painted the tile. Such a self-soak counts as forced only when an opponent demonstrably took the
// last escape away. The recording is replayed from the cut (the victim's last balloon placed
// into the fatal cascade); a "way out" is what an exact search finds (no safety margin, the
// victim's real speed, the bots' own danger model): a reachable tile that stays dry through
// every pending burst. Forced means all of:
//   1. the victim had a way out right after the cut (else its own drop sealed its fate);
//   2. the last way out was lost during a tick in which an opponent placed, lobbed or kicked a
//      balloon, and with those actions taken out of that one tick the victim would still have
//      had a way out (else the victim ran out of time or walked into the trap by itself);
//   3. the victim did not dawdle before that: it never stood still for DAWDLE_TICKS in a row in
//      its own splash lines (a tile a pending cascade holding one of its balloons will wet) while
//      it had a way out. Careful bots leave their own lines at once; idling there until someone
//      closes them is the victim's blunder (waiting elsewhere for a path to dry is not).
import { CONFIG, DIR_DX, DIR_DY, Dir, cloneState, simulateTick, tileOf, type GameEvent, type PlayerInput, type PlayerState, type RoundState } from '@splash/shared';
import { DangerMap } from '../../src/bots/dangerMap';
import { buildBlocked, moverOf, playerTileIndex, predictStep, tileIndex, wouldKick } from '../../src/bots/motion';
import { searchReach } from '../../src/bots/pathing';
import type { SoakFacts } from './balloonLog';
import { decodeInput } from './round';

/** How to restart a recorded round. */
export interface RoundSource {
  /** A fresh copy of the round's starting state. */
  start(): RoundState;
}

export interface SelfSoak {
  slot: number;
  /** Tick the victim was soaked. */
  tick: number;
  facts: SoakFacts;
}

/** Standing still this long in its own splash lines, with a way out, is dawdling (longer than any splash to wait out). */
export const DAWDLE_TICKS = 2 * CONFIG.SPLASH_TICKS;

/** Latest tick of every pending splash (and lingering water), capped by the flooding of the arena. */
function lastPendingWet(s: RoundState, danger: DangerMap): number {
  let last = s.tick + 1;
  for (const b of s.balloons) {
    const burst = danger.burstTickOf(b.id);
    if (burst !== Infinity) last = Math.max(last, burst + CONFIG.SPLASH_TICKS);
  }
  for (let i = 0; i < s.splashUntil.length; i++) last = Math.max(last, s.splashUntil[i]);
  return Math.min(last, danger.lastFloodTick);
}

/** The victim's situation: does it have a way out, and is it standing in its own splash lines? */
interface Outlook {
  wayOut: boolean;
  inOwnLine: boolean;
}

function outlook(s: RoundState, slot: number): Outlook {
  const danger = DangerMap.fromState(s);
  const until = lastPendingWet(s, danger);
  const reach = searchReach({
    danger,
    blocked: buildBlocked(s, danger.balloonTiles()),
    mover: moverOf(s.players[slot]),
    startTick: s.tick,
    campUntil: until,
    horizon: s.tick + CONFIG.FUSE_TICKS + CONFIG.SPLASH_TICKS + 60,
    margin: 0,
    stopAfter: 1,
  });
  return { wayOut: reach.campTiles.length > 0, inOwnLine: danger.tilesWetBy(slot).includes(playerTileIndex(s, s.players[slot])) };
}

/** Could `slot` still reach a tile that stays dry through every pending burst? */
export function hasWayOut(s: RoundState, slot: number): boolean {
  return outlook(s, slot).wayOut;
}

/** The recorded inputs of the tick that takes the state from its current tick to the next one. */
function recordedTick(inputs: Uint8Array, s: RoundState): (PlayerInput | null)[] {
  const slots = s.players.length;
  const tick: (PlayerInput | null)[] = [];
  for (let slot = 0; slot < slots; slot++) tick.push(decodeInput(inputs[s.tick * slots + slot], s.tick + 1));
  return tick;
}

/** The recorded round replayed (sim only) until the state's tick is `until`. */
function recordedStateAt(source: RoundSource, inputs: Uint8Array, until: number): RoundState {
  const state = source.start();
  while (state.tick < until) simulateTick(state, recordedTick(inputs, state));
  return state;
}

/** The tile a balloon the victim drops this tick lands on (after its move), -1 if it drops none. */
function dropTileOf(state: RoundState, victim: PlayerState, input: PlayerInput | null): number {
  if (!input?.balloon || !victim.alive) return -1;
  const pos = predictStep(state, victim, input.dir);
  return tileIndex(state, pos.x, pos.y);
}

/**
 * Could pressing `dir` this tick kick a balloon: one resting ahead, or the one the victim drops
 * ahead during this very tick (players act in slot order, so it may already be there)?
 */
function mayKick(state: RoundState, p: PlayerState, dir: PlayerInput['dir'], dropTile: number): boolean {
  if (!p.alive || dir === Dir.None) return false;
  if (wouldKick(state, p, dir)) return true;
  const ahead = (tileOf(p.y) + DIR_DY[dir]) * state.w + tileOf(p.x) + DIR_DX[dir];
  return state.rules.kick && p.canKick && ahead === dropTile;
}

/** The tick's inputs with every opponent's balloon action (placement, lob, possible kick) taken away. */
function withoutOpponentActions(state: RoundState, tick: (PlayerInput | null)[], victim: number): (PlayerInput | null)[] {
  const dropTile = dropTileOf(state, state.players[victim], tick[victim]);
  return tick.map((input, slot) => {
    if (!input || slot === victim) return input;
    const kick = mayKick(state, state.players[slot], input.dir, dropTile);
    return { ...input, balloon: false, dir: kick ? Dir.None : input.dir };
  });
}

/** The opponent balloon action that took a victim's last way out away. */
export type ForcedBy = 'drop' | 'lob' | 'kick';

/** The kind of the first opponent balloon action among a tick's events, null if none. */
function opponentAction(events: GameEvent[], victim: number): ForcedBy | null {
  for (const e of events) {
    if (e.type === 'balloon_placed' && e.owner !== victim) return 'drop';
    if (e.type === 'revenge_lob' && e.slot !== victim) return 'lob';
    if (e.type === 'balloon_kicked' && e.slot !== victim) return 'kick';
  }
  return null;
}

/** Where the victim was when it last had a way out, and whether it had dawdled until then. */
interface LastChance {
  /** It had a way out right after the cut. */
  fromCut: boolean;
  /** The state before the tick that took the last way out away (null: none after the cut). */
  before: RoundState | null;
  dawdled: boolean;
}

/** Replays from the cut to the soak, tracking the victim's ways out and its idling. */
function lastChance(state: RoundState, inputs: Uint8Array, soak: SelfSoak): LastChance {
  let before: RoundState | null = null;
  let dawdled = false;
  let idle = 0;
  let longestIdle = 0;
  let now = outlook(state, soak.slot);
  const fromCut = now.wayOut;
  while (state.tick < soak.tick) {
    const snapshot = now.wayOut ? cloneState(state) : null;
    const me = state.players[soak.slot];
    const [x, y] = [me.x, me.y];
    simulateTick(state, recordedTick(inputs, state));
    idle = snapshot && now.inOwnLine && me.x === x && me.y === y ? idle + 1 : 0;
    longestIdle = Math.max(longestIdle, idle);
    now = state.tick < soak.tick ? outlook(state, soak.slot) : { wayOut: false, inOwnLine: true };
    if (snapshot && !now.wayOut) {
      before = snapshot;
      dawdled = longestIdle >= DAWDLE_TICKS;
    }
  }
  return { fromCut, before, dawdled };
}

/**
 * How an opponent forced this self-soak (see the header): the kind of balloon action that took the
 * victim's last way out away; null when the self-soak was the victim's own blunder.
 */
export function forcedBy(source: RoundSource, inputs: Uint8Array, soak: SelfSoak): ForcedBy | null {
  const { cut, lastOpponentAction } = soak.facts;
  if (lastOpponentAction < cut || cut >= soak.tick) return null;
  const { fromCut, before, dawdled } = lastChance(recordedStateAt(source, inputs, cut), inputs, soak);
  if (!fromCut || !before || dawdled) return null;
  const tick = recordedTick(inputs, before);
  const action = opponentAction(simulateTick(cloneState(before), tick), soak.slot);
  if (!action) return null;
  const counterfactual = cloneState(before);
  if (opponentAction(simulateTick(counterfactual, withoutOpponentActions(before, tick, soak.slot)), soak.slot)) {
    throw new Error('self-soak counterfactual kept an opponent balloon action');
  }
  return counterfactual.players[soak.slot].alive && hasWayOut(counterfactual, soak.slot) ? action : null;
}

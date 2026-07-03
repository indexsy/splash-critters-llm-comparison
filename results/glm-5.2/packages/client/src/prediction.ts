// prediction.ts — client-side prediction + reconciliation (spec §8).
// The local player's inputs are applied immediately to a predicted state via the
// shared deterministic sim. On each authoritative snapshot, we rewind to the
// server tick and replay buffered inputs, snapping if drift exceeds a threshold.

import {
  newMatchState,
  simulateTick,
  TICK_HZ,
  type GameMode,
  type Input,
  type MatchState,
  type Snapshot,
} from "@splash/shared";

export interface LocalInput {
  dir: number; // -1 none
  balloonPressed: boolean;
}

export class Prediction {
  // authoritative display state (the one we render)
  state: MatchState;
  // pending unacked local inputs keyed by seq
  pending: Input[] = [];
  seq = 1;
  yourPlayerId = 0;
  lastAckedTick = 0;
  mode: GameMode;

  constructor(mode: GameMode, seed: number, numPlayers: number) {
    this.mode = mode;
    this.state = newMatchState(seed, mode, numPlayers).state;
  }

  resetRound(seed: number) {
    const wins = this.state.players.map((p) => p.roundsWon);
    this.state = newMatchState(seed, this.mode, this.state.players.length).state;
    this.state.players.forEach((p, i) => (p.roundsWon = wins[i] ?? 0));
    this.pending = [];
  }

  /** Called at the network tick: gather local input, send to server AND step locally. */
  step(localInput: LocalInput, tick: number): Input | null {
    const input: Input = {
      seq: this.seq++,
      tick,
      dir: localInput.dir as -1 | 0 | 1 | 2 | 3,
      balloonPressed: localInput.balloonPressed,
    };
    this.pending.push(input);
    // apply to predicted state
    const inputs = new Map<number, Input[]>();
    inputs.set(this.yourPlayerId, [input]);
    simulateTick(this.state, inputs);
    return input;
  }

  /** On authoritative snapshot, reconcile: rewind to snapshot tick and replay. */
  reconcile(snap: Snapshot) {
    this.lastAckedTick = snap.tick;
    // drop acked inputs
    this.pending = this.pending.filter((i) => i.tick > snap.tick);
    // rebuild state from snapshot (simplest correct approach: reconstruct player
    // positions from the snapshot, then replay pending inputs).
    for (let i = 0; i < this.state.players.length && i < snap.players.length; i++) {
      const sp = snap.players[i];
      const p = this.state.players[i];
      p.x = sp.x; p.y = sp.y; p.dir = sp.dir; p.moving = sp.moving;
      p.alive = sp.alive; p.revenge = sp.revenge;
      p.speed = sp.speed; p.balloonCount = sp.balloonCount; p.splashRange = sp.splashRange;
      p.hasKick = sp.hasKick; p.soaks = sp.soaks; p.roundsWon = sp.roundsWon;
    }
    // sync balloons/splashes
    this.state.balloons.clear();
    for (const b of snap.balloons) {
      this.state.balloons.set(b.id, { ...b, sliding: b.sliding === -1 ? undefined : b.sliding, spawnedTick: snap.tick });
    }
    this.state.splashes.clear();
    for (const s of snap.splashes) {
      this.state.splashes.set(s.id, { ...s, linger: 12 });
    }
    this.state.tick = snap.tick;
    this.state.tideRing = snap.tideRing;
    this.state.tideActive = snap.tideActive;
    // replay pending inputs
    for (const inp of this.pending) {
      const inputs = new Map<number, Input[]>();
      inputs.set(this.yourPlayerId, [inp]);
      simulateTick(this.state, inputs);
    }
  }

  /** Snap player count / mode from match_start. */
  initPlayers(numPlayers: number, seed: number) {
    this.state = newMatchState(seed, this.mode, numPlayers).state;
  }
}

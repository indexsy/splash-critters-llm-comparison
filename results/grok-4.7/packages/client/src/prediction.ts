import {
  applySnapshot,
  createRoundState,
  simulateTick,
  type Dir,
  type PlayerCard,
  type Snapshot,
  type SimPlayer,
  type SimState,
} from '@splash/shared';
import type { ServerMsg } from '@splash/shared';

type RoundStart = Extract<ServerMsg, { t: 'round_start' }>;

export class Predictor {
  state: SimState | null = null;
  pending: { seq: number; dir: Dir; balloon: boolean }[] = [];
  seq = 0;
  me: string;

  constructor(me: string) {
    this.me = me;
  }

  seed(round: RoundStart, cards: PlayerCard[]): void {
    this.state = createRoundState({
      map: {
        width: round.width,
        height: round.height,
        tiles: round.castleGrid.slice(),
        powerups: [],
        spawns: round.spawns,
        seed: round.mapSeed,
        lootSalt: 0,
      },
      players: cards.map((c) => ({ id: c.id, name: c.name, animal: c.animal, hat: c.hat })),
      enableRevenge: round.revenge,
    });
    this.pending = [];
  }

  onSnapshot(snap: Snapshot): void {
    this.state = applySnapshot(this.state, snap);
    this.pending = this.pending.filter((i) => i.seq > snap.ackSeq).slice(-45);
    for (const input of this.pending) {
      if (!this.state || this.state.phase !== 'playing') break;
      simulateTick(this.state, [{ id: this.me, dir: input.dir, balloon: input.balloon }]);
    }
  }

  push(dir: Dir, balloon: boolean): { seq: number; tick: number } | null {
    if (!this.state || this.state.phase !== 'playing') return null;
    this.seq += 1;
    this.pending.push({ seq: this.seq, dir, balloon });
    simulateTick(this.state, [{ id: this.me, dir, balloon }]);
    return { seq: this.seq, tick: this.state.tick };
  }

  local(): SimPlayer | null {
    return this.state?.players.find((p) => p.id === this.me) ?? null;
  }
}

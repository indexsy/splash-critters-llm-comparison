import type { InputState, RoundState, Snapshot } from "@splash/shared";
import { applySnapshot, simulateTick } from "@splash/shared";

export class Predictor {
  state: RoundState;
  localId: string;
  inputHistory: InputState[] = [];
  serverSnapshots: Snapshot[] = [];
  lastProcessedServerTick = -1;

  constructor(state: RoundState, localId: string) {
    this.state = state;
    this.localId = localId;
  }

  applyLocalInput(input: InputState) {
    input.tick = this.state.tick;
    this.inputHistory.push(input);
    if (this.inputHistory.length > 60) this.inputHistory.shift();
  }

  predict() {
    // Re-apply local inputs on top of current state to advance one tick
    const latest = this.inputHistory[this.inputHistory.length - 1];
    if (!latest) return;
    const inputs = this.state.players.map((p) => ({
      playerId: p.id,
      tick: this.state.tick,
      dir: p.id === this.localId ? latest.dir : { x: 0, y: 0 },
      balloonPressed: p.id === this.localId ? latest.balloonPressed : false,
      kickPressed: p.id === this.localId ? latest.kickPressed : false,
    }));
    simulateTick(this.state, inputs);
  }

  onSnapshot(snap: Snapshot) {
    if (snap.tick <= this.lastProcessedServerTick) return;
    this.lastProcessedServerTick = snap.tick;
    applySnapshot(this.state, snap);

    // Replay unacknowledged local inputs
    const unacked = this.inputHistory.filter((i) => i.tick > snap.tick);
    for (const input of unacked) {
      const inputs = this.state.players.map((p) => ({
        playerId: p.id,
        tick: this.state.tick,
        dir: p.id === this.localId ? input.dir : { x: 0, y: 0 },
        balloonPressed: p.id === this.localId ? input.balloonPressed : false,
        kickPressed: false,
      }));
      simulateTick(this.state, inputs);
    }
  }
}

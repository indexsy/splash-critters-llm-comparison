import {
  CONFIG,
  Tile,
  cloneState,
  simulateTick,
  type GameState,
  type PlayerInput,
  type Snapshot,
} from "@splash/shared";

export class Prediction {
  state: GameState | null = null;
  private inputs: PlayerInput[] = [];
  private snapshots: Snapshot[] = [];
  private tiles: Tile[] = [];
  private width = 13;
  private height = 11;
  private seed = 0;
  localId = "";
  ranked = false;
  revengeEnabled = true;
  reset(width: number, height: number, tiles: Tile[], seed: number): void {
    this.width = width;
    this.height = height;
    this.tiles = [...tiles];
    this.seed = seed;
    this.inputs = [];
    this.snapshots = [];
    this.state = null;
  }
  wash(x: number, y: number): void {
    this.tiles[y * this.width + x] = Tile.Floor;
    if (this.state) this.state.tiles[y * this.width + x] = Tile.Floor;
  }
  reconcile(snapshot: Snapshot): void {
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 20) this.snapshots.shift();
    if (snapshot.tideRing > 0)
      for (let y = 0; y < this.height; y++)
        for (let x = 0; x < this.width; x++)
          if (
            Math.min(x, y, this.width - 1 - x, this.height - 1 - y) <=
            snapshot.tideRing
          )
            this.tiles[y * this.width + x] = Tile.Flood;
    const ack =
      snapshot.players.find((p) => p.id === this.localId)?.lastInputSeq ?? -1;
    this.inputs = this.inputs
      .filter((i) => i.seq > ack)
      .slice(-CONFIG.INPUT_BUFFER_TICKS);
    const state: GameState = {
      ...snapshot,
      width: this.width,
      height: this.height,
      tiles: [...this.tiles],
      hiddenPowerups: {},
      mapSeed: this.seed,
      events: [],
      nextBalloonId: Math.max(0, ...snapshot.balloons.map((b) => b.id)) + 1,
      winnerId: null,
      ranked: this.ranked,
      revengeEnabled: this.revengeEnabled,
    };
    this.state = cloneState(state);
    if (!snapshot.countdown && !snapshot.roundOver)
      for (const input of this.inputs)
        simulateTick(this.state, { [this.localId]: input });
  }
  predict(input: PlayerInput): void {
    if (!this.state || this.state.roundOver) return;
    this.inputs.push(input);
    if (this.inputs.length > CONFIG.INPUT_BUFFER_TICKS) this.inputs.shift();
    simulateTick(this.state, { [this.localId]: input });
  }
  renderState(serverTime: number): GameState | null {
    if (!this.state) return null;
    const render = {
      ...this.state,
      players: this.state.players.map((p) => ({ ...p })),
    };
    const time = serverTime - CONFIG.INTERPOLATION_MS;
    let before = this.snapshots[0];
    let after = this.snapshots[this.snapshots.length - 1];
    for (const snapshot of this.snapshots) {
      if (snapshot.serverTime <= time) before = snapshot;
      if (snapshot.serverTime >= time) {
        after = snapshot;
        break;
      }
    }
    if (before && after) {
      const alpha = Math.max(
        0,
        Math.min(
          1,
          (time - before.serverTime) /
            Math.max(1, after.serverTime - before.serverTime),
        ),
      );
      for (const player of render.players)
        if (player.id !== this.localId) {
          const a = before.players.find((p) => p.id === player.id);
          const b = after.players.find((p) => p.id === player.id);
          if (a && b && a.alive === b.alive) {
            player.x = a.x + (b.x - a.x) * alpha;
            player.y = a.y + (b.y - a.y) * alpha;
            player.alive = b.alive;
          }
        }
    }
    return render;
  }
}

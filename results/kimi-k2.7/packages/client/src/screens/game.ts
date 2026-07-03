import type { App, Screen } from "../main.js";
import type { InputState, RoundState, ServerMsg } from "@splash/shared";
import { CONFIG, createRoundState } from "@splash/shared";
import { Renderer } from "../render/sprites.js";
import { drawHUD, drawAnnounce } from "../render/hud.js";
import { ParticleSystem } from "../render/particles.js";
import { Predictor } from "../prediction.js";

const INPUT_KEYS: Record<string, string> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  Space: "balloon",
  KeyE: "balloon",
};

export class GameScreen implements Screen {
  app: App;
  renderer: Renderer;
  particles: ParticleSystem;
  predictor?: Predictor;
  state?: RoundState;
  localId: string;
  matchId: string;
  mode: "duel" | "ffa";
  players: any[];
  seq = 0;
  input: InputState = { seq: 0, tick: 0, dir: { x: 0, y: 0 }, balloonPressed: false, kickPressed: false };
  announces: { text: string; until: number }[] = [];
  castleGrid?: boolean[][];
  started = false;
  tickAccumulator = 0;

  constructor(app: App, data: any) {
    this.app = app;
    this.renderer = new Renderer();
    this.particles = new ParticleSystem();
    this.localId = data.localId;
    this.matchId = data.matchId;
    this.mode = data.mode;
    this.players = data.players;
  }

  update(dt: number) {
    this.particles.update(dt);
    if (this.predictor) {
      this.tickAccumulator += dt;
      const tickDuration = 1 / CONFIG.TICK_RATE;
      while (this.tickAccumulator >= tickDuration) {
        this.tickAccumulator -= tickDuration;
        this.input.seq = this.seq++;
        this.input.tick = this.predictor.state.tick;
        this.predictor.applyLocalInput(this.input);
        this.predictor.predict();
        this.app.net.input(this.input);
        this.input.balloonPressed = false;
      }
    }

    this.announces = this.announces.filter((a) => a.until > Date.now());
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 256, 224);
    if (!this.state) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for round...", 128, 112);
      return;
    }
    this.renderer.drawRound(ctx, this.state, this.localId);
    this.particles.draw(ctx, 16, 32);
    drawHUD(ctx, this.state, this.localId);
    for (const a of this.announces) drawAnnounce(ctx, a.text);
  }

  onKey(e: KeyboardEvent, down: boolean) {
    const action = INPUT_KEYS[e.code];
    if (!action) return;
    if (action === "balloon") {
      if (down) this.input.balloonPressed = true;
      return;
    }
    const dirs: Record<string, { x: number; y: number }> = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    };
    const dir = dirs[action];
    if (down) {
      this.input.dir.x = dir.x;
      this.input.dir.y = dir.y;
    } else {
      if (this.input.dir.x === dir.x && this.input.dir.y === dir.y) {
        this.input.dir.x = 0;
        this.input.dir.y = 0;
      }
    }
  }

  onMessage(msg: ServerMsg) {
    switch (msg.type) {
      case "round_start": {
        const playerDefs = this.players.map((p) => ({
          id: p.id,
          nickname: p.nickname,
          animal: p.animal,
          hat: p.hat,
          slot: 0,
        }));
        const state = createRoundState(this.mode, msg.roundNo, msg.mapSeed, msg.theme, playerDefs);
        this.state = state;
        this.castleGrid = msg.castleGrid;
        this.predictor = new Predictor(state, this.localId);
        this.started = true;
        break;
      }
      case "snapshot": {
        if (this.predictor) {
          this.predictor.onSnapshot(msg.snap);
          this.state = this.predictor.state;
        } else if (this.state) {
          // no prediction yet, just apply
        }
        break;
      }
      case "event": {
        this.handleEvent(msg.event);
        break;
      }
      case "round_end": {
        const winner = msg.winnerId ? this.state?.players.find((p) => p.id === msg.winnerId)?.nickname : null;
        this.announces.push({ text: winner ? `${winner} wins round!` : "Draw!", until: Date.now() + 2000 });
        this.app.audio.sfx("win");
        break;
      }
      case "match_end": {
        this.app.setScreen("results", { result: msg });
        break;
      }
    }
  }

  handleEvent(ev: any) {
    switch (ev.type) {
      case "burst":
      case "chain_burst":
        this.app.audio.sfx(ev.type === "chain_burst" ? "chain" : "burst");
        if (ev.type === "chain_burst" && ev.count >= 2) {
          const label = ev.count === 2 ? "DOUBLE SPLASH!" : ev.count === 3 ? "TRIPLE SPLASH!" : `${ev.count}x SPLASH!`;
          this.announces.push({ text: label, until: Date.now() + 1500 });
        }
        break;
      case "player_soaked":
        this.app.audio.sfx("soak");
        this.particles.emit(16 + ev.tx * 16, 32 + ev.ty * 16, 8, "#38bdf8");
        break;
      case "powerup_collected":
        this.app.audio.sfx("pickup");
        break;
      case "balloon_kicked":
        this.app.audio.sfx("drop");
        break;
    }
  }
}

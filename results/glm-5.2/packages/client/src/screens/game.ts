// screens/game.ts — the in-match canvas renderer + input sampling (spec §8, §10).
// Runs at 60Hz render, 30Hz input sampling, reconciles snapshots from the server.

import {
  TICK_HZ,
  INTERP_DELAY_MS,
  type GameMode,
  type ServerMsg,
  type Snapshot,
} from "@splash/shared";
import { Prediction } from "../prediction.js";
import { audio } from "../audio.js";
import {
  drawBalloon, drawCastle, drawBoulder, drawCritter, drawPowerUp, drawSplash, drawWater,
  tileColors,
} from "../render/sprites.js";
import { drawHud, drawAnnouncer, drawCountdown } from "../render/hud.js";
import { Particles } from "../render/particles.js";

const TILE = 16; // pixels per tile at internal 256x224 (fits ~16 tiles wide)

export class GameScreen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  net: { send: (m: any) => void; on: (t: string, h: (m: any) => void) => void };
  prediction: Prediction | null = null;
  yourSlot = 0;
  mode: GameMode = "duel";
  roundsToWin = 3;
  theme = "beach" as "backyard" | "beach" | "pool";
  castleGrid: Uint8Array = new Uint8Array(0);
  width = 13;
  height = 11;
  players: { slot: number; nickname: string; animal: string }[] = [];
  particles = new Particles();
  killFeed: { text: string; life: number }[] = [];
  countdown = 3;
  countdownTimer = 0;
  announcer: { text: string; life: number } | null = null;
  inputState = { up: false, down: false, left: false, right: false, balloon: false };
  lastBalloonHeld = false;
  raf = 0;
  onMatchEnd?: (m: ServerMsg & { t: "match_end" }) => void;
  shake = 0;
  lastChainSize = 0;
  seenSoaked = new Set<number>();

  constructor(canvas: HTMLCanvasElement, net: any) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.net = net;
    this.bindKeys();
  }

  private keydown = (e: KeyboardEvent) => this.onKey(e, true);
  private keyup = (e: KeyboardEvent) => this.onKey(e, false);
  private onKey(e: KeyboardEvent, down: boolean) {
    switch (e.key.toLowerCase()) {
      case "w": case "arrowup": this.inputState.up = down; e.preventDefault(); break;
      case "s": case "arrowdown": this.inputState.down = down; e.preventDefault(); break;
      case "a": case "arrowleft": this.inputState.left = down; e.preventDefault(); break;
      case "d": case "arrowright": this.inputState.right = down; e.preventDefault(); break;
      case " ": case "e": this.inputState.balloon = down; e.preventDefault(); break;
      case "m": if (down) audio.setMuted(!audio.muted); break;
    }
  }
  private bindKeys() {
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("keyup", this.keyup);
  }
  unbind() {
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
  }

  start(msg: ServerMsg & { t: "match_start" }) {
    this.mode = msg.mode;
    this.roundsToWin = msg.roundsToWin;
    this.theme = msg.theme;
    this.yourSlot = msg.yourSlot;
    this.players = msg.players.map((p) => ({ slot: p.slot, nickname: p.nickname, animal: p.animal }));
    this.prediction = new Prediction(msg.mode, 1, msg.players.length);
    this.prediction.yourPlayerId = msg.yourSlot;
    this.seenSoaked.clear();
    audio.startMusic(1);
    this.countdown = 3;
    this.countdownTimer = 0;

    // wire snapshot/round/match handlers
    this.net.on("round_start", (m: any) => this.onRoundStart(m));
    this.net.on("snapshot", (m: any) => this.onSnapshot(m));
    this.net.on("round_end", (m: any) => {
      this.announcer = { text: m.winnerSlot >= 0 ? `Round → Player ${m.winnerSlot + 1}` : "Draw!", life: 90 };
    });
    this.net.on("match_end", (m: any) => {
      audio.victory();
      this.stop();
      this.onMatchEnd?.(m);
    });

    this.loop();
  }

  private onRoundStart(m: any) {
    this.width = m.width;
    this.height = m.height;
    this.castleGrid = new Uint8Array(m.castleGrid);
    if (this.prediction) this.prediction.resetRound(m.mapSeed);
    this.countdown = 3;
    this.countdownTimer = 0;
    this.seenSoaked.clear();
  }

  private onSnapshot(m: { snap: Snapshot }) {
    if (!this.prediction) return;
    const snap = m.snap;
    this.prediction.reconcile(snap);
    // process events for SFX + juice
    for (const e of snap.events) {
      switch (e.type) {
        case "castle_washed":
          this.particles.burst(e.x * TILE + 8, e.y * TILE + 8, "#f0d8a0", 5, 1);
          break;
        case "player_soaked":
          if (!this.seenSoaked.has(e.playerId)) {
            this.seenSoaked.add(e.playerId);
            audio.soak();
            this.shake = 6;
            const victim = this.players[e.playerId]?.nickname ?? `P${e.playerId + 1}`;
            const by = e.byPlayerId >= 0 ? this.players[e.byPlayerId]?.nickname ?? `P${e.byPlayerId + 1}` : "the tide";
            this.killFeed.unshift({ text: `${by} soaked ${victim}!`, life: 240 });
            if (this.killFeed.length > 4) this.killFeed.pop();
            this.particles.burst(this.prediction.state.players[e.playerId].x * TILE + 8, this.prediction.state.players[e.playerId].y * TILE + 8, "#73eff7", 14, 2);
          }
          break;
        case "chain_burst":
          if (e.chainSize >= 2) {
            audio.chain(e.chainSize);
            const label = e.chainSize >= 4 ? "MEGA SPLASH!!" : e.chainSize === 3 ? "TRIPLE SPLASH!" : "DOUBLE SPLASH!";
            this.announcer = { text: label, life: 60 };
          } else {
            audio.burst();
          }
          break;
        case "powerup_revealed":
          audio.pickup();
          break;
        case "powerup_collected":
          audio.pickup();
          break;
        case "tide_advance":
          audio.tide();
          break;
      }
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.update();
    this.render();
  };

  private inputTick = 0;
  private update() {
    // 30Hz input sampling
    if (this.countdown <= 0 && this.prediction) {
      this.inputTick++;
      if (this.inputTick % 2 === 0) {
        // compute dir
        let dir = -1;
        if (this.inputState.up) dir = 0;
        else if (this.inputState.right) dir = 1;
        else if (this.inputState.down) dir = 2;
        else if (this.inputState.left) dir = 3;
        const balloonPressed = this.inputState.balloon && !this.lastBalloonHeld;
        this.lastBalloonHeld = this.inputState.balloon;
        const input = this.prediction.step({ dir, balloonPressed }, this.prediction.state.tick);
        if (input) this.net.send({ t: "input", seq: input.seq, tick: input.tick, dir: input.dir, balloonPressed: input.balloonPressed });
      }
    }
    // countdown
    if (this.countdown > 0) {
      this.countdownTimer++;
      if (this.countdownTimer >= 30) {
        this.countdownTimer = 0;
        this.countdown--;
        if (this.countdown === 0) audio.burst();
      }
    }
    this.particles.update();
    this.shake = Math.max(0, this.shake - 0.5);
    if (this.announcer) { this.announcer.life--; if (this.announcer.life <= 0) this.announcer = null; }
    this.killFeed.forEach((k) => k.life--);
    this.killFeed = this.killFeed.filter((k) => k.life > 0);
  }

  private render() {
    const ctx = this.ctx;
    // integer-scale canvas to viewport
    this.resizeCanvas();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 256, 224);

    const state = this.prediction?.state;
    if (!state) return;
    const tc = tileColors(this.theme);
    // screen shake offset
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    const sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    ctx.save();
    ctx.translate(Math.round(sx), Math.round(sy));

    // tiles
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const px = x * TILE;
        const py = y * TILE + 22; // leave room for HUD
        const t = state.tiles[y * this.width + x];
        // floor
        ctx.fillStyle = (x + y) % 2 === 0 ? tc.floor : tc.floor2;
        ctx.fillRect(px, py, TILE, TILE);
        if (t === 1) drawBoulder(ctx, px, py, 2, tc.boulder, tc.boulder2);
        else if (t === 2) drawCastle(ctx, px, py, 2);
      }
    }

    // tide water
    if (state.tideActive && state.tideRing > 0) {
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const dist = Math.min(x, y, this.width - 1 - x, this.height - 1 - y);
          if (dist < state.tideRing) drawWater(ctx, x * TILE, y * TILE + 22, 2, state.tick);
        }
      }
    }

    // splashes
    for (const s of state.splashes.values()) {
      drawSplash(ctx, s.cx * TILE, s.cy * TILE + 22, 16);
      for (let d = 1; d <= s.up; d++) drawSplash(ctx, s.cx * TILE, (s.cy - d) * TILE + 22, 16);
      for (let d = 1; d <= s.down; d++) drawSplash(ctx, s.cx * TILE, (s.cy + d) * TILE + 22, 16);
      for (let d = 1; d <= s.left; d++) drawSplash(ctx, (s.cx - d) * TILE, s.cy * TILE + 22, 16);
      for (let d = 1; d <= s.right; d++) drawSplash(ctx, (s.cx + d) * TILE, s.cy * TILE + 22, 16);
    }

    // exposed power-ups
    for (const pu of state.exposedPowerUps.values()) {
      drawPowerUp(ctx, pu.x * TILE, pu.y * TILE + 22, 2, pu.kind);
    }

    // balloons
    for (const b of state.balloons.values()) {
      drawBalloon(ctx, b.x * TILE + 2, b.y * TILE + 22, 2, state.tick * 0.3 + b.id);
    }

    // critters
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      if (!p.alive && !p.revenge) continue;
      const animal = (this.players[i]?.animal ?? "frog") as any;
      const frame = p.moving ? Math.floor(p.animTime / 8) : 0;
      drawCritter(ctx, Math.round(p.x * TILE), Math.round(p.y * TILE) + 22 - (frame % 2), 2, animal, "none", frame, p.dir);
    }

    this.particles.draw(ctx);
    ctx.restore();

    // HUD
    const hudPlayers = state.players.map((p, i) => ({
      slot: i,
      nickname: this.players[i]?.nickname ?? `P${i + 1}`,
      animal: this.players[i]?.animal ?? "frog",
      alive: p.alive,
      soaks: p.soaks,
      roundsWon: p.roundsWon,
      speed: p.speed,
      balloonCount: p.balloonCount,
      splashRange: p.splashRange,
      isLocal: i === this.yourSlot,
    }));
    drawHud(ctx, hudPlayers, this.roundsToWin, this.killFeed);
    if (this.countdown > 0) drawCountdown(ctx, this.countdown);
    if (this.announcer) drawAnnouncer(ctx, this.announcer.text, 2);
  }

  private resizeCanvas() {
    // scale internal 256x224 to fit window while keeping pixelated
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.max(1, Math.floor(Math.min(vw / 256, vh / 224)));
    this.canvas.style.width = 256 * scale + "px";
    this.canvas.style.height = 224 * scale + "px";
  }

  stop() {
    cancelAnimationFrame(this.raf);
    audio.stopMusic();
  }
}

void INTERP_DELAY_MS; void TILE;

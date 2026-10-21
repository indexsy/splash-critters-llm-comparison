import {
  CONFIG,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  DIR_UP,
  type MatchConfigWire,
  type SimEvent,
  type Snapshot,
  type SnapshotPlayer,
} from '@splash-critters/shared';
import { audio } from '../audio.js';
import type { App } from '../app.js';
import { Predictor, type LocalInput } from '../prediction.js';
import { Particles } from '../render/particles.js';
import {
  drawAnimalIcon,
  drawBalloon,
  drawBoulder,
  drawBorderTile,
  drawCastle,
  drawCritter,
  drawDuckToy,
  drawFloorTile,
  drawHat,
  drawPowerup,
  drawSplash,
  PALETTE,
  TILE,
  THEMES,
} from '../render/sprites.js';
import { drawText, textWidth } from '../render/font.js';
import { drawHud } from '../render/hud.js';
import { TutorialDirector } from './tutorial.js';
import { clear, el } from '../ui.js';

const TICK_MS = 1000 / CONFIG.TICK_RATE;

interface KillFeedEntry {
  text: string;
  color: string;
  until: number;
}

interface Announcement {
  text: string;
  sub: string;
  color: string;
  until: number;
}

export class GameScreen {
  active = false;
  private predictor = new Predictor();
  private snapshots: Snapshot[] = [];
  private particles = new Particles();
  private config: MatchConfigWire | null = null;
  private localId = -1;
  private serverOffset = 0;
  private keys = new Set<string>();
  private accumulator = 0;
  private inputTimer = 0;
  private pendingInput: LocalInput | null = null;
  private killFeed: KillFeedEntry[] = [];
  private announcements: Announcement[] = [];
  private emoteBubbles = new Map<number, { id: number; until: number }>();
  private shake = 0;
  private hitStop = 0;
  private roundNo = 0;
  private roundEndAt = 0;
  private roundWinners: number[] = [];
  private tutorial = new TutorialDirector();
  private lastChainDepth = 0;
  private showdown = false;
  private scoreboard = new Map<number, number>();
  private endScreenTimer = 0;

  // ---------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------

  show(app: App): void {
    this.active = true;
    clear(app.overlay);
    this.bindKeys();
    const track = app.state.profile ? 'battle' : 'battle';
    audio.playMusic(track);
  }

  hide(): void {
    this.active = false;
    this.unbindKeys();
  }

  private bindKeys(): void {
    if (this.bound) return;
    this.bound = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private unbindKeys(): void {
    if (!this.bound) return;
    this.bound = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private bound = false;

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    this.keys.add(event.code);
    const app = this.app;
    if (!app) return;
    const binds = app.state.settings.keybinds;
    if (event.code === binds.drop || event.code === binds.dropAlt) {
      event.preventDefault();
      this.dropRequested = true;
    }
    const emotes = [binds.emote1, binds.emote2, binds.emote3, binds.emote4];
    const index = emotes.indexOf(event.code);
    if (index >= 0) {
      app.send({ t: 'emote', id: index });
      audio.play('emote');
    }
    if (event.code === 'KeyM') {
      app.updateSettings({ muted: !app.state.settings.muted });
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  private app: App | null = null;
  private dropRequested = false;

  // ---------------------------------------------------------------------
  // server messages
  // ---------------------------------------------------------------------

  onMatchStart(message: Extract<import('@splash-critters/shared').ServerMessage, { t: 'match_start' }>): void {
    this.config = message.config;
    this.snapshots = [];
    this.scoreboard.clear();
    this.tutorial.reset(message.config.ranked);
  }

  onRoundStart(message: Extract<import('@splash-critters/shared').ServerMessage, { t: 'round_start' }>): void {
    const config = message.config;
    this.config = config;
    this.roundNo = message.roundNo;
    const localIndex = config.players.findIndex((p) => p.playerId === this.app?.state.playerId);
    this.localId = localIndex >= 0 ? localIndex : 0;
    this.predictor.startRound({
      roundNo: message.roundNo,
      mapSeed: message.mapSeed,
      castleGrid: message.castleGrid,
      theme: message.theme,
      mode: config.mode,
      roundsToWin: config.roundsToWin,
      players: config.players.map((p) => ({
        animal: p.animal,
        hat: p.hat,
        nickname: p.nickname,
        tag: p.tag,
      })),
      localId: this.localId,
    });
    this.snapshots = [];
    this.particles.clear();
    this.showdown = false;
    audio.setTempoScale(1);
    audio.playMusic('battle');
    this.announce(`ROUND ${message.roundNo}`, 'READY... SPLASH!', PALETTE.sky, 2200);
    audio.play('click');
    this.tutorial.onRoundStart();
  }

  onSnapshot(snapshot: Snapshot): void {
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 24) this.snapshots.shift();
    this.predictor.applySnapshot(snapshot);
    for (const event of snapshot.events) this.handleEvent(event);
    const local = snapshot.players[this.localId];
    if (local) this.scoreboard.set(local.id, local.roundWins);
  }

  onEvent(event: SimEvent | { t: 'emote'; player: number; id: number }): void {
    if (event.t === 'emote') {
      this.emoteBubbles.set(event.player, { id: event.id, until: performance.now() + 1600 });
      return;
    }
    this.handleEvent(event);
  }

  onRoundEnd(message: Extract<import('@splash-critters/shared').ServerMessage, { t: 'round_end' }>): void {
    this.roundEndAt = performance.now();
    this.roundWinners = message.winners;
    const names = message.winners
      .map((id) => message.scores.find((s) => s.id === id)?.nickname ?? '')
      .filter(Boolean);
    if (message.draw) {
      this.announce('DRAW!', 'BOTH GOT SOAKED', PALETTE.pink, 3000);
    } else {
      this.announce(`${names.join(' & ')} WINS`, 'ROUND OVER', PALETTE.yellow, 3000);
    }
    audio.play(message.draw ? 'soak' : 'victory');
  }

  onMatchEnd(message: Extract<import('@splash-critters/shared').ServerMessage, { t: 'match_end' }>): void {
    this.endScreenTimer = performance.now() + 500;
    this.matchEnd = message;
  }

  private matchEnd: Extract<import('@splash-critters/shared').ServerMessage, { t: 'match_end' }> | null = null;

  onPing(ts: number, echo?: number): void {
    const now = Date.now();
    if (echo !== undefined) {
      const rtt = now - echo;
      this.serverOffset = ts + rtt / 2 - now;
    }
    this.app?.send({ t: 'pong', ts: now });
  }

  // ---------------------------------------------------------------------
  // events
  // ---------------------------------------------------------------------

  private handleEvent(event: SimEvent): void {
    switch (event.t) {
      case 'castle_washed': {
        const x = event.x * TILE + TILE / 2;
        const y = event.y * TILE + TILE / 2;
        this.particles.burst(x, y, 10, { color: PALETTE.sand, speed: 1.2, life: 24, size: 2 });
        this.particles.burst(x, y, 6, { color: PALETTE.foam, speed: 1.8, life: 18 });
        break;
      }
      case 'powerup_revealed': {
        const x = event.x * TILE + TILE / 2;
        const y = event.y * TILE + TILE / 2;
        this.particles.burst(x, y, 14, { color: PALETTE.yellow, speed: 2, life: 26, size: 1 });
        this.particles.popText(x, y - 6, 'POWER UP!', PALETTE.yellow);
        audio.play('pickup');
        break;
      }
      case 'powerup_collected': {
        const x = event.x * TILE + TILE / 2;
        const y = event.y * TILE + TILE / 2;
        this.particles.burst(x, y, 12, { color: PALETTE.mint, speed: 2, life: 22 });
        audio.play('pickup');
        break;
      }
      case 'player_soaked': {
        const x = event.x * TILE + TILE / 2;
        const y = event.y * TILE + TILE / 2;
        this.particles.burst(x, y, 26, { color: PALETTE.water, speed: 2.6, life: 30, size: 2 });
        this.particles.burst(x, y, 12, { color: PALETTE.foam, speed: 3, life: 22 });
        this.shake = this.reducedShake ? 1 : 4;
        this.hitStop = 2;
        audio.play('soak');
        const killer = this.playerName(event.by);
        const victim = this.playerName(event.player);
        if (event.revenge) {
          this.pushKill(`${killer} revenge-soaked ${victim}!`, PALETTE.mint);
        } else if (event.by >= 0) {
          this.pushKill(`${killer} soaked ${victim}!`, PALETTE.pink);
        } else {
          this.pushKill(`the tide got ${victim}!`, PALETTE.sky);
        }
        break;
      }
      case 'chain_burst': {
        const x = event.x * TILE + TILE / 2;
        const y = event.y * TILE + TILE / 2;
        this.particles.burst(x, y, 20 + event.depth * 6, {
          color: event.depth >= 3 ? PALETTE.pink : PALETTE.foam,
          speed: 2.4,
          life: 28,
          size: 2,
        });
        const words = ['', 'SPLASH!', 'DOUBLE SPLASH!', 'TRIPLE SPLASH!', 'QUAD SPLASH!', 'MEGA SPLASH!'];
        this.announce(
          words[Math.min(words.length - 1, event.depth)],
          `${event.depth} balloons in one tick`,
          event.depth >= 3 ? PALETTE.pink : PALETTE.sky,
          1500,
        );
        audio.play('burst', event.depth);
        this.shake = this.reducedShake ? 1 : 2 + event.depth;
        break;
      }
      case 'balloon_kicked': {
        const x = event.x * TILE + TILE / 2;
        const y = event.y * TILE + TILE / 2;
        this.particles.burst(x, y, 8, { color: PALETTE.mint, speed: 1.6, life: 16 });
        audio.play('kick');
        break;
      }
      case 'tide_advance': {
        this.announce('RISING TIDE!', 'MOVE TO THE CENTRE', PALETTE.sky, 2200);
        audio.play('tide');
        break;
      }
      case 'revenge_lob': {
        const x = event.x * TILE + TILE / 2;
        const y = event.y * TILE + TILE / 2;
        this.particles.burst(x, y, 8, { color: PALETTE.yellow, speed: 1.4, life: 16 });
        break;
      }
      case 'balloon_placed': {
        audio.play('drop');
        break;
      }
      default:
        break;
    }
  }

  private reducedShake = false;

  private playerName(id: number): string {
    const player = this.snapshotPlayer(id);
    return player ? `${player.nickname}` : 'someone';
  }

  private snapshotPlayer(id: number): SnapshotPlayer | undefined {
    const latest = this.snapshots[this.snapshots.length - 1];
    return latest?.players.find((p) => p.id === id);
  }

  private pushKill(text: string, color: string): void {
    this.killFeed.unshift({ text, color, until: performance.now() + 5000 });
    if (this.killFeed.length > 5) this.killFeed.pop();
  }

  private announce(text: string, sub: string, color: string, duration: number): void {
    this.announcements.unshift({ text, sub, color, until: performance.now() + duration });
    if (this.announcements.length > 3) this.announcements.pop();
  }

  // ---------------------------------------------------------------------
  // loop
  // ---------------------------------------------------------------------

  update(dt: number): void {
    if (!this.app) return;
    this.reducedShake = this.app.state.settings.reducedShake;
    this.accumulator += dt * 1000;
    this.inputTimer += dt * 1000;

    if (this.hitStop > 0) {
      this.hitStop -= 1;
      this.accumulator = 0;
    } else {
      while (this.accumulator >= TICK_MS) {
        this.accumulator -= TICK_MS;
        this.localTick();
      }
    }

    if (this.inputTimer >= TICK_MS) {
      this.inputTimer = 0;
      this.sampleInput();
    }

    this.particles.update();
    this.predictor.decayOffset();
    this.shake *= 0.85;
    if (this.shake < 0.1) this.shake = 0;

    const now = performance.now();
    const state = this.predictor.state;
    if (state && !this.showdown) {
      const alive = state.players.filter((p) => p.alive).length;
      if (alive === 2 && state.players.length > 2) {
        this.showdown = true;
        audio.playMusic('showdown');
        audio.setTempoScale(1.15);
      }
    }
    this.killFeed = this.killFeed.filter((k) => k.until > now);
    this.announcements = this.announcements.filter((a) => a.until > now);
    for (const [key, bubble] of this.emoteBubbles) {
      if (bubble.until <= now) this.emoteBubbles.delete(key);
    }

    if (this.matchEnd && now > this.endScreenTimer) {
      const message = this.matchEnd;
      this.matchEnd = null;
      this.app.go('results');
      void message;
    }
  }

  private localTick(): void {
    const input = this.pendingInput;
    this.pendingInput = null;
    this.predictor.tick(input);
    this.tutorial.onTick(this.predictor.state, input);
  }

  private sampleInput(): void {
    if (!this.app) return;
    const binds = this.app.state.settings.keybinds;
    let dir = 0;
    if (this.keys.has(binds.up) || this.keys.has('ArrowUp')) dir |= DIR_UP;
    if (this.keys.has(binds.down) || this.keys.has('ArrowDown')) dir |= DIR_DOWN;
    if (this.keys.has(binds.left) || this.keys.has('ArrowLeft')) dir |= DIR_LEFT;
    if (this.keys.has(binds.right) || this.keys.has('ArrowRight')) dir |= DIR_RIGHT;
    const balloon = this.dropRequested;
    this.dropRequested = false;
    const input = this.predictor.queueInput(dir, balloon);
    this.pendingInput = input;
    this.app.send({ t: 'input', seq: input.seq, tick: 0, dir: input.dir, balloon: input.balloon });
  }

  // ---------------------------------------------------------------------
  // rendering
  // ---------------------------------------------------------------------

  render(context: CanvasRenderingContext2D, dt: number): void {
    const app = this.app;
    if (!app) return;
    const ctx = context;
    const state = this.predictor.state;
    ctx.imageSmoothingEnabled = false;

    if (!state) {
      drawText(ctx, 'WAITING FOR PLAYERS', 128, 108, { align: 'center', color: PALETTE.sky, scale: 1 });
      return;
    }

    const theme = state.arena.theme;
    const colors = THEMES[theme];
    const arenaW = state.arena.width * TILE;
    const arenaH = state.arena.height * TILE;
    const originX = Math.round((256 - arenaW) / 2);
    const originY = Math.max(16, Math.round((224 - arenaH) / 2) + 2);

    ctx.save();
    if (this.shake > 0) {
      const amount = Math.round(this.shake);
      ctx.translate(
        Math.round((Math.random() - 0.5) * amount),
        Math.round((Math.random() - 0.5) * amount),
      );
    }

    // floor
    for (let y = 0; y < state.arena.height; y++) {
      for (let x = 0; x < state.arena.width; x++) {
        const px = originX + x * TILE;
        const py = originY + y * TILE;
        const border = x === 0 || y === 0 || x === state.arena.width - 1 || y === state.arena.height - 1;
        if (border) {
          drawBorderTile(ctx, theme, px, py, y === 0 || y === state.arena.height - 1);
        } else {
          drawFloorTile(ctx, theme, px, py, x, y, Math.floor(app.frame / 6));
        }
      }
    }

    // rising tide
    if (state.tideRing >= 0) {
      for (let y = 0; y < state.arena.height; y++) {
        for (let x = 0; x < state.arena.width; x++) {
          const ring = Math.min(x, y, state.arena.width - 1 - x, state.arena.height - 1 - y);
          if (ring > state.tideRing) continue;
          const px = originX + x * TILE;
          const py = originY + y * TILE;
          ctx.fillStyle = 'rgba(58,166,216,0.55)';
          ctx.fillRect(px, py, TILE, TILE);
          const shimmer = (Math.floor(app.frame / 4) + x + y) % 8;
          ctx.fillStyle = 'rgba(232,247,255,0.5)';
          ctx.fillRect(px + 2 + shimmer, py + 4, 6, 1);
        }
      }
    }

    // sandcastles
    for (let y = 0; y < state.arena.height; y++) {
      for (let x = 0; x < state.arena.width; x++) {
        const i = y * state.arena.width + x;
        const border = x === 0 || y === 0 || x === state.arena.width - 1 || y === state.arena.height - 1;
        if (border) continue;
        const px = originX + x * TILE;
        const py = originY + y * TILE;
        if (x % 2 === 0 && y % 2 === 0) {
          drawBoulder(ctx, px, py);
        } else if (state.arena.castles[i]) {
          drawCastle(ctx, px, py);
        }
      }
    }

    // exposed power-ups
    for (const exposed of state.exposed) {
      drawPowerup(
        ctx,
        exposed.kind,
        originX + exposed.x * TILE,
        originY + exposed.y * TILE,
        app.frame,
      );
    }

    // balloons
    for (const balloon of state.balloons) {
      const px = originX + balloon.x * TILE;
      const py = originY + balloon.y * TILE;
      drawBalloon(ctx, px, py, balloon.fuse, app.frame, balloon.revenge);
      if (balloon.fuse < 15) {
        ctx.fillStyle = 'rgba(244,162,97,0.85)';
        ctx.fillRect(px + 6, py + 13, 4, 2);
      }
    }

    // splashes
    for (const splash of state.splashes) {
      const progress = 1 - splash.ticks / CONFIG.SPLASH_LINGER_TICKS;
      const px = originX + splash.x * TILE;
      const py = originY + splash.y * TILE;
      for (let d = 0; d < 4; d++) {
        drawSplash(ctx, px, py, splash.lens[d], d, progress, this.app?.state.settings.colorblindPalette ?? false);
      }
    }

    // players
    const remote = this.interpolatedPlayers();
    for (const player of state.players) {
      const isLocal = player.id === this.localId;
      const draw = remote.get(player.id);
      const px = originX + (draw ? draw.x : player.x) * TILE + (isLocal ? this.predictor.offsetX : 0);
      const py = originY + (draw ? draw.y : player.y) * TILE + (isLocal ? this.predictor.offsetY : 0);
      const frame = draw ? draw.frame : 0;
      if (!player.alive) {
        // the soaked critter leaves a puddle
        ctx.fillStyle = 'rgba(58,166,216,0.45)';
        ctx.fillRect(Math.round(px) + 3, Math.round(py) + 8, 10, 4);
        continue;
      }
      const facing = draw ? draw.facing : player.facing;
      const moving = draw ? draw.moving : player.moving;
      const walkFrame = moving ? Math.floor(app.frame / 6) % 2 : 0;
      drawCritter(ctx, player.animal, Math.round(px) + 2, Math.round(py) + 3, walkFrame, facing, {
        soak: player.animal === 'cat' ? 0 : undefined,
      });
      drawHat(ctx, player.hat, Math.round(px) + 2, Math.round(py) + 3);
      if (isLocal) {
        ctx.fillStyle = 'rgba(126,200,227,0.75)';
        ctx.fillRect(Math.round(px) + 7, Math.round(py) + 15, 2, 2);
      }
      const bubble = this.emoteBubbles.get(player.id);
      if (bubble) {
        this.drawEmoteBubble(ctx, px + 8, py - 4, bubble.id);
      }
    }

    // revenge ducks
    for (const player of state.players) {
      if (!player.duck) continue;
      drawDuckToy(
        ctx,
        originX + player.duck.x * TILE,
        originY + player.duck.y * TILE,
        player.duck.dir,
        app.frame,
      );
    }

    this.particles.draw(ctx);
    ctx.restore();

    // hud
    drawHud(ctx, {
      players: state.players.map((p) => ({
        id: p.id,
        nickname: p.nickname ?? '',
        tag: p.tag ?? '',
        animal: p.animal,
        hat: p.hat,
        roundWins: p.roundWins,
        alive: p.alive,
        soaks: p.soaks,
        ping: this.pingFor(p.id),
      })),
      localId: this.localId,
      timeLeft: state.timeLeft,
      roundNo: state.roundNo,
      roundsToWin: state.roundsToWin,
      tideRing: state.tideRing,
      killFeed: this.killFeed,
      announcements: this.announcements,
      countdown: state.countdown,
      theme: theme,
      balloons: state.balloons.filter((b) => b.owner === this.localId).length,
      balloonCount: state.players[this.localId]?.balloonCount ?? 1,
      splashRange: state.players[this.localId]?.splashRange ?? 2,
      hasBoots: state.players[this.localId]?.hasBoots ?? false,
      colorblind: this.app?.state.settings.colorblindPalette ?? false,
    });

    if (this.app && (this.tutorial.active || this.tutorial.completed)) {
      this.tutorial.render(ctx, this.app);
    }

    if (this.roundEndAt > 0 && performance.now() - this.roundEndAt < 2000) {
      ctx.fillStyle = 'rgba(9,15,30,0.55)';
      ctx.fillRect(0, 0, 256, 224);
      const winner = this.roundWinners.length
        ? this.playerName(this.roundWinners[0])
        : 'nobody';
      drawText(ctx, `${winner.toUpperCase()} TAKES THE ROUND`, 128, 96, {
        align: 'center',
        color: PALETTE.yellow,
        shadow: PALETTE.ink,
        scale: 1,
      });
    }
  }

  private drawEmoteBubble(ctx: CanvasRenderingContext2D, x: number, y: number, id: number): void {
    const words = ['QUACK!', 'RIBBIT!', 'SQUEAK!', 'HONK!'];
    const text = words[id] ?? words[0];
    const width = textWidth(text) + 4;
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(Math.round(x - width / 2), Math.round(y - 9), width, 10);
    ctx.fillStyle = PALETTE.ink;
    ctx.fillRect(Math.round(x - width / 2 + 1), Math.round(y - 8), width - 2, 8);
    drawText(ctx, text, x, y - 7, { align: 'center', color: PALETTE.white });
  }

  private pingFor(id: number): number {
    return id === this.localId ? this.app?.net.latency ?? 0 : 0;
  }

  /** Interpolates the remote players between the two latest snapshots. */
  private interpolatedPlayers(): Map<number, { x: number; y: number; facing: number; moving: boolean; frame: number }> {
    const out = new Map();
    if (this.snapshots.length === 0) return out;
    const latest = this.snapshots[this.snapshots.length - 1];
    const renderTick = latest.tick - CONFIG.INTERP_DELAY_MS / TICK_MS;
    let older: Snapshot | null = null;
    let newer: Snapshot | null = null;
    for (let i = this.snapshots.length - 1; i > 0; i--) {
      const a = this.snapshots[i - 1];
      const b = this.snapshots[i];
      if (a.tick <= renderTick && b.tick >= renderTick) {
        older = a;
        newer = b;
        break;
      }
    }
    if (!older || !newer) {
      older = this.snapshots[Math.max(0, this.snapshots.length - 2)];
      newer = latest;
    }
    const span = Math.max(1, newer.tick - older.tick);
    const alpha = Math.max(0, Math.min(1, (renderTick - older.tick) / span));
    for (const player of newer.players) {
      const before = older.players.find((p) => p.id === player.id);
      if (!before) {
        out.set(player.id, { x: player.x, y: player.y, facing: player.facing, moving: player.moving, frame: 0 });
        continue;
      }
      out.set(player.id, {
        x: before.x + (player.x - before.x) * alpha,
        y: before.y + (player.y - before.y) * alpha,
        facing: alpha > 0.5 ? player.facing : before.facing,
        moving: player.moving,
        frame: Math.floor(this.app?.frame ?? 0) / 6,
      });
    }
    return out;
  }

  setApp(app: App): void {
    this.app = app;
  }

  /** Called by the app so the screen can reach the network layer. */
  attach(app: App): void {
    this.setApp(app);
  }

  get tutorialDirector(): TutorialDirector {
    return this.tutorial;
  }
}

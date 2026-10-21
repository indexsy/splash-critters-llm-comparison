import {
  CONFIG,
  type ArenaRoundStart,
  type MatchConfig,
  type PlayerInput,
  type RoundEndPayload,
  type RoundSnapshot,
  type RoundState,
  type ServerMessage,
  type SimEvent,
} from "@splash/shared";
import type { App } from "../main.js";
import { LocalPredictor } from "../prediction.js";
import { Screen, contains, type Button } from "../ui.js";
import { keyLabel } from "../settings.js";
import { ParticleSystem } from "../render/particles.js";
import {
  drawAnimal,
  drawBalloon,
  drawBoulder,
  drawCastle,
  drawDuckie,
  drawPowerup,
  drawSplash,
  drawThemeTile,
  drawTideTile,
  isFlooded,
} from "../render/sprites.js";
import {
  drawAnnouncement,
  drawCountdown,
  drawControlsHint,
  drawEmote,
  drawFeed,
  drawMatchHud,
  drawRoundEnd,
  drawVSIntro,
  type FeedLine,
  type HudPlayer,
} from "../render/hud.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { drawButton, drawPanel } from "../ui.js";
import { COLORS } from "../ui.js";

type Phase = "intro" | "countdown" | "playing" | "round_end";

type EventMessage = Extract<ServerMessage, { t: "event" }>;

interface Visual {
  x: number;
  y: number;
}

interface EmoteState {
  id: number;
  until: number;
}

export class GameScreen extends Screen {
  private predictor = new LocalPredictor();
  private phase: Phase = "intro";
  private round: ArenaRoundStart | null = null;
  private roundNo = 0;
  private scores: Record<string, number> = {};
  private time = 0;
  private countdownEndsAt = 0;
  private countdownTotal: number = CONFIG.ROUND_COUNTDOWN_MS;
  private accumulator = 0;
  private seq = 0;
  private tile = 15;
  private ox = 0;
  private oy = 30;
  private feed: FeedLine[] = [];
  private particles = new ParticleSystem();
  private visuals = new Map<string, Visual>();
  private emotes = new Map<string, EmoteState>();
  private knownSplashes = new Set<number>();
  private knownBalloons = new Set<number>();
  private localBalloonCount = 0;
  private banner = "";
  private bannerTimer = 0;
  private lastCountdownSecond = -1;
  private roundEnd: RoundEndPayload | null = null;
  private shake = 0;
  private shade = 0;
  private leaveConfirm = false;
  private leaveButtons: Button[] = [
    { x: 50, y: 136, w: 72, h: 18, label: "STAY", action: "stay" },
    { x: 134, y: 136, w: 72, h: 18, label: "LEAVE", action: "leave" },
  ];
  private nameMap = new Map<string, string>();

  constructor(
    app: App,
    readonly config: MatchConfig,
  ) {
    super(app);
    for (const player of config.players) this.nameMap.set(player.id, player.name);
    this.predictor.setMatch(config, app.playerId);
  }

  enter(): void {
    this.app.audio.unlock();
    this.app.audio.setMusic("game");
    this.app.audio.setShowdown(false);
  }

  onRoundStart(data: ArenaRoundStart): void {
    this.round = data;
    this.roundNo = data.roundNo;
    this.predictor.setRound(data);
    this.phase = "countdown";
    this.countdownTotal = data.countdownMs;
    this.countdownEndsAt = performance.now() + data.countdownMs + 120;
    this.lastCountdownSecond = -1;
    this.accumulator = 0;
    this.seq = 0;
    this.roundEnd = null;
    this.feed = [];
    this.particles.clear();
    this.visuals.clear();
    this.emotes.clear();
    this.knownSplashes.clear();
    this.knownBalloons.clear();
    this.localBalloonCount = 0;
    this.banner = "";
    this.bannerTimer = 0;
    this.tile = Math.max(
      10,
      Math.min(15, Math.floor(240 / data.w), Math.floor(188 / data.h)),
    );
    this.ox = Math.floor((256 - data.w * this.tile) / 2);
    this.oy = 24 + Math.floor((188 - data.h * this.tile) / 2);
  }

  onSnapshot(message: Extract<ServerMessage, { t: "snapshot" }>): void {
    if (!this.round) return;
    const snapshot: RoundSnapshot = {
      tick: message.tick,
      players: message.players,
      balloons: message.balloons,
      splashes: message.splashes,
      powerups: message.powerups,
      tide: message.tide,
      ended: message.ended,
      winnerId: message.winnerId,
      draw: message.draw,
      acks: message.acks,
    };
    this.predictor.onSnapshot(snapshot, message.acks[this.app.playerId] ?? 0);
  }

  onRoundEnd(data: RoundEndPayload): void {
    this.phase = "round_end";
    this.roundEnd = data;
    this.scores = { ...data.scores };
    this.accumulator = 0;
    this.app.audio.setShowdown(false);
    if (data.winnerId === this.app.playerId) {
      this.app.audio.victory();
      this.particles.confetti(128, 90);
    } else {
      this.app.audio.levelUp();
    }
    this.addFeed(
      data.draw
        ? "DRAW - EVERYONE GOT WET"
        : `${this.shortName(data.winnerName ?? "NOBODY")} WINS ROUND ${data.roundNo}`,
      "gold",
    );
  }

  onEvent(message: EventMessage): void {
    const event = message as SimEvent;
    if (event.type === "castle_washed") {
      this.predictor.onCastleWashed(event.x, event.y);
      const cx = this.ox + (event.x + 0.5) * this.tile;
      const cy = this.oy + (event.y + 0.5) * this.tile;
      this.particles.dust(cx, cy, this.themeDust());
    } else if (event.type === "player_soaked") {
      const name = this.shortName(this.nameMap.get(event.playerId) ?? "SOMEONE");
      const by = event.byId ? this.shortName(this.nameMap.get(event.byId) ?? "SOMEONE") : null;
      if (event.playerId === this.app.playerId) {
        this.addFeed(event.cause === "tide" ? "THE TIDE GOT YOU!" : "YOU GOT SOAKED!", "soak");
        this.shake = this.app.settings.data.reducedShake ? 0 : 4;
      } else if (by) {
        this.addFeed(`${by} SOAKED ${name}`, "soak");
      } else {
        this.addFeed(`${name} GOT WASHED AWAY`, "soak");
      }
      this.app.audio.soak();
      this.particles.soak(this.ox + (event.x + 0.5) * this.tile, this.oy + (event.y + 0.5) * this.tile, event.playerId === this.app.playerId);
    } else if (event.type === "chain_burst") {
      this.app.audio.chain(event.count);
      if (event.ownerIds.includes(this.app.playerId)) {
        this.addFeed(`YOU CHAINED X${event.count}!`, "chain");
        this.showBanner(`CHAIN X${event.count}!`);
      } else {
        const owner = this.shortName(this.nameMap.get(event.ownerIds[0] ?? "") ?? "SOMEONE");
        this.addFeed(`${owner} CHAINED X${event.count}`, "chain");
      }
      this.particles.burst(
        this.ox + (event.x + 0.5) * this.tile,
        this.oy + (event.y + 0.5) * this.tile,
        this.app.settings.data.colorblind ? "#ffd34d" : "#57c7ff",
      );
    } else if (event.type === "powerup_collected") {
      const label = event.kind.toUpperCase();
      if (event.playerId === this.app.playerId) {
        this.app.audio.pickup();
        this.addFeed(`GOT ${label}!`, "gold");
        this.showBanner(label);
      }
      this.particles.pickup(this.ox + (event.x + 0.5) * this.tile, this.oy + (event.y + 0.5) * this.tile);
    } else if (event.type === "powerup_revealed") {
      this.particles.pickup(
        this.ox + (event.powerup.x + 0.5) * this.tile,
        this.oy + (event.powerup.y + 0.5) * this.tile,
      );
    } else if (event.type === "balloon_kicked") {
      const by = this.shortName(this.nameMap.get(event.byId) ?? "SOMEONE");
      this.addFeed(`${by} KICKED A BALLOON`, "normal");
    } else if (event.type === "tide_advance") {
      this.app.audio.tideAlarm();
      this.addFeed(`THE TIDE ROSE TO RING ${event.ring}`, "tide");
      this.showBanner("TIDE INCOMING!");
    } else if (event.type === "revenge_lob") {
      const name = this.shortName(this.nameMap.get(event.playerId) ?? "SOMEONE");
      this.addFeed(`${name} LOBED A REVENGE DUCK`, "gold");
      this.particles.sparkle(
        this.ox + (event.x + 0.5) * this.tile,
        this.oy + (event.y + 0.5) * this.tile,
        COLORS.pink,
      );
    }
  }

  onEmote(playerId: string, id: number): void {
    this.emotes.set(playerId, { id, until: this.time + 2 });
    this.app.audio.emote(id);
  }

  update(dt: number): void {
    this.time += dt;
    this.bannerTimer = Math.max(0, this.bannerTimer - dt);
    this.particles.update(dt);
    this.shake = Math.max(0, this.shake - dt * 18);
    for (const [id, emote] of this.emotes) {
      if (emote.until <= this.time) this.emotes.delete(id);
    }
    for (const line of this.feed) line.age += dt;
    this.feed = this.feed.filter((line) => line.age < 6).slice(-8);
    if (this.phase === "countdown") {
      const remaining = Math.max(0, this.countdownEndsAt - performance.now());
      const second = Math.ceil(remaining / 1000);
      if (second !== this.lastCountdownSecond && second > 0) {
        this.lastCountdownSecond = second;
        this.app.audio.countdown(false);
      }
      if (remaining <= 0) {
        this.phase = "playing";
        this.app.audio.countdown(true);
        this.showBanner("SPLASH!");
        this.accumulator = 0;
      }
      return;
    }
    if (this.phase !== "playing") return;
    const state = this.predictor.getState();
    if (!state) return;
    this.app.audio.setShowdown(state.tide.active);
    this.accumulator += Math.min(dt, 0.2);
    let iterations = 0;
    while (this.accumulator >= 1 / CONFIG.TICK_RATE && iterations < 6) {
      this.accumulator -= 1 / CONFIG.TICK_RATE;
      iterations += 1;
      this.sendTick(state);
    }
    this.scanEffects();
    this.updateVisuals(dt);
    this.simulateShade(state);
  }

  private simulateShade(state: RoundState): void {
    const actor = state.players.find((entry) => entry.id === this.app.playerId);
    if (!actor) return;
    const target = actor.alive ? 0 : 0.14;
    this.shade += (target - this.shade) * 0.12;
  }

  private sendTick(state: RoundState): void {
    const actor = state.players.find((entry) => entry.id === this.app.playerId);
    if (!actor) return;
    const dir = this.leaveConfirm
      ? "none"
      : this.app.isActionDown("up")
        ? "up"
        : this.app.isActionDown("down")
          ? "down"
          : this.app.isActionDown("left")
            ? "left"
            : this.app.isActionDown("right")
              ? "right"
              : "none";
    const input: PlayerInput = {
      seq: ++this.seq,
      tick: state.tick,
      dir,
      balloonPressed: !this.leaveConfirm && this.app.isActionDown("drop"),
    };
    this.app.net.input(input);
    this.predictor.pushInput(input);
  }

  private scanEffects(): void {
    const state = this.predictor.getState();
    if (!state) return;
    for (const balloon of state.balloons) {
      if (this.knownBalloons.has(balloon.id)) continue;
      this.knownBalloons.add(balloon.id);
      if (balloon.ownerId === this.app.playerId && balloon.source === "balloon") {
        this.app.audio.drop();
      }
    }
    for (const splash of state.splashes) {
      if (this.knownSplashes.has(splash.id)) continue;
      this.knownSplashes.add(splash.id);
      const x = this.ox + (splash.x + 0.5) * this.tile;
      const y = this.oy + (splash.y + 0.5) * this.tile;
      const color = splash.kind === "revenge"
        ? COLORS.pink
        : this.app.settings.data.colorblind
          ? "#ffd34d"
          : "#57c7ff";
      this.particles.splash(x, y, color, 9);
      if (splash.ownerId === this.app.playerId) this.app.audio.burst();
    }
  }

  private updateVisuals(dt: number): void {
    const state = this.predictor.getState();
    if (!state) return;
    const blend = 1 - Math.exp(-dt * 18);
    for (const player of state.players) {
      if (player.id === this.app.playerId) {
        this.visuals.set(player.id, { x: player.x, y: player.y });
        continue;
      }
      const visual = this.visuals.get(player.id);
      if (!visual || Math.abs(visual.x - player.x) + Math.abs(visual.y - player.y) > 2.5 || !player.alive) {
        this.visuals.set(player.id, { x: player.x, y: player.y });
      } else {
        visual.x += (player.x - visual.x) * blend;
        visual.y += (player.y - visual.y) * blend;
      }
    }
  }

  private showBanner(text: string): void {
    this.banner = text;
    this.bannerTimer = 1.2;
  }

  private addFeed(text: string, tone: FeedLine["tone"]): void {
    this.feed.push({ text, age: 0, tone });
  }

  private shortName(name: string): string {
    const base = name.split("#")[0] ?? name;
    return base.toUpperCase().slice(0, 14);
  }

  private themeDust(): string {
    if (this.config.theme === "beach") return "#e8cf99";
    if (this.config.theme === "pool") return "#bff6ff";
    return "#c9a26a";
  }

  private leaveMatch(): void {
    this.app.net.leaveRoom();
    this.app.showMenu();
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (this.leaveConfirm) {
      if (event.code === "Enter" || event.code === "NumpadEnter") this.leaveMatch();
      else if (event.code === "Escape") this.leaveConfirm = false;
      return true;
    }
    if (event.code === "Escape") {
      this.leaveConfirm = true;
      return true;
    }
    if (event.code === "Digit1" || event.code === "Digit2" || event.code === "Digit3" || event.code === "Digit4") {
      const id = Number(event.code.slice(-1));
      this.app.audio.unlock();
      this.app.net.emote(id);
      return true;
    }
    if (
      event.code === "Space" ||
      event.code === "ArrowUp" ||
      event.code === "ArrowDown" ||
      event.code === "ArrowLeft" ||
      event.code === "ArrowRight"
    ) {
      event.preventDefault();
      return true;
    }
    return false;
  }

  onClick(x: number, y: number): void {
    if (!this.leaveConfirm) return;
    for (const button of this.leaveButtons) {
      if (!contains(button, x, y)) continue;
      if (button.action === "leave") this.leaveMatch();
      else this.leaveConfirm = false;
      return;
    }
  }

  cursorAt(x: number, y: number): string {
    if (this.leaveConfirm) {
      return this.leaveButtons.some((button) => contains(button, x, y)) ? "pointer" : "default";
    }
    return "default";
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#04121a";
    ctx.fillRect(0, 0, 256, 224);
    const state = this.predictor.getState();
    const hudPlayers: HudPlayer[] = this.config.players.map((player) => ({
      id: player.id,
      name: player.name,
      animal: player.animal,
      hat: player.hat,
      alive: state?.players.find((entry) => entry.id === player.id)?.alive ?? true,
      score: this.scores[player.id] ?? 0,
      isBot: player.isBot,
      level: player.level ?? 1,
      tier: player.tier,
    }));
    if (!state || !this.round) {
      drawVSIntro(ctx, this.config, this.time);
      drawTextCentered(ctx, "CONNECTING TO THE ROUND...", 128, 198, "#7fb3bd");
      return;
    }
    this.renderArena(ctx, state);
    drawMatchHud(
      ctx,
      this.config,
      hudPlayers,
      this.app.playerId,
      this.app.rtt,
      this.time,
    );
    this.renderMatchStrip(ctx, state);
    drawFeed(ctx, this.feed);
    if (this.bannerTimer > 0) {
      drawAnnouncement(ctx, this.banner, null, COLORS.yellow, 2);
    }
    this.renderControls(ctx, state);
    if (this.phase === "intro") {
      drawVSIntro(ctx, this.config, this.time);
    } else if (this.phase === "countdown") {
      const remaining = Math.max(0, this.countdownEndsAt - performance.now());
      const second = Math.max(1, Math.ceil(remaining / 1000));
      drawCountdown(ctx, `${second}`, 1 - remaining / Math.max(1, this.countdownTotal), this.time);
    } else if (this.phase === "round_end" && this.roundEnd) {
      drawRoundEnd(
        ctx,
        this.roundEnd.winnerName,
        this.roundEnd.draw,
        this.roundNo,
        this.scores,
        this.app.playerId,
        hudPlayers,
      );
      drawTextCentered(
        ctx,
        this.roundNo < this.config.roundsToWin ? "NEXT ROUND IN A MOMENT" : "MATCH COMPLETE",
        128,
        184,
        "#7db3bd",
      );
    }
    this.particles.draw(ctx);
    if (this.leaveConfirm) this.renderLeaveConfirm(ctx);
  }

  private renderLeaveConfirm(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(2, 8, 12, 0.78)";
    ctx.fillRect(0, 0, 256, 224);
    drawPanel(ctx, 38, 78, 180, 90);
    drawTextCentered(ctx, "LEAVE MATCH?", 128, 88, COLORS.yellow, 2);
    drawTextCentered(ctx, "YOU WILL FORFEIT THIS MATCH.", 128, 110, COLORS.foam);
    drawTextCentered(ctx, "YOUR OPPONENT GETS THE WIN.", 128, 121, "#7faeb8");
    this.leaveButtons.forEach((button) => drawButton(ctx, button, false));
    drawTextCentered(ctx, "ENTER TO CONFIRM / ESC TO STAY", 128, 159, "#507f8a");
  }

  private renderMatchStrip(ctx: CanvasRenderingContext2D, state: RoundState): void {
    ctx.fillStyle = "rgba(3, 13, 20, 0.62)";
    ctx.fillRect(96, 22, 64, 10);
    drawTextCentered(
      ctx,
      `ROUND ${this.roundNo}  ${this.scores[this.app.playerId] ?? 0}-${this.bestOpponentScore()}`,
      128,
      24,
      "#8fc0c8",
    );
    if (state.tide.active) {
      const flooded = Math.max(0, state.tide.ring);
      ctx.fillStyle = "rgba(3, 13, 20, 0.72)";
      ctx.fillRect(2, 22, 86, 10);
      drawText(ctx, `TIDE RING ${flooded}`, 6, 24, "#57c7ff");
    }
  }

  private bestOpponentScore(): number {
    let best = 0;
    for (const [id, score] of Object.entries(this.scores)) {
      if (id !== this.app.playerId) best = Math.max(best, score);
    }
    return best;
  }

  private renderControls(ctx: CanvasRenderingContext2D, state: RoundState): void {
    const local = state.players.find((entry) => entry.id === this.app.playerId);
    const bindings = this.app.settings.data.bindings;
    const drop = keyLabel(bindings.drop[0] ?? "Space");
    let hint = `${keyLabel(bindings.up[0] ?? "KeyW")}${keyLabel(bindings.left[0] ?? "KeyA")}${keyLabel(bindings.down[0] ?? "KeyS")}${keyLabel(bindings.right[0] ?? "KeyD")} MOVE  ${drop} DROP  1-4 EMOTE`;
    if (local && !local.alive) {
      if (local.revengeReadyTick <= state.tick) hint = `${drop} TO LOB A REVENGE DUCK  /  SPECTATING`;
      else hint = `SPECTATING - REVENGE IN ${Math.ceil((local.revengeReadyTick - state.tick) / CONFIG.TICK_RATE)}S`;
    }
    drawControlsHint(ctx, hint);
    if (local) {
      ctx.fillStyle = "rgba(3, 13, 20, 0.7)";
      ctx.fillRect(2, 203, 93, 11);
      drawText(
        ctx,
        `B${local.balloonCount}  R${local.splashRange}  SPD ${local.speed.toFixed(1)}`,
        5,
        205,
        "#74a7b1",
      );
      if (local.kickCharges > 0) drawText(ctx, "KICK READY", 201, 205, COLORS.yellow);
    }
    if (this.config.mode === "ffa") {
      const alive = state.players.filter((entry) => entry.alive).length;
      drawText(ctx, `ALIVE ${alive}/${state.players.length}`, 181, 205, "#74a7b1");
    }
  }

  private renderArena(ctx: CanvasRenderingContext2D, state: RoundState): void {
    const shakeX = this.shake > 0 ? Math.round((Math.random() - 0.5) * this.shake) : 0;
    const shakeY = this.shake > 0 ? Math.round((Math.random() - 0.5) * this.shake) : 0;
    const { arena } = state;
    const ox = this.ox + shakeX;
    const oy = this.oy + shakeY;
    const size = this.tile;
    const width = arena.w * size;
    const height = arena.h * size;
    ctx.fillStyle = "#03111a";
    ctx.fillRect(this.ox - 3, this.oy - 3, width + 6, height + 6);
    ctx.strokeStyle = "#1b5869";
    ctx.strokeRect(this.ox - 2.5, this.oy - 2.5, width + 5, height + 5);
    for (let y = 0; y < arena.h; y += 1) {
      for (let x = 0; x < arena.w; x += 1) {
        const px = ox + x * size;
        const py = oy + y * size;
        const flooded = state.tide.active && isFlooded(state.tide.ring, x, y, arena.w, arena.h);
        drawThemeTile(ctx, arena.theme, px, py, size, x, y);
        if (flooded) {
          drawTideTile(
            ctx,
            px,
            py,
            size,
            this.time,
            isFlooded(state.tide.ring, x - 1, y, arena.w, arena.h) === false ||
              isFlooded(state.tide.ring, x + 1, y, arena.w, arena.h) === false ||
              isFlooded(state.tide.ring, x, y - 1, arena.w, arena.h) === false ||
              isFlooded(state.tide.ring, x, y + 1, arena.w, arena.h) === false,
          );
        }
        if (arena.boulders[y]?.[x]) {
          drawBoulder(ctx, px, py, size, x, y);
        } else if (arena.castles[y]?.[x] === 1) {
          drawCastle(ctx, px, py, size, x, y);
        }
      }
    }
    for (const powerup of state.powerups) {
      const px = ox + powerup.x * size;
      const py = oy + powerup.y * size;
      const pulse = Math.floor(this.time * 5) % 2 === 0;
      ctx.strokeStyle = pulse ? COLORS.yellow : "#b89b38";
      ctx.strokeRect(px + 1.5, py + 1.5, size - 3, size - 3);
      drawPowerup(ctx, powerup.kind, px, py, this.time, size);
    }
    for (const splash of state.splashes) {
      const duration = Math.max(1, splash.endTick - splash.createdTick);
      const progress = 1 - (splash.endTick - state.tick) / duration;
      drawSplash(
        ctx,
        ox + splash.x * size,
        oy + splash.y * size,
        size,
        Math.max(0, Math.min(1, progress)),
        this.app.settings.data.colorblind,
        splash.kind === "revenge" ? "revenge" : "splash",
      );
    }
    for (const balloon of state.balloons) {
      const remaining = Math.max(0, balloon.burstTick - state.tick);
      drawBalloon(
        ctx,
        ox + balloon.x * size + 1,
        oy + balloon.y * size,
        1 - remaining / CONFIG.FUSE_TICKS,
        this.time,
        size / 15,
      );
      if (balloon.kickedDir !== "none") {
        drawText(ctx, ">", ox + balloon.x * size + (size - 4) / 2, oy + balloon.y * size + 2, COLORS.yellow);
      }
    }
    for (const player of state.players) {
      if (player.alive) continue;
      const px = ox + player.soakedAtX * size;
      const py = oy + player.soakedAtY * size;
      drawDuckie(ctx, px - 6, py - 8, size / 16, this.time + player.slot);
      if (
        player.id === this.app.playerId &&
        state.enableRevengeDucks &&
        state.tick >= player.revengeReadyTick
      ) {
        ctx.strokeStyle = COLORS.pink;
        ctx.strokeRect(px - 8.5, py - 8.5, 17, 17);
      }
    }
    const players = [...state.players].sort((a, b) => a.y - b.y);
    for (const player of players) {
      if (!player.alive) continue;
      const visual = this.visuals.get(player.id) ?? { x: player.x, y: player.y };
      const px = ox + visual.x * size;
      const py = oy + visual.y * size;
      const scale = Math.max(0.7, size / 16.5);
      const moving = player.id === this.app.playerId
        ? this.app.isActionDown("up") ||
          this.app.isActionDown("down") ||
          this.app.isActionDown("left") ||
          this.app.isActionDown("right")
        : true;
      drawAnimal(ctx, {
        animal: player.animal,
        hat: player.hat,
        x: px - 6.5 * scale,
        y: py - 7.5 * scale,
        dir: player.dir,
        frame: Math.floor(this.time * 8 + player.slot) % 2,
        moving,
        scale,
        time: this.time,
      });
      if (player.id === this.app.playerId) {
        const bob = Math.floor(this.time * 3) % 2;
        const above = py - 7 * scale - 8 - bob;
        const youY = above < this.oy + 2 ? py + size + 1 : above;
        drawText(ctx, "YOU", px - 8, youY, COLORS.mint);
      }
      const emote = this.emotes.get(player.id);
      if (emote) drawEmote(ctx, px, py - 7, emote.id);
    }
    ctx.globalAlpha = this.shade;
    ctx.fillStyle = "#07131d";
    ctx.fillRect(0, 0, 256, 224);
    ctx.globalAlpha = 1;
  }

  getRound(): ArenaRoundStart | null {
    return this.round;
  }
}

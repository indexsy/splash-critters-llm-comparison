import {
  CONFIG,
  TILE,
  perimeterTile,
  type MapTheme,
  type MatchPlayerInfo,
  type S2C,
  type SimEvent,
  type SnapshotData,
} from "@splash/shared";
import { app, type Screen } from "../app.js";
import { GameNetState } from "../prediction.js";
import { drawTextCentered, drawTextShadow } from "../render/font.js";
import { Hud } from "../render/hud.js";
import { PAL } from "../render/palette.js";
import { Particles } from "../render/particles.js";
import {
  critterSprite,
  drawBalloon,
  drawPowerup,
  drawRubberDuck,
  soakedSprite,
  themeTiles,
} from "../render/sprites.js";

const EMOTE_TEXT = ["QUACK!", "RIBBIT!", "SQUEAK!", "HONK!"];
const TILE_PX = 16;

interface GameParams {
  start: Extract<S2C, { t: "match_start" }>;
}

export class GameScreen implements Screen {
  private players: MatchPlayerInfo[] = [];
  private ranked = false;
  private roundsToWin = 3;
  private theme: MapTheme = "beach";
  private yourSlot = 0;
  private net!: GameNetState;
  private hud = new Hud();
  private particles = new Particles();
  private scores: number[] = [];
  private roundNo = 1;
  private introUntil = 0;
  private lastCount = 99;
  private roundEndText: string | null = null;
  private inputAcc = 0;
  private shake = 0;
  private freezeUntil = 0;
  private emotes: { slot: number; id: number; until: number }[] = [];
  private escArmedUntil = 0;
  private time = 0;
  private w = 0;
  private h = 0;

  enter(params?: unknown): void {
    const p = params as GameParams;
    const start = p.start;
    this.players = start.players;
    this.ranked = start.ranked;
    this.roundsToWin = start.roundsToWin;
    this.theme = start.theme;
    this.yourSlot = start.yourSlot;
    this.net = new GameNetState(this.yourSlot);
    this.scores = this.players.map(() => 0);
    this.hud.clear();
    this.particles.clear();
    this.roundEndText = null;
    this.emotes = [];
    app.audio.music("battle");
  }

  onMessage(msg: S2C): void {
    switch (msg.t) {
      case "round_start":
        this.w = msg.w;
        this.h = msg.h;
        this.roundNo = msg.roundNo;
        this.scores = msg.scores;
        this.theme = msg.theme;
        this.net.startRound(msg.w, msg.h, msg.castleGrid, this.players.length);
        this.introUntil = performance.now() + (msg.introTicks / CONFIG.TICK_RATE) * 1000;
        this.lastCount = 99;
        this.roundEndText = null;
        this.particles.clear();
        break;
      case "snapshot":
        this.net.onSnapshot(msg.data);
        break;
      case "events":
        for (const ev of msg.events) this.handleEvent(ev);
        break;
      case "round_end": {
        const name = msg.winnerSlot >= 0 ? this.shortName(msg.winnerSlot) : null;
        this.scores = msg.scores;
        this.roundEndText = msg.draw ? "DRAW ROUND!" : `${name} WINS THE ROUND!`;
        if (!msg.draw && msg.winnerSlot === this.yourSlot) app.audio.sfx("victory");
        break;
      }
      case "match_end":
        app.go("results", { end: msg, players: this.players });
        break;
      case "player_conn": {
        const n = this.shortName(msg.slot);
        if (msg.becameBot) this.hud.addFeed(`${n} IS NOW A BOT`, PAL.gold);
        else this.hud.addFeed(msg.connected ? `${n} RECONNECTED` : `${n} DISCONNECTED`, PAL.gray);
        break;
      }
      case "emote":
        this.emotes = this.emotes.filter((e) => e.slot !== msg.slot);
        this.emotes.push({ slot: msg.slot, id: msg.id, until: performance.now() + 1500 });
        app.audio.sfx(`emote${msg.id % 4}` as "emote0");
        break;
      default:
        break;
    }
  }

  private shortName(slot: number): string {
    return this.players[slot]?.nickname.split("#")[0].slice(0, 10) ?? "?";
  }

  private arenaPos(tx: number, ty: number): { x: number; y: number } {
    const ox = Math.floor((256 - this.w * TILE_PX) / 2);
    const oy = 16 + Math.floor((224 - 16 - this.h * TILE_PX) / 2);
    return { x: ox + tx * TILE_PX, y: oy + ty * TILE_PX };
  }

  private handleEvent(ev: SimEvent): void {
    const cb = app.settings.colorblindSplash;
    switch (ev.t) {
      case "balloon_placed":
        app.audio.sfx("drop");
        break;
      case "balloon_burst": {
        const p = this.arenaPos(ev.x, ev.y);
        this.particles.splashSpray(p.x + 8, p.y + 8, cb);
        app.audio.sfx("burst");
        if (!app.settings.reduceShake) this.shake = Math.min(3, this.shake + 1.6);
        break;
      }
      case "castle_washed": {
        const p = this.arenaPos(ev.x, ev.y);
        this.particles.castleCrumble(p.x + 8, p.y + 8);
        this.net.washCastle(ev.x, ev.y);
        break;
      }
      case "powerup_revealed": {
        const p = this.arenaPos(ev.x, ev.y);
        this.particles.burst(p.x + 8, p.y + 8, 6, PAL.gold, 30, 0.5, 20);
        break;
      }
      case "powerup_collected":
        if (ev.slot === this.yourSlot) {
          app.audio.sfx("pickup");
          const label = { extra_balloon: "+BALLOON", big_splash: "+SPLASH", flippers: "+SPEED", rubber_boots: "KICK!" }[ev.type];
          this.hud.addFeed(label, PAL.green);
        }
        break;
      case "powerup_destroyed": {
        const p = this.arenaPos(ev.x, ev.y);
        this.particles.burst(p.x + 8, p.y + 8, 5, PAL.gray, 25, 0.4, 40);
        break;
      }
      case "player_soaked": {
        const victim = this.players[ev.slot];
        const p = this.net.remotePos(ev.slot) ?? this.net.localPos();
        if (p) {
          const pos = this.arenaPos(0, 0);
          this.particles.soakSplash(pos.x + p.x * TILE_PX, pos.y + p.y * TILE_PX, victim?.animal === "cat");
        }
        app.audio.sfx("soak");
        this.freezeUntil = performance.now() + 70; // hit-stop
        if (!app.settings.reduceShake) this.shake = Math.min(4, this.shake + 2.2);
        const vn = this.shortName(ev.slot);
        if (ev.bySlot === -1) this.hud.addFeed(`${vn} SWEPT BY THE TIDE`, PAL.waterLight);
        else if (ev.bySlot === ev.slot) this.hud.addFeed(`${vn} SOAKED THEMSELVES`, PAL.gold);
        else this.hud.addFeed(`${this.shortName(ev.bySlot)} SOAKED ${vn}!`, ev.revenge ? PAL.gold : PAL.white);
        if (ev.slot === this.yourSlot) this.hud.announce("SOAKED!", PAL.waterLight, 2);
        break;
      }
      case "chain_burst": {
        const label = ev.size === 2 ? "DOUBLE SPLASH!" : ev.size === 3 ? "TRIPLE SPLASH!" : `${ev.size}X MEGA SPLASH!`;
        this.hud.announce(label, PAL.gold, 2);
        app.audio.chainJingle(ev.size);
        break;
      }
      case "balloon_kicked":
        app.audio.sfx("kick");
        break;
      case "tide_advance":
        if (ev.ring === 1) {
          this.hud.announce("RISING TIDE!", PAL.waterLight, 2, 1800);
          app.audio.sfx("tide");
        } else if (ev.ring % 2 === 1) {
          app.audio.sfx("tide");
        }
        break;
      case "revenge_lob":
        app.audio.sfx("lob");
        break;
      case "round_over":
        break;
    }
  }

  update(dt: number): void {
    this.time += dt;
    if (performance.now() < this.freezeUntil) return;
    this.particles.update(dt);
    this.net.update(dt);
    this.shake = Math.max(0, this.shake - dt * 8);

    // intro countdown SFX
    const introLeft = this.introUntil - performance.now();
    if (introLeft > 0) {
      const count = Math.ceil(introLeft / 1000);
      if (count !== this.lastCount && count <= 3) {
        this.lastCount = count;
        app.audio.sfx("countdown");
      }
    } else if (this.lastCount <= 3 && this.lastCount !== 0) {
      this.lastCount = 0;
      this.hud.announce("SPLASH!", PAL.gold, 3, 900);
      app.audio.sfx("go");
    }

    // emotes
    for (let i = 0; i < 4; i++) {
      if (app.keys.wasPressed(`emote${i + 1}` as "emote1")) {
        app.net.send({ t: "emote", id: i });
      }
    }

    // showdown music
    const snap = this.net.latest;
    if (snap) {
      const alive = snap.players.filter((p) => p.alive).length;
      const showdown = snap.tideRing > 0 || (this.players.length > 2 && alive === 2);
      app.audio.music(showdown ? "showdown" : "battle");
    }

    // send inputs at 30Hz
    this.inputAcc += dt;
    const step = 1 / CONFIG.TICK_RATE;
    while (this.inputAcc >= step) {
      this.inputAcc -= step;
      const dir = app.keys.moveDir();
      const balloon = app.keys.isHeld("drop");
      const input = this.net.applyLocalInput(dir, balloon);
      app.net.send({ t: "input", seq: input.seq, tick: input.tick, dir, balloon });
    }
  }

  onKeyDown(code: string): boolean | void {
    if (code === "Escape") {
      const now = performance.now();
      if (now < this.escArmedUntil) {
        app.net.send({ t: "leave_room" });
        app.go("menu");
      } else {
        this.escArmedUntil = now + 2000;
        app.toast("PRESS ESC AGAIN TO LEAVE THE MATCH", PAL.gold);
      }
      return true;
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.navy;
    g.fillRect(0, 0, 256, 224);
    if (this.w === 0) {
      drawTextCentered(g, "WAITING FOR ROUND...", 128, 104, PAL.gray);
      return;
    }

    g.save();
    if (this.shake > 0.3) {
      g.translate(Math.round((Math.random() - 0.5) * this.shake), Math.round((Math.random() - 0.5) * this.shake));
    }

    const tiles = themeTiles(this.theme);
    const snap = this.net.latest;
    const renderTick = this.net.renderTick();
    const origin = this.arenaPos(0, 0);

    // floor + solids
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const px = origin.x + x * TILE_PX;
        const py = origin.y + y * TILE_PX;
        const t = this.net.grid[y * this.w + x];
        g.drawImage(tiles.floor, px, py);
        if (t === TILE.BOULDER) g.drawImage(tiles.boulder, px, py);
        else if (t === TILE.CASTLE) g.drawImage(tiles.castle, px, py);
      }
    }

    // splashes (under entities)
    if (snap) {
      const cb = app.settings.colorblindSplash;
      for (const s of snap.splashes) {
        if (s.endTick < renderTick) continue;
        const p = this.arenaPos(s.x, s.y);
        const phase = Math.floor(this.time * 12) % 2;
        g.fillStyle = cb ? PAL.splashAlt : PAL.splash;
        g.globalAlpha = 0.85;
        g.fillRect(p.x + 1, p.y + 1, 14, 14);
        g.globalAlpha = 1;
        g.fillStyle = cb ? PAL.gold : PAL.waterLight;
        g.fillRect(p.x + (phase ? 2 : 4), p.y + (phase ? 4 : 2), 3, 3);
        g.fillRect(p.x + (phase ? 10 : 8), p.y + (phase ? 8 : 10), 3, 3);
      }

      // power-ups
      for (const u of snap.powerups) {
        const p = this.arenaPos(u.x, u.y);
        drawPowerup(g, p.x, p.y, u.type, this.time);
      }

      // balloons
      for (const b of snap.balloons) {
        const slideF = b.slideDir !== 0 ? b.slideProgress / CONFIG.KICK_TICKS_PER_TILE : 0;
        const [dx, dy] = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]][b.slideDir];
        const p = this.arenaPos(b.x, b.y);
        const fuseFrac = (b.burstTick - renderTick) / CONFIG.FUSE_TICKS;
        drawBalloon(g, p.x + 8 + dx * slideF * TILE_PX, p.y + 8 + dy * slideF * TILE_PX, fuseFrac, b.revenge, this.time);
      }
    }

    // players (locals predicted, remotes interpolated), sorted by y
    const order = [...this.players].sort((a, b) => {
      const pa = a.slot === this.yourSlot ? this.net.localPos() : this.net.remotePos(a.slot);
      const pb = b.slot === this.yourSlot ? this.net.localPos() : this.net.remotePos(b.slot);
      return (pa?.y ?? 0) - (pb?.y ?? 0);
    });
    for (const info of order) {
      const sp = snap?.players.find((s) => s.slot === info.slot);
      const pos = info.slot === this.yourSlot ? this.net.localPos() : this.net.remotePos(info.slot);
      if (!pos || !sp) continue;
      const px = origin.x + pos.x * TILE_PX - 8;
      const py = origin.y + pos.y * TILE_PX - 10;
      if (!sp.alive && sp.duckPos !== null) {
        const pt = perimeterTile({ w: this.w, h: this.h }, sp.duckPos);
        const dp = this.arenaPos(pt.x, pt.y);
        drawRubberDuck(g, dp.x + 8, dp.y + 8, this.time + info.slot);
        const sprite = critterSprite(info.animal, info.hat, 0, pt.inwardDir);
        g.drawImage(sprite, 0, 0, 16, 16, dp.x + 2, dp.y - 6, 12, 12);
        continue;
      }
      if (!sp.alive) {
        g.globalAlpha = 0.8;
        g.drawImage(soakedSprite(info.animal, info.hat), Math.round(px), Math.round(py) + 2);
        g.globalAlpha = 1;
        continue;
      }
      const frame = pos.moving ? Math.floor(this.time * 8) % 2 : 0;
      const sprite = critterSprite(info.animal, info.hat, frame, pos.dir);
      g.drawImage(sprite, Math.round(px), Math.round(py));
      if (info.slot === this.yourSlot) {
        g.fillStyle = PAL.gold; // little "you" marker
        g.fillRect(Math.round(px) + 7, Math.round(py) - 3, 2, 2);
      }
    }

    // tide water overlay
    if (snap && snap.tideRing > 0) {
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          const ring = Math.min(x, y, this.w - 1 - x, this.h - 1 - y);
          if (ring >= snap.tideRing) continue;
          const p = this.arenaPos(x, y);
          g.fillStyle = PAL.waterDeep;
          g.globalAlpha = 0.85;
          g.fillRect(p.x, p.y, 16, 16);
          g.globalAlpha = 1;
          const shimmer = (Math.floor(this.time * 6) + x + y) % 4 === 0;
          if (shimmer) {
            g.fillStyle = PAL.waterLight;
            g.fillRect(p.x + 3, p.y + 6, 5, 1);
            g.fillRect(p.x + 10, p.y + 11, 4, 1);
          }
        }
      }
    }

    // emote bubbles
    const now = performance.now();
    this.emotes = this.emotes.filter((e) => e.until > now);
    for (const e of this.emotes) {
      const pos = e.slot === this.yourSlot ? this.net.localPos() : this.net.remotePos(e.slot);
      if (!pos) continue;
      const px = origin.x + pos.x * TILE_PX;
      const py = origin.y + pos.y * TILE_PX - 22;
      const text = EMOTE_TEXT[e.id % 4];
      g.fillStyle = PAL.white;
      g.fillRect(px - 14, py, text.length * 4 + 5, 9);
      g.fillRect(px - 4, py + 9, 3, 2); // tail
      drawTextCentered(g, text, px - 12 + (text.length * 4 + 2) / 2, py + 2, PAL.black);
    }

    this.particles.draw(g);
    g.restore();

    // HUD
    this.hud.drawTop(g, this.players, snap?.players ?? null, this.scores, this.roundsToWin, snap?.tick ?? 0);
    this.hud.drawTideTimer(g, snap?.tick ?? 0, snap?.tideRing ?? 0);
    this.hud.drawFeed(g);
    this.hud.drawAnnouncements(g);
    this.hud.drawPing(g);

    // intro overlay
    const introLeft = this.introUntil - performance.now();
    if (introLeft > 0) {
      g.fillStyle = "rgba(15,15,27,0.6)";
      g.fillRect(0, 0, 256, 224);
      if (this.roundNo === 1 && introLeft > 1200) this.drawVsCard(g);
      drawTextCentered(g, `ROUND ${this.roundNo}`, 128, 60, PAL.white, 2);
      const count = Math.ceil(introLeft / 1000);
      drawTextShadow(g, count <= 3 ? String(count) : "", 124, 100, PAL.gold, 4);
    }

    // round end overlay
    if (this.roundEndText) {
      g.fillStyle = "rgba(15,15,27,0.55)";
      g.fillRect(0, 84, 256, 40);
      drawTextCentered(g, this.roundEndText, 128, 96, PAL.gold);
      drawTextCentered(g, this.scores.map((s) => `${s}`).join(" - "), 128, 108, PAL.white, 2);
    }
  }

  private drawVsCard(g: CanvasRenderingContext2D): void {
    const n = this.players.length;
    this.players.forEach((p, i) => {
      const x = n === 2 ? 64 + i * 128 : 40 + i * 59;
      const sprite = critterSprite(p.animal, p.hat, Math.floor(this.time * 4) % 2, 3);
      g.drawImage(sprite, 0, 0, 16, 16, x - 16, 120, 32, 32);
      drawTextCentered(g, p.nickname.split("#")[0].slice(0, 9), x, 156, PAL.white);
      if (this.ranked && p.rating !== undefined) {
        drawTextCentered(g, `${p.tier} ${p.rating}`, x, 165, PAL.gold);
      } else if (p.isBot) {
        drawTextCentered(g, `BOT (${p.difficulty ?? "?"})`, x, 165, PAL.gray);
      }
    });
    drawTextCentered(g, "VS", 128, 132, PAL.red, 2);
  }

  exit(): void {
    app.audio.music("off");
  }
}

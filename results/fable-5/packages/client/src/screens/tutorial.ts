// Fully client-side scripted tutorial: a tiny arena, one harmless wandering
// target duck, and five guided steps. Runs the SAME shared sim the server
// runs — no netcode involved.

import {
  CONFIG,
  TILE,
  createSimState,
  simulateTick,
  type Dir,
  type GeneratedMap,
  type SimState,
} from "@splash/shared";
import { app, type Screen } from "../app.js";
import { drawText, drawTextCentered } from "../render/font.js";
import { PAL } from "../render/palette.js";
import { Particles } from "../render/particles.js";
import { button } from "../render/ui.js";
import { critterSprite, drawBalloon, drawPowerup, soakedSprite, themeTiles } from "../render/sprites.js";

const W = 11;
const H = 9;
const STEPS = [
  "MOVE WITH WASD OR THE ARROW KEYS",
  "PRESS SPACE TO DROP A BALLOON BY A SANDCASTLE - THEN RUN!",
  "GRAB THE POWER-UP IT LEFT BEHIND",
  "CHAIN: DROP TWO BALLOONS SO ONE SETS OFF THE OTHER",
  "SOAK THE TARGET DUCK TO FINISH!",
];

function tutorialMap(): GeneratedMap {
  const grid = new Array(W * H).fill(TILE.EMPTY);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || (x % 2 === 0 && y % 2 === 0)) {
        grid[y * W + x] = TILE.BOULDER;
      }
    }
  }
  const contents = new Array(W * H).fill(null);
  const castles = [
    [3, 1],
    [5, 3],
    [1, 5],
    [7, 5],
    [5, 7],
    [9, 3],
  ];
  for (const [x, y] of castles) grid[y * W + x] = TILE.CASTLE;
  contents[1 * W + 3] = "extra_balloon"; // the first castle teaches pickups
  contents[3 * W + 5] = "big_splash";
  return {
    w: W,
    h: H,
    grid,
    contents,
    spawns: [
      { x: 1, y: 1 },
      { x: W - 2, y: H - 2 },
    ],
  };
}

export class TutorialScreen implements Screen {
  private sim!: SimState;
  private step = 0;
  private acc = 0;
  private t = 0;
  private moved = 0;
  private lastPos = { x: 0, y: 0 };
  private botDir: Dir = 0;
  private botTimer = 0;
  private particles = new Particles();
  private doneAt = 0;

  enter(): void {
    this.step = 0;
    this.moved = 0;
    this.doneAt = 0;
    this.reset();
    app.audio.music("menu");
  }

  private reset(): void {
    this.sim = createSimState("duel", tutorialMap(), ["you", "target"], {
      enableKick: true,
      revengeDucks: false,
    });
    // No tide during the tutorial.
    this.sim.tideNextTick = Number.MAX_SAFE_INTEGER;
    if (this.step >= 3) this.sim.players[0].balloonCount = 2;
    this.lastPos = { x: this.sim.players[0].x, y: this.sim.players[0].y };
    this.particles.clear();
  }

  update(dt: number): void {
    this.t += dt;
    this.particles.update(dt);
    if (this.doneAt > 0) {
      if (performance.now() - this.doneAt > 2600) {
        app.net.send({ t: "tutorial_done" });
        app.go("menu");
      }
      return;
    }

    this.acc += dt;
    const stepDur = 1 / CONFIG.TICK_RATE;
    while (this.acc >= stepDur) {
      this.acc -= stepDur;
      this.tickSim();
    }
  }

  private tickSim(): void {
    const me = this.sim.players[0];
    if (!me.alive) {
      app.toast("SOAKED! LET'S TRY THAT AGAIN", PAL.waterLight);
      this.reset();
      return;
    }
    // wandering target duck: changes direction every ~0.6s, never drops
    this.botTimer--;
    if (this.botTimer <= 0) {
      this.botTimer = 18;
      const dirs: Dir[] = [0, 1, 2, 3, 4];
      this.botDir = dirs[Math.floor(Math.random() * dirs.length)];
    }
    const events = simulateTick(this.sim, [
      { seq: 0, tick: 0, dir: app.keys.moveDir(), balloon: app.keys.isHeld("drop") },
      { seq: 0, tick: 0, dir: this.botDir, balloon: false },
    ]);

    // track movement for step 0
    this.moved += Math.abs(me.x - this.lastPos.x) + Math.abs(me.y - this.lastPos.y);
    this.lastPos = { x: me.x, y: me.y };
    if (this.step === 0 && this.moved > 3) this.advance();

    for (const ev of events) {
      if (ev.t === "balloon_placed") app.audio.sfx("drop");
      if (ev.t === "balloon_burst") {
        app.audio.sfx("burst");
        const p = this.pos(ev.x, ev.y);
        this.particles.splashSpray(p.x + 8, p.y + 8, app.settings.colorblindSplash);
      }
      if (ev.t === "castle_washed") {
        const p = this.pos(ev.x, ev.y);
        this.particles.castleCrumble(p.x + 8, p.y + 8);
        if (this.step === 1) this.advance();
      }
      if (ev.t === "powerup_collected" && ev.slot === 0) {
        app.audio.sfx("pickup");
        if (this.step === 2) this.advance();
      }
      if (ev.t === "chain_burst" && ev.slot === 0) {
        app.audio.chainJingle(ev.size);
        if (this.step === 3) this.advance();
      }
      if (ev.t === "player_soaked" && ev.slot === 1) {
        app.audio.sfx("soak");
        const p = this.pos(Math.floor(this.sim.players[1].x), Math.floor(this.sim.players[1].y));
        this.particles.soakSplash(p.x + 8, p.y + 8, false);
        if (this.step === 4) {
          this.doneAt = performance.now();
          app.audio.sfx("victory");
        }
      }
    }

    // safety: steps that need balloons — make sure supplies match the lesson
    if (this.step === 3 && this.sim.players[0].balloonCount < 2) {
      this.sim.players[0].balloonCount = 2;
    }
  }

  private advance(): void {
    this.step++;
    app.audio.sfx("pickup");
  }

  private pos(tx: number, ty: number): { x: number; y: number } {
    const ox = Math.floor((256 - W * 16) / 2);
    const oy = 30;
    return { x: ox + tx * 16, y: oy + ty * 16 };
  }

  onKeyDown(code: string): boolean | void {
    if (code === "Escape") {
      app.net.send({ t: "tutorial_done" });
      app.go("menu");
      return true;
    }
  }

  draw(g: CanvasRenderingContext2D): void {
    g.fillStyle = PAL.uiBg;
    g.fillRect(0, 0, 256, 224);
    drawTextCentered(g, "TUTORIAL", 128, 4, PAL.gold, 2);

    const tiles = themeTiles("beach");
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = this.pos(x, y);
        g.drawImage(tiles.floor, p.x, p.y);
        const t = this.sim.grid[y * W + x];
        if (t === TILE.BOULDER) g.drawImage(tiles.boulder, p.x, p.y);
        if (t === TILE.CASTLE) g.drawImage(tiles.castle, p.x, p.y);
      }
    }
    for (const s of this.sim.splashes) {
      const p = this.pos(s.x, s.y);
      g.fillStyle = app.settings.colorblindSplash ? PAL.splashAlt : PAL.splash;
      g.globalAlpha = 0.85;
      g.fillRect(p.x + 1, p.y + 1, 14, 14);
      g.globalAlpha = 1;
    }
    for (const u of this.sim.powerups) {
      const p = this.pos(u.x, u.y);
      drawPowerup(g, p.x, p.y, u.type, this.t);
    }
    for (const b of this.sim.balloons) {
      const p = this.pos(b.x, b.y);
      drawBalloon(g, p.x + 8, p.y + 8, (b.burstTick - this.sim.tick) / CONFIG.FUSE_TICKS, false, this.t);
    }
    const ox = this.pos(0, 0);
    for (const pl of this.sim.players) {
      const animal = pl.slot === 0 ? (app.profile?.selectedAnimal ?? "frog") : "duck";
      const hat = pl.slot === 0 ? (app.profile?.selectedHat ?? "none") : "none";
      const px = Math.round(ox.x + pl.x * 16 - 8);
      const py = Math.round(ox.y + pl.y * 16 - 10);
      if (!pl.alive) {
        g.drawImage(soakedSprite(animal, hat), px, py + 2);
        continue;
      }
      const frame = pl.moving ? Math.floor(this.t * 8) % 2 : 0;
      g.drawImage(critterSprite(animal, hat, frame, pl.dir), px, py);
      if (pl.slot === 1) {
        // target marker
        drawTextCentered(g, "TARGET", px + 8, py - 8, PAL.red);
      }
    }
    this.particles.draw(g);

    // step banner
    g.fillStyle = "rgba(15,15,27,0.85)";
    g.fillRect(0, 182, 256, 26);
    if (this.doneAt > 0) {
      drawTextCentered(g, "TUTORIAL COMPLETE!", 128, 186, PAL.gold, 2);
      drawTextCentered(g, `+${CONFIG.XP_TUTORIAL} XP`, 128, 200, PAL.green);
    } else {
      drawTextCentered(g, `STEP ${this.step + 1}/5`, 128, 185, PAL.gold);
      drawTextCentered(g, STEPS[this.step], 128, 195, PAL.white);
    }

    if (this.doneAt === 0 && button(g, 208, 210, 44, 12, "SKIP")) {
      app.net.send({ t: "tutorial_done" });
      app.go("menu");
    }
  }
}

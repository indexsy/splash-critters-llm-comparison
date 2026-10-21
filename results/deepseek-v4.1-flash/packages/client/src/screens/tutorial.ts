import {
  CONFIG,
  createRoundState,
  generateArena,
  simulateTick,
  type PowerupKind,
  type PlayerInput,
  type RoundState,
} from "@splash/shared";
import type { App } from "../main.js";
import { COLORS, Screen, drawButton, drawOcean, drawPanel, drawProgress, type Button } from "../ui.js";
import { drawText, drawTextCentered } from "../render/font.js";
import {
  drawAnimal,
  drawBalloon,
  drawBoulder,
  drawCastle,
  drawPowerup,
  drawSplash,
  drawThemeTile,
} from "../render/sprites.js";
import { ParticleSystem } from "../render/particles.js";

const TILE = 15;
const OX = 30;
const OY = 44;
const TUTORIAL_SEED = 20260214;
const STEP_TEXT = [
  "MOVE WITH WASD / ARROWS",
  "DROP A BALLOON: SPACE",
  "DODGE THE SPLASH!",
  "GRAB THE EXTRA BALLOON",
  "CHAIN TWO BALLOONS",
  "SOAK THE TRAINING BOT",
];

export class TutorialScreen extends Screen {
  private sim!: RoundState;
  private playerId = "";
  private botId = "tutorial-bot";
  private step = 0;
  private time = 0;
  private accumulator = 0;
  private seq = 0;
  private startX = 0;
  private startY = 0;
  private dropTick = 0;
  private dropBalloonId: number | null = null;
  private botDir: PlayerInput["dir"] = "left";
  private botDecision = 0;
  private banner = "";
  private bannerTime = 0;
  private resetTimer = 0;
  private completed = false;
  private sentComplete = false;
  private particles = new ParticleSystem();
  private skipButton: Button = { x: 208, y: 5, w: 40, h: 13, label: "SKIP", action: "skip", small: true };
  private finishButton: Button = { x: 78, y: 170, w: 100, h: 20, label: "TO THE POND", action: "finish" };

  enter(): void {
    this.app.audio.unlock();
    this.app.audio.setMusic("game");
    this.app.audio.setShowdown(false);
    this.playerId = this.app.playerId;
    this.buildRound();
  }

  private buildRound(): void {
    const arena = generateArena("duel", TUTORIAL_SEED, "backyard");
    const profile = this.app.profile;
    this.sim = createRoundState(
      "duel",
      arena,
      [
        {
          id: this.playerId,
          slot: 0,
          name: profile?.displayName ?? "YOU",
          animal: profile?.selectedAnimal ?? "frog",
          hat: profile?.selectedHat ?? "none",
          isBot: false,
        },
        {
          id: this.botId,
          slot: 1,
          name: "PUDDLES#0001",
          animal: "duck",
          hat: "bucket",
          isBot: true,
          difficulty: "easy",
        },
      ],
      { roundNo: 1, enableKick: true, enableRevengeDucks: false },
    );
    const player = this.sim.players.find((entry) => entry.id === this.playerId)!;
    const bot = this.sim.players.find((entry) => entry.id === this.botId)!;
    player.speed = 4.2;
    bot.speed = 2.2;
    if (this.step >= 4) player.balloonCount = 2;
    this.startX = player.x;
    this.startY = player.y;
    if (this.step === 3) this.spawnReward();
    this.particles.clear();
    this.accumulator = 0;
    this.banner = "";
    this.bannerTime = 0;
    this.resetTimer = 0;
    this.dropBalloonId = null;
  }

  private spawnReward(): void {
    const player = this.sim.players.find((entry) => entry.id === this.playerId);
    if (!player || this.sim.powerups.length > 0) return;
    const px = Math.floor(player.x);
    const py = Math.floor(player.y);
    const offsets = [
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
      [2, 1],
      [-2, -1],
      [1, 2],
      [-1, -2],
      [3, 0],
      [0, 3],
      [0, -3],
      [-3, 0],
    ];
    for (const [dx, dy] of offsets) {
      const x = px + dx!;
      const y = py + dy!;
      if (x <= 0 || y <= 0 || x >= this.sim.arena.w - 1 || y >= this.sim.arena.h - 1) continue;
      if (this.sim.arena.boulders[y]?.[x]) continue;
      if (this.sim.arena.castles[y]?.[x] === 1) continue;
      if (this.sim.balloons.some((balloon) => balloon.x === x && balloon.y === y)) continue;
      this.sim.powerups.push({
        id: this.sim.nextIds++,
        x,
        y,
        kind: "balloon" satisfies PowerupKind,
        revealedTick: this.sim.tick,
      });
      return;
    }
  }

  private showBanner(text: string): void {
    this.banner = text;
    this.bannerTime = 1.8;
  }

  update(dt: number): void {
    this.time += dt;
    this.bannerTime = Math.max(0, this.bannerTime - dt);
    this.particles.update(dt);
    this.app.audio.setShowdown(false);
    if (this.completed) return;
    if (this.resetTimer > 0) {
      this.resetTimer -= dt;
      if (this.resetTimer <= 0) this.buildRound();
      return;
    }
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= 1 / CONFIG.TICK_RATE && steps < 3) {
      this.accumulator -= 1 / CONFIG.TICK_RATE;
      steps += 1;
      this.tickSim();
    }
  }

  private direction(): PlayerInput["dir"] {
    if (this.app.isActionDown("up")) return "up";
    if (this.app.isActionDown("down")) return "down";
    if (this.app.isActionDown("left")) return "left";
    if (this.app.isActionDown("right")) return "right";
    return "none";
  }

  private tickSim(): void {
    const player = this.sim.players.find((entry) => entry.id === this.playerId);
    if (!player) return;
    const balloonCountBefore = this.sim.balloons.length;
    this.seq += 1;
    if (this.sim.tick - this.botDecision > 32) {
      this.botDecision = this.sim.tick;
      const dirs: Array<PlayerInput["dir"]> = ["up", "down", "left", "right", "none", "left", "right"];
      this.botDir = dirs[Math.floor(Math.random() * dirs.length)] ?? "none";
      const bot = this.sim.players.find((entry) => entry.id === this.botId);
      if (bot) {
        if (bot.x < 3) this.botDir = "right";
        else if (bot.x > this.sim.arena.w - 4) this.botDir = "left";
        if (bot.y < 3) this.botDir = "down";
        else if (bot.y > this.sim.arena.h - 4) this.botDir = "up";
      }
    }
    const input: PlayerInput = {
      seq: this.seq,
      tick: this.sim.tick,
      dir: this.direction(),
      balloonPressed: this.app.isActionDown("drop"),
    };
    const botInput: PlayerInput = {
      seq: 1,
      tick: this.sim.tick,
      dir: this.botDir,
      balloonPressed: false,
    };
    const events = simulateTick(this.sim, {
      [this.playerId]: input,
      [this.botId]: botInput,
    });

    if (this.step === 0) {
      const dx = player.x - this.startX;
      const dy = player.y - this.startY;
      if (dx * dx + dy * dy > 0.7) {
        this.step = 1;
        this.app.audio.countdown(false);
      }
    }
    if (this.step === 1 && this.sim.balloons.length > balloonCountBefore) {
      const own = this.sim.balloons.find((balloon) => balloon.ownerId === this.playerId);
      if (own) {
        this.dropBalloonId = own.id;
        this.dropTick = this.sim.tick;
        this.step = 2;
        this.app.audio.drop();
      }
    }
    if (this.step === 2) {
      const own = this.sim.balloons.find((balloon) => balloon.id === this.dropBalloonId);
      if (!own && this.sim.tick - this.dropTick > 25 && player.alive) {
        this.step = 3;
        this.spawnReward();
        this.showBanner("NICE DODGE!");
        this.app.audio.pickup();
      }
    }

    for (const event of events) {
      if (event.type === "powerup_revealed") {
        this.particles.pickup(
          OX + (event.powerup.x + 0.5) * TILE,
          OY + (event.powerup.y + 0.5) * TILE,
        );
      } else if (event.type === "powerup_collected" && event.playerId === this.playerId) {
        this.app.audio.pickup();
        if (this.step >= 3) {
          this.step = 4;
          this.showBanner("EXTRA BALLOON! CHAIN THEM UP!");
        }
      } else if (event.type === "castle_washed") {
        this.particles.dust(OX + (event.x + 0.5) * TILE, OY + (event.y + 0.5) * TILE);
      } else if (event.type === "chain_burst" && event.ownerIds.includes(this.playerId)) {
        this.app.audio.chain(event.count);
        if (event.count >= 2 && this.step <= 4) {
          this.step = 5;
          this.showBanner(`CHAIN X${event.count}!`);
        }
      } else if (event.type === "player_soaked" && event.playerId === this.playerId) {
        this.app.audio.soak();
        this.particles.soak(OX + (event.x + 0.5) * TILE, OY + (event.y + 0.5) * TILE, true);
        if (!this.completed) {
          this.step = 1;
          this.resetTimer = 1.35;
          this.showBanner("SPLOOSH! LET'S TRY THAT AGAIN.");
        }
      } else if (event.type === "player_soaked" && event.playerId === this.botId) {
        this.app.audio.soak();
        this.particles.soak(OX + (event.x + 0.5) * TILE, OY + (event.y + 0.5) * TILE, true);
        if (this.step >= 4) {
          this.complete();
          return;
        }
        this.resetTimer = 1.2;
        this.step = 1;
        this.showBanner("GOOD SPLASH! BUT LET'S PRACTICE THE STEPS.");
      }
    }

    if (this.step === 2) {
      const splashes = this.sim.splashes;
      if (splashes.length > 0) this.particles.sparkle(OX + (player.x) * TILE, OY + (player.y) * TILE);
    }
    if (this.sim.ended && !this.completed) {
      this.step = 1;
      this.resetTimer = 1.2;
      this.showBanner("THE POND RESETS. TRY AGAIN!");
    }
  }

  private complete(): void {
    if (this.completed) return;
    this.completed = true;
    this.step = 6;
    this.app.audio.victory();
    this.particles.confetti(128, 110);
    if (!this.sentComplete) {
      this.sentComplete = true;
      this.app.net.tutorialComplete();
    }
  }

  private skip(): void {
    this.app.audio.click();
    if (!this.sentComplete) {
      this.sentComplete = true;
      this.app.net.tutorialComplete();
    }
    this.app.afterTutorial();
  }

  onKeyDown(event: KeyboardEvent): boolean {
    if (event.code === "Escape") {
      this.skip();
      return true;
    }
    if (event.code === "Enter" || event.code === "NumpadEnter") {
      if (this.completed) this.app.afterTutorial();
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
    if (x >= 208 && y >= 5 && x < 248 && y < 18) {
      this.skip();
      return;
    }
    if (this.completed && x >= 78 && y >= 170 && x < 178 && y < 190) {
      this.app.afterTutorial();
    }
  }

  cursorAt(x: number, y: number): string {
    if (x >= 208 && y >= 5 && x < 248 && y < 18) return "pointer";
    if (this.completed && x >= 78 && y >= 170 && x < 178 && y < 190) return "pointer";
    return "default";
  }

  render(ctx: CanvasRenderingContext2D): void {
    drawOcean(ctx, this.time, true);
    drawText(ctx, "HOW TO SPLASH", 8, 7, COLORS.mint);
    drawButton(ctx, this.skipButton, false);
    if (!this.sim) return;
    drawPanel(ctx, 8, 22, 240, 16);
    drawText(ctx, `STEP ${Math.min(this.step + 1, 6)}/6`, 14, 27, COLORS.yellow);
    drawText(ctx, STEP_TEXT[Math.min(this.step, 5)] ?? "", 66, 27, COLORS.foam);
    drawProgress(ctx, 8, 39, 240, 3, (Math.min(this.step, 5) + 1) / 6, COLORS.teal);

    const width = this.sim.arena.w * TILE;
    const height = this.sim.arena.h * TILE;
    ctx.fillStyle = "#05131c";
    ctx.fillRect(OX - 3, OY - 3, width + 6, height + 6);
    for (let y = 0; y < this.sim.arena.h; y += 1) {
      for (let x = 0; x < this.sim.arena.w; x += 1) {
        const px = OX + x * TILE;
        const py = OY + y * TILE;
        drawThemeTile(ctx, this.sim.arena.theme, px, py, TILE, x, y);
        if (this.sim.arena.boulders[y]?.[x]) drawBoulder(ctx, px, py, TILE, x, y);
        else if (this.sim.arena.castles[y]?.[x] === 1) drawCastle(ctx, px, py, TILE, x, y);
      }
    }
    for (const powerup of this.sim.powerups) {
      const px = OX + powerup.x * TILE;
      const py = OY + powerup.y * TILE;
      ctx.strokeStyle = Math.floor(this.time * 6) % 2 === 0 ? COLORS.yellow : "#c7a640";
      ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
      drawPowerup(ctx, powerup.kind, px, py, this.time, TILE);
    }
    for (const balloon of this.sim.balloons) {
      const remaining = Math.max(0, balloon.burstTick - this.sim.tick);
      drawBalloon(
        ctx,
        OX + balloon.x * TILE + 1,
        OY + balloon.y * TILE,
        1 - remaining / CONFIG.FUSE_TICKS,
        this.time,
      );
    }
    for (const splash of this.sim.splashes) {
      const duration = Math.max(1, splash.endTick - splash.createdTick);
      const progress = 1 - (splash.endTick - this.sim.tick) / duration;
      drawSplash(
        ctx,
        OX + splash.x * TILE,
        OY + splash.y * TILE,
        TILE,
        Math.max(0, Math.min(1, progress)),
        this.app.settings.data.colorblind,
        splash.kind === "revenge" ? "revenge" : "splash",
      );
    }
    for (const player of this.sim.players) {
      if (!player.alive) continue;
      drawAnimal(ctx, {
        animal: player.animal,
        hat: player.hat,
        x: OX + player.x * TILE - 1,
        y: OY + player.y * TILE - 2,
        dir: player.dir,
        frame: Math.floor(this.time * 7) % 2,
        moving: this.direction() !== "none" || player.id === this.botId,
        time: this.time,
        soaked: false,
      });
      if (player.id === this.botId) {
        drawText(ctx, "BOT", OX + player.x * TILE - 5, OY + player.y * TILE - 12, "#d9cfa8");
      }
    }
    this.particles.draw(ctx);

    const local = this.sim.players.find((entry) => entry.id === this.playerId);
    if (local && this.step === 3) {
      const powerup = this.sim.powerups[0];
      if (powerup) {
        const px = OX + (powerup.x + 0.5) * TILE;
        const py = OY + (powerup.y + 0.5) * TILE;
        ctx.strokeStyle = COLORS.yellow;
        ctx.strokeRect(px - 9, py - 8, 18, 18);
      }
    }
    if (this.bannerTime > 0) {
      drawTextCentered(ctx, this.banner, 128, 26, COLORS.yellow);
    }
    drawTextCentered(
      ctx,
      this.step === 5 ? "THE BOT NEVER FIGHTS BACK. TRAP IT!" : "WASD TO MOVE  /  SPACE TO DROP",
      128,
      214,
      "#6ea0aa",
    );
    if (this.resetTimer > 0) {
      ctx.fillStyle = "rgba(3, 13, 20, 0.45)";
      ctx.fillRect(OX, OY, width, height);
      drawTextCentered(ctx, "RESETTING...", 128, 118, COLORS.foam, 2);
    }
    if (this.completed) this.renderComplete(ctx);
  }

  private renderComplete(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(3, 12, 18, 0.8)";
    ctx.fillRect(0, 0, 256, 224);
    drawPanel(ctx, 28, 46, 200, 152);
    drawTextCentered(ctx, "TUTORIAL COMPLETE!", 128, 60, COLORS.yellow, 2);
    drawTextCentered(ctx, "YOU CAN MOVE, DROP, DODGE,", 128, 86, COLORS.foam);
    drawTextCentered(ctx, "CHAIN AND SOAK. THE POND AWAITS.", 128, 97, COLORS.foam);
    drawTextCentered(ctx, `+${CONFIG.TUTORIAL_XP} XP`, 128, 116, COLORS.mint, 2);
    const profile = this.app.profile;
    if (profile) drawTextCentered(ctx, `LEVEL ${profile.level}  -  ${profile.displayName}`, 128, 134, "#8ec4cb");
    drawButton(ctx, this.finishButton, false, true);
    this.particles.draw(ctx);
  }
}

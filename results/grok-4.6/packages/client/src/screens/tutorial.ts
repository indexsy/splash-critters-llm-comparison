import {
  CONFIG,
  createRound,
  defaultPlayer,
  simulateTick,
  type PlayerInput,
  type RoundState,
} from "@splash/shared";
import { audio } from "../audio.js";
import { net } from "../net.js";
import { burst, drawParticles, tickParticles } from "../render/particles.js";
import { drawAnimal, drawBalloon, drawBoulder, drawCastle, drawPowerup, PAL, themeColors } from "../render/sprites.js";
import { app } from "../state.js";
import { centerText, drawText } from "../ui.js";
import type { Screen } from "./types.js";

const STEPS = [
  "WASD / arrows to move",
  "Walk behind a sandcastle, press SPACE to drop a balloon, then dodge",
  "Grab the power-up that pops out",
  "Chain two balloons — splash one into the other",
  "Soak the bot! Last critter dry wins",
];

export function tutorialScreen(go: (name: string) => void): Screen {
  let step = 0;
  let t = 0;
  const keys = new Set<string>();
  let state: RoundState = makeTut();
  let done = false;

  function makeTut(): RoundState {
    return createRound(42, 11, 9, "backyard", [
      defaultPlayer("you", 0, "You", { balloonCount: 3, splashRange: 3 }),
      defaultPlayer("bot", 1, "Drizzle", { isBot: true, botDifficulty: "easy" }),
    ]);
  }

  function dir(): PlayerInput["dir"] {
    if (keys.has("KeyW") || keys.has("ArrowUp")) return "up";
    if (keys.has("KeyS") || keys.has("ArrowDown")) return "down";
    if (keys.has("KeyA") || keys.has("ArrowLeft")) return "left";
    if (keys.has("KeyD") || keys.has("ArrowRight")) return "right";
    return "none";
  }

  return {
    name: "tutorial",
    update() {
      t++;
      if (done) return;
      const you = state.players[0]!;
      const input: PlayerInput = {
        seq: t,
        tick: state.tick,
        dir: dir(),
        balloonPressed: keys.has("Space") || keys.has("KeyE"),
      };
      keys.delete("Space");
      keys.delete("KeyE");
      const bot = state.players[1]!;
      const bx = Math.floor(bot.x + 0.5);
      const by = Math.floor(bot.y + 0.5);
      const botDir = t % 80 < 40 ? "left" : "right";
      simulateTick(
        state,
        new Map([
          ["you", input],
          ["bot", { seq: t, tick: state.tick, dir: botDir as PlayerInput["dir"], balloonPressed: false }],
        ]),
      );
      for (const ev of state.events) {
        if (ev.type === "balloon_placed") audio.drop();
        if (ev.type === "balloon_burst") audio.burst();
        if (ev.type === "chain_burst") {
          audio.chain((ev.count as number) ?? 2);
          if (step === 3) step = 4;
        }
        if (ev.type === "powerup_collected") {
          audio.pickup();
          if (step === 2) step = 3;
        }
        if (ev.type === "castle_washed") {
          burst(ev.tx as number, ev.ty as number, PAL.castle);
          if (step === 1) step = 2;
        }
        if (ev.type === "player_soaked" && ev.playerId === "bot") {
          audio.soak();
          step = 5;
          done = true;
        }
      }
      if (step === 0 && (you.x !== state.players[0]!.x || dir() !== "none")) {
        /* movement detected next tick */
      }
      if (step === 0 && dir() !== "none") step = 1;
      void bx;
      void by;
      tickParticles();
    },
    draw(ctx) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
      const theme = themeColors("backyard");
      const tile = 16;
      const ox = 40;
      const oy = 28;
      const { width, height } = state.arena;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const kind = state.arena.tiles[y * width + x];
          const px = ox + x * tile;
          const py = oy + y * tile;
          ctx.fillStyle = (x + y) % 2 ? theme.floor : theme.floor2;
          ctx.fillRect(px, py, tile, tile);
          if (kind === "boulder") drawBoulder(ctx, px, py);
          if (kind === "castle") drawCastle(ctx, px, py);
        }
      }
      for (const e of state.exposed) drawPowerup(ctx, ox + e.tx * tile, oy + e.ty * tile, e.kind, t);
      for (const b of state.balloons) drawBalloon(ctx, ox + b.tx * tile, oy + b.ty * tile, b.fuseLeft, t / 6);
      ctx.fillStyle = PAL.water2;
      for (const s of state.splashes) ctx.fillRect(ox + s.tx * tile + 2, oy + s.ty * tile + 2, 12, 12);
      for (const p of state.players) {
        drawAnimal(ctx, ox + p.x * tile, oy + p.y * tile, p.animal, p.hat, Math.floor(t / 10), p.status !== "alive");
      }
      drawParticles(ctx, ox, oy, tile);
      ctx.fillStyle = PAL.ui;
      ctx.fillRect(0, 0, CONFIG.INTERNAL_W, 22);
      centerText(ctx, "TUTORIAL", 10, PAL.gold, 8);
      centerText(ctx, STEPS[Math.min(step, STEPS.length - 1)] ?? "Done!", 20, PAL.paper, 7);
      drawText(ctx, "ESC skip", 4, CONFIG.INTERNAL_H - 6, PAL.paper, 7);
      if (done) centerText(ctx, "Nice! Click or Enter → menu", 200, PAL.gold, 8);
    },
    key(e) {
      keys.add(e.code);
      if (e.code === "Escape") finish(go);
      if (done && (e.code === "Enter" || e.code === "Space")) finish(go);
    },
    keyup(e) {
      keys.delete(e.code);
    },
    click() {
      if (done) finish(go);
    },
  };
}

function finish(go: (n: string) => void): void {
  localStorage.setItem("splash_tutorial", "1");
  app.seenTutorial = true;
  net.send({ type: "tutorial_complete" });
  audio.click();
  go("menu");
}

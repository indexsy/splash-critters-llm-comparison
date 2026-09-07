import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/silkscreen/400.css";
import "./style.css";
import {
  CONFIG,
  createGame,
  simulateTick,
  type Direction,
  type GameState,
  type PlayerInput,
} from "@splash/shared";
import { BotController } from "../../server/src/bots/bot.js";
import { drawArena } from "./render/sprites.js";
import { AudioEngine } from "./audio.js";

document.querySelector("#app")!.innerHTML =
  `<div class="site-shell"><header class="site-header"><strong class="pixel">SPLASH CRITTERS / SIM LAB</strong><a class="button secondary" href="/">Back to the Pond</a></header><main class="main-content"><div class="page-heading"><div><div class="eyebrow">M1 / ENTIRELY LOCAL / NO SOCKETS OR ACCOUNT</div><h1>One Human. One Hard Bot.</h1><p>The same deterministic 30 Hz simulation used by the online authority.</p></div><button id="restart" class="button primary">Restart Match</button></div><div class="arena-shell" style="width:max-content;margin:auto"><canvas id="arena" width="256" height="224" tabindex="0"></canvas></div><div class="control-strip"><span>WASD / Arrows: Move</span><span>Space / E: Balloon</span><span id="score">YOU 0 : 0 HARD</span><span id="status"></span></div></main></div>`;
const canvas = document.querySelector<HTMLCanvasElement>("#arena")!;
const ctx = canvas.getContext("2d")!;
let game: GameState;
let bot: BotController;
let scores = [0, 0];
let round = 0;
let breakUntil = 0;
const keys = new Set<string>();
let drop = false;
let seq = 0;
let accumulator = 0;
let previous = performance.now();
const audio = new AudioEngine();
audio.setScreen("game");
function start(): void {
  game = createGame({
    mode: "duel",
    seed: 19283 + round * 117,
    players: [
      { id: "human", nickname: "You", animal: "frog", roundsWon: scores[0] },
      { id: "bot", nickname: "Hard Bot", animal: "duck", roundsWon: scores[1] },
    ],
    revengeEnabled: false,
  });
  bot = new BotController("bot", "hard", 478 + round);
  breakUntil = 0;
  seq = 0;
  keys.clear();
  drop = false;
  document.querySelector("#status")!.textContent = `ROUND ${round + 1}`;
}
document.querySelector("#restart")!.addEventListener("click", () => {
  scores = [0, 0];
  round = 0;
  start();
  document.querySelector("#score")!.textContent = "YOU 0 : 0 HARD";
});
addEventListener("keydown", (e) => {
  if (
    ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
      e.code,
    )
  )
    e.preventDefault();
  audio.unlock();
  keys.add(e.code);
  if (!e.repeat && ["Space", "KeyE"].includes(e.code)) drop = true;
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => {
  keys.clear();
  drop = false;
});
function frame(now: number): void {
  requestAnimationFrame(frame);
  accumulator += Math.min(0.1, (now - previous) / 1000);
  previous = now;
  if (breakUntil && now >= breakUntil && Math.max(...scores) < 3) {
    round++;
    start();
  }
  while (accumulator >= 1 / CONFIG.TICK_RATE) {
    accumulator -= 1 / CONFIG.TICK_RATE;
    if (game.roundOver) continue;
    const dir: Direction =
      keys.has("KeyW") || keys.has("ArrowUp")
        ? "up"
        : keys.has("KeyS") || keys.has("ArrowDown")
          ? "down"
          : keys.has("KeyA") || keys.has("ArrowLeft")
            ? "left"
            : keys.has("KeyD") || keys.has("ArrowRight")
              ? "right"
              : "none";
    const input: PlayerInput = {
      seq: ++seq,
      tick: game.tick,
      dir,
      balloonPressed: drop,
    };
    drop = false;
    simulateTick(game, { human: input, bot: bot.nextInput(game) });
    for (const e of game.events)
      audio.play(e.type, e.type === "chain_burst" ? e.count : undefined);
    if (game.roundOver) {
      if (game.winnerId) scores[game.winnerId === "human" ? 0 : 1]++;
      document.querySelector("#score")!.textContent =
        `YOU ${scores[0]} : ${scores[1]} HARD`;
      document.querySelector("#status")!.textContent =
        Math.max(...scores) >= 3
          ? "MATCH OVER / RESTART TO PLAY AGAIN"
          : game.winnerId
            ? `${game.winnerId === "human" ? "YOU" : "HARD BOT"} WINS THE ROUND`
            : "DRAW ROUND";
      breakUntil = now + CONFIG.ROUND_BREAK_MS;
    }
  }
  drawArena(ctx, game, "backyard", "human", now);
}
start();
requestAnimationFrame(frame);

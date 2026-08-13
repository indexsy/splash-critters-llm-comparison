import { CONFIG } from "@splash/shared";
import { audio } from "./audio.js";
import { net } from "./net.js";
import { applyWelcome, app, settings } from "./state.js";
import { scalePoint } from "./ui.js";
import type { Screen } from "./screens/types.js";
import { titleScreen } from "./screens/title.js";
import { tutorialScreen } from "./screens/tutorial.js";
import { menuScreen } from "./screens/menu.js";
import { browserScreen } from "./screens/browser.js";
import { lobbyScreen } from "./screens/lobby.js";
import { queuePickScreen, queueScreen } from "./screens/queue.js";
import { gameScreen } from "./screens/game.js";
import { resultsScreen } from "./screens/results.js";
import { leaderboardScreen } from "./screens/leaderboard.js";
import { lockerScreen } from "./screens/locker.js";
import { howtoScreen, settingsScreen } from "./screens/settings.js";
import { practiceScreen } from "./screens/practice.js";
import type { Mode, ServerMsg } from "@splash/shared";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;

audio.sfx = settings.sfx;
audio.music = settings.music;

let current: Screen;
let last = performance.now();

function go(name: string, data?: unknown): void {
  current.leave?.();
  current = make(name, data);
}

function make(name: string, data?: unknown): Screen {
  switch (name) {
    case "title":
      return titleScreen(go);
    case "tutorial":
      return tutorialScreen(go);
    case "menu":
      return menuScreen(go);
    case "browser":
      return browserScreen(go);
    case "lobby":
      return lobbyScreen(go);
    case "queuepick":
      return queuePickScreen(go);
    case "queue":
      return queueScreen(go, (data as Mode) ?? "duel");
    case "game":
      return gameScreen(go, data as Extract<ServerMsg, { type: "match_start" }> | undefined);
    case "results":
      return resultsScreen(go, data as Extract<ServerMsg, { type: "match_end" }>);
    case "leaderboard":
      return leaderboardScreen(go);
    case "locker":
      return lockerScreen(go);
    case "settings":
      return settingsScreen(go);
    case "howto":
      return howtoScreen(go);
    case "practice":
      return practiceScreen(go);
    default:
      return menuScreen(go);
  }
}

function resize(): void {
  const s = Math.max(1, Math.floor(Math.min(window.innerWidth / CONFIG.INTERNAL_W, window.innerHeight / CONFIG.INTERNAL_H)));
  canvas.style.width = `${CONFIG.INTERNAL_W * s}px`;
  canvas.style.height = `${CONFIG.INTERNAL_H * s}px`;
}

current = titleScreen(go);
resize();
window.addEventListener("resize", resize);

window.addEventListener("keydown", (e) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  if (e.code === "KeyM" && current.name !== "settings") audio.toggleMute();
  current.key?.(e);
});
window.addEventListener("keyup", (e) => current.keyup?.(e));
canvas.addEventListener("click", (e) => {
  audio.ensure();
  const p = scalePoint(canvas, e);
  current.click?.(p.x, p.y);
});

net.on((msg) => {
  if (msg.type === "welcome") applyWelcome(msg);
  if (msg.type === "profile") app.profile = msg.profile;
});
net.connect();

const hash = location.hash;
if (hash.startsWith("#/room/")) {
  const code = hash.slice(7).toUpperCase();
  const wait = setInterval(() => {
    if (app.playerId) {
      clearInterval(wait);
      net.send({ type: "join_room", code });
      go("lobby");
    }
  }, 100);
}

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  current.update(dt);
  ctx.imageSmoothingEnabled = false;
  current.draw(ctx);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

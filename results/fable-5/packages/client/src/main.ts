import { app } from "./app.js";
import { AudioSys } from "./audio.js";
import { InputSys } from "./input.js";
import { Net } from "./net.js";
import { loadSettings, saveSettings } from "./settings.js";
import { drawTextCentered } from "./render/font.js";
import { BrowserScreen } from "./screens/browser.js";
import { GameScreen } from "./screens/game.js";
import { HowToScreen } from "./screens/howto.js";
import { LeaderboardScreen } from "./screens/leaderboard.js";
import { LobbyScreen } from "./screens/lobby.js";
import { LockerScreen } from "./screens/locker.js";
import { MenuScreen } from "./screens/menu.js";
import { QueueScreen } from "./screens/queue.js";
import { ResultsScreen } from "./screens/results.js";
import { SettingsScreen } from "./screens/settings.js";
import { TitleScreen } from "./screens/title.js";
import { TutorialScreen } from "./screens/tutorial.js";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const g = canvas.getContext("2d")!;
g.imageSmoothingEnabled = false;

// --- boot the app singleton ---
app.settings = loadSettings();
app.keys = new InputSys(app.settings.bindings);
app.audio = new AudioSys(app.settings);
app.net = new Net();

app.screens.set("title", new TitleScreen());
app.screens.set("menu", new MenuScreen());
app.screens.set("tutorial", new TutorialScreen());
app.screens.set("browser", new BrowserScreen());
app.screens.set("lobby", new LobbyScreen());
app.screens.set("queue", new QueueScreen());
app.screens.set("game", new GameScreen());
app.screens.set("results", new ResultsScreen());
app.screens.set("leaderboard", new LeaderboardScreen());
app.screens.set("locker", new LockerScreen());
app.screens.set("settings", new SettingsScreen());
app.screens.set("howto", new HowToScreen());

// Share links: /#/room/CODE
const hashMatch = location.hash.match(/^#\/room\/([A-Za-z0-9]{4,8})$/);
if (hashMatch) app.pendingRoomCode = hashMatch[1].toUpperCase();

app.net.connect();
app.go("title");

// --- input plumbing ---
window.addEventListener("keydown", (e) => {
  app.audio.unlock();
  const gameKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"];
  if (gameKeys.includes(e.code)) e.preventDefault();
  if (e.code === "KeyM" && app.keys.actionFor("KeyM") === "mute") {
    const muted = app.audio.toggleMute();
    saveSettings(app.settings);
    app.toast(muted ? "MUTED" : "SOUND ON");
  }
  const consumed = app.current?.onKeyDown?.(e.code, e.key);
  if (!consumed) app.keys.keyDown(e.code);
});
window.addEventListener("keyup", (e) => app.keys.keyUp(e.code));
window.addEventListener("blur", () => app.keys.clear());

function canvasPos(e: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * 256,
    y: ((e.clientY - rect.top) / rect.height) * 224,
  };
}
canvas.addEventListener("mousemove", (e) => {
  const p = canvasPos(e);
  app.mouse.x = p.x;
  app.mouse.y = p.y;
});
canvas.addEventListener("mousedown", (e) => {
  app.audio.unlock();
  const p = canvasPos(e);
  app.mouse.x = p.x;
  app.mouse.y = p.y;
  app.mouse.down = true;
  app.mouse.clicked = true;
});
window.addEventListener("mouseup", () => {
  app.mouse.down = false;
});

// --- display scaling (integer where possible) ---
function resize(): void {
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / 256, window.innerHeight / 224)));
  canvas.style.width = `${256 * scale}px`;
  canvas.style.height = `${224 * scale}px`;
}
window.addEventListener("resize", resize);
resize();

// --- main loop ---
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  app.current?.update(dt);
  g.clearRect(0, 0, 256, 224);
  app.current?.draw(g);
  app.drawToasts(g, (gg, t, cx, y, c) => drawTextCentered(gg, t, cx, y, c));
  if (!app.connected && app.screenName !== "title") {
    g.fillStyle = "rgba(15,15,27,0.6)";
    g.fillRect(0, 100, 256, 24);
    drawTextCentered(g, "RECONNECTING...", 128, 109, "#e14141");
  }
  app.mouse.clicked = false;
  app.keys.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

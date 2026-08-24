import type { PublicProfile } from "@sc/shared";
import { net } from "./net";
import { audio } from "./audio";
import { showTitle } from "./screens/title";
import { showMenu } from "./screens/menu";
import { showTutorial } from "./screens/tutorial";
import { showBrowser } from "./screens/browser";
import { showLobby } from "./screens/lobby";
import { showQueue } from "./screens/queue";
import { showLeaderboard } from "./screens/leaderboard";
import { showLocker } from "./screens/locker";
import { showSettings } from "./screens/settings";
import { enterGame, leaveGame } from "./screens/game";

export interface Settings {
  sfx: number;
  music: number;
  muted: boolean;
  colorblind: boolean;
  reducedShake: boolean;
}

export interface App {
  token: string;
  playerId: string | null;
  profile: PublicProfile | null;
  ratings: Record<string, { rating: number; games: number; wins: number; peak: number }>;
  settings: Settings;
  screens: HTMLElement;
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
  navigate(hash: string): void;
}

export const app: App = {
  token: localStorage.getItem("sc_token") ?? "",
  playerId: null,
  profile: null,
  ratings: {},
  settings: JSON.parse(
    localStorage.getItem("sc_settings") ??
      '{"sfx":0.6,"music":0.35,"muted":false,"colorblind":false,"reducedShake":false}',
  ),
  screens: document.getElementById("screens")!,
  canvas: document.getElementById("game") as HTMLCanvasElement,
  hud: document.getElementById("hud")!,
  navigate: (hash: string) => {
    location.hash = hash;
  },
};

function leaveGameView(): void {
  leaveGame();
  app.canvas.style.display = "none";
  app.hud.style.display = "none";
}

let cleanup: (() => void) | null = null;

function route(): void {
  if (cleanup) cleanup();
  cleanup = null;
  app.screens.innerHTML = "";
  const hash = location.hash || "#/";
  audio.unlock();
  audio.setMuted(app.settings.muted);

  if (hash.startsWith("#/room/")) {
    const code = hash.slice(7);
    cleanup = showLobby(app, code);
  } else
    switch (hash) {
      case "#/menu":
        cleanup = showMenu(app);
        break;
      case "#/tutorial":
        cleanup = showTutorial(app);
        break;
      case "#/browser":
        cleanup = showBrowser(app);
        break;
      case "#/queue/duel":
      case "#/queue/ffa":
        cleanup = showQueue(app, hash.slice(7) as "duel" | "ffa");
        break;
      case "#/leaderboard":
        cleanup = showLeaderboard(app);
        break;
      case "#/locker":
        cleanup = showLocker(app);
        break;
      case "#/settings":
        cleanup = showSettings(app);
        break;
      case "#/play":
        leaveGameView();
        break;
      default:
        cleanup = showTitle(app);
    }
}

window.addEventListener("hashchange", () => {
  if (location.hash !== "#/play") leaveGameView();
  route();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "m" || e.key === "M") {
    app.settings.muted = !app.settings.muted;
    saveSettings();
    audio.setMuted(app.settings.muted);
  }
});

export function saveSettings(): void {
  localStorage.setItem("sc_settings", JSON.stringify(app.settings));
  audio.sfxVolume = app.settings.sfx;
  audio.musicVolume = app.settings.music;
}

// ---------- boot ----------

async function boot(): Promise<void> {
  saveSettings();
  await net.connect();

  let firstWelcome = true;
  net.on((msg) => {
    switch (msg.t) {
      case "welcome":
        app.playerId = msg.playerId;
        app.profile = msg.profile;
        app.ratings = msg.ratings;
        if (msg.token && msg.token !== app.token) {
          app.token = msg.token;
          localStorage.setItem("sc_token", msg.token);
        }
        if (firstWelcome) {
          firstWelcome = false;
          // deep link into a private room
          if (location.hash.startsWith("#/room/")) {
            net.send({ t: "join_room", code: location.hash.slice(7) });
          }
        }
        break;
      case "match_found":
        app.navigate(`#/queue/${msg.mode}`);
        break;
      case "match_start":
        leaveGameView();
        enterGame(msg);
        break;
      case "match_end":
        // handled inside game screen
        break;
    }
  });

  net.send({ t: "hello", token: app.token || undefined });
  route();
}

void boot();

// main.ts — client entry. Wires WebSocket, profile, screen router, game screen.
import { makeNet } from "./net.js";
import { audio } from "./audio.js";
import { renderScreen, type AppCtx, type ScreenName, type ScreenActions } from "./screens/index.js";
import { GameScreen } from "./screens/game.js";
import type { Animal, Hat, Profile, ServerMsg, SlotView, RoomSummary } from "@splash/shared";

const TOKEN_KEY = "splash_token";
const canvas = document.getElementById("game") as HTMLCanvasElement;
const net = makeNet();

const ctx: AppCtx = {
  net,
  profile: null,
  setProfile: (p) => { ctx.profile = p; },
  go: (s: ScreenName, extra?: any) => {
    if (s === "game") return; // game has no overlay
    renderScreen(s, ctx, extra);
  },
  lobby: null,
  matchResult: null,
  actions: undefined as any,
};

let gameScreen: GameScreen | null = null;

const actions: ScreenActions = {
  createRoom: (opts) => net.send({
    t: "create_room",
    name: opts.name, size: opts.size, visibility: opts.visibility as any,
    theme: opts.theme as any, roundsToWin: opts.roundsToWin, botFill: opts.botFill,
  }),
  joinRoom: (code) => net.send({ t: "join_room", code }),
  refreshRooms: () => new Promise<RoomSummary[]>((resolve) => {
    net.send({ t: "room_list_request" });
    const h = (m: ServerMsg & { t: "room_list" }) => resolve(m.rooms);
    net.on("room_list", h as any);
  }),
  leaveRoom: () => net.send({ t: "leave_room" }),
  setSlot: (slot, kind, difficulty) => net.send({ t: "set_slot", slot, kind, difficulty }),
  setReady: (ready) => net.send({ t: "set_ready", ready }),
  startMatch: () => net.send({ t: "start_match" }),
  queueJoin: (mode) => net.send({ t: "queue_join", mode }),
  queueLeave: () => net.send({ t: "queue_leave" }),
  setNickname: (n) => net.send({ t: "set_nickname", nickname: n }),
  setCosmetics: (animal, hat) => {
    // client-only preview; server endpoint omitted for v1 but stored locally
    if (ctx.profile) {
      ctx.profile.selectedAnimal = animal;
      ctx.profile.selectedHat = hat;
    }
  },
  rematch: (vote) => net.send({ t: "rematch_vote", vote }),
};
ctx.actions = actions;

// ---- wire server messages to UI state ----
net.on("welcome", (m: ServerMsg & { t: "welcome" }) => {
  ctx.profile = m.profile as Profile;
  if (m.token) localStorage.setItem(TOKEN_KEY, m.token);
});

net.on("lobby_state", (m: ServerMsg & { t: "lobby_state" }) => {
  ctx.lobby = {
    code: m.code, name: m.name, size: m.size, theme: m.theme,
    roundsToWin: m.roundsToWin, slots: m.slots as SlotView[],
    hostSlot: m.hostSlot, yourSlot: m.yourSlot,
  };
  // if currently on lobby screen, refresh
  const overlay = document.getElementById("overlay");
  if (overlay && overlay.querySelector(".panel")?.textContent?.includes(m.code)) {
    ctx.go("lobby");
  }
});

net.on("room_created", (_m) => { /* lobby_state will follow */ });

net.on("match_start", (m: ServerMsg & { t: "match_start" }) => {
  // hide overlay, start game
  document.getElementById("overlay")!.classList.add("hidden");
  audio.init();
  audio.resume();
  if (!gameScreen) gameScreen = new GameScreen(canvas, net);
  gameScreen.onMatchEnd = (res) => {
    ctx.matchResult = res;
    canvas.hidden = false;
    document.getElementById("overlay")!.classList.remove("hidden");
    ctx.go("results");
  };
  gameScreen.start(m);
});

net.on("match_found", (_m) => {
  // match_start will follow shortly
});

net.on("error", (m: ServerMsg & { t: "error" }) => {
  console.warn("[server error]", m.code, m.msg);
});

// ---- connect + bootstrap ----
net.onOpen = () => {
  const token = localStorage.getItem(TOKEN_KEY) ?? undefined;
  net.send({ t: "hello", token });
};

net.onClose = () => {
  // overlay shows disconnected; reconnect handled in net
};

net.connect();

// Title screen first; once welcome arrives, push to menu if profile present.
ctx.go("title");

// auto-advance: when welcome arrives after title, move to menu (unless nick needed)
const welcomeGuard = setInterval(() => {
  if (ctx.profile) {
    clearInterval(welcomeGuard);
    // stay on title for a beat; user presses START
  }
}, 100);

// resume audio on first user gesture
const resumeAudio = () => {
  audio.init();
  audio.resume();
  window.removeEventListener("pointerdown", resumeAudio);
  window.removeEventListener("keydown", resumeAudio);
};
window.addEventListener("pointerdown", resumeAudio);
window.addEventListener("keydown", resumeAudio);

import "@fontsource/space-grotesk/latin-400.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/silkscreen/400.css";
import "./style.css";
import {
  CONFIG,
  rankTier,
  type Animal,
  type Direction,
  type GameEvent,
  type Hat,
  type Mode,
  type PlayerInput,
  type RecentMatch,
  type RoomOptions,
  type ServerMessage,
  type Snapshot,
} from "@splash/shared";
import { Network } from "./net.js";
import { Prediction } from "./prediction.js";
import { AudioEngine } from "./audio.js";
import { drawAnimal, drawArena, drawMenuScene } from "./render/sprites.js";
import { Particles } from "./render/particles.js";
import { formatTime } from "./render/hud.js";
import {
  button,
  escapeHtml,
  icon,
  portrait,
  type Screen,
  type Settings,
  type UIState,
} from "./ui.js";
import { titleScreen } from "./screens/title.js";
import { browserScreen } from "./screens/browser.js";
import { lobbyScreen } from "./screens/lobby.js";
import { queueScreen } from "./screens/queue.js";
import { gameScreen } from "./screens/game.js";
import { resultsScreen } from "./screens/results.js";
import { leaderboardScreen } from "./screens/leaderboard.js";
import { lockerScreen } from "./screens/locker.js";
import { settingsScreen } from "./screens/settings.js";
import { tutorialPanel } from "./screens/tutorial.js";

const defaults: Settings = {
  sfx: 0.5,
  music: 0.2,
  muted: false,
  colorblind: false,
  reducedShake: matchMedia("(prefers-reduced-motion: reduce)").matches,
  bindings: {
    up: "KeyW",
    down: "KeyS",
    left: "KeyA",
    right: "KeyD",
    balloon: "Space",
  },
};
let settings = { ...defaults, bindings: { ...defaults.bindings } };
try {
  const saved = JSON.parse(
    localStorage.getItem("splash-settings") ?? "{}",
  ) as Partial<Settings>;
  settings = {
    ...defaults,
    ...saved,
    sfx: Math.max(0, Math.min(1, Number(saved.sfx ?? defaults.sfx))),
    music: Math.max(0, Math.min(1, Number(saved.music ?? defaults.music))),
    bindings: { ...defaults.bindings, ...saved.bindings },
  };
} catch {
  /* Malformed local preferences never prevent play. */
}
const state: UIState = {
  screen: "title",
  profile: null,
  connection: "connecting",
  lobby: null,
  rooms: [],
  queue: null,
  match: null,
  result: null,
  mode: "duel",
  leaderboard: [],
  leaderboardLoading: false,
  settings,
  training: false,
  tutorialGoals: new Set(),
};
const app = document.querySelector<HTMLDivElement>("#app")!;
const dialog = document.querySelector<HTMLDialogElement>("#dialog")!;
const audio = new AudioEngine();
const prediction = new Prediction();
const particles = new Particles();
const network = new Network(receive, (connection) => {
  state.connection = connection;
  updateConnection();
  if (connection === "another-tab")
    toast(
      "This account is open in another tab. Use a private window for a second player.",
      10000,
    );
  if (connection === "reconnecting") {
    keys.clear();
    balloonPressed = false;
  }
});
const keys = new Set<string>();
let balloonPressed = false;
let seq = 0;
let accumulator = 0;
let lastFrame = performance.now();
let snapshot: Snapshot | null = null;
let announcedUntil = 0;
let announcedText = "";
let shakeUntil = 0;
let freezeUntil = 0;
let remapping: keyof Settings["bindings"] | null = null;
let pendingRanked: Mode | null = null;
let pendingAfterLeave: (() => void) | null = null;
let filter: Mode | undefined;
let toastTimer = 0;
let leaderboardRequest = 0;
let frames = 0;
let fpsAt = performance.now();
let fps = 60;

function saveSettings(): void {
  localStorage.setItem("splash-settings", JSON.stringify(state.settings));
  audio.sfxVolume = state.settings.sfx;
  audio.musicVolume = state.settings.music;
  audio.setMuted(state.settings.muted);
  const mute = document.querySelector('[data-action="mute"]');
  if (mute) {
    mute.innerHTML = icon(state.settings.muted ? "mute" : "sound", 19);
    mute.setAttribute(
      "aria-label",
      state.settings.muted ? "Unmute audio" : "Mute audio",
    );
  }
}
function toast(text: string, duration = 4000): void {
  const target = document.querySelector<HTMLDivElement>("#toast")!;
  target.textContent = text;
  target.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(
    () => target.classList.remove("visible"),
    duration,
  );
}
function updateConnection(): void {
  const status = document.querySelector("#connection-status");
  if (status) {
    status.className =
      state.connection === "online" ? "connection online" : "connection";
    status.innerHTML = `<i></i>${state.connection === "online" ? "ALL SYSTEMS SPLASH" : state.connection === "another-tab" ? "OPEN IN ANOTHER TAB" : state.connection.toUpperCase()}`;
  }
}
function render(): void {
  const active =
    state.screen === "title" || state.screen === "menu"
      ? "play"
      : state.screen === "browser" || state.screen === "lobby"
        ? "browse"
        : state.screen;
  const p = state.profile;
  const renderers: Record<Screen, (s: UIState) => string> = {
    title: titleScreen,
    menu: titleScreen,
    browser: browserScreen,
    lobby: lobbyScreen,
    queue: queueScreen,
    game: gameScreen,
    tutorial: gameScreen,
    results: resultsScreen,
    leaderboard: leaderboardScreen,
    locker: lockerScreen,
    settings: settingsScreen,
  };
  app.innerHTML = `<div class="site-shell"><header class="site-header"><button class="brand" data-action="home" aria-label="Splash Critters home"><span class="brand-mark">${portrait("frog")}</span><span>SPLASH<span>CRITTERS<span class="brand-dot">.</span></span></span></button><nav aria-label="Main navigation"><button class="${active === "play" ? "active" : ""}" data-action="home">Play</button><button class="${active === "browse" ? "active" : ""}" data-action="browse">Room Browser</button><button class="${active === "locker" ? "active" : ""}" data-action="locker">Locker</button><button class="${active === "leaderboard" ? "active" : ""}" data-action="leaderboard">Leaderboard</button></nav><div class="header-actions"><button class="round-button" data-action="mute" aria-label="${state.settings.muted ? "Unmute" : "Mute"} audio">${icon(state.settings.muted ? "mute" : "sound", 19)}</button><button class="round-button" data-action="settings" aria-label="Settings">${icon("gear", 19)}</button><button class="profile-button" data-action="nickname">${portrait(p?.selectedAnimal, p?.selectedHat)}<span><strong>${escapeHtml(p?.nickname ?? "Getting your flippers...")}</strong><small>LVL ${p?.level ?? 1} <i></i> ${rankTier(p?.ratings.find((r) => r.mode === "duel")?.rating ?? 1000).name}</small></span>${icon("arrow", 14)}</button></div></header><main class="main-content screen-${state.screen}" id="main">${renderers[state.screen](state)}</main><footer class="site-footer"><span class="footer-brand">A LITTLE SPLASH GOES A LONG WAY.</span><div><span id="connection-status"></span><span class="footer-separator">/</span><button data-action="how-to">How to Play ${icon("help", 14)}</button><span class="version">V1.0</span></div></footer><div class="desktop-note">This pond needs a keyboard. Play on desktop for the full splash.</div></div>`;
  updateConnection();
  audio.setScreen(state.screen);
  window.scrollTo({ top: 0 });
  if (state.screen === "browser")
    document
      .querySelectorAll(".segmented button")
      .forEach((b) =>
        b.classList.toggle(
          "active",
          b.getAttribute("data-action") === `filter-${filter ?? "all"}`,
        ),
      );
}
function go(screen: Screen): void {
  if (state.screen === "game" && screen !== "game") {
    toast("The match is still live. Use the X beside the timer to leave.");
    return;
  }
  if (state.queue && screen !== "queue") {
    network.send({ type: "queue_leave" });
    state.queue = null;
  }
  state.screen = screen;
  render();
}
function modal(title: string, subtitle: string, content: string): void {
  keys.clear();
  balloonPressed = false;
  dialog.innerHTML = `<button class="dialog-close round-button" data-action="close-dialog" aria-label="Close dialog">${icon("close")}</button><div class="eyebrow">SPLASH CRITTERS</div><h2>${title}</h2><p>${subtitle}</p>${content}`;
  if (!dialog.open) dialog.showModal();
}
function closeModal(): void {
  dialog.close();
  pendingRanked = null;
  remapping = null;
}
function requireOnline(): boolean {
  if (!state.profile || state.connection !== "online") {
    toast("Connecting to the pond. Please try again in a moment.");
    return false;
  }
  return true;
}
function showRanked(): void {
  if (!requireOnline()) return;
  modal(
    "Friendly Faces. Fierce Rivals.",
    "Humans only. First to three wins. Choose your arena.",
    `<div class="ranked-choices">${(["duel", "ffa"] as Mode[])
      .map((mode) => {
        const r = state.profile!.ratings.find((r) => r.mode === mode)!;
        return `<button data-action="queue" data-mode="${mode}">${icon(mode === "duel" ? "bolt" : "users", 34)}<strong>${mode === "duel" ? "Duel" : "Free-for-All"}</strong><p>${mode === "duel" ? "You. One rival. No excuses." : "Four critters. One dry champion."}</p><span>${rankTier(r.rating).name} / ${r.rating} ELO</span>${icon("arrow")}</button>`;
      })
      .join(
        "",
      )}</div><p class="small">A disconnect has a 15-second grace period, then counts as a forfeit.</p>`,
  );
}
function nicknameDialog(mode: Mode | null = null): void {
  pendingRanked = mode;
  modal(
    "What Should We Call You?",
    mode
      ? "Choose a friendly nickname to enter the ranked pond."
      : "Your tag keeps your name uniquely yours.",
    `<form id="nickname-form"><label>Nickname<input name="nickname" required minlength="3" maxlength="16" pattern="[A-Za-z0-9_ ]{3,16}" autocomplete="off" value="${escapeHtml(state.profile?.nicknameSet ? state.profile.nickname : "")}" placeholder="e.g. PuddleLegend" autofocus></label><small>3-16 letters, numbers, spaces or underscores.</small><button class="button primary" type="submit">${mode ? "Save & Find a Match" : "Looking Good. Save It."} ${icon("arrow")}</button></form>`,
  );
}
function startPractice(training = false): void {
  if (!requireOnline()) return;
  if (state.lobby) {
    toast("Leave your current room first.");
    return;
  }
  state.training = training;
  state.tutorialGoals.clear();
  state.result = null;
  network.send({
    type: "create_room",
    opts: {
      name: training ? "Splash School" : "Just Me & The Bots",
      mode: "duel",
      isPublic: false,
      theme: "backyard",
      roundsToWin: 3,
      botFill: true,
      practice: true,
      tutorial: training,
    },
  });
}
function createDialog(): void {
  if (!requireOnline()) return;
  modal(
    "Make Your Own Little Pond.",
    "Invite friends, add bots, and let the good clean chaos begin.",
    `<form id="create-form"><label>Room Name<input name="name" required maxlength="32" value="${escapeHtml(`${state.profile!.nickname}'s Pond`.slice(0, 32))}"></label><div class="form-grid"><label>Room Size<select name="mode"><option value="ffa">4-Player Free-for-All</option><option value="duel">2-Player Duel</option></select></label><label>Map Theme<select name="theme"><option value="backyard">Backyard</option><option value="beach">Beach</option><option value="pool">Pool Party</option><option value="random">Surprise Me</option></select></label><label>First to Win<select name="rounds"><option value="2">2 Rounds</option><option value="3" selected>3 Rounds</option><option value="5">5 Rounds</option></select></label><label>Who's Invited?<select name="visibility"><option value="public">Public / Everyone</option><option value="private">Private / Invite Only</option></select></label></div><label class="check-label"><input name="botFill" type="checkbox"> Fill empty slots with bots when starting</label><button class="button primary" type="submit">Open the Gates ${icon("arrow")}</button></form>`,
  );
}
function afterLeave(callback: () => void): void {
  pendingAfterLeave = callback;
  network.send({ type: "leave_room" });
}
async function loadLeaderboard(): Promise<void> {
  const request = ++leaderboardRequest;
  state.leaderboardLoading = true;
  state.screen = "leaderboard";
  render();
  try {
    const response = await fetch(`/api/leaderboard?mode=${state.mode}`);
    if (!response.ok)
      throw new Error("The leaderboard is taking a breather. Try refreshing.");
    const data = (await response.json()) as {
      leaderboard: UIState["leaderboard"];
    };
    if (request !== leaderboardRequest || state.screen !== "leaderboard")
      return;
    state.leaderboard = data.leaderboard;
    state.leaderboardLoading = false;
    render();
  } catch (e) {
    state.leaderboardLoading = false;
    if (state.screen === "leaderboard") render();
    toast(String(e instanceof Error ? e.message : e));
  }
}
async function action(name: string, element: HTMLElement): Promise<void> {
  audio.unlock();
  audio.play("click");
  if (
    ["home", "browse", "locker", "leaderboard", "settings"].includes(name) &&
    (state.screen === "game" ||
      state.screen === "lobby" ||
      state.screen === "results")
  ) {
    if (name === "home" && state.screen !== "game") {
      afterLeave(() => go("menu"));
      return;
    }
    toast("Leave your current room before changing screens.");
    return;
  }
  switch (name) {
    case "home":
      go("menu");
      break;
    case "mute":
      state.settings.muted = !state.settings.muted;
      saveSettings();
      break;
    case "settings":
      go("settings");
      break;
    case "locker":
      go("locker");
      break;
    case "browse":
      if (!requireOnline()) return;
      go("browser");
      network.send({ type: "room_list_request", mode: filter });
      break;
    case "filter-all":
    case "filter-duel":
    case "filter-ffa":
      filter =
        name === "filter-all"
          ? undefined
          : name === "filter-duel"
            ? "duel"
            : "ffa";
      network.send({ type: "room_list_request", mode: filter });
      break;
    case "refresh-rooms":
      network.send({ type: "room_list_request", mode: filter });
      break;
    case "create-room":
      createDialog();
      break;
    case "join-code":
      modal(
        "Your Invitation to Chaos.",
        "Enter a six-character room code and jump right in.",
        '<form id="join-form"><label>Room Code<input class="code-input" name="code" required minlength="6" maxlength="6" placeholder="SPLASH" autocomplete="off" autofocus></label><button class="button primary" type="submit">Find My Pond</button></form>',
      );
      break;
    case "join-room":
      network.send({ type: "join_room", code: element.dataset.code! });
      break;
    case "copy-invite": {
      const link = `${location.origin}/#/room/${state.lobby!.code}`;
      try {
        await navigator.clipboard.writeText(link);
        toast("Invite link copied. Go rally your critters.");
      } catch {
        modal(
          "Your Pond Is Ready.",
          "Share this invite link with a friend.",
          `<input readonly value="${escapeHtml(link)}" aria-label="Room invite link">`,
        );
      }
      break;
    }
    case "start-match":
      network.send({ type: "start_match" });
      break;
    case "ready":
      network.send({
        type: "set_ready",
        ready: !state.lobby?.slots.find((s) => s.playerId === state.profile?.id)
          ?.ready,
      });
      break;
    case "ranked":
      showRanked();
      break;
    case "queue": {
      const mode = element.dataset.mode as Mode;
      state.mode = mode;
      if (!state.profile?.nicknameSet) {
        nicknameDialog(mode);
        break;
      }
      closeModal();
      network.send({ type: "queue_join", mode });
      break;
    }
    case "nickname":
      if (requireOnline()) nicknameDialog();
      break;
    case "cancel-queue":
      network.send({ type: "queue_leave" });
      state.queue = null;
      go("menu");
      break;
    case "practice":
    case "quick-play":
      closeModal();
      startPractice();
      break;
    case "tutorial":
      closeModal();
      startPractice(true);
      break;
    case "leave":
      closeModal();
      afterLeave(() => go("menu"));
      break;
    case "exit-match":
      modal(
        "Heading for the Towels?",
        state.match?.ranked
          ? "Leaving a ranked match counts as a forfeit after the reconnect grace period."
          : "A Medium bot will take your place. The other critters keep playing.",
        `<div class="dialog-actions">${button("Stay & Splash", "close-dialog")}${button("Leave Match", "confirm-exit", "secondary")}</div>`,
      );
      break;
    case "confirm-exit":
      closeModal();
      afterLeave(() => {
        state.screen = "menu";
        render();
      });
      break;
    case "skip-tutorial":
      localStorage.setItem("splash-tutorial-seen", "true");
      afterLeave(() => {
        state.training = false;
        state.screen = "menu";
        render();
      });
      break;
    case "complete-tutorial":
      network.send({ type: "tutorial_complete" });
      break;
    case "ranked-again":
      afterLeave(() => {
        state.screen = "menu";
        render();
        showRanked();
      });
      break;
    case "rematch":
      network.send({ type: "rematch_vote" });
      toast("One more splash? Your vote is in.");
      break;
    case "emote":
      network.send({ type: "emote", id: Number(element.dataset.id) });
      break;
    case "leaderboard":
    case "refresh-leaderboard":
      await loadLeaderboard();
      break;
    case "leaderboard-duel":
    case "leaderboard-ffa":
      state.mode = name === "leaderboard-duel" ? "duel" : "ffa";
      await loadLeaderboard();
      break;
    case "equip-animal":
      if (state.profile)
        network.send({
          type: "equip",
          animal: element.dataset.id as Animal,
          hat: state.profile.selectedHat,
        });
      break;
    case "equip-hat":
      if (state.profile)
        network.send({
          type: "equip",
          animal: state.profile.selectedAnimal,
          hat: element.dataset.id as Hat,
        });
      break;
    case "remap":
      remapping = element.dataset.id as keyof Settings["bindings"];
      element.textContent = "Press a key...";
      break;
    case "reset-controls":
      state.settings.bindings = { ...defaults.bindings };
      saveSettings();
      render();
      break;
    case "close-dialog":
      closeModal();
      break;
    case "how-to":
      modal(
        "A Crash Course in Splash.",
        "Cute faces. Surprisingly tactical water fights.",
        `<div class="how-to-grid"><div><kbd>WASD</kbd><h3>Waddle Around.</h3><p>Move with WASD or arrows. Space or E drops a water balloon on your tile.</p></div><div>${icon("drop", 30)}<h3>Make an Exit.</h3><p>Three seconds later: splash! Water travels in a cross, stops at rocks, and washes the first sandcastle.</p></div><div>${icon("bolt", 30)}<h3>Think Ahead.</h3><p>Collect upgrades. Chain balloons together. Rubber Boots let you kick balloons down a lane.</p></div><div>${icon("trophy", 30)}<h3>Stay Dry.</h3><p>Last critter dry wins the round. At two minutes, the tide closes in. Soaked in casual? Ride a duck and lob with Space!</p></div></div><div class="dialog-actions">${button("Take the Tutorial", "tutorial")}${button("I'm Ready", "close-dialog", "secondary")}</div>`,
      );
      break;
    case "profile": {
      try {
        const response = await fetch(
          `/api/profile/${encodeURIComponent(element.dataset.id!)}`,
        );
        if (!response.ok) throw new Error("Player not found.");
        const data = (await response.json()) as {
          profile: NonNullable<UIState["profile"]>;
          recentMatches: RecentMatch[];
        };
        modal(
          escapeHtml(`${data.profile.nickname}#${data.profile.tag}`),
          `Level ${data.profile.level} / ${data.profile.xp} lifetime XP`,
          `<div class="profile-ratings">${data.profile.ratings.map((r) => `<div><span>${r.mode.toUpperCase()}</span><h3>${r.rating} <small>${rankTier(r.rating).name}</small></h3><p>${r.games} games / ${r.wins} wins / peak ${r.peak}</p></div>`).join("")}</div><h3>Recent Splashes</h3><div class="recent-matches">${data.recentMatches.length ? data.recentMatches.map((m) => `<div><strong>#${m.placement}</strong><span>${m.ranked ? "Ranked" : "Casual"} ${m.mode}</span><span>${m.soaks} soaks</span><small>+${m.xpEarned} XP</small></div>`).join("") : "<p>No matches yet.</p>"}</div>`,
        );
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not load this profile.");
      }
      break;
    }
  }
}
document.addEventListener("click", (e) => {
  const target = (e.target as Element).closest<HTMLElement>("[data-action]");
  if (target && !target.hasAttribute("disabled"))
    void action(target.dataset.action!, target);
});
document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  const data = new FormData(form);
  e.preventDefault();
  if (form.id === "nickname-form")
    network.send({
      type: "set_nickname",
      nickname: String(data.get("nickname")),
    });
  if (form.id === "join-form")
    network.send({
      type: "join_room",
      code: String(data.get("code")).trim().toUpperCase(),
    });
  if (form.id === "create-form") {
    const opts: RoomOptions = {
      name: String(data.get("name")).trim(),
      mode: data.get("mode") as Mode,
      theme: data.get("theme") as RoomOptions["theme"],
      roundsToWin: Number(data.get("rounds")) as 2 | 3 | 5,
      isPublic: data.get("visibility") === "public",
      botFill: data.has("botFill"),
    };
    network.send({ type: "create_room", opts });
  }
});
document.addEventListener("change", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.dataset.change === "slot")
    network.send({
      type: "set_slot",
      slot: Number(target.dataset.slot),
      kind: target.value === "open" ? "open" : "bot",
      difficulty:
        target.value === "open"
          ? undefined
          : (target.value as "easy" | "medium" | "hard"),
    });
  if (target.dataset.setting && target.type === "checkbox") {
    const setting = target.dataset.setting as
      | "muted"
      | "colorblind"
      | "reducedShake";
    state.settings[setting] = target.checked;
    saveSettings();
  }
});
document.addEventListener("input", (e) => {
  const target = e.target as HTMLInputElement;
  if (target.type === "range" && target.dataset.setting) {
    state.settings[target.dataset.setting as "sfx" | "music"] =
      Number(target.value) / 100;
    const output = target.parentElement?.querySelector("output");
    if (output) output.textContent = `${target.value}%`;
    saveSettings();
  }
});
dialog.addEventListener("cancel", () => {
  pendingRanked = null;
  remapping = null;
});
window.addEventListener("keydown", (e) => {
  if (remapping) {
    e.preventDefault();
    if (e.code === "Escape") {
      remapping = null;
      render();
      return;
    }
    if (
      ["KeyM", "Digit1", "Digit2", "Digit3", "Digit4", "Tab", "Enter"].includes(
        e.code,
      ) ||
      Object.entries(state.settings.bindings).some(
        ([action, code]) => action !== remapping && code === e.code,
      )
    ) {
      toast("That key is already in use. Choose another.");
      return;
    }
    state.settings.bindings[remapping] = e.code;
    remapping = null;
    saveSettings();
    render();
    return;
  }
  if ((e.target as Element).matches("input,select,textarea") || dialog.open)
    return;
  if (e.code === "KeyM" && !e.repeat) {
    audio.unlock();
    state.settings.muted = !state.settings.muted;
    saveSettings();
  }
  if (state.screen !== "game") return;
  if (
    Object.values(state.settings.bindings).includes(e.code) ||
    [
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyE",
      "Space",
    ].includes(e.code)
  )
    e.preventDefault();
  keys.delete(e.code);
  keys.add(e.code);
  if (
    !e.repeat &&
    (e.code === state.settings.bindings.balloon || e.code === "KeyE")
  )
    balloonPressed = true;
  if (!e.repeat && /^Digit[1-4]$/.test(e.code))
    network.send({ type: "emote", id: Number(e.code.at(-1)) - 1 });
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  balloonPressed = false;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    keys.clear();
    balloonPressed = false;
  }
});
function inputDirection(): Direction {
  const fallback: Record<string, Direction> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
  };
  for (const key of [...keys].reverse()) {
    const direction = (
      Object.keys(state.settings.bindings) as (keyof Settings["bindings"])[]
    ).find((d) => d !== "balloon" && state.settings.bindings[d] === key);
    if (direction) return direction as Direction;
    if (fallback[key]) return fallback[key];
  }
  return "none";
}
function announce(text: string, subtitle = "", duration = 1800): void {
  announcedText = text;
  announcedUntil = performance.now() + duration;
  const target = document.querySelector("#announcer");
  if (target) {
    target.innerHTML = `<strong>${escapeHtml(text)}</strong><small>${escapeHtml(subtitle)}</small>`;
    target.classList.add("visible");
  }
}
function goal(id: string): void {
  if (!state.training || state.tutorialGoals.has(id)) return;
  state.tutorialGoals.add(id);
  audio.play("powerup_collected");
  const panel = document.querySelector(".tutorial-panel");
  if (panel) panel.outerHTML = tutorialPanel(state);
}
function gameEvent(event: GameEvent): void {
  particles.emit(
    event,
    event.type === "player_soaked"
      ? state.match?.players.find((p) => p.playerId === event.playerId)?.animal
      : undefined,
  );
  audio.play(
    event.type,
    event.type === "chain_burst" ? event.count : undefined,
  );
  if (event.type === "castle_washed") {
    prediction.wash(event.x, event.y);
    if (event.playerId === state.profile?.id) goal("castle");
  }
  if (
    event.type === "powerup_collected" &&
    event.playerId === state.profile?.id
  )
    goal("pickup");
  if (event.type === "chain_burst") {
    announce(
      event.count === 2 ? "DOUBLE SPLASH!" : "TRIPLE SPLASH!+",
      `${event.count} BALLOONS. ONE BIG MESS.`,
    );
    if (event.playerId === state.profile?.id) goal("chain");
  }
  if (event.type === "balloon_burst" && !state.settings.reducedShake)
    shakeUntil = performance.now() + 130;
  if (event.type === "tide_advance") {
    announce("RISING TIDE!", "THE POND IS GETTING SMALLER.", 1300);
  }
  if (event.type === "player_soaked") {
    freezeUntil = performance.now() + (2 * 1000) / CONFIG.TICK_RATE;
    const victim =
      state.match?.players
        .find((p) => p.playerId === event.playerId)
        ?.nickname.split("#")[0] ?? "A critter";
    const attacker =
      state.match?.players
        .find((p) => p.playerId === event.byId)
        ?.nickname.split("#")[0] ?? "The tide";
    const text =
      event.byId === event.playerId
        ? `${victim} splashed a little too close.`
        : `${attacker} soaked ${victim}!`;
    const feed = document.querySelector("#kill-feed");
    if (feed) {
      if (feed.children[0]?.textContent?.includes("All quiet"))
        feed.innerHTML = "";
      const line = document.createElement("p");
      line.textContent = text;
      feed.prepend(line);
      if (feed.children.length > 6) feed.lastElementChild?.remove();
    }
    if (event.byId === state.profile?.id && event.playerId !== state.profile.id)
      goal("soak");
    if (event.playerId === state.profile?.id)
      announce(
        state.match?.ranked
          ? "ALL SOAKED!"
          : state.training
            ? "TRY ANOTHER SPLASH!"
            : "REVENGE DUCK!",
        state.match?.ranked
          ? "CHEER ON THE SURVIVORS."
          : state.training
            ? "THE NEXT ROUND IS A FRESH START."
            : "MOVE AROUND THE EDGE. SPACE TO LOB.",
        2300,
      );
  }
  if (event.type === "emote") {
    audio.play(`emote${event.id}`);
    const slot = state.match?.players.find(
      (s) => s.playerId === event.playerId,
    )?.slot;
    const target = document.querySelector(`#player-${slot}`);
    if (target) {
      const bubble = document.createElement("div");
      bubble.className = "emote-bubble pixel";
      bubble.textContent = ["QUACK!", "RIBBIT!", "SQUEAK!", "HONK!"][event.id];
      target.append(bubble);
      setTimeout(() => bubble.remove(), 1700);
    }
  }
}
function receive(message: ServerMessage): void {
  switch (message.type) {
    case "welcome":
      state.profile = message.profile;
      prediction.localId = message.playerId;
      render();
      {
        const code = location.hash.match(/^#\/room\/([A-Z0-9]{6})$/i)?.[1];
        if (code)
          setTimeout(() => {
            if (!state.lobby)
              network.send({ type: "join_room", code: code.toUpperCase() });
          }, 150);
      }
      break;
    case "profile_updated": {
      const wasComplete = state.profile?.tutorialComplete;
      state.profile = message.profile;
      if (state.training && !wasComplete && message.profile.tutorialComplete) {
        localStorage.setItem("splash-tutorial-seen", "true");
        toast("Splash School complete. +50 XP. Welcome to the pond!");
        afterLeave(() => {
          state.training = false;
          state.screen = "menu";
          render();
        });
        break;
      }
      const mode = pendingRanked;
      if (dialog.querySelector("#nickname-form")) {
        closeModal();
        if (mode) network.send({ type: "queue_join", mode });
      }
      if (state.screen !== "game") render();
      break;
    }
    case "error":
      toast(message.msg, 6000);
      break;
    case "room_list":
      state.rooms = message.rooms;
      if (state.screen === "browser") render();
      break;
    case "room_created":
      if (dialog.open) closeModal();
      history.replaceState(
        null,
        "",
        `${location.pathname}${location.search}#/room/${message.code}`,
      );
      break;
    case "lobby_state": {
      state.lobby = message.lobby;
      state.training = !!message.lobby.opts.tutorial;
      if (message.lobby.status === "lobby") {
        closeModal();
        state.training = !!message.lobby.opts.tutorial;
        state.screen = "lobby";
        history.replaceState(
          null,
          "",
          `${location.pathname}${location.search}#/room/${message.lobby.code}`,
        );
        render();
      }
      if (message.lobby.status === "results") {
        const el = document.querySelector("#rematch-status");
        if (el)
          el.textContent = `${message.lobby.rematchVotes.length} rematch vote(s). A majority restarts this pond.`;
      }
      break;
    }
    case "room_left":
      state.lobby = null;
      state.match = null;
      state.result = null;
      prediction.state = null;
      snapshot = null;
      state.screen = "menu";
      state.training = false;
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      {
        const callback = pendingAfterLeave;
        pendingAfterLeave = null;
        if (callback) callback();
        else render();
      }
      break;
    case "queue_status":
      state.queue = message;
      if (state.screen !== "queue") {
        closeModal();
        state.screen = "queue";
        render();
      } else {
        const elapsed = document.querySelector("#queue-elapsed");
        if (elapsed) elapsed.textContent = `${message.elapsed}s`;
        document.querySelector("#queue-range")!.textContent =
          `+/- ${message.searchRange}`;
        document.querySelector("#queue-count")!.textContent = String(
          message.queued,
        );
      }
      break;
    case "queue_left":
      state.queue = null;
      if (state.screen === "queue") {
        state.screen = "menu";
        render();
      }
      break;
    case "match_found":
      toast("Rivals found. Get your flippers on.");
      state.queue = null;
      break;
    case "match_start":
      state.queue = null;
      state.match = message.config;
      state.result = null;
      prediction.ranked = message.config.ranked;
      prediction.revengeEnabled = !message.config.ranked && !state.training;
      state.screen = "game";
      closeModal();
      keys.clear();
      balloonPressed = false;
      render();
      break;
    case "round_start":
      prediction.reset(
        message.width,
        message.height,
        message.castleGrid,
        message.mapSeed,
      );
      seq = 0;
      accumulator = 0;
      particles.reset();
      announcedText = "";
      announcedUntil = 0;
      snapshot = null;
      if (state.match) state.match.theme = message.theme;
      document.querySelector("#round-label")!.textContent =
        `ROUND ${message.roundNo}`;
      break;
    case "snapshot": {
      snapshot = message.state;
      prediction.reconcile(message.state);
      for (const id of message.state.tutorialGoals ?? []) goal(id);
      const p = message.state.players.find((p) => p.id === state.profile?.id);
      if (p) seq = Math.max(seq, p.lastInputSeq);
      if (p && Math.abs(p.x - 1.5) + Math.abs(p.y - 1.5) > 1) goal("move");
      updateHud(message.state);
      break;
    }
    case "event":
      gameEvent(message.event);
      break;
    case "round_end": {
      const winner = state.match?.players.find(
        (p) => p.playerId === message.winnerId,
      );
      announce(
        winner ? `${winner.nickname.split("#")[0]} WINS!` : "A PROPER SOAKING.",
        winner
          ? "ONE ROUND CLOSER TO GLORY."
          : "DRAW ROUND. EVERYBODY GOT WET.",
        2600,
      );
      for (const s of state.match?.players ?? []) {
        const score = document.querySelector(`#player-${s.slot} .player-score`);
        if (score) score.textContent = String(message.scores[s.playerId!] ?? 0);
      }
      break;
    }
    case "match_end":
      state.result = message;
      state.screen = "results";
      keys.clear();
      audio.play("victory");
      render();
      break;
  }
}
function updateHud(s: Snapshot): void {
  if (state.screen !== "game") return;
  const clock = document.querySelector("#round-clock");
  if (clock)
    clock.textContent = s.tideRing
      ? "TIDE!"
      : formatTime(CONFIG.TIDE_START_TICKS - s.tick);
  const ping = document.querySelector("#ping-label");
  if (ping) ping.textContent = `${Math.round(network.ping)}ms`;
  const tide = document.querySelector("#tide-label");
  if (tide)
    tide.textContent = s.tideRing
      ? `TIDE RING ${s.tideRing}`
      : "RISING TIDE AT 2:00";
  for (const p of s.players) {
    const card = document.querySelector(`#player-${p.slot}`);
    if (!card) continue;
    card.classList.toggle("soaked", !p.alive);
    card.querySelector(".stat-balloons")!.textContent = String(p.balloonCount);
    card.querySelector(".stat-range")!.textContent = String(p.splashRange);
    card.querySelector(".stat-speed")!.textContent = p.speed.toFixed(1);
    card.querySelector(".player-score")!.textContent = String(p.roundsWon);
    card.querySelector(".alive-label")!.textContent = p.alive
      ? p.kick
        ? "DRY / RUBBER BOOTS ON"
        : "STILL DRY"
      : state.match?.ranked
        ? "ALL SOAKED"
        : "REVENGE DUCK";
  }
  audio.setShowdown(s.players.filter((p) => p.alive).length === 2);
  if (s.countdown > 0) {
    const text = String(Math.ceil(s.countdown / CONFIG.TICK_RATE));
    if (announcedText !== text) {
      announce(
        text,
        s.countdown > 60 ? "MEET YOUR RIVALS." : "GET READY TO SPLASH.",
        1100,
      );
      audio.play("click");
      if (text === "3")
        document
          .querySelector("#announcer")
          ?.insertAdjacentHTML(
            "beforeend",
            `<div class="vs-intro">${state.match?.players.map((p) => `<div>${portrait(p.animal, p.hat)}<b>${escapeHtml(p.nickname.split("#")[0])}</b><span>${state.match?.ranked ? `${rankTier(p.rating).name} / ${p.rating}` : p.kind === "bot" ? `${p.difficulty.toUpperCase()} BOT` : "READY TO SPLASH"}</span></div>`).join("<i>VS</i>")}</div>`,
          );
    }
  } else if (/^[1-3]$/.test(announcedText))
    announce("SPLASH!", "LAST CRITTER DRY WINS.", 900);
}
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  frames++;
  if (now - fpsAt > 1000) {
    fps = Math.round((frames * 1000) / (now - fpsAt));
    fpsAt = now;
    frames = 0;
  }
  const scene = document.querySelector<HTMLCanvasElement>("#scene");
  if (scene) drawMenuScene(scene.getContext("2d")!, now);
  const preview = document.querySelector<HTMLCanvasElement>("#locker-preview");
  if (preview) {
    const ctx = preview.getContext("2d")!;
    ctx.clearRect(0, 0, 64, 64);
    drawAnimal(
      ctx,
      8,
      14,
      state.profile?.selectedAnimal ?? "frog",
      state.profile?.selectedHat ?? "none",
      Math.floor(now / 220) % 2,
      3,
    );
  }
  if (state.screen !== "game") {
    accumulator = 0;
    return;
  }
  if (
    state.connection === "online" &&
    !document.hidden &&
    !dialog.open &&
    snapshot &&
    !snapshot.countdown &&
    !snapshot.roundOver
  ) {
    accumulator += dt;
    while (accumulator >= 1 / CONFIG.INPUT_RATE) {
      accumulator -= 1 / CONFIG.INPUT_RATE;
      const input: PlayerInput = {
        seq: ++seq,
        tick: prediction.state?.tick ?? 0,
        dir: inputDirection(),
        balloonPressed,
      };
      network.send({ type: "input", ...input });
      prediction.predict(input);
      balloonPressed = false;
    }
  } else accumulator = 0;
  const canvas = document.querySelector<HTMLCanvasElement>("#arena");
  const renderState = prediction.renderState(Date.now() + network.clockOffset);
  if (canvas && renderState && now > freezeUntil) {
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (now < shakeUntil && !state.settings.reducedShake)
      ctx.translate(
        Math.floor(Math.random() * 3) - 1,
        Math.floor(Math.random() * 3) - 1,
      );
    drawArena(
      ctx,
      renderState,
      state.match?.theme ?? "backyard",
      state.profile?.id ?? "",
      now,
      state.settings,
    );
    particles.draw(
      ctx,
      dt,
      (256 - renderState.width * 16) / 2,
      (224 - renderState.height * 16) / 2,
    );
    ctx.restore();
  }
  const announceEl = document.querySelector("#announcer");
  if (announceEl) announceEl.classList.toggle("visible", now < announcedUntil);
  if (new URLSearchParams(location.search).has("dev")) {
    const dev = document.querySelector("#dev-stats");
    if (dev)
      dev.textContent = `${fps} FPS / ${renderState?.tick ?? 0} TICK / ${network.latency}ms SIMULATED RTT`;
  }
}
saveSettings();
render();
network.connect();
requestAnimationFrame(frame);

// screens/index.ts — UI screen router & HTML-based screens (spec §7).
// The canvas handles in-match rendering; these screens are HTML overlays managed
// here. Each screen renders into #overlay and wires its own buttons to actions.

import type { Net } from "../net.js";
import type { Animal, Hat, Profile, ServerMsg, SlotView, RoomSummary } from "@splash/shared";

export type ScreenName =
  | "title" | "nickname" | "menu" | "browser" | "create" | "join" | "lobby"
  | "queue" | "game" | "results" | "leaderboard" | "locker" | "settings" | "howto";

export interface AppCtx {
  net: Net;
  profile: Profile | null;
  setProfile: (p: Profile) => void;
  go: (s: ScreenName, extra?: any) => void;
  // lobby state cache
  lobby: { code: string; name: string; size: 2 | 4; theme: string; roundsToWin: number; slots: SlotView[]; hostSlot: number; yourSlot: number } | null;
  matchResult: ServerMsg & { t: "match_end" } | null;
  // actions
  actions: ScreenActions;
}

export interface ScreenActions {
  createRoom: (opts: { name: string; size: 2 | 4; visibility: "public" | "private"; theme: string; roundsToWin: number; botFill: boolean }) => void;
  joinRoom: (code: string) => void;
  refreshRooms: () => Promise<RoomSummary[]>;
  leaveRoom: () => void;
  setSlot: (slot: number, kind: "open" | "bot", difficulty?: "easy" | "medium" | "hard") => void;
  setReady: (ready: boolean) => void;
  startMatch: () => void;
  queueJoin: (mode: "duel" | "ffa") => void;
  queueLeave: () => void;
  setNickname: (n: string) => void;
  setCosmetics: (animal: Animal, hat: Hat) => void;
  rematch: (vote: boolean) => void;
}

const overlay = () => document.getElementById("overlay")!;
const clear = () => (overlay().innerHTML = "");

function el(tag: string, cls: string, text = ""): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "btn", label) as HTMLButtonElement;
  b.onclick = onClick;
  return b;
}

// ---------- screen registry ----------

export function renderScreen(name: ScreenName, ctx: AppCtx, extra?: any) {
  clear();
  switch (name) {
    case "title": return titleScreen(ctx);
    case "nickname": return nicknameScreen(ctx);
    case "menu": return menuScreen(ctx);
    case "browser": return browserScreen(ctx);
    case "create": return createScreen(ctx);
    case "join": return joinScreen(ctx);
    case "lobby": return lobbyScreen(ctx);
    case "queue": return queueScreen(ctx, extra);
    case "results": return resultsScreen(ctx);
    case "leaderboard": return leaderboardScreen(ctx);
    case "locker": return lockerScreen(ctx);
    case "settings": return settingsScreen(ctx);
    case "howto": return howtoScreen(ctx);
    case "game": return; // game has no overlay
  }
}

// ---------- individual screens ----------

function titleScreen(ctx: AppCtx) {
  const o = overlay();
  o.appendChild(el("h1", "", "SPLASH CRITTERS"));
  o.appendChild(el("div", "small", "an 8-bit water balloon battler"));
  o.appendChild(btn("PRESS START", () => {
    if (!ctx.profile?.nickname || ctx.profile.nickname === "Player") ctx.go("nickname");
    else ctx.go("menu");
  }));
  // animated subtitle handled by canvas in main; here just static
}

function nicknameScreen(ctx: AppCtx) {
  const o = overlay();
  const panel = el("div", "panel");
  panel.appendChild(el("h2", "", "CHOOSE A NAME"));
  panel.appendChild(el("div", "small", "3-16 chars. Required for ranked."));
  const input = el("input", "") as HTMLInputElement;
  input.placeholder = "SoggyOtter";
  input.maxLength = 16;
  panel.appendChild(input);
  const row = el("div", "row");
  row.appendChild(btn("Confirm", () => {
    const v = input.value.trim();
    if (v.length < 3) return;
    ctx.actions.setNickname(v);
    setTimeout(() => ctx.go("menu"), 200);
  }));
  row.appendChild(btn("Back", () => ctx.go("title")));
  panel.appendChild(row);
  o.appendChild(panel);
}

function menuScreen(ctx: AppCtx) {
  const o = overlay();
  o.appendChild(el("h1", "", "SPLASH CRITTERS"));
  const p = el("div", "small", `Welcome, ${ctx.profile?.nickname} (Lv ${ctx.profile?.level})`);
  o.appendChild(p);
  const col = el("div", "");
  col.style.display = "flex";
  col.style.flexDirection = "column";
  col.style.gap = "8px";
  col.appendChild(btn("Play Ranked Duel (1v1)", () => { ctx.actions.queueJoin("duel"); ctx.go("queue", { mode: "duel" }); }));
  col.appendChild(btn("Play Ranked Free-for-All (4p)", () => { ctx.actions.queueJoin("ffa"); ctx.go("queue", { mode: "ffa" }); }));
  col.appendChild(btn("Casual: Browse Rooms", () => ctx.go("browser")));
  col.appendChild(btn("Casual: Create Room", () => ctx.go("create")));
  col.appendChild(btn("Casual: Join by Code", () => ctx.go("join")));
  col.appendChild(btn("Practice vs Bots", () => practiceVsBots(ctx)));
  col.appendChild(btn("Leaderboard", () => ctx.go("leaderboard")));
  col.appendChild(btn("Locker", () => ctx.go("locker")));
  col.appendChild(btn("How to Play", () => ctx.go("howto")));
  col.appendChild(btn("Settings", () => ctx.go("settings")));
  o.appendChild(col);
}

function practiceVsBots(ctx: AppCtx) {
  // create a private 4p room with bot fill, then start
  ctx.actions.createRoom({ name: "Practice", size: 4, visibility: "private", theme: "backyard", roundsToWin: 3, botFill: true });
  // start will happen from lobby; jump to lobby
  setTimeout(() => ctx.go("lobby"), 200);
}

function browserScreen(ctx: AppCtx) {
  const o = overlay();
  const panel = el("div", "panel");
  panel.appendChild(el("h2", "", "PUBLIC ROOMS"));
  const list = el("div", "lobbylist");
  list.textContent = "Loading…";
  panel.appendChild(list);
  const row = el("div", "row");
  row.appendChild(btn("Refresh", async () => {
    const rooms = await ctx.actions.refreshRooms();
    list.innerHTML = "";
    if (rooms.length === 0) list.appendChild(el("div", "small", "No open rooms. Create one!"));
    for (const r of rooms) {
      const item = el("div", "lobbyrow");
      item.innerHTML = `<b>${r.name}</b> ${r.size}p ${r.theme} — ${r.players}/${r.max} (host: ${r.host}) <b style="color:#ffcd75">${r.code}</b>`;
      item.onclick = () => { ctx.actions.joinRoom(r.code); setTimeout(() => ctx.go("lobby"), 200); };
      list.appendChild(item);
    }
  }));
  row.appendChild(btn("Back", () => ctx.go("menu")));
  panel.appendChild(row);
  o.appendChild(panel);
  // auto-load
  setTimeout(() => ctx.actions.refreshRooms().then(async () => {
    const rooms = await ctx.actions.refreshRooms();
    list.innerHTML = "";
    for (const r of rooms) {
      const item = el("div", "lobbyrow");
      item.innerHTML = `<b>${r.name}</b> ${r.size}p ${r.theme} — ${r.players}/${r.max} (host: ${r.host}) <b style="color:#ffcd75">${r.code}</b>`;
      item.onclick = () => { ctx.actions.joinRoom(r.code); setTimeout(() => ctx.go("lobby"), 200); };
      list.appendChild(item);
    }
  }), 100);
}

function createScreen(ctx: AppCtx) {
  const o = overlay();
  const panel = el("div", "panel");
  panel.appendChild(el("h2", "", "CREATE ROOM"));
  const nameIn = el("input", "") as HTMLInputElement;
  nameIn.placeholder = "Room name";
  nameIn.value = "Splash Room";
  panel.appendChild(el("div", "small", "Room name"));
  panel.appendChild(nameIn);

  const sizeSel = el("select", "") as HTMLSelectElement;
  sizeSel.innerHTML = `<option value="2">2 players (Duel)</option><option value="4">4 players (FFA)</option>`;
  const themeSel = el("select", "") as HTMLSelectElement;
  themeSel.innerHTML = `<option value="backyard">Backyard</option><option value="beach">Beach</option><option value="pool">Pool Party</option>`;
  const roundsSel = el("select", "") as HTMLSelectElement;
  roundsSel.innerHTML = `<option value="2">First to 2</option><option value="3" selected>First to 3</option><option value="5">First to 5</option>`;
  const visSel = el("select", "") as HTMLSelectElement;
  visSel.innerHTML = `<option value="public">Public</option><option value="private">Private</option>`;
  const botFillSel = el("select", "") as HTMLSelectElement;
  botFillSel.innerHTML = `<option value="1">Bot fill ON</option><option value="0">Bot fill OFF</option>`;

  const field = (label: string, input: HTMLElement) => {
    const r = el("div", "row");
    r.style.justifyContent = "space-between";
    r.appendChild(el("span", "small", label));
    r.appendChild(input);
    return r;
  };
  panel.appendChild(field("Size", sizeSel));
  panel.appendChild(field("Theme", themeSel));
  panel.appendChild(field("Rounds", roundsSel));
  panel.appendChild(field("Visibility", visSel));
  panel.appendChild(field("Bots", botFillSel));

  const row = el("div", "row");
  row.appendChild(btn("Create", () => {
    ctx.actions.createRoom({
      name: nameIn.value || "Splash Room",
      size: Number(sizeSel.value) as 2 | 4,
      visibility: visSel.value as "public" | "private",
      theme: themeSel.value,
      roundsToWin: Number(roundsSel.value),
      botFill: botFillSel.value === "1",
    });
    setTimeout(() => ctx.go("lobby"), 200);
  }));
  row.appendChild(btn("Back", () => ctx.go("menu")));
  panel.appendChild(row);
  o.appendChild(panel);
}

function joinScreen(ctx: AppCtx) {
  const o = overlay();
  const panel = el("div", "panel");
  panel.appendChild(el("h2", "", "JOIN BY CODE"));
  const code = el("input", "") as HTMLInputElement;
  code.placeholder = "6-char code";
  code.maxLength = 6;
  panel.appendChild(code);
  const row = el("div", "row");
  row.appendChild(btn("Join", () => { ctx.actions.joinRoom(code.value.toUpperCase()); setTimeout(() => ctx.go("lobby"), 200); }));
  row.appendChild(btn("Back", () => ctx.go("menu")));
  panel.appendChild(row);
  o.appendChild(panel);
}

function lobbyScreen(ctx: AppCtx) {
  const o = overlay();
  const panel = el("div", "panel");
  const lb = ctx.lobby;
  if (!lb) { panel.appendChild(el("div", "", "Waiting for lobby…")); o.appendChild(panel); return; }
  panel.appendChild(el("h2", "", `${lb.name}  ·  ${lb.code}`));
  panel.appendChild(el("div", "small", `${lb.size}p · ${lb.theme} · first to ${lb.roundsToWin}`));
  const slotsEl = el("div", "slots");
  const isHost = lb.yourSlot === lb.hostSlot;
  for (const s of lb.slots) {
    const slot = el("div", "slot");
    const left = el("span", "", `Slot ${s.slot + 1}: ${s.kind === "human" ? (s.nickname ?? "Player") : s.kind === "bot" ? `Bot (${s.difficulty})` : "OPEN"}`);
    slot.appendChild(left);
    if (isHost && s.kind !== "human") {
      const cycle = el("button", "btn", s.kind === "open" ? "+ Bot" : "x");
      cycle.style.minWidth = "60px";
      cycle.onclick = () => {
        if (s.kind === "open") ctx.actions.setSlot(s.slot, "bot", "medium");
        else ctx.actions.setSlot(s.slot, "open");
      };
      slot.appendChild(cycle);
    }
    slotsEl.appendChild(slot);
  }
  panel.appendChild(slotsEl);

  const row = el("div", "row");
  if (isHost) row.appendChild(btn("Start Match", () => ctx.actions.startMatch()));
  else row.appendChild(btn("Ready", () => ctx.actions.setReady(true)));
  row.appendChild(btn("Leave", () => { ctx.actions.leaveRoom(); ctx.go("menu"); }));
  panel.appendChild(row);
  o.appendChild(panel);
}

function queueScreen(ctx: AppCtx, extra: { mode: "duel" | "ffa" }) {
  const o = overlay();
  o.appendChild(el("h2", "", `Queued: ${extra.mode === "duel" ? "Ranked Duel" : "Ranked FFA"}`));
  const status = el("div", "", "Searching…");
  status.id = "queue-status";
  o.appendChild(status);
  o.appendChild(btn("Cancel", () => { ctx.actions.queueLeave(); ctx.go("menu"); }));
  // queue_status handler updates #queue-status text
  ctx.net.on("queue_status", (m: any) => {
    const s = document.getElementById("queue-status");
    if (s) s.textContent = `Searching… range ±${m.searchRange} (ETA ~${m.eta}s)`;
  });
}

function resultsScreen(ctx: AppCtx) {
  const o = overlay();
  const panel = el("div", "panel");
  panel.appendChild(el("h2", "", "MATCH RESULTS"));
  const r = ctx.matchResult;
  if (r && r.t === "match_end") {
    for (const p of r.placements) {
      const row = el("div", "slot");
      row.appendChild(el("span", "", `#${p.slot + 1} ${p.nickname} — ${p.roundsWon} round wins, ${p.soaks} soaks, +${p.xp} XP`));
      if (p.ratingAfter) row.appendChild(el("span", "small", `${p.ratingBefore} → ${p.ratingAfter}`));
      panel.appendChild(row);
    }
  } else {
    panel.appendChild(el("div", "", "No result data."));
  }
  const row = el("div", "row");
  row.appendChild(btn("Rematch", () => { ctx.actions.rematch(true); ctx.go("lobby"); }));
  row.appendChild(btn("Continue", () => { ctx.actions.leaveRoom(); ctx.go("menu"); }));
  panel.appendChild(row);
  o.appendChild(panel);
}

async function leaderboardScreen(ctx: AppCtx) {
  const o = overlay();
  const panel = el("div", "panel");
  panel.appendChild(el("h2", "", "LEADERBOARD"));
  const modeSel = el("select", "") as HTMLSelectElement;
  modeSel.innerHTML = `<option value="duel">Duel</option><option value="ffa">FFA</option>`;
  const list = el("div", "lobbylist");
  panel.appendChild(modeSel);
  panel.appendChild(list);
  const load = async () => {
    const res = await fetch(`/api/leaderboard?mode=${modeSel.value}`);
    const j = await res.json();
    list.innerHTML = "";
    if (!j.entries?.length) list.appendChild(el("div", "small", "No games played yet."));
    for (const e of j.entries) {
      const row = el("div", "lobbyrow");
      row.innerHTML = `<b>#${e.rank}</b> ${e.nickname}#${e.tag} <b>${e.rating}</b> ${e.tier} (${e.games}g, ${Math.round(e.winrate * 100)}%)`;
      list.appendChild(row);
    }
  };
  modeSel.onchange = load;
  const row = el("div", "row");
  row.appendChild(btn("Refresh", load));
  row.appendChild(btn("Back", () => ctx.go("menu")));
  panel.appendChild(row);
  o.appendChild(panel);
  load();
}

function lockerScreen(ctx: AppCtx) {
  const o = overlay();
  const panel = el("div", "panel");
  panel.appendChild(el("h2", "", "LOCKER"));
  panel.appendChild(el("div", "small", `Level ${ctx.profile?.level}. Pick your critter & hat.`));
  const animals = ["frog", "duck", "otter", "penguin", "cat", "raccoon", "turtle", "capybara"];
  const hats = ["none", "bucket", "snorkel", "crown", "bandana", "propeller"];
  // simple unlock by level approximation (client-side preview; server validates)
  const lv = ctx.profile?.level ?? 1;
  const aSel = el("select", "") as HTMLSelectElement;
  for (const a of animals) aSel.innerHTML += `<option value="${a}">${a}</option>`;
  aSel.value = ctx.profile?.selectedAnimal ?? "frog";
  const hSel = el("select", "") as HTMLSelectElement;
  for (const h of hats) hSel.innerHTML += `<option value="${h}">${h}</option>`;
  hSel.value = ctx.profile?.selectedHat ?? "none";
  panel.appendChild(el("div", "small", "Animal"));
  panel.appendChild(aSel);
  panel.appendChild(el("div", "small", "Hat"));
  panel.appendChild(hSel);
  panel.appendChild(el("div", "small", `Higher-level options unlock as you play. (Lv ${lv})`));
  const row = el("div", "row");
  row.appendChild(btn("Save", () => {
    ctx.actions.setCosmetics(aSel.value as Animal, hSel.value as Hat);
    ctx.go("menu");
  }));
  row.appendChild(btn("Back", () => ctx.go("menu")));
  panel.appendChild(row);
  o.appendChild(panel);
}

function settingsScreen(ctx: AppCtx) {
  const o = overlay();
  const panel = el("div", "panel");
  panel.appendChild(el("h2", "", "SETTINGS"));
  panel.appendChild(el("div", "small", "M: mute · Arrow/WASD: move · Space/E: drop balloon"));
  panel.appendChild(el("div", "small", "Accounts are token-based. If you clear localStorage, your account & progress are lost. This is by design for v1."));
  const row = el("div", "row");
  row.appendChild(btn("Back", () => ctx.go("menu")));
  panel.appendChild(row);
  o.appendChild(panel);
}

function howtoScreen(ctx: AppCtx) {
  const o = overlay();
  const panel = el("div", "panel");
  panel.appendChild(el("h2", "", "HOW TO PLAY"));
  const lines = [
    "Move with WASD or Arrows.",
    "Drop a water balloon with SPACE or E.",
    "Balloons burst into cross-shaped splashes.",
    "Splashes wash sandcastles & soak critters.",
    "Chained balloons burst together — set up big combos!",
    "Grab power-ups from ruined castles.",
    "Last critter dry wins the round. First to 3 wins.",
  ];
  for (const l of lines) panel.appendChild(el("div", "small", "• " + l));
  const row = el("div", "row");
  row.appendChild(btn("Back", () => ctx.go("menu")));
  panel.appendChild(row);
  o.appendChild(panel);
}

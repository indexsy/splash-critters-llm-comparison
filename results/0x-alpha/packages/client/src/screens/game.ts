import { CONFIG, TICK_MS } from "@sc/shared";
import { TILE_BOULDER, TILE_CASTLE, TILE_FLOODED } from "@sc/shared";
import type {
  MatchEndMsg,
  MatchStartMsg,
  RoundEndMsg,
  RoundStartMsg,
  SimEventMsg,
  SnapshotMsg,
} from "@sc/shared";
import { app } from "../main";
import { net } from "../net";
import { audio } from "../audio";
import { Predictor } from "../prediction";
import { Particles } from "../render/particles";
import { drawAnimal, drawBalloon, drawSplashCell, drawPowerupIcon } from "../render/sprites";

const THEME = {
  backyard: { floor: "#3e8948", floor2: "#48a14f", border: "#5a6988", border2: "#7b8bbd" },
  beach: { floor: "#e8d28a", floor2: "#d9bd6c", border: "#a0643a", border2: "#c98850" },
  pool: { floor: "#7ec8e3", floor2: "#5aa7c9", border: "#29366f", border2: "#3b4a8c" },
};

interface EntityInfo {
  id: string;
  nickname: string;
  animal: string;
  hat: string | null;
  isBot: boolean;
}

interface GameSession {
  entities: Map<string, EntityInfo>;
  yourEntityId: string;
  ranked: boolean;
  grid: Uint8Array | null;
  w: number;
  h: number;
  theme: keyof typeof THEME;
  scores: Record<string, number>;
  snapTick: number;
  snapTime: number;
  balloons: SnapshotMsg["snapshot"]["balloons"];
  splashes: Array<{ id: number; x: number; y: number; age: number; cells: number[] }>;
  exposed: SnapshotMsg["snapshot"]["exposed"];
  tideRing: number;
  stats: Record<string, { speed: number; balloons: number; range: number }>;
  alive: Record<string, boolean>;
  predictor: Predictor;
  particles: Particles;
  emotes: Map<string, { id: number; until: number }>;
  hitStopUntil: number;
  shake: number;
  roundNo: number;
  matchOver: boolean;
  roomCode: string | null;
}

let session: GameSession | null = null;
let raf = 0;
let offNet: (() => void) | null = null;

export function enterGame(msg: MatchStartMsg): void {
  app.canvas.style.display = "block";
  app.hud.style.display = "block";
  app.hud.innerHTML = `<div class="players"></div><div class="feed"></div><div class="announce"></div><div class="timer"></div>`;
  session = {
    entities: new Map(msg.entities.map((e) => [e.id, { id: e.id, nickname: e.nickname, animal: e.animal, hat: e.hat, isBot: e.isBot }])),
    yourEntityId: msg.yourEntityId,
    ranked: msg.ranked,
    grid: null,
    w: msg.config.w,
    h: msg.config.h,
    theme: msg.config.theme,
    scores: {},
    snapTick: 0,
    snapTime: Date.now(),
    balloons: [],
    splashes: [],
    exposed: [],
    tideRing: -1,
    stats: {},
    alive: {},
    predictor: new Predictor(),
    particles: new Particles(),
    emotes: new Map(),
    hitStopUntil: 0,
    shake: 0,
    roundNo: 0,
    matchOver: false,
    roomCode: null,
  };
  audio.playMusic("game");
  renderPlayerCards();

  let inputAcc = 0;
  let lastFrame = performance.now();
  const keys = new Set<string>();
  let prevPressed = false;

  const kd = (e: KeyboardEvent): void => {
    keys.add(e.key.toLowerCase());
    if (/^[1-4]$/.test(e.key)) net.send({ t: "emote", id: Number(e.key) });
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
  };
  const ku = (e: KeyboardEvent): void => {
    keys.delete(e.key.toLowerCase());
  };
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);

  const readDir = (): { x: number; y: number } => {
    let x = 0;
    let y = 0;
    if (keys.has("a") || keys.has("arrowleft")) x -= 1;
    if (keys.has("d") || keys.has("arrowright")) x += 1;
    if (keys.has("w") || keys.has("arrowup")) y -= 1;
    if (keys.has("s") || keys.has("arrowdown")) y += 1;
    return { x, y };
  };

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const s = session!;
    if (!s || !s.grid) return;

    // inputs at ~30Hz
    inputAcc += dt;
    const dir = readDir();
    const pressed = keys.has(" ") || keys.has("e");
    if (inputAcc >= 1 / CONFIG.inputSendHz) {
      inputAcc = 0;
      const seq = s.predictor.addInput(dir.x, dir.y);
      net.send({ t: "input", seq, tick: s.snapTick, dirX: dir.x, dirY: dir.y, balloonPressed: pressed });
    }
    prevPressed = pressed;

    // local prediction
    const myStats = s.stats[s.yourEntityId] ?? { speed: CONFIG.speedBase, balloons: 1, range: CONFIG.splashRangeBase };
    const solidAt = (tx: number, ty: number): boolean => {
      if (!s.grid) return true;
      if (tx < 0 || ty < 0 || tx >= s.w || ty >= s.h) return true;
      const t = s.grid[ty * s.w + tx]!;
      return t === TILE_BOULDER || t === TILE_CASTLE;
    };
    if (now > s.hitStopUntil && s.alive[s.yourEntityId] !== false) {
      s.predictor.integrate(dt, dir.x, dir.y, myStats.speed, solidAt, false);
    }

    s.particles.update(dt);
    s.shake = Math.max(0, s.shake - dt * 30);
    draw();
  };

  const draw = (): void => {
    const s = session!;
    const ctx = app.canvas.getContext("2d")!;
    const pal = THEME[s.theme];
    const TILE = Math.floor(Math.min(256 / s.w, 224 / s.h));
    const ox = Math.floor((256 - s.w * TILE) / 2);
    const oy = Math.floor((224 - s.h * TILE) / 2);

    ctx.save();
    if (s.shake > 0 && !app.settings.reducedShake) {
      ctx.translate(Math.round((Math.random() - 0.5) * s.shake), Math.round((Math.random() - 0.5) * s.shake));
    }
    ctx.fillStyle = "#141b33";
    ctx.fillRect(0, 0, 256, 224);

    // tiles
    for (let ty = 0; ty < s.h; ty++) {
      for (let tx = 0; tx < s.w; tx++) {
        const t = s.grid![ty * s.w + tx]!;
        const px = ox + tx * TILE;
        const py = oy + ty * TILE;
        const border = tx === 0 || ty === 0 || tx === s.w - 1 || ty === s.h - 1;
        if (t === TILE_BOULDER) {
          ctx.fillStyle = border ? pal.border : "#5a6988";
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = border ? pal.border2 : "#7b8bbd";
          ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 6);
        } else if (t === TILE_CASTLE) {
          ctx.fillStyle = pal.floor;
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = "#e08c3a";
          ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 3);
          ctx.fillStyle = "#ffcd75";
          ctx.fillRect(px + 4, py + 4, 3, 3);
          ctx.fillRect(px + TILE - 8, py + 4, 3, 3);
          ctx.fillRect(px + 6, py + TILE - 8, 4, 4);
        } else if (t === TILE_FLOODED) {
          const shim = Math.sin((Date.now() / 300 + tx + ty) % (Math.PI * 2)) > 0 ? "#41a6f6" : "#3b7dd8";
          ctx.fillStyle = shim;
          ctx.fillRect(px, py, TILE, TILE);
        } else {
          ctx.fillStyle = (tx + ty) % 2 === 0 ? pal.floor : pal.floor2;
          ctx.fillRect(px, py, TILE, TILE);
        }
      }
    }

    const time = Date.now();
    // splashes
    for (const sp of s.splashes) {
      for (const c of sp.cells ?? []) {
        drawSplashCell(
          ctx,
          ox + (c % s.w) * TILE + TILE / 2,
          oy + Math.floor(c / s.w) * TILE + TILE / 2,
          sp.age,
          CONFIG.splashLingerTicks,
          app.settings.colorblind,
        );
      }
    }
    // exposed powerups
    for (const e of s.exposed) {
      drawPowerupIcon(ctx, e.type, ox + e.x * TILE + TILE / 2, oy + e.y * TILE + TILE / 2, time);
    }
    // balloons — fuse rendered from server tick timestamps
    const ticksSinceSnap = ((Date.now() - s.snapTime) / TICK_MS) | 0;
    for (const b of s.balloons) {
      const fuseNow = Math.max(0, b.fuse - ticksSinceSnap);
      const bx = b.sliding ? b.x + b.dx * b.progress : b.x;
      const by = b.sliding ? b.y + b.dy * b.progress : b.y;
      drawBalloon(ctx, ox + bx * TILE + TILE / 2, oy + by * TILE + TILE / 2, fuseNow, time);
    }
    // players
    const wf = (Math.floor(time / 160) % 2 === 0 ? 0 : 1) as 0 | 1;
    for (const [id, info] of s.entities) {
      let px: number;
      let py: number;
      if (id === s.yourEntityId) {
        px = s.predictor.localX;
        py = s.predictor.localY;
      } else {
        const pos = s.predictor.remotePos(id);
        if (!pos) continue;
        px = pos.x;
        py = pos.y;
      }
      const soaked = s.alive[id] === false;
      drawAnimal(ctx, info.animal, info.hat, ox + px * TILE - TILE / 2, oy + py * TILE - TILE / 2 - 4, 2, wf, soaked);
      // name tag
      ctx.fillStyle = soaked ? "#7b8bbd" : "#f4f4f4";
      ctx.font = "6px monospace";
      const short = info.nickname.split("#")[0]!.slice(0, 8);
      ctx.fillText(short, ox + px * TILE - short.length * 1.75, oy + py * TILE - 12);
      // emote bubble
      const em = s.emotes.get(id);
      if (em && time < em.until) {
        const label = ["QUACK!", "RIBBIT!", "SQUEAK!", "HONK!"][em.id - 1]!;
        ctx.fillStyle = "#f4f4f4";
        ctx.fillRect(ox + px * TILE - 12, oy + py * TILE - 26, label.length * 4 + 6, 10);
        ctx.fillStyle = "#0b0d1a";
        ctx.font = "6px monospace";
        ctx.fillText(label, ox + px * TILE - 9, oy + py * TILE - 19);
      }
    }
    s.particles.draw(ctx, 1);
    ctx.restore();
  };

  raf = requestAnimationFrame(frame);

  // ---------- network messages ----------

  offNet = net.on((msg) => {
    const s = session;
    if (!s) return;
    switch (msg.t) {
      case "round_start":
        handleRoundStart(s, msg);
        break;
      case "snapshot":
        handleSnapshot(s, msg);
        break;
      case "event":
        handleEvent(s, msg);
        break;
      case "round_end":
        handleRoundEnd(s, msg);
        break;
      case "match_end":
        handleMatchEnd(s, msg);
        break;
      case "emote_event": {
        s.emotes.set(msg.entityId, { id: msg.id, until: Date.now() + 1500 });
        audio.emote(msg.id);
        break;
      }
      default:
        break;
    }
  });

  // cleanup registry for leaveGame
  cleanups.push(() => {
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
  });
}

const cleanups: Array<() => void> = [];

export function leaveGame(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (offNet) {
    offNet();
    offNet = null;
  }
  for (const fn of cleanups.splice(0)) fn();
  session = null;
  app.hud.innerHTML = "";
}

// ---------- handlers ----------

function handleRoundStart(s: GameSession, msg: RoundStartMsg): void {
  s.grid = Uint8Array.from(msg.castleGrid);
  s.w = msg.w;
  s.h = msg.h;
  s.roundNo = msg.roundNo;
  s.scores = { ...msg.scores };
  s.tideRing = -1;
  s.splashes = [];
  s.exposed = [];
  s.particles.clear();
  const me = msg.spawns.find((sp) => sp.entityId === s.yourEntityId);
  if (me) s.predictor.setLocal(me.x, me.y);
  announce(`ROUND ${msg.roundNo}`);
  setTimeout(() => announce("3… 2… 1… SPLASH!"), 900);
  renderPlayerCards();
}

function handleSnapshot(s: GameSession, msg: SnapshotMsg): void {
  s.snapTick = msg.snapshot.tick;
  s.snapTime = Date.now();
  s.balloons = msg.snapshot.balloons;
  s.splashes = msg.snapshot.splashes.map((x) => ({ ...x }));
  s.exposed = msg.snapshot.exposed;
  s.tideRing = msg.snapshot.tideRing;
  for (const p of msg.snapshot.players) {
    s.alive[p.id] = p.alive;
    s.stats[p.id] = p.stats;
  }
  s.predictor.reconcile(msg.snapshot, s.yourEntityId);
  updatePlayerCards(s);
}

function handleEvent(s: GameSession, msg: SimEventMsg): void {
  const ev = msg.event;
  const feed = app.hud.querySelector(".feed")!;
  switch (ev.type) {
    case "chain_burst": {
      if ((ev.chain ?? 0) >= 1) {
        const n = ev.chain ?? 1;
        announce(`${["DOUBLE", "TRIPLE", "QUAD", "MEGA"][Math.min(3, n - 1)]!} SPLASH${n > 3 ? "+" : ""}!`);
        audio.chain(n);
      } else {
        audio.burst();
      }
      s.shake = 4;
      break;
    }
    case "player_soaked": {
      audio.sploosh();
      s.hitStopUntil = Date.now() + CONFIG.hitStopTicks * TICK_MS;
      s.shake = 6;
      const victim = s.entities.get(ev.target ?? "")?.nickname ?? "?";
      const by = ev.by ? (s.entities.get(ev.by)?.nickname ?? "?") : "the tide";
      const div = document.createElement("div");
      div.textContent = `💧 ${by} soaked ${victim}${"revenge" in ev && ev.revenge ? " (revenge!)" : ""}`;
      feed.appendChild(div);
      setTimeout(() => div.remove(), 5000);
      while (feed.children.length > 5) feed.firstChild?.remove();
      if (ev.target === s.yourEntityId) audio.defeat();
      break;
    }
    case "powerup_collected":
      if (ev.target === s.yourEntityId) audio.pickup();
      updatePlayerCards(s);
      break;
    case "tide_advance":
      if (ev.tile === 0 || ev.tile === 1) {
        audio.tideAlarm();
        announce("RISING TIDE!");
      }
      break;
    case "revenge_lob":
      audio.drop();
      break;
    default:
      break;
  }
}

function handleRoundEnd(s: GameSession, msg: RoundEndMsg): void {
  s.scores = { ...msg.scores };
  const names = msg.winners.map((w) => s.entities.get(w)?.nickname.split("#")[0] ?? "?");
  announce(names.length ? `${names.join(" & ")} WINS THE ROUND!` : "DRAW ROUND!");
  renderScoreLine();
}

function handleMatchEnd(s: GameSession, msg: MatchEndMsg): void {
  s.matchOver = true;
  audio.stopMusic();
  const iWon = msg.placements.find((p) => p.entityId === s.yourEntityId)?.placement === 1;
  if (iWon) audio.victory();
  else audio.defeat();

  const panel = document.createElement("div");
  panel.className = "screen";
  panel.style.background = "rgba(11,13,26,.92)";
  const rows = [...msg.placements]
    .sort((a, b) => a.placement - b.placement)
    .map((p) => {
      const delta = p.playerId ? msg.ratingDeltas[p.playerId] : undefined;
      const xp = msg.xp[p.entityId] ?? 0;
      return `<tr><td>#${p.placement}</td><td>${p.nickname}</td><td>${p.roundsWon} rounds</td><td>${p.soaks} soaks</td><td>+${xp} XP${delta ? ` · ${delta.before}→${delta.after}` : ""}${myDelta && p.playerId === app.playerId ? ` (<span class="badge">${myDelta.tier}</span>)` : ""}</td></tr>`;
    })
    .join("");
  const fun = (label: string, entityId?: string): string =>
    `${label}: <b>${entityId ? (s.entities.get(entityId)?.nickname ?? "?") : "—"}</b>`;
  const myPlacement = msg.placements.find((p) => p.entityId === s.yourEntityId);
  const myDeltaInfo = app.playerId ? msg.ratingDeltas[app.playerId] : undefined;
  const myDelta = myDeltaInfo ? { ...myDeltaInfo, delta: myDeltaInfo.after - myDeltaInfo.before } : undefined;
  const levelUp = app.playerId ? msg.levelUps[app.playerId] : undefined;
  panel.innerHTML = `
    <h2>${iWon ? "VICTORY!" : "MATCH OVER"} ${myDelta ? `<span class="badge">${myDelta.after} ${myDelta.delta >= 0 ? "+" : ""}${myDelta.delta}</span>` : ""}</h2>
    ${levelUp ? `<div class="subtitle">LEVEL UP! ${levelUp.from} → ${levelUp.to}</div>` : ""}
    <div class="panel" style="min-width:520px">
      <table><thead><tr><th></th><th>Player</th><th>Rounds</th><th>Soaks</th><th>XP</th></tr></thead><tbody>${rows}</tbody></table>
      <hr style="border-color:var(--panel);margin:8px 0">
      <div class="muted">
        ${fun("Most Soaks", msg.funStats.mostSoaks)} ·
        ${fun("Castle Crusher", msg.funStats.castleCrusher)} ·
        ${fun("Longest Survivor", msg.funStats.longestSurvivor)} ·
        ${fun("Biggest Chain", msg.funStats.biggestChain)}
      </div>
    </div>
    <div class="row">
      ${s.ranked ? "" : `<button class="primary" id="rematchBtn">Rematch (vote)</button>`}
      <button id="continueBtn">Continue</button>
    </div>
    <div class="muted" id="rematchInfo"></div>
  `;
  app.hud.appendChild(panel);

  panel.querySelector("#continueBtn")!.addEventListener("click", () => {
    net.send({ t: "leave_room" });
    location.hash = "#/menu";
  });
  const rematchBtn = panel.querySelector("#rematchBtn");
  rematchBtn?.addEventListener("click", () => {
    net.send({ t: "rematch_vote" });
    (rematchBtn as HTMLButtonElement).disabled = true;
  });

  const offRematch = net.on((m) => {
    if (m.t === "rematch_state") {
      const info = panel.querySelector("#rematchInfo");
      if (info) info.textContent = `${m.votes.length}/${m.needed} voted for rematch`;
    }
  });
  cleanups.push(offRematch);
}

// ---------- HUD helpers ----------

function announce(text: string): void {
  const el = app.hud.querySelector(".announce")!;
  el.textContent = text;
  el.animate(
    [
      { transform: "translate(-50%,-50%) scale(.6)", opacity: 0 },
      { transform: "translate(-50%,-50%) scale(1.15)", opacity: 1 },
      { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
      { transform: "translate(-50%,-50%) scale(1)", opacity: 0 },
    ],
    { duration: 1800 },
  );
}

function renderScoreLine(): void {
  const s = session;
  if (!s) return;
  const timer = app.hud.querySelector(".timer")!;
  const parts = [...s.entities.values()].map(
    (e) => `${e.nickname.split("#")[0]}: ${s.scores[e.id] ?? 0}`,
  );
  timer.textContent = parts.join(" · ");
}

function renderPlayerCards(): void {
  const wrap = app.hud.querySelector(".players")!;
  wrap.innerHTML = "";
}

function updatePlayerCards(s: GameSession): void {
  const wrap = app.hud.querySelector(".players")!;
  wrap.innerHTML = "";
  for (const [id, info] of s.entities) {
    const st = s.stats[id] ?? { speed: 0, balloons: 0, range: 0 };
    const card = document.createElement("div");
    card.className = "pcard";
    card.style.outline = id === s.yourEntityId ? "2px solid var(--accent)" : "";
    card.innerHTML = `${info.nickname.split("#")[0]}<br><span class="muted">💨${st.speed.toFixed(1)} 🎈${st.balloons} 💦${st.range}${s.alive[id] === false ? " · SOAKED" : ""}</span>`;
    wrap.appendChild(card);
  }
}

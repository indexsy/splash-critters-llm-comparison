import { CONFIG, TICK_MS, createSimState, simulateTick, defaultMatchConfig } from "@sc/shared";
import type { SimPlayerInput, SimState } from "@sc/shared";
import type { App } from "../main";
import { audio } from "../audio";
import { drawAnimal, drawBalloon, drawSplashCell, drawPowerupIcon } from "../render/sprites";
import { TILE_BOULDER, TILE_CASTLE, TILE_FLOODED } from "@sc/shared";

const STEPS = [
  "Move with WASD / arrows",
  "Drop a balloon near a sandcastle (Space) — then RUN!",
  "Grab a power-up revealed by your splash",
  "Chain two balloons: drop one, run around it, drop another in its splash path",
  "Soak the bot to win! (last critter dry wins)",
];

export function showTutorial(app: App): () => void {
  const el = document.createElement("div");
  el.className = "screen";
  el.innerHTML = `
    <h2>TUTORIAL</h2>
    <div class="panel" style="max-width:560px">
      <div id="objective" style="font-size:15px;color:var(--accent)">✔ done</div>
      <ol id="steps" style="text-align:left;font-size:13px;margin:10px 0"></ol>
      <canvas id="tut" width="208" height="176" style="image-rendering:pixelated;width:416px;height:352px;border:3px solid var(--ink)"></canvas>
      <div class="row" style="margin-top:10px">
        <button class="small" id="skipBtn">Skip</button>
        <button class="small primary hidden" id="doneBtn">Finish (+XP)</button>
      </div>
    </div>
  `;
  app.screens.appendChild(el);
  audio.stopMusic();

  const ol = el.querySelector("#steps")!;
  STEPS.forEach((s, i) => {
    const li = document.createElement("li");
    li.textContent = s;
    li.id = `step${i}`;
    li.style.color = "#7b8bbd";
    ol.appendChild(li);
  });
  const markDone = (i: number): void => {
    const li = el.querySelector(`#step${i}`);
    if (li && li.getAttribute("data-done") !== "1") {
      li.setAttribute("data-done", "1");
      (li as HTMLElement).style.color = "var(--ok)";
      (el.querySelector("#objective")!).textContent = `✔ ${STEPS[i]}`;
      audio.pickup();
    }
  };

  // --- local sim vs easy bot ---
  const config = defaultMatchConfig("duel", {
    mapSeed: 20260214,
    theme: "backyard",
    roundsToWin: 1,
    enableRevengeDucks: false,
  });
  config.w = 13;
  config.h = 11;
  const state: SimState = createSimState(config, ["you", "bot"]);
  state.players[1]!.speed = CONFIG.speedBase * 0.8; // gentle bot
  let botDir = { x: 0, y: 0 };
  let botTimer = 0;

  const cv = el.querySelector("#tut") as HTMLCanvasElement;
  const ctx = cv.getContext("2d")!;
  const SCALE = 16;
  const keys = new Set<string>();
  const kd = (e: KeyboardEvent): void => {
    keys.add(e.key.toLowerCase());
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
  };
  const ku = (e: KeyboardEvent): void => {
    keys.delete(e.key.toLowerCase());
  };
  window.addEventListener("keydown", kd);
  window.addEventListener("keyup", ku);

  let droppedOnce = false;
  let powerupSeen = false;
  let chainSeen = false;
  let wonRound = false;
  let step = 0;
  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let prevPressed = false;

  const inputFor = (): SimPlayerInput => {
    let dx = 0;
    let dy = 0;
    if (keys.has("a") || keys.has("arrowleft")) dx -= 1;
    if (keys.has("d") || keys.has("arrowright")) dx += 1;
    if (keys.has("w") || keys.has("arrowup")) dy -= 1;
    if (keys.has("s") || keys.has("arrowdown")) dy += 1;
    const pressed = keys.has(" ");
    const inp: SimPlayerInput = { seq: 0, tick: state.tick, dirX: dx, dirY: dy, balloonPressed: pressed && !prevPressed };
    prevPressed = pressed;
    return inp;
  };

  const tickSim = (): void => {
    // trivial bot wander
    if (--botTimer <= 0) {
      botTimer = 60;
      botDir = { x: [-1, 1][Math.floor(Math.random() * 2)]!, y: 0 };
      if (Math.random() < 0.3) botDir = { x: 0, y: [-1, 1][Math.floor(Math.random() * 2)]! };
    }
    const events = simulateTick(state, {
      you: inputFor(),
      bot: { seq: 0, tick: state.tick, dirX: botDir.x, dirY: botDir.y, balloonPressed: Math.random() < 0.01 },
    });
    for (const ev of events) {
      if (ev.type === "castle_washed" && ev.by === "you") {
        droppedOnce = true;
        markDone(1);
      }
      if (ev.type === "powerup_revealed") powerupSeen = true;
      if (ev.type === "powerup_collected" && ev.target === "you") markDone(2);
      if (ev.type === "chain_burst" && (ev.chain ?? 0) >= 1) {
        chainSeen = true;
        markDone(3);
      }
      if (ev.type === "player_soaked" && ev.target === "bot") {
        wonRound = true;
        markDone(4);
        audio.victory();
        el.querySelector("#doneBtn")!.classList.remove("hidden");
      }
      if (ev.type === "player_soaked" && ev.target === "you") audio.sploosh();
    }
    if (droppedOnce && step < 1) {
      step = 1;
      markDone(0);
    }
  };

  const draw = (): void => {
    ctx.fillStyle = "#3e8948"; // backyard grass
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let y = 0; y < config.h; y++) {
      for (let x = 0; x < config.w; x++) {
        const t = state.grid[y * config.w + x]!;
        const px = x * SCALE;
        const py = y * SCALE;
        if (t === TILE_BOULDER) {
          ctx.fillStyle = "#5a6988";
          ctx.fillRect(px + 1, py + 1, SCALE - 2, SCALE - 2);
          ctx.fillStyle = "#7b8bbd";
          ctx.fillRect(px + 3, py + 3, SCALE - 8, SCALE - 8);
        } else if (t === TILE_CASTLE) {
          ctx.fillStyle = "#e08c3a";
          ctx.fillRect(px + 1, py + 1, SCALE - 2, SCALE - 2);
          ctx.fillStyle = "#ffcd75";
          ctx.fillRect(px + 3, py + 3, 3, 3);
          ctx.fillRect(px + SCALE - 7, py + 3, 3, 3);
          ctx.fillRect(px + 6, py + SCALE - 7, 4, 4);
        } else if (t === TILE_FLOODED) {
          ctx.fillStyle = "#41a6f6";
          ctx.fillRect(px, py, SCALE, SCALE);
        }
      }
    }
    const time = performance.now();
    for (const sp of state.splashes) {
      for (const c of sp.cells) {
        drawSplashCell(ctx, (c % config.w) * SCALE + SCALE / 2, Math.floor(c / config.w) * SCALE + SCALE / 2, sp.age, CONFIG.splashLingerTicks, app.settings.colorblind);
      }
    }
    for (const b of state.balloons) drawBalloon(ctx, b.x * SCALE + SCALE / 2, b.y * SCALE + SCALE / 2, b.fuse, time);
    for (const e of state.exposed) drawPowerupIcon(ctx, e.type, e.x * SCALE + SCALE / 2, e.y * SCALE + SCALE / 2, time);
    const wf = Math.floor(time / 160) % 2 === 0 ? 0 : 1;
    for (const p of state.players) {
      drawAnimal(
        ctx,
        p.id === "you" ? app.profile?.selectedAnimal ?? "frog" : "duck",
        null,
        p.x * SCALE - SCALE / 2,
        p.y * SCALE - SCALE / 2 - 4,
        2,
        wf as 0 | 1,
        !p.alive,
      );
    }
  };

  const loop = (now: number): void => {
    acc += now - last;
    last = now;
    while (acc >= TICK_MS) {
      acc -= TICK_MS;
      if (!wonRound) tickSim();
    }
    draw();
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  const finish = (): void => {
    app.navigate("#/menu");
  };
  el.querySelector("#skipBtn")!.addEventListener("click", finish);
  el.querySelector("#doneBtn")!.addEventListener("click", finish);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("keydown", kd);
    window.removeEventListener("keyup", ku);
  };
}

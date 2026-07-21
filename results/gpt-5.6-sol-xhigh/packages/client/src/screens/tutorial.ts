import { CONFIG, createGameState, simulateTick, type Direction, type GameState, type SimEvent } from "@splash/shared";
import type { AppCtx, Screen, ScreenHandle, ScreenParams } from "../main.js";
import { HUD_H, STAGE_W, paletteFor, renderArena, renderBalloons, renderPlayers, renderPowerups, renderSplashes } from "../render/sprites.js";
import { el } from "../ui.js";
import { markTutorialDone } from "./state.js";

interface Step {
  index: number;
  title: string;
  hint: string;
  done: boolean;
}

const STEPS: Omit<Step, "done">[] = [
  { index: 0, title: "STEP 1 · MOVE", hint: "WASD or ARROWS to wade around." },
  { index: 1, title: "STEP 2 · DROP A BALLOON", hint: "PRESS SPACE to plant a water balloon." },
  { index: 2, title: "STEP 3 · STAY BACK", hint: "Back away — the splash will soak you!" },
  { index: 3, title: "STEP 4 · WASH A CASTLE", hint: "Burst a balloon next to a sand castle." },
  { index: 4, title: "GRADUATE", hint: "All done — head to the menu!" }
];

export function createTutorialScreen(): Screen {
  return {
    id: "tutorial",
    mount(ctx: AppCtx, params: ScreenParams): ScreenHandle {
      const audio = ctx.audio;
      const next = (params["next"] as ScreenId | undefined) ?? "menu";
      const seed = 1234 + Math.floor(Math.random() * 99);
      const state = createGameState(seed, "duel", [
        { id: "you", name: "YOU", animal: "frog", hat: "bucket" },
        { id: "towel", name: "MR.TOWELS", animal: "otter", hat: "bandana" }
      ], false);
      void CONFIG;
      const steps: Step[] = STEPS.map((s) => ({ ...s, done: false }));
      let stepIdx = 0;

      const keys = new Set<string>();
      let tickAcc = 0;
      let lastT = performance.now();
      let lastBalloonAt = -1;
      let movedTiles = 0;
      let lastTileX = state.players[0]?.x ?? 0;
      let lastTileY = state.players[0]?.y ?? 0;

      const titleEl = el("div", { class: ["sc-title"], text: steps[0]!.title });
      const hintEl = el("div", { class: ["sc-sub"], text: steps[0]!.hint });
      const progressEl = el("div", { class: ["sc-row"], style: { gap: "4px" } });
      const dots = STEPS.map(() => el("span", { class: ["sc-tag"], text: "·", style: { background: "#3f7be0", color: "#0a2549", padding: "2px 5px" } }));
      dots.forEach((d) => progressEl.append(d));

      const nextBtn = el("button", { class: ["sc-btn", "mint", "block"], text: "CONTINUE", attrs: { disabled: "true" } });
      nextBtn.addEventListener("click", () => {
        audio.play("confirm");
        ctx.net.send({ type: "tutorial_complete" });
        markTutorialDone();
        ctx.go(next);
      });
      (nextBtn as HTMLButtonElement).disabled = true;

      const skipBtn = el("button", { class: ["sc-btn", "ghost", "tiny"], text: "SKIP" });
      skipBtn.addEventListener("click", () => {
        audio.play("back");
        ctx.net.send({ type: "tutorial_complete" });
        markTutorialDone();
        ctx.go(next);
      });

      const card = el("div", { class: ["sc-card", "wide"], style: { background: "transparent", border: "none", boxShadow: "none", padding: "0", maxWidth: "640px", width: "100%" } }, [
        el("div", { class: ["sc-card"], style: { background: "rgba(6,18,42,0.78)" } }, [
          titleEl,
          hintEl,
          progressEl,
          el("div", { class: ["sc-row"], style: { marginTop: "8px", justifyContent: "space-between", alignItems: "center" } }, [
            skipBtn,
            nextBtn
          ])
        ])
      ]);
      const root = el("div", { class: ["sc-stack"], style: { alignItems: "center", justifyContent: "flex-start", paddingTop: "10px", width: "100%" } }, [card]);

      function refreshUI(): void {
        titleEl.textContent = steps[stepIdx]?.title ?? "DONE";
        hintEl.textContent = steps[stepIdx]?.hint ?? "";
        dots.forEach((d, i) => {
          d.textContent = steps[i]?.done ? "✓" : "·";
          d.style.background = steps[i]?.done ? "#66e08f" : "#3f7be0";
        });
        const allDone = steps.every((s) => s.done);
        (nextBtn as HTMLButtonElement).disabled = !allDone;
      }

      function advance(toIdx: number): void {
        if (toIdx <= stepIdx) return;
        stepIdx = toIdx;
        for (let i = 0; i < stepIdx; i++) steps[i]!.done = true;
        audio.play("confirm");
        ctx.toast(`✓ ${STEPS[stepIdx - 1]?.title ?? ""}`);
        refreshUI();
      }

      function applyEvents(events: SimEvent[], localTick: number): void {
        for (const e of events) {
          if (e.type === "balloon_dropped" && e.balloon.ownerId === "you" && !steps[1]!.done) {
            lastBalloonAt = localTick;
            advance(2);
          }
          if (e.type === "castle_washed" && !steps[3]!.done && lastBalloonAt >= 0) {
            steps[3]!.done = true;
            advance(4);
          }
        }
      }

      function tick(): void {
        const local = state.players[0]!;
        const beforeX = Math.floor(local.x);
        const beforeY = Math.floor(local.y);
        const dir: Direction = keys.has("W") || keys.has("ArrowUp") ? "up"
          : keys.has("S") || keys.has("ArrowDown") ? "down"
          : keys.has("A") || keys.has("ArrowLeft") ? "left"
          : keys.has("D") || keys.has("ArrowRight") ? "right"
          : "none";
        const balloonPressed = keys.has("Space");
        const res = simulateTick(state, [{
          playerId: "you",
          seq: state.tick + 1,
          tick: state.tick + 1,
          dir,
          balloonPressed,
          ...(false ? { revengePressed: true } : {})
        }]);
        applyEvents(res.events, state.tick);
        const afterX = Math.floor(local.x);
        const afterY = Math.floor(local.y);
        if (beforeX !== afterX || beforeY !== afterY) {
          movedTiles++;
          if (!steps[0]!.done && movedTiles >= 3) { steps[0]!.done = true; advance(1); }
        }
        void lastTileX; void lastTileY;
        lastTileX = afterX; lastTileY = afterY;
      }

      const handle: ScreenHandle = {
        root,
        onTick(dt) {
          tickAcc += dt;
          while (tickAcc >= 1 / CONFIG.TICK_RATE) {
            tickAcc -= 1 / CONFIG.TICK_RATE;
            tick();
          }
          void lastT;
        },
        onRender(rc) {
          const { ctx: c, t } = rc;
          renderTutorial(c, state, t);
        },
        onKey(ev, down) {
          const k = ev.key;
          if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(k)) ev.preventDefault();
          if (down) keys.add(k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k);
          else keys.delete(k === " " ? "Space" : k.length === 1 ? k.toUpperCase() : k);
          if (down && ev.key === "Enter" && steps.every((s) => s.done)) {
            audio.play("confirm");
            ctx.net.send({ type: "tutorial_complete" });
            markTutorialDone();
            ctx.go(next);
            return true;
          }
          if (down && ev.key === "Escape") {
            audio.play("back");
            markTutorialDone();
            ctx.go(next);
            return true;
          }
          return true;
        },
        unmount() { /* nothing */ }
      };
      refreshUI();
      return handle;
    }
  };
}

type ScreenId = "title" | "tutorial" | "menu" | "browser" | "lobby" | "queue" | "game" | "results" | "leaderboard" | "locker" | "settings";

function renderTutorial(c: CanvasRenderingContext2D, state: GameState, t: number): void {
  const pal = paletteFor("backyard");
  const playH = 224 - HUD_H;
  const tile = Math.floor(Math.min(STAGE_W / state.map.width, playH / state.map.height));
  const arenaW = tile * state.map.width;
  const arenaH = tile * state.map.height;
  const offX = Math.floor((STAGE_W - arenaW) / 2);
  const offY = HUD_H + Math.floor((playH - arenaH) / 2);

  c.fillStyle = pal.skyTop;
  c.fillRect(0, 0, STAGE_W, 224);
  c.fillStyle = "rgba(6,18,42,0.85)";
  c.fillRect(0, 0, STAGE_W, HUD_H);
  c.font = "bold 8px 'Courier New', monospace";
  c.fillStyle = "#ffd83d";
  c.fillText("PRACTICE ARENA", 4, 4);
  c.fillStyle = "#7ee4ff";
  c.fillText("WASD · SPACE", 4, 14);

  renderArena(c, state.map.tiles, state.map.width, state.map.height, tile, offX, offY, pal, state.tideRing, t);
  renderSplashes(c, state.splashes, tile, offX, offY, state.tick, t);
  renderPowerups(c, state.powerups, tile, offX, offY, t);
  renderBalloons(c, state.balloons, tile, offX, offY, t, state.tick);
  renderPlayers(c, state.players, tile, offX, offY, t, "you", 0, state.tick);
}

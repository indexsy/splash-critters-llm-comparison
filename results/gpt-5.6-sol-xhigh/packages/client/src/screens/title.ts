import type { AppCtx, Screen, ScreenHandle, ScreenParams } from "../main.js";
import { el } from "../ui.js";
import { STAGE_W, STAGE_H, drawAnimalTiny } from "../render/sprites.js";
import { ANIMAL_LIST, HAT_LIST } from "../ui.js";
import { isTutorialDone } from "./state.js";

export function createTitleScreen(): Screen {
  return {
    id: "title",
    mount(ctx: AppCtx, _params: ScreenParams): ScreenHandle {
      const audio = ctx.audio;
      const root = el("div", { class: ["sc-stack"], style: { alignItems: "center", gap: "14px" } });

      const startBtn = el("button", { class: ["sc-btn", "big", "block"], text: "PRESS START" });
      startBtn.addEventListener("click", () => {
        audio.play("confirm");
        if (!isTutorialDone()) ctx.go("tutorial", { next: "menu" });
        else ctx.go("menu");
      });

      const howBtn = el("button", { class: ["sc-btn", "ghost", "block"], text: "HOW TO PLAY" });
      howBtn.addEventListener("click", () => { audio.play("tab"); ctx.go("tutorial", { next: "menu" }); });

      const settingsBtn = el("button", { class: ["sc-btn", "ghost", "tiny"], text: "SETTINGS" });
      settingsBtn.addEventListener("click", () => { audio.play("tab"); ctx.go("settings", { back: "title" }); });

      const footer = el("div", { class: ["sc-row"], style: { justifyContent: "center", marginTop: "6px" } }, [
        settingsBtn,
        el("span", { class: ["sc-tiny", "sc-muted"], text: "v1.0 · MADE WITH WATER" })
      ]);

      const card = el("div", { class: ["sc-card"], style: { background: "transparent", boxShadow: "none", border: "none", padding: "0", textAlign: "center" } }, [
        startBtn,
        el("div", { style: { height: "8px" } }),
        howBtn,
        footer
      ]);
      root.append(card);

      const mascots = ANIMAL_LIST.map((a, i) => ({ animal: a, hat: HAT_LIST[(i + 1) % HAT_LIST.length]!, phase: i * 0.6 }));

      const handle: ScreenHandle = {
        root,
        onTick() { /* ambient */ },
        onRender(rc) {
          const { ctx: c, t } = rc;
          const ts = t / 1000;
          drawTitleLogo(c, ts);
          for (let i = 0; i < mascots.length; i++) {
            const m = mascots[i]!;
            const baseX = 28 + i * 26;
            const bob = Math.sin(ts * 2 + m.phase) * 3;
            drawAnimalTiny(c, baseX, 160 + bob, 1.4, m, ts * 1000);
          }
          c.font = "bold 8px 'Courier New', monospace";
          c.fillStyle = "rgba(6,18,42,0.6)";
          c.fillRect(0, STAGE_H - 16, STAGE_W, 16);
          c.fillStyle = "#ffd83d";
          c.textAlign = "center";
          c.fillText("WASD MOVE  ·  SPACE BALLOON  ·  E REVENGE", STAGE_W / 2, STAGE_H - 12);
          c.fillText("© SPLASH CRITTERS — STAY DRY", STAGE_W / 2, STAGE_H - 4);
          c.textAlign = "left";
        },
        onKey(ev, down) {
          if (down && (ev.key === "Enter" || ev.key === " ")) {
            audio.play("confirm");
            if (!isTutorialDone()) ctx.go("tutorial", { next: "menu" });
            else ctx.go("menu");
            return true;
          }
          return false;
        },
        unmount() { /* nothing */ }
      };
      return handle;
    }
  };
}

function drawTitleLogo(c: CanvasRenderingContext2D, t: number): void {
  const cx = STAGE_W / 2;
  const cy = 70 + Math.sin(t * 1.2) * 2;
  c.save();
  c.translate(cx, cy);
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = "bold 26px 'Courier New', monospace";
  c.fillStyle = "#0a2549";
  for (let i = 4; i > 0; i--) {
    c.fillText("SPLASH", i, i);
  }
  c.fillStyle = "#ff4fa3";
  c.fillText("SPLASH", 2, 2);
  c.fillStyle = "#ffd83d";
  c.fillText("SPLASH", 0, 0);
  c.font = "bold 22px 'Courier New', monospace";
  c.fillStyle = "#0a2549";
  c.fillText("CRITTERS", 3, 30);
  c.fillStyle = "#7ee4ff";
  c.fillText("CRITTERS", 1, 29);
  c.fillStyle = "#f4faff";
  c.fillText("CRITTERS", 0, 28);
  for (let i = 0; i < 3; i++) {
    const dropX = -60 + i * 60 + Math.sin(t * 2 + i) * 4;
    const dropY = -30 + (t * 30 + i * 20) % 100;
    c.fillStyle = ["#7ee4ff", "#ffd83d", "#ff4fa3"][i]!;
    c.globalAlpha = 0.6;
    c.fillRect(Math.round(dropX), Math.round(dropY), 3, 4);
    c.globalAlpha = 1;
  }
  c.restore();
  c.fillStyle = "#0a2549";
  c.fillRect(60, 130, STAGE_W - 120, 2);
  c.fillStyle = "#ffd83d";
  c.fillRect(60, 128, STAGE_W - 120, 1);
}

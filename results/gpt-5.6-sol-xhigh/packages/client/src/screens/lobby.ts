import type { Difficulty, LobbyView, LobbySlot } from "@splash/shared";
import type { AppCtx, Screen, ScreenHandle, ScreenParams } from "../main.js";
import { ANIMAL_LIST, button, el, panel } from "../ui.js";
import { drawAnimalTiny } from "../render/sprites.js";

export function createLobbyScreen(): Screen {
  return {
    id: "lobby",
    mount(ctx: AppCtx, _params: ScreenParams): ScreenHandle {
      const audio = ctx.audio;
      const { root, body } = panel("LOBBY", "WAITING FOR PLAYERS", true);

      const header = el("div", { class: ["sc-row", "between"] });
      const slotsHost = el("div", { class: ["sc-slots"] });
      const actions = el("div", { class: ["sc-btn-row", "between"] });
      body.append(header, el("div", { class: ["sc-divider"] }), slotsHost, el("div", { class: ["sc-divider"] }), actions);

      let lobby: LobbyView | null = null;
      let ready = false;

      const codeEl = el("span", { class: ["sc-tag", "host"], text: "----" });
      const modeTag = el("span", { class: ["sc-tag", "casual"], text: "—" });

      const backBtn = button("LEAVE", () => {
        ctx.net.send({ type: "leave_room" });
        audio.play("back");
        ctx.go("menu");
      }, { variant: "ghost", size: "tiny" });
      header.replaceChildren(
        el("div", { class: ["sc-row"], style: { gap: "8px", alignItems: "center" } }, [
          codeEl,
          modeTag,
          el("span", { class: ["sc-muted", "sc-tiny"], text: "SHARE THE CODE" })
        ]),
        backBtn
      );

      const readyBtn = button("READY UP", () => {
        ready = !ready;
        ctx.net.send({ type: "set_ready", ready });
        audio.play("tab");
      }, { variant: "mint" });

      const startBtn = button("START MATCH", () => {
        ctx.net.send({ type: "start_match" });
        audio.play("confirm");
      }, { variant: "pink", size: "big" });

      actions.replaceChildren(readyBtn, startBtn);

      function refresh(): void {
        if (!lobby) return;
        const me = ctx.profile();
        const host = !!me && lobby.hostId === me.id;
        codeEl.textContent = lobby.code;
        modeTag.textContent = `${lobby.opts.size === 2 ? "DUEL" : "FFA"} · ${lobby.opts.theme.toUpperCase()}`;
        slotsHost.replaceChildren();
        for (const slot of lobby.slots) {
          slotsHost.append(renderSlot(ctx, slot, host, () => refresh()));
        }
        readyBtn.textContent = ready ? "NOT READY" : "READY UP";
        readyBtn.classList.toggle("mint", !ready);
        readyBtn.classList.toggle("ghost", ready);
        startBtn.disabled = !host;
        startBtn.style.opacity = host ? "1" : "0.4";
        startBtn.textContent = host ? `START MATCH (${lobby.rematchVotes}/${lobby.slots.length})` : "HOST ONLY";
      }

      const off = ctx.net.add({
        onLobby: (l) => {
          lobby = l;
          if (l.phase === "playing") { ctx.go("game", { lobby: l }); return; }
          if (l.phase === "results") { ctx.go("results", { lobby: l }); return; }
          refresh();
        },
        onMessage: (msg) => {
          if (msg.type === "match_start") {
            ctx.go("game", { match_start: msg.config, lobby });
          }
        }
      });

      const handle: ScreenHandle = {
        root,
        onKey(ev, down) {
          if (down && ev.key === "r".toLowerCase() || down && ev.key === "R") {
            ready = !ready;
            ctx.net.send({ type: "set_ready", ready });
            return true;
          }
          if (down && ev.key === "Escape") {
            ctx.net.send({ type: "leave_room" });
            ctx.go("menu");
            return true;
          }
          return false;
        },
        unmount() { off(); }
      };

      window.setTimeout(refresh, 0);
      return handle;
    }
  };
}

function renderSlot(ctx: AppCtx, slot: LobbySlot, isHost: boolean, onChange: () => void): HTMLElement {
  const root = el("div", { class: ["sc-slot", slot.kind === "empty" ? "empty" : slot.kind === "bot" ? "bot" : undefined] });
  const portraitCanvas = el("canvas", { attrs: { width: "32", height: "32" }, style: { width: "32px", height: "32px", background: "rgba(6,18,42,0.6)", borderRadius: "3px" } }) as HTMLCanvasElement;
  const pctx = portraitCanvas.getContext("2d");
  if (pctx) {
    pctx.imageSmoothingEnabled = false;
    pctx.clearRect(0, 0, 32, 32);
    const animal = slot.animal ?? ANIMAL_LIST[slot.index % ANIMAL_LIST.length]!;
    drawAnimalTiny(pctx, 16, 16, 1.4, { animal, hat: "none" }, performance.now());
  }
  root.append(portraitCanvas);

  if (slot.kind === "empty") {
    root.append(el("div", { class: ["sc-muted", "sc-small"], text: `SLOT ${slot.index + 1} · EMPTY` }));
    if (isHost) {
      const ctrl = el("div", { class: ["ctrls"] });
      ctrl.append(button("ADD BOT", () => {
        ctx.net.send({ type: "set_slot", slot: slot.index, kind: "bot", difficulty: "medium" });
        ctx.audio.play("tab");
        onChange();
      }, { variant: "ghost", size: "tiny" }));
      root.append(ctrl);
    }
    return root;
  }

  if (slot.kind === "bot") {
    root.append(
      el("div", { class: ["sc-stack"], style: { gap: "0" } }, [
        el("span", { class: ["name"], text: slot.name ?? "BOT" }),
        el("span", { class: ["sc-tag", "bot"], text: (slot.difficulty ?? "medium").toUpperCase() })
      ])
    );
    if (isHost) {
      const ctrl = el("div", { class: ["ctrls"] });
      const diffSel = el("select", { class: ["sc-select", "sc-tiny"] }) as HTMLSelectElement;
      for (const d of ["easy", "medium", "hard"] as Difficulty[]) {
        const o = el("option", { attrs: { value: d }, text: d.toUpperCase() }) as HTMLOptionElement;
        if (d === slot.difficulty) o.selected = true;
        diffSel.append(o);
      }
      diffSel.addEventListener("change", () => {
        ctx.net.send({ type: "set_slot", slot: slot.index, kind: "bot", difficulty: diffSel.value as Difficulty });
      });
      ctrl.append(diffSel);
      ctrl.append(button("REMOVE", () => {
        ctx.net.send({ type: "set_slot", slot: slot.index, kind: "empty" });
        ctx.audio.play("back");
        onChange();
      }, { variant: "ghost", size: "tiny" }));
      root.append(ctrl);
    }
    return root;
  }

  if (slot.index === 0) root.classList.add("host");
  root.append(
    el("div", { class: ["sc-stack"], style: { gap: "0" } }, [
      el("span", { class: ["name"], text: slot.name ?? "PLAYER" }),
      el("span", { class: ["ready", slot.ready ? "" : "no"], text: slot.ready ? "READY" : "NOT READY" })
    ])
  );
  return root;
}

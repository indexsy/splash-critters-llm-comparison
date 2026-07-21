import type { Mode } from "@splash/shared";
import { CONFIG, tierForRating } from "@splash/shared";
import type { AppCtx, Screen, ScreenHandle, ScreenParams } from "../main.js";
import { button, el, field, formatETA, panel, textInput, tierClass } from "../ui.js";

export function createQueueScreen(): Screen {
  return {
    id: "queue",
    mount(ctx: AppCtx, _params: ScreenParams): ScreenHandle {
      const audio = ctx.audio;
      const { root, body } = panel("RANKED QUEUE", "EARN RATING · CLIMB TIERS", true);

      let mode: Mode = "duel";
      let queued = false;

      const nickCard = el("div", { class: ["sc-card"], style: { background: "rgba(255,93,93,0.10)" } });
      body.append(nickCard);

      function refreshNick(): void {
        const p = ctx.profile();
        if (!p) {
          nickCard.replaceChildren(el("div", { class: ["sc-muted", "sc-small"], text: "CONNECTING…" }));
          return;
        }
        const hasNick = p.hasCustomNickname && p.nickname.trim().length > 0;
        const tier = tierForRating(1000);
        if (hasNick) {
          nickCard.replaceChildren(
            el("div", { class: ["sc-row", "between"] }, [
              el("div", { class: ["sc-stack"], style: { gap: "2px" } }, [
                el("span", { class: ["sc-tiny", "sc-dim"], text: "YOU" }),
                el("span", { class: ["sc-title"], text: `${p.nickname}#${p.tag}`, style: { fontSize: "14px" } }),
                el("div", { class: ["sc-row"], style: { gap: "6px", alignItems: "center" } }, [
                  el("span", { class: [tierClass(tier)], text: tier }),
                  el("span", { class: ["sc-muted", "sc-tiny"], text: "RANKED READY" })
                ])
              ]),
              button("EDIT NAME", () => { editNick(); }, { variant: "ghost", size: "tiny" })
            ])
          );
          return;
        }
        const input = textInput({ value: p.nickname, placeholder: "ENTER A NICKNAME", maxlength: 16 });
        const setBtn = button("SET NAME", () => {
          const v = input.value.trim();
          if (v.length < 3) { ctx.toast("NICKNAME TOO SHORT", "bad"); return; }
          ctx.net.setNickname(v);
          ctx.net.send({ type: "set_nickname", nickname: v });
          audio.play("confirm");
        }, { variant: "pink", size: "tiny" });
        nickCard.replaceChildren(
          el("div", { class: ["sc-stack"], style: { gap: "4px" } }, [
            el("div", { class: ["sc-row"], style: { gap: "6px" } }, [
              el("span", { class: ["sc-tag", "ranked"], text: "NICKNAME REQUIRED" }),
              el("span", { class: ["sc-muted", "sc-tiny"], text: "PICK A NAME TO QUEUE RANKED" })
            ]),
            field("NICKNAME", el("div", { class: ["sc-row"], style: { gap: "6px" } }, [input, setBtn]))
          ])
        );
      }

      function editNick(): void {
        const p = ctx.profile();
        if (!p) return;
        const input = textInput({ value: p.nickname, maxlength: 16 });
        const setBtn = button("SAVE", () => {
          const v = input.value.trim();
          if (v.length < 3) { ctx.toast("NICKNAME TOO SHORT", "bad"); return; }
          ctx.net.setNickname(v);
          ctx.net.send({ type: "set_nickname", nickname: v });
          audio.play("confirm");
          refreshNick();
        }, { variant: "mint", size: "tiny" });
        nickCard.replaceChildren(field("NICKNAME", el("div", { class: ["sc-row"], style: { gap: "6px" } }, [input, setBtn])));
      }

      refreshNick();

      const duelBtn = button("DUEL 1V1", () => { mode = "duel"; refreshMode(); }, { variant: "default" });
      const ffaBtn = button("FFA 4P", () => { mode = "ffa"; refreshMode(); }, { variant: "default" });
      function refreshMode(): void {
        duelBtn.classList.toggle("mint", mode === "duel");
        duelBtn.classList.toggle("ghost", mode !== "duel");
        ffaBtn.classList.toggle("mint", mode === "ffa");
        ffaBtn.classList.toggle("ghost", mode !== "ffa");
      }
      refreshMode();

      body.append(el("div", { class: ["sc-row"], style: { gap: "6px" } }, [duelBtn, ffaBtn]));

      const statusCard = el("div", { class: ["sc-card"], style: { background: "rgba(10,37,73,0.55)" } });
      body.append(statusCard);

      const queueBtn = button("QUEUE UP", () => {
        const p = ctx.profile();
        if (!p) { ctx.toast("NOT CONNECTED", "bad"); return; }
        if (!p.hasCustomNickname || p.nickname.trim().length < 3) { ctx.toast("SET A NICKNAME FIRST", "bad"); editNick(); return; }
        ctx.net.send({ type: "queue_join", mode });
        audio.play("confirm");
      }, { variant: "pink", size: "big" });

      const leaveBtn = button("LEAVE QUEUE", () => {
        ctx.net.send({ type: "queue_leave" });
        audio.play("back");
      }, { variant: "ghost" });

      body.append(el("div", { class: ["sc-row", "between"] }, [
        button("BACK", () => { if (queued) ctx.net.send({ type: "queue_leave" }); audio.play("back"); ctx.go("menu"); }, { variant: "ghost", size: "tiny" }),
        queueBtn
      ]));

      let etaValue = 0;
      function refreshStatus(): void {
        const p = ctx.profile();
        const tier = p ? tierForRating(1000 + (p.level * 25)) : "PUDDLE";
        if (!queued) {
          statusCard.replaceChildren(
            el("div", { class: ["sc-stack"], style: { gap: "4px" } }, [
              el("div", { class: ["sc-row"], style: { gap: "8px", alignItems: "center" } }, [
                el("span", { class: [tierClass(tier)], text: tier }),
                el("span", { class: ["sc-tiny", "sc-dim"], text: "PLACE TOP TO GAIN RATING" })
              ]),
              el("div", { class: ["sc-muted", "sc-tiny"], text: `${CONFIG.PROVISIONAL_GAMES} PROVISIONAL GAMES · THEN ${CONFIG.STANDARD_K} K-FACTOR` })
            ])
          );
          queueBtn.classList.toggle("sc-hide", false);
          leaveBtn.remove();
          return;
        }
        queueBtn.classList.toggle("sc-hide", true);
        if (!body.contains(leaveBtn)) body.append(leaveBtn);
        statusCard.replaceChildren(
          el("div", { class: ["sc-stack"], style: { gap: "4px" } }, [
            el("div", { class: ["sc-title"], text: "SEARCHING…", style: { fontSize: "14px", color: "#66e08f" } }),
            el("div", { class: ["sc-row", "between"] }, [
              el("span", { class: ["sc-tiny", "sc-dim"], text: "ETA" }),
              el("span", { class: ["sc-mono-num"], text: formatETA(etaValue), style: { fontWeight: "700" } })
            ])
          ])
        );
      }
      refreshStatus();

      const off = ctx.net.add({
        onProfile: () => { refreshNick(); refreshStatus(); },
        onWelcome: () => { refreshNick(); refreshStatus(); },
        onQueueStatus: (eta) => {
          queued = true;
          etaValue = eta / 1000;
          refreshStatus();
        },
        onMatchFound: () => {
          queued = false;
          ctx.toast("MATCH FOUND!", "good");
          audio.play("found");
          ctx.go("lobby");
        },
        onError: () => { /* toast handled globally */ }
      });

      const handle: ScreenHandle = {
        root,
        onKey(ev, down) {
          if (down && ev.key === "Escape") {
            if (queued) ctx.net.send({ type: "queue_leave" });
            ctx.go("menu");
            return true;
          }
          return false;
        },
        unmount() {
          off();
        }
      };
      return handle;
    }
  };
}

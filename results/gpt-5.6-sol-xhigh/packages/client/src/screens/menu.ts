import type { Profile } from "@splash/shared";
import type { AppCtx, Screen, ScreenHandle, ScreenParams } from "../main.js";
import { button, el, field, panel, textInput, tierClass } from "../ui.js";
import { tierForRating } from "@splash/shared";

export function createMenuScreen(): Screen {
  return {
    id: "menu",
    mount(ctx: AppCtx, _params: ScreenParams): ScreenHandle {
      const audio = ctx.audio;
      const { root, body } = panel("SPLASH PAD", "PICK YOUR WAVES");

      const profileCard = el("div", { class: ["sc-card"], style: { background: "rgba(10,37,73,0.55)", padding: "10px" } });
      body.append(profileCard);
      const refreshProfile = (): void => {
        const p = ctx.profile();
        if (!p) {
          profileCard.replaceChildren(el("div", { class: ["sc-muted", "sc-small"], text: "CONNECTING…" }));
          return;
        }
        const tier = tierForRating(1000 + (p.level * 25));
        const tierTag = el("span", { class: [tierClass(tier)], text: tier });
        const nameInput = textInput({ value: p.nickname, placeholder: "NICKNAME", maxlength: 16, onEnter: (v) => submitNick(v) });
        function submitNick(v: string): void {
          const trimmed = v.trim().slice(0, 16);
          if (!trimmed) return;
          ctx.net.setNickname(trimmed);
          ctx.net.send({ type: "set_nickname", nickname: trimmed });
          audio.play("confirm");
        }
        const saveBtn = button("SAVE", () => submitNick(nameInput.value), { variant: "mint", size: "tiny" });
        profileCard.replaceChildren(
          el("div", { class: ["sc-row", "between"] }, [
            el("div", { class: ["sc-stack"], style: { gap: "4px" } }, [
              el("div", { class: ["sc-row"], style: { gap: "6px", alignItems: "baseline" } }, [
                el("span", { class: ["sc-title"], text: p.nickname, style: { fontSize: "14px" } }),
                el("span", { class: ["sc-muted", "sc-tiny"], text: `#${p.tag}` }),
                tierTag
              ]),
              el("div", { class: ["sc-tiny", "sc-dim"], text: `LVL ${p.level} · ${p.xp} XP · ${p.hasCustomNickname ? "CUSTOM NAME" : "DEFAULT NAME"}` })
            ]),
            el("div", { class: ["sc-row"], style: { gap: "6px" } }, [
              button("LOCKER", () => { audio.play("tab"); ctx.go("locker", { back: "menu" }); }, { variant: "ghost", size: "tiny" }),
              button("SETTINGS", () => { audio.play("tab"); ctx.go("settings", { back: "menu" }); }, { variant: "ghost", size: "tiny" })
            ])
          ]),
          el("div", { class: ["sc-divider"] }),
          field("NICKNAME (FOR RANKED)", el("div", { class: ["sc-row"], style: { gap: "4px" } }, [nameInput, saveBtn]))
        );
      };

      refreshProfile();
      const profileInterval = window.setInterval(refreshProfile, 1500);

      const actions = el("div", { class: ["sc-grid", "cols-2"] });
      actions.append(
        bigButton(ctx, "PLAY CASUAL", "BROWSE · CREATE · JOIN", "default", () => { audio.play("confirm"); ctx.go("browser"); }),
        bigButton(ctx, "PLAY RANKED", "DUEL · FFA QUEUE", "pink", () => { audio.play("confirm"); ctx.go("queue"); }),
        bigButton(ctx, "PRACTICE", "VS BOTS LOCALLY", "mint", () => { audio.play("confirm"); ctx.net.send({ type: "create_room", opts: { name: "PRACTICE", size: 4, visibility: "private", theme: "random", roundsToWin: 2, botFill: true } }); }),
        bigButton(ctx, "HOW TO PLAY", "QUICK TUTORIAL", "ghost", () => { audio.play("tab"); ctx.go("tutorial", { next: "menu" }); }),
        bigButton(ctx, "LEADERBOARD", "TOP SPLASHERS", "ghost", () => { audio.play("tab"); ctx.go("leaderboard", { back: "menu" }); }),
        bigButton(ctx, "TUTORIAL", "FIRST-RUN DRILL", "ghost", () => { audio.play("tab"); ctx.go("tutorial", { next: "menu" }); })
      );
      body.append(actions);

      const off = ctx.net.add({
        onProfile: () => refreshProfile(),
        onWelcome: () => refreshProfile(),
        onRoomCreated: () => ctx.go("lobby"),
        onMatchFound: () => ctx.go("lobby")
      });

      const handle: ScreenHandle = {
        root,
        unmount() {
          window.clearInterval(profileInterval);
          off();
        }
      };
      return handle;
    }
  };
}

function bigButton(ctx: AppCtx, label: string, sub: string, variant: "default" | "pink" | "mint" | "ghost", onClick: () => void): HTMLElement {
  void ctx;
  const b = el("button", { class: ["sc-btn", variant === "ghost" ? "ghost" : variant, "block"], style: { textAlign: "left", padding: "10px 12px" }, on: { click: () => onClick() } });
  b.append(
    el("div", { text: label, style: { fontSize: "12px" } }),
    el("div", { text: sub, style: { fontSize: "8px", opacity: "0.85", marginTop: "2px", letterSpacing: "0.14em" } })
  );
  return b;
}

export type { Profile };

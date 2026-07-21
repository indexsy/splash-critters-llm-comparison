import type { LobbyView, ServerMessage } from "@splash/shared";
import { tierForRating } from "@splash/shared";
import type { AppCtx, Screen, ScreenHandle, ScreenParams } from "../main.js";
import { button, el, panel, tierClass } from "../ui.js";

interface Placement { playerId: string; name: string; placement: number; soaks: number; castles: number }

export function createResultsScreen(): Screen {
  return {
    id: "results",
    mount(ctx: AppCtx, params: ScreenParams): ScreenHandle {
      const audio = ctx.audio;
      const { root, body } = panel("MATCH RESULTS", "GG · STAY DRY", true);

      const matchEnd = params["match_end"] as Extract<ServerMessage, { type: "match_end" }> | undefined;
      const lobby = params["lobby"] as LobbyView | undefined;

      if (matchEnd) {
        renderResults(ctx, body, matchEnd.placements as Placement[], matchEnd.ratingDeltas, matchEnd.xp);
        const youRow = matchEnd.placements.find((p) => p.playerId === ctx.profile()?.id);
        if (youRow?.placement === 1) {
          audio.play("win");
          ctx.flash("#ffd83d", 0.4);
          ctx.announce("VICTORY!", "#ffd83d", "GG!", 2400);
        } else {
          audio.play("lose");
          ctx.announce(`PLACED #${youRow?.placement ?? "?"}`, "#7ee4ff", undefined, 2400);
        }
      } else {
        body.append(el("div", { class: ["sc-muted"], text: "NO RESULTS YET" }));
      }

      const actions = el("div", { class: ["sc-btn-row", "between"] });
      actions.append(
        button("BACK TO MENU", () => { ctx.net.send({ type: "leave_room" }); audio.play("back"); ctx.go("menu"); }, { variant: "ghost" }),
        button("REMATCH", () => {
          ctx.net.send({ type: "rematch_vote" });
          audio.play("confirm");
          ctx.toast("REMATCH VOTED");
          if (lobby) ctx.go("lobby", { lobby });
          else ctx.go("menu");
        }, { variant: "pink" })
      );
      body.append(actions);

      const off = ctx.net.add({
        onLobby: (l) => {
          if (l.phase === "lobby") ctx.go("lobby", { lobby: l });
        },
        onMessage: (msg) => {
          if (msg.type === "match_start") ctx.go("game", { match_start: msg.config, lobby });
        }
      });

      return { root, unmount() { off(); } };
    }
  };
}

function renderResults(ctx: AppCtx, host: HTMLElement, placements: Placement[], deltas: Record<string, number>, xp: Record<string, number>): void {
  const sorted = [...placements].sort((a, b) => a.placement - b.placement);
  const list = el("div", { class: ["sc-list"] });
  const medals = ["1ST", "2ND", "3RD", "4TH"];
  for (const p of sorted) {
    const isYou = p.playerId === ctx.profile()?.id;
    const delta = deltas[p.playerId] ?? 0;
    const gained = xp[p.playerId] ?? 0;
    const row = el("div", { class: ["sc-list-row", isYou ? "active" : undefined] });
    row.append(
      el("span", { text: medals[p.placement - 1] ?? "•", style: { fontSize: "14px" } }),
      el("span", { class: ["sc-tag", p.placement === 1 ? "ranked" : "casual"], text: `#${p.placement}` }),
      el("span", { text: p.name + (isYou ? " (YOU)" : ""), style: { fontWeight: "700" } }),
      el("span", { class: ["meta"], text: `${p.soaks} SOAKS · ${p.castles} CASTLES · ${delta >= 0 ? "+" : ""}${delta} RATING · +${gained} XP` })
    );
    list.append(row);
  }
  host.append(list);
  void tierForRating;
  void tierClass;
}

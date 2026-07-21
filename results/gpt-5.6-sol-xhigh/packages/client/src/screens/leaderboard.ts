import type { Mode } from "@splash/shared";
import { tierForRating } from "@splash/shared";
import type { AppCtx, Screen, ScreenHandle, ScreenParams } from "../main.js";
import { button, el, panel, select, tierClass } from "../ui.js";
import type { LeaderboardEntry } from "../net.js";

export function createLeaderboardScreen(): Screen {
  return {
    id: "leaderboard",
    mount(ctx: AppCtx, params: ScreenParams): ScreenHandle {
      const audio = ctx.audio;
      const back = (params["back"] as string | undefined) ?? "menu";
      const { root, body } = panel("LEADERBOARD", "TOP SPLASHERS", true);

      const list = el("div", { class: ["sc-list"] });
      let mode: Mode = "duel";
      let scope = "global";
      let youRank: { rank: number; total: number } | null = null;

      const modeSel = select<Mode>(
        [{ value: "duel", label: "DUEL" }, { value: "ffa", label: "FFA" }],
        mode,
        (v) => { mode = v; refresh(); }
      );
      const scopeSel = select<string>(
        [{ value: "global", label: "GLOBAL" }, { value: "friends", label: "FRIENDS" }],
        scope,
        (v) => { scope = v; refresh(); }
      );

      body.append(el("div", { class: ["sc-row", "between"] }, [
        el("div", { class: ["sc-row"], style: { gap: "6px" } }, [modeSel, scopeSel]),
        button("BACK", () => { audio.play("back"); ctx.go(back as never); }, { variant: "ghost", size: "tiny" })
      ]));
      body.append(list);

      async function refresh(): Promise<void> {
        list.replaceChildren(el("div", { class: ["sc-list-row", "sc-muted"], text: "FETCHING…" }));
        try {
          const res = await ctx.net.fetchLeaderboard(mode, scope);
          render(res.entries);
        } catch (e) {
          list.replaceChildren(el("div", { class: ["sc-list-row", "sc-muted"], text: "LEADERBOARD UNAVAILABLE (REST /api/leaderboard)" }));
          ctx.toast("LEADERBOARD UNAVAILABLE", "bad");
          void e;
        }
      }

      function render(entries: LeaderboardEntry[]): void {
        list.replaceChildren();
        if (!entries.length) {
          list.append(el("div", { class: ["sc-list-row", "sc-muted"], text: "NO ENTRIES YET — BE THE FIRST!" }));
          return;
        }
        const meId = ctx.profile()?.id;
        entries.forEach((entry, i) => {
          const tier = tierForRating(entry.rating);
          const isYou = entry.playerId === meId;
          if (isYou) youRank = { rank: i + 1, total: entries.length };
          const row = el("div", { class: ["sc-list-row", isYou ? "active" : undefined] });
          row.append(
            el("span", { class: ["sc-tag", "host"], text: `#${i + 1}` }),
            el("span", { text: `${entry.name}#${entry.tag}${isYou ? " (YOU)" : ""}`, style: { fontWeight: "700" } }),
            el("span", { class: [tierClass(tier)], text: tier }),
            el("span", { class: ["meta"], text: `${entry.rating}R · ${entry.games}G · ${entry.wins}W` })
          );
          list.append(row);
        });
        if (youRank) {
          list.prepend(el("div", { class: ["sc-list-row", "active"], style: { background: "rgba(255,216,61,0.18)" } }, [
            el("span", { class: ["sc-tag", "ranked"], text: "YOU" }),
            el("span", { text: `RANK ${youRank.rank} OF ${youRank.total}` })
          ]));
        }
      }

      void refresh;
      const refreshNow = (): void => { void refresh(); };
      refreshNow();

      return { root, unmount() { /* nothing */ } };
    }
  };
}

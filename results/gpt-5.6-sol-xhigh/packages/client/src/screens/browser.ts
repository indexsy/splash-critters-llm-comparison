import type { Mode, RoomOptions, RoomSummary, Theme } from "@splash/shared";
import type { AppCtx, Screen, ScreenHandle, ScreenParams } from "../main.js";
import { button, el, field, panel, select, textInput } from "../ui.js";
import type { RoomSummaryLike } from "../net.js";

export function createBrowserScreen(): Screen {
  return {
    id: "browser",
    mount(ctx: AppCtx, _params: ScreenParams): ScreenHandle {
      const audio = ctx.audio;
      const { root, body } = panel("CASUAL LOBBIES", "BROWSE · CREATE · JOIN", true);

      const list = el("div", { class: ["sc-list"] });
      const modeSel = select<Mode | "any">(
        [{ value: "any", label: "ANY MODE" }, { value: "duel", label: "DUEL 1V1" }, { value: "ffa", label: "FFA 4P" }],
        "any",
        (v) => {
          if (v === "any") ctx.net.send({ type: "room_list_request" });
          else ctx.net.send({ type: "room_list_request", mode: v });
          audio.play("tab");
        }
      );
      const refreshBtn = button("REFRESH", () => {
        ctx.net.send({ type: "room_list_request" });
        audio.play("tab");
      }, { variant: "ghost", size: "tiny" });

      body.append(el("div", { class: ["sc-row", "between"] }, [
        el("div", { class: ["sc-row"], style: { gap: "6px", alignItems: "center" } }, [
          el("span", { class: ["sc-tiny"], text: "FILTER" }),
          modeSel
        ]),
        refreshBtn
      ]));

      body.append(list);

      const codeInput = textInput({ placeholder: "ROOM CODE", maxlength: 8 });
      const joinBtn = button("JOIN BY CODE", () => {
        const code = codeInput.value.trim().toUpperCase();
        if (!code) return;
        ctx.net.send({ type: "join_room", code });
        audio.play("confirm");
      }, { variant: "mint" });
      body.append(field("JOIN A FRIEND", el("div", { class: ["sc-row"], style: { gap: "6px" } }, [codeInput, joinBtn])));

      const divider = el("div", { class: ["sc-divider"] });
      body.append(divider);

      const createTitle = el("div", { class: ["sc-title"], text: "CREATE A ROOM", style: { fontSize: "14px" } });
      body.append(createTitle);

      const nameInput = textInput({ value: "SPLASH PAD", maxlength: 20 });
      const sizeSel = select<"2" | "4">(
        [{ value: "2", label: "1V1 (2P)" }, { value: "4", label: "FFA (4P)" }],
        "4",
        () => {}
      );
      const themeSel = select<Theme | "random">(
        [{ value: "random", label: "RANDOM THEME" }, { value: "backyard", label: "BACKYARD" }, { value: "beach", label: "BEACH" }, { value: "pool", label: "POOL" }],
        "random",
        () => {}
      );
      const roundsSel = select<"2" | "3" | "5">(
        [{ value: "2", label: "BEST OF 3" }, { value: "3", label: "BEST OF 5" }, { value: "5", label: "BEST OF 9" }],
        "3",
        () => {}
      );
      const visSel = select<"public" | "private">(
        [{ value: "public", label: "PUBLIC" }, { value: "private", label: "PRIVATE" }],
        "public",
        () => {}
      );
      let botFill = true;
      const botToggle = el("label", { class: ["sc-toggle", "on"], style: { fontSize: "10px" } }, [
        el("div", { class: ["track"] }, [el("div", { class: ["knob"] })]),
        document.createTextNode("BOT FILL")
      ]);
      botToggle.addEventListener("click", () => {
        botFill = !botFill;
        botToggle.classList.toggle("on", botFill);
      });

      const createBtn = button("CREATE ROOM", () => {
        const opts: RoomOptions = {
          name: nameInput.value.trim().slice(0, 20) || "SPLASH PAD",
          size: sizeSel.value === "2" ? 2 : 4,
          visibility: visSel.value === "private" ? "private" : "public",
          theme: themeSel.value as Theme | "random",
          roundsToWin: roundsSel.value === "2" ? 2 : roundsSel.value === "3" ? 3 : 5,
          botFill
        };
        ctx.net.send({ type: "create_room", opts });
        audio.play("confirm");
      }, { variant: "pink", size: "big" });

      body.append(el("div", { class: ["sc-grid", "cols-2"] }, [
        field("NAME", nameInput),
        field("SIZE", sizeSel),
        field("THEME", themeSel),
        field("BEST OF", roundsSel),
        field("VISIBILITY", visSel),
        field("BOT FILL", botToggle)
      ]));
      body.append(createBtn);

      const backBtn = button("BACK", () => { audio.play("back"); ctx.go("menu"); }, { variant: "ghost", size: "tiny" });
      body.append(backBtn);

      const renderList = (rooms: RoomSummaryLike[]): void => {
        list.replaceChildren();
        if (!rooms.length) {
          list.append(el("div", { class: ["sc-list-row", "sc-muted"], text: "NO OPEN ROOMS — CREATE ONE!" }));
          return;
        }
        for (const r of rooms) {
          const row = el("div", { class: ["sc-list-row"], on: { click: () => { ctx.net.send({ type: "join_room", code: r.code }); audio.play("confirm"); } } });
          row.append(
            el("span", { class: ["sc-tag", "casual"], text: r.mode.toUpperCase() }),
            el("span", { text: r.name || r.code, style: { fontWeight: "700" } }),
            el("span", { class: ["sc-muted", "sc-tiny"], text: `#${r.code} · ${r.theme.toUpperCase()}` }),
            el("span", { class: ["meta"], text: `${r.players}/${r.maxPlayers}P · ${r.host}` })
          );
          list.append(row);
        }
      };

      const off = ctx.net.add({
        onRoomList: (rooms) => renderList(rooms as RoomSummary[] as unknown as RoomSummaryLike[]),
        onLobby: () => ctx.go("lobby"),
        onError: () => { /* toast handled globally */ }
      });

      ctx.net.send({ type: "room_list_request" });

      const handle: ScreenHandle = {
        root,
        unmount() { off(); }
      };
      return handle;
    }
  };
}

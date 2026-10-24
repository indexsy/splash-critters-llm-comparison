import type { GameMode } from "@splash/shared";
import { STR, themeName } from "../strings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { background, button, centered, panel, text, truncate } from "./ui.js";
import { openCreateRoom, openJoinCode } from "./menu.js";

let filter: GameMode | "all" = "all";

function refresh(app: App): void {
  app.net.send({ type: "room_list_request", filter });
}

export const browserScreen: Screen = {
  enter(app) {
    app.audio.setTrack("menu");
    refresh(app);
  },
  render(app, time) {
    background(app, time);
    text(app, STR.publicRooms, 12, 10, "#f9dc5c", 12);
    button(app, "all", STR.all, 12, 29, 48, 14, () => { filter = "all"; refresh(app); }, { small: true, color: filter === "all" ? "#56e39f" : undefined });
    button(app, "duel", STR.duel, 64, 29, 54, 14, () => { filter = "duel"; refresh(app); }, { small: true, color: filter === "duel" ? "#56e39f" : undefined });
    button(app, "ffa", STR.ffa, 122, 29, 54, 14, () => { filter = "ffa"; refresh(app); }, { small: true, color: filter === "ffa" ? "#56e39f" : undefined });
    button(app, "refresh", STR.refresh, 180, 29, 64, 14, () => refresh(app), { small: true });
    const rooms = app.rooms.filter((room) => filter === "all" || room.mode === filter);
    if (rooms.length === 0) centered(app, STR.noRooms, 128, 100, "#8a96bd", 7);
    rooms.slice(0, 5).forEach((room, index) => {
      const y = 50 + index * 27;
      panel(app, 8, y, 240, 24);
      text(app, truncate(app, room.name, 95), 13, y + 4, "#f7f3d5", 7);
      text(app, `${room.mode.toUpperCase()} • ${themeName(room.theme)}`, 13, y + 14, "#8be9fd", 6);
      text(app, `${room.players}/${room.maxPlayers}`, 166, y + 8, "#f9dc5c", 7);
      button(app, `join-${room.code}`, STR.join, 194, y + 4, 48, 15, () => app.joinRoom(room.code), { small: true, disabled: room.players >= room.maxPlayers });
    });
    button(app, "create", STR.createRoom, 8, 195, 80, 18, () => openCreateRoom(app), { small: true });
    button(app, "code", STR.joinCode, 92, 195, 84, 18, () => openJoinCode(app), { small: true });
    button(app, "back", STR.back, 180, 195, 68, 18, () => app.go("menu"), { small: true });
  }
};

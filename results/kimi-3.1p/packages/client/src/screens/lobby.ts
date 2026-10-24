import type { BotDifficulty } from "@splash/shared";
import { STR, themeName } from "../strings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { background, button, centered, panel, text, truncate } from "./ui.js";
import { drawAnimal } from "../render/sprites.js";

const DIFFICULTIES: BotDifficulty[] = ["easy", "medium", "hard"];

function leave(app: App): void {
  app.leaveRoom();
}

export const lobbyScreen: Screen = {
  enter(app) {
    app.audio.setTrack("menu");
  },
  render(app, time) {
    background(app, time);
    const lobby = app.lobby;
    if (!lobby) {
      centered(app, STR.waiting, 128, 100, "#8be9fd", 9);
      button(app, "back", STR.back, 91, 190, 74, 17, () => app.go("menu"));
      return;
    }
    text(app, truncate(app, lobby.name, 160), 10, 9, "#f9dc5c", 11);
    text(app, `${lobby.code} • ${themeName(lobby.theme)} • ${lobby.mode.toUpperCase()}`, 10, 27, "#8be9fd", 7);
    lobby.slots.forEach((slot, index) => {
      const x = index % 2 === 0 ? 8 : 132;
      const y = 45 + Math.floor(index / 2) * 48;
      panel(app, x, y, 116, 42, slot.kind === "open" ? "#10162f" : "#182142");
      if (slot.kind === "open") {
        centered(app, STR.openSlot, x + 58, y + 9, "#4c5d95", 7);
        if (lobby.you === lobby.hostId && !lobby.inMatch) button(app, `add-${index}`, `+ ${STR.addBot}`, x + 19, y + 23, 78, 13, () => app.net.send({ type: "set_slot", slot: index, kind: "bot", difficulty: "medium" }), { small: true });
        return;
      }
      drawAnimal(app.canvas, slot.animal, x + 14, y + 22, Math.floor(time / 180 + index) % 2, slot.hat, "down", false, 20);
      text(app, truncate(app, slot.nickname, 78), x + 28, y + 6, slot.playerId === lobby.you ? "#f9dc5c" : "#f7f3d5", 7);
      const status = slot.kind === "bot" ? `${STR.bot} • ${slot.difficulty?.toUpperCase()}` : !slot.connected ? STR.offline : slot.ready ? STR.ready : STR.notReady;
      text(app, status, x + 28, y + 17, slot.ready ? "#56e39f" : "#8a96bd", 6);
      if (slot.kind === "bot" && lobby.you === lobby.hostId && !lobby.inMatch) {
        button(app, `difficulty-${index}`, slot.difficulty?.toUpperCase() ?? STR.medium, x + 27, y + 27, 52, 11, () => {
          const next = DIFFICULTIES[(DIFFICULTIES.indexOf(slot.difficulty ?? "medium") + 1) % DIFFICULTIES.length];
          app.net.send({ type: "set_slot", slot: index, kind: "bot", difficulty: next });
        }, { small: true });
        button(app, `remove-${index}`, "×", x + 84, y + 27, 20, 11, () => app.net.send({ type: "set_slot", slot: index, kind: "open" }), { small: true, color: "#d64550" });
      }
      if (slot.kind === "human" && slot.playerId === lobby.hostId) text(app, STR.host, x + 83, y + 30, "#f9dc5c", 6);
    });
    button(app, "copy", STR.copyLink, 38, 145, 180, 15, () => {
      void navigator.clipboard?.writeText(`${location.origin}/#/room/${lobby.code}`);
      app.toastMessage(STR.copied);
    }, { small: true });
    const occupied = lobby.slots.filter((slot) => slot.kind !== "open").length;
    const guestsReady = lobby.slots.every((slot) => slot.kind !== "human" || slot.playerId === lobby.hostId || slot.ready);
    if (app.results && !lobby.inMatch) {
      centered(app, `${STR.rematchVotes}: ${lobby.rematchVotes}/${lobby.rematchNeeded}`, 128, 166, "#8be9fd", 7);
      button(app, "rematch", STR.rematch, 8, 184, 116, 21, () => app.net.send({ type: "rematch_vote", vote: true }), { color: "#56e39f" });
    } else if (lobby.you === lobby.hostId) {
      button(app, "start", STR.startMatch, 8, 184, 116, 21, () => app.net.send({ type: "start_match" }), { disabled: occupied < 2 || !guestsReady || lobby.inMatch, color: "#56e39f" });
    } else {
      const me = lobby.slots.find((slot) => slot.playerId === lobby.you);
      button(app, "ready", me?.ready ? STR.notReady : STR.ready, 8, 184, 116, 21, () => app.net.send({ type: "set_ready", ready: !me?.ready }), { color: me?.ready ? "#d64550" : "#56e39f" });
    }
    button(app, "leave", STR.leave, 132, 184, 116, 21, () => leave(app), { color: "#d64550" });
  },
  key(app, code) {
    if (code === "Escape") leave(app);
    return true;
  }
};

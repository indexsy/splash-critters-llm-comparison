import { CONFIG } from "@splash/shared";
import type { BotDifficulty, GameMode, RoomOptions, ThemeChoice } from "@splash/shared";
import { STR } from "../strings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { addDialogActions, background, button, centered, checkField, dialogButton, openDialog, panel, selectField, text, textField, xpBar } from "./ui.js";
import { drawAnimal } from "../render/sprites.js";

export function joinQueue(app: App, mode: GameMode): void {
  if (!app.profile?.nicknameSet) {
    app.toastMessage(STR.nicknameHelp);
    app.go("settings");
    return;
  }
  app.queueMode = mode;
  app.queueJoinedAt = performance.now();
  app.queueSearchRange = CONFIG.MATCHMAKING.INITIAL_RANGE;
  app.queueEta = CONFIG.MATCHMAKING.ETA_SECONDS;
  app.queuePlayers = 1;
  app.net.send({ type: "queue_join", mode });
  app.go("queue");
}

export function openJoinCode(app: App): void {
  const dialog = openDialog(app, STR.joinCode);
  const input = textField(dialog, STR.enterCode, "", 6);
  input.style.textTransform = "uppercase";
  input.addEventListener("input", () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  const submit = () => {
    if (!/^[A-Z0-9]{6}$/.test(input.value)) return input.focus();
    app.joinRoom(input.value);
    app.closeDialog();
  };
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
  addDialogActions(dialog, dialogButton(STR.cancel, () => app.closeDialog(), "secondary"), dialogButton(STR.join, submit));
  input.focus();
}

export function openPractice(app: App): void {
  const dialog = openDialog(app, STR.practice);
  const difficulty = selectField(dialog, STR.difficulty, [
    { value: "easy", label: STR.easy },
    { value: "medium", label: STR.medium },
    { value: "hard", label: STR.hard }
  ], "medium");
  addDialogActions(dialog, dialogButton(STR.cancel, () => app.closeDialog(), "secondary"), dialogButton(STR.play, () => {
    app.net.send({ type: "practice_start", difficulty: difficulty.value as BotDifficulty });
    app.closeDialog();
    app.go("game");
  }));
}

export function openCreateRoom(app: App): void {
  const dialog = openDialog(app, STR.createRoom);
  const name = textField(dialog, STR.roomName, `${app.profile?.nickname ?? "Splash"} ROOM`.slice(0, 24), 24);
  const size = selectField(dialog, STR.roomSize, [{ value: "2", label: STR.twoPlayers }, { value: "4", label: STR.fourPlayers }], "4");
  const visibility = selectField(dialog, STR.visibility, [{ value: "public", label: STR.public }, { value: "private", label: STR.private }], "public");
  const theme = selectField(dialog, STR.theme, [
    { value: "random", label: STR.random },
    { value: "backyard", label: STR.backyard },
    { value: "beach", label: STR.beach },
    { value: "pool", label: STR.pool }
  ], "random");
  const rounds = selectField(dialog, STR.roundsToWin, [{ value: "2", label: "2" }, { value: "3", label: "3" }, { value: "5", label: "5" }], "3");
  const botFill = checkField(dialog, STR.botFill, true);
  const create = () => {
    const options: RoomOptions = {
      name: name.value.trim() || STR.appName,
      maxPlayers: Number(size.value) as 2 | 4,
      public: visibility.value === "public",
      theme: theme.value as ThemeChoice,
      roundsToWin: Number(rounds.value) as 2 | 3 | 5,
      botFill: botFill.checked
    };
    app.net.send({ type: "create_room", opts: options });
    app.closeDialog();
  };
  addDialogActions(dialog, dialogButton(STR.cancel, () => app.closeDialog(), "secondary"), dialogButton(STR.create, create));
}

export const menuScreen: Screen = {
  enter(app) {
    app.audio.setTrack("menu");
    app.net.send({ type: "room_list_request", filter: "all" });
  },
  render(app, time) {
    background(app, time);
    panel(app, 5, 5, 246, 29);
    if (app.profile) {
      drawAnimal(app.canvas, app.profile.selectedAnimal, 17, 19, Math.floor(time / 200) % 2, app.profile.selectedHat, "down", false, 18);
      text(app, `${app.profile.nickname}#${app.profile.tag}`, 31, 8, "#f9dc5c", 8);
      text(app, `${STR.level} ${app.profile.level} • ${app.profile.xp} ${STR.xp}`, 31, 20, "#8be9fd", 7);
      xpBar(app, 152, 20, 91, app.profile.xp, app.profile.level);
    }
    const items: { label: string; action: () => void; color?: string }[] = [
      { label: STR.rankedDuel, action: () => joinQueue(app, "duel"), color: "#3867d6" },
      { label: STR.rankedFfa, action: () => joinQueue(app, "ffa"), color: "#3867d6" },
      { label: STR.browseRooms, action: () => app.go("browser") },
      { label: STR.createRoom, action: () => openCreateRoom(app) },
      { label: STR.joinCode, action: () => openJoinCode(app) },
      { label: STR.practice, action: () => openPractice(app) },
      { label: STR.leaderboard, action: () => app.go("leaderboard") },
      { label: STR.locker, action: () => app.go("locker") },
      { label: STR.howToPlay, action: () => app.go("howto") },
      { label: STR.settings, action: () => app.go("settings") },
      { label: STR.tutorial, action: () => app.startTutorial() },
      { label: STR.profile, action: () => { if (app.profile) app.openProfile(app.profile.id); } }
    ];
    items.forEach((item, index) => {
      const x = index % 2 === 0 ? 8 : 132;
      const y = 40 + Math.floor(index / 2) * 25;
      button(app, `menu-${index}`, item.label, x, y, 116, 20, item.action, { small: item.label.length > 18, color: item.color, disabled: !app.profile });
    });
    centered(app, STR.fullScreenHint, 128, 211, "#4c5d95", 6);
    button(app, "title", STR.back, 91, 190, 74, 14, () => app.go("title"), { small: true });
  }
};

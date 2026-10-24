import { STR } from "../strings.js";
import { keyLabel, saveSettings, type BindingAction } from "../settings.js";
import type { App } from "../main.js";
import type { Screen } from "./types.js";
import { addDialogActions, background, button, centered, checkField, dialogButton, openDialog, panel, rangeField, text, textField } from "./ui.js";

function openNickname(app: App): void {
  const dialog = openDialog(app, STR.nicknameTitle);
  const help = document.createElement("p");
  help.textContent = STR.nicknameHelp;
  dialog.append(help);
  const input = textField(dialog, STR.nickname, app.profile?.nickname ?? "", 16);
  const save = () => {
    app.net.send({ type: "set_nickname", nickname: input.value.trim() });
    app.closeDialog();
  };
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") save(); });
  addDialogActions(dialog, dialogButton(STR.cancel, () => app.closeDialog(), "secondary"), dialogButton(STR.save, save));
  input.focus();
}

function openAudio(app: App): void {
  const dialog = openDialog(app, STR.audio);
  rangeField(dialog, STR.sfxVolume, app.settings.sfx, (value) => { app.settings.sfx = value; saveSettings(app.settings); app.audio.play("click"); });
  rangeField(dialog, STR.musicVolume, app.settings.music, (value) => { app.settings.music = value; saveSettings(app.settings); });
  const muted = checkField(dialog, STR.mute, app.settings.muted);
  muted.addEventListener("change", () => { app.settings.muted = muted.checked; saveSettings(app.settings); });
  const colorblind = checkField(dialog, STR.colorblind, app.settings.colorblind);
  colorblind.addEventListener("change", () => { app.settings.colorblind = colorblind.checked; saveSettings(app.settings); });
  const shake = checkField(dialog, STR.reducedShake, app.settings.reducedShake);
  shake.addEventListener("change", () => { app.settings.reducedShake = shake.checked; saveSettings(app.settings); });
  addDialogActions(dialog, dialogButton(STR.close, () => app.closeDialog()));
}

function openControls(app: App): void {
  const dialog = openDialog(app, STR.controls);
  const actions: { action: BindingAction; label: string }[] = [
    { action: "up", label: STR.moveUp },
    { action: "down", label: STR.moveDown },
    { action: "left", label: STR.moveLeft },
    { action: "right", label: STR.moveRight },
    { action: "balloon", label: STR.dropBalloon }
  ];
  for (const item of actions) {
    const row = document.createElement("div");
    row.className = "row";
    const label = document.createElement("span");
    label.textContent = item.label;
    const remap = dialogButton(keyLabel(app.settings.bindings[item.action]), () => {
      remap.textContent = STR.pressKey;
      const listener = (event: KeyboardEvent) => {
        event.preventDefault();
        event.stopPropagation();
        app.settings.bindings[item.action] = event.code;
        saveSettings(app.settings);
        remap.textContent = keyLabel(event.code);
        dialog.removeEventListener("keydown", listener, true);
      };
      dialog.addEventListener("keydown", listener, true);
    }, "keybind");
    row.append(label, remap);
    dialog.append(row);
  }
  addDialogActions(dialog, dialogButton(STR.close, () => app.closeDialog()));
}

function openAccount(app: App): void {
  const dialog = openDialog(app, STR.account);
  const warning = document.createElement("p");
  warning.className = "warning";
  warning.textContent = STR.tokenWarning;
  const reset = document.createElement("p");
  reset.textContent = STR.deleteNote;
  dialog.append(warning, reset);
  addDialogActions(dialog, dialogButton(STR.close, () => app.closeDialog()));
}

function toggle(app: App, key: "muted" | "colorblind" | "reducedShake"): void {
  app.settings[key] = !app.settings[key];
  saveSettings(app.settings);
}

export const settingsScreen: Screen = {
  enter(app) {
    app.audio.setTrack("menu");
  },
  render(app, time) {
    background(app, time);
    centered(app, STR.settings, 128, 10, "#f9dc5c", 13);
    panel(app, 20, 32, 216, 135);
    button(app, "nickname", `${STR.nickname}: ${app.profile?.nickname ?? "—"}`, 31, 41, 194, 18, () => openNickname(app), { small: true, disabled: !app.profile });
    button(app, "audio", `${STR.audio} / ${STR.accessibility}`, 31, 64, 194, 18, () => openAudio(app), { small: true });
    button(app, "controls", STR.controls, 31, 87, 194, 18, () => openControls(app), { small: true });
    button(app, "muted", `${STR.mute}: ${app.settings.muted ? "ON" : "OFF"}`, 31, 112, 194, 15, () => toggle(app, "muted"), { small: true, color: app.settings.muted ? "#d64550" : undefined });
    button(app, "palette", STR.colorblind, 31, 131, 194, 15, () => toggle(app, "colorblind"), { small: true, color: app.settings.colorblind ? "#56e39f" : undefined });
    button(app, "shake", STR.reducedShake, 31, 150, 194, 15, () => toggle(app, "reducedShake"), { small: true, color: app.settings.reducedShake ? "#56e39f" : undefined });
    button(app, "account", STR.account, 31, 174, 194, 16, () => openAccount(app), { small: true });
    button(app, "back", STR.back, 85, 204, 86, 14, () => app.go(app.settingsReturn), { small: true });
  },
  key(app, code) {
    if (code === "Escape") app.go(app.settingsReturn);
    return true;
  }
};

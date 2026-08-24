import type { App } from "../main";
import { saveSettings } from "../main";
import { audio } from "../audio";

export function showSettings(app: App): () => void {
  const s = app.settings;
  const el = document.createElement("div");
  el.className = "screen";
  el.innerHTML = `
    <h2>SETTINGS</h2>
    <div class="panel col" style="min-width:420px">
      <label class="row">SFX volume <input type="range" id="sfx" min="0" max="1" step="0.05" value="${s.sfx}"></label>
      <label class="row">Music volume <input type="range" id="music" min="0" max="1" step="0.05" value="${s.music}"></label>
      <label class="row"><input type="checkbox" id="mute" ${s.muted ? "checked" : ""}> Mute (M)</label>
      <label class="row"><input type="checkbox" id="cb" ${s.colorblind ? "checked" : ""}> Colorblind-safe splash palette</label>
      <label class="row"><input type="checkbox" id="shake" ${s.reducedShake ? "checked" : ""}> Reduced screen shake</label>
      <hr style="width:100%;border-color:var(--panel)">
      <div class="muted">Your account is tied to a device token in this browser's localStorage.
      Clearing it (or deleting account data) means losing your nickname, level and ratings — there are no passwords.</div>
      <button class="small danger" id="wipe">Delete account data (this browser)</button>
    </div>
    <button class="small" id="back">Back</button>
  `;
  app.screens.appendChild(el);
  audio.playMusic("menu");

  el.querySelector("#sfx")!.addEventListener("input", (e) => {
    s.sfx = Number((e.target as HTMLInputElement).value);
    saveSettings();
  });
  el.querySelector("#music")!.addEventListener("input", (e) => {
    s.music = Number((e.target as HTMLInputElement).value);
    saveSettings();
  });
  el.querySelector("#mute")!.addEventListener("change", (e) => {
    s.muted = (e.target as HTMLInputElement).checked;
    saveSettings();
    audio.setMuted(s.muted);
  });
  el.querySelector("#cb")!.addEventListener("change", (e) => {
    s.colorblind = (e.target as HTMLInputElement).checked;
    saveSettings();
  });
  el.querySelector("#shake")!.addEventListener("change", (e) => {
    s.reducedShake = (e.target as HTMLInputElement).checked;
    saveSettings();
  });
  el.querySelector("#wipe")!.addEventListener("click", () => {
    if (confirm("Delete your local token? Your progress will be lost.")) {
      localStorage.removeItem("sc_token");
      location.reload();
    }
  });
  el.querySelector("#back")!.addEventListener("click", () => app.navigate("#/menu"));

  return () => audio.stopMusic();
}

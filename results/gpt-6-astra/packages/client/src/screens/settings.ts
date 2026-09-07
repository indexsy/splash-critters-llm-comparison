import { button, escapeHtml, icon, pageHeading, type UIState } from "../ui.js";
export function settingsScreen(state: UIState): string {
  const s = state.settings;
  return `${pageHeading("YOUR POND. YOUR RULES.", "The Little Details.", "Tune your soundtrack, your controls, and your comfort.")}<div class="settings-grid"><section class="settings-panel"><h2>${icon("sound")} Sound & Comfort</h2><label class="range-label">Sound Effects <output>${Math.round(s.sfx * 100)}%</output><input type="range" min="0" max="100" value="${s.sfx * 100}" data-setting="sfx"></label><label class="range-label">Music <output>${Math.round(s.music * 100)}%</output><input type="range" min="0" max="100" value="${s.music * 100}" data-setting="music"></label><label class="toggle-row"><span><strong>Keep It Quiet</strong><small>Mute everything. Shortcut: M.</small></span><input type="checkbox" data-setting="muted" ${s.muted ? "checked" : ""}></label><label class="toggle-row"><span><strong>Colorblind-Safe Splashes</strong><small>High-contrast violet and white water.</small></span><input type="checkbox" data-setting="colorblind" ${s.colorblind ? "checked" : ""}></label><label class="toggle-row"><span><strong>Reduced Screen Shake</strong><small>All the splash. Less of the wobble.</small></span><input type="checkbox" data-setting="reducedShake" ${s.reducedShake ? "checked" : ""}></label></section><section class="settings-panel"><h2>${icon("bolt")} Your Flippers, Remapped</h2><p class="small">Click a key, then press its replacement. Arrow keys and E are always available.</p>${Object.entries(
    s.bindings,
  )
    .map(
      ([action, code]) =>
        `<div class="keybind-row"><strong>${action.charAt(0).toUpperCase() + action.slice(1)}</strong><button class="keybind" data-action="remap" data-id="${action}">${escapeHtml(code.replace("Key", ""))}</button></div>`,
    )
    .join(
      "",
    )}${button("Reset Controls", "reset-controls", "text")}</section><section class="settings-panel account-panel"><div><h2>${icon("users")} A Guest, but One of Us.</h2><p>Your account is saved using a secret device token in this browser. There are no passwords or recovery emails.</p><p><strong>Clearing browser data or losing the token permanently loses access to your account.</strong> Never share the token. Opening a second tab uses this same account.</p><p class="small">Want a clean start? Removing this site's browser storage creates a new guest next time. It does not delete historical public match records.</p></div>${button("Change Nickname", "nickname", "secondary")}</section></div>`;
}

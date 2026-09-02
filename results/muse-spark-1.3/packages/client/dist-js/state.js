const DEF_KEYS = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', balloon: 'Space' };
export function loadSettings() {
    try {
        const raw = localStorage.getItem('sc_settings');
        if (raw)
            return { ...defaults(), ...JSON.parse(raw) };
    }
    catch { /* ignore */ }
    return defaults();
}
function defaults() {
    return { sfx: 0.7, music: 0.5, muted: false, colorblind: false, shake: true, keys: { ...DEF_KEYS } };
}
export function saveSettings(s) {
    localStorage.setItem('sc_settings', JSON.stringify(s));
}
export const app = {
    profile: null,
    settings: loadSettings(),
    params: new URLSearchParams(location.search),
};
export function setProfile(p) {
    app.profile = p;
}

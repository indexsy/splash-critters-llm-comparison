/**
 * Client app store — plain reactive state + settings persistence.
 * Screens subscribe(); net.ts mutates and calls notify().
 */
const DEFAULT_BINDS = {
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    balloon: ['Space', 'KeyE'],
};
function loadSettings() {
    const base = {
        sfx: 0.7,
        music: 0.4,
        muted: false,
        reduceShake: false,
        colorblind: false,
        binds: JSON.parse(JSON.stringify(DEFAULT_BINDS)),
    };
    try {
        const raw = localStorage.getItem('splash.settings');
        if (raw) {
            const s = JSON.parse(raw);
            Object.assign(base, s);
            base.binds = { ...DEFAULT_BINDS, ...(s.binds ?? {}) };
        }
    }
    catch {
        /* ignore corrupt settings */
    }
    return base;
}
export class Store {
    screen = 'boot';
    connected = false;
    profile = null;
    token = null;
    ping = 0;
    roomList = [];
    lobby = null;
    queue = null;
    matchConfig = null;
    matchTheme = 'backyard';
    result = null;
    lastXp = null;
    leaderboard = null;
    tutorialSeen = false;
    settings = loadSettings();
    listeners = new Set();
    constructor() {
        this.token = localStorage.getItem('splash.token');
        this.tutorialSeen = localStorage.getItem('splash.tutorial') === '1';
    }
    subscribe(cb) {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }
    notify() {
        for (const cb of this.listeners)
            cb();
    }
    saveSettings() {
        localStorage.setItem('splash.settings', JSON.stringify(this.settings));
        this.notify();
    }
    saveToken(token) {
        this.token = token;
        localStorage.setItem('splash.token', token);
    }
    markTutorialSeen() {
        this.tutorialSeen = true;
        localStorage.setItem('splash.tutorial', '1');
    }
    actionForCode(code) {
        for (const action of Object.keys(this.settings.binds)) {
            if (this.settings.binds[action].includes(code))
                return action;
        }
        return null;
    }
}
export const store = new Store();
//# sourceMappingURL=store.js.map
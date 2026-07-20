/**
 * Keyboard input. Tracks held movement keys (last-pressed wins), the balloon
 * edge, emote keys (1-4) and mute (M). Also supports capturing a key for rebinding.
 */
import { store } from './store';
const MOVE = ['up', 'down', 'left', 'right'];
const ACTION_DIR = { up: 'up', down: 'down', left: 'left', right: 'right' };
export class InputManager {
    held = new Set();
    order = [];
    balloonEdge = false;
    emotes = [];
    capture = null;
    enabled = true;
    onMute = () => { };
    start() {
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));
        window.addEventListener('blur', () => this.reset());
    }
    setCapture(cb) {
        this.capture = cb;
    }
    onKeyDown(e) {
        if (this.capture) {
            e.preventDefault();
            const cb = this.capture;
            this.capture = null;
            cb(e.code);
            return;
        }
        const action = store.actionForCode(e.code);
        if (action || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
            e.preventDefault();
        if (e.repeat)
            return;
        if (e.code === 'KeyM') {
            store.settings.muted = !store.settings.muted;
            store.saveSettings();
            this.onMute();
            return;
        }
        if (/^Digit[1-4]$/.test(e.code)) {
            this.emotes.push(Number(e.code.slice(5)));
            return;
        }
        if (!action)
            return;
        if (MOVE.includes(action)) {
            this.held.add(action);
            this.order = this.order.filter((a) => a !== action);
            this.order.push(action);
        }
        else if (action === 'balloon') {
            this.balloonEdge = true;
        }
    }
    onKeyUp(e) {
        const action = store.actionForCode(e.code);
        if (!action)
            return;
        if (MOVE.includes(action)) {
            this.held.delete(action);
            this.order = this.order.filter((a) => a !== action);
        }
    }
    reset() {
        this.held.clear();
        this.order = [];
    }
    pollDir() {
        if (!this.enabled)
            return null;
        for (let i = this.order.length - 1; i >= 0; i--) {
            const a = this.order[i];
            if (this.held.has(a))
                return ACTION_DIR[a];
        }
        return null;
    }
    takeBalloon() {
        if (!this.enabled) {
            this.balloonEdge = false;
            return false;
        }
        const b = this.balloonEdge;
        this.balloonEdge = false;
        return b;
    }
    takeEmote() {
        if (!this.emotes.length)
            return null;
        return this.emotes.shift() ?? null;
    }
}
export const input = new InputManager();
//# sourceMappingURL=input.js.map
/**
 * Keyboard input. Tracks held movement keys (last-pressed wins), the balloon
 * edge, emote keys (1-4) and mute (M). Also supports capturing a key for rebinding.
 */
import type { Dir } from '@splash/shared';
export declare class InputManager {
    private held;
    private order;
    private balloonEdge;
    private emotes;
    private capture;
    enabled: boolean;
    onMute: () => void;
    start(): void;
    setCapture(cb: (code: string) => void): void;
    private onKeyDown;
    private onKeyUp;
    private reset;
    pollDir(): Dir | null;
    takeBalloon(): boolean;
    takeEmote(): number | null;
}
export declare const input: InputManager;
//# sourceMappingURL=input.d.ts.map
/**
 * Chiptune audio via Web Audio oscillators + noise. All SFX are synthesized;
 * a tiny sequencer loops a per-screen tune that speeds up in showdown.
 */
export declare class AudioEngine {
    private ctx;
    private master;
    private sfxGain;
    private musicGain;
    sfxVol: number;
    musicVol: number;
    muted: boolean;
    private noise;
    private seqTimer;
    private step;
    private stepMs;
    private track;
    private showdown;
    resume(): void;
    setVolumes(sfx: number, music: number, muted: boolean): void;
    private applyVolumes;
    private tone;
    private noiseBurst;
    sfx(name: string, arg?: number): void;
    startMusic(track: 'menu' | 'game'): void;
    setShowdown(on: boolean): void;
    stopMusic(): void;
    private tick;
}
export declare const audio: AudioEngine;
//# sourceMappingURL=audio.d.ts.map
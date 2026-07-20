/**
 * Lightweight particle system (droplets, castle crumble bits, pickup sparkles).
 * Coordinates are in backbuffer pixels.
 */
export declare class Particles {
    private parts;
    private add;
    splash(x: number, y: number, color: string, count?: number): void;
    crumble(x: number, y: number, color: string): void;
    sparkle(x: number, y: number, color: string): void;
    update(dt: number): void;
    draw(ctx: CanvasRenderingContext2D): void;
    clear(): void;
}
//# sourceMappingURL=particles.d.ts.map
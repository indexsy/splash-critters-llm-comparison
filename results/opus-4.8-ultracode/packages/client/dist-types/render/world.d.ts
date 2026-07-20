/**
 * Draws the arena board and all live entities from a RenderView into the
 * 256x224 backbuffer. Pure drawing — no state.
 */
import { type MapTheme } from '@splash/shared';
import type { RenderView } from '../prediction';
import type { Particles } from './particles';
export interface Board {
    tile: number;
    ox: number;
    oy: number;
    width: number;
    height: number;
}
export declare function computeBoard(width: number, height: number, topHud: number): Board;
export declare function drawWorld(ctx: CanvasRenderingContext2D, view: RenderView, grid: number[], board: Board, theme: MapTheme, particles: Particles, opts: {
    colorblind: boolean;
    nowMs: number;
}): void;
//# sourceMappingURL=world.d.ts.map
/**
 * Procedural 8-bit sprites: critters (+hats, walk cycle, facing, dramatic soak),
 * water balloons, sandcastles, tiles, splash sprays, power-ups and rubber ducks.
 * All drawn with primitives so they scale cleanly to any tile size.
 */
import type { AnimalId, Dir, HatId, MapTheme, PowerUpType } from '@splash/shared';
export interface CritterOpts {
    animal: AnimalId;
    hat: HatId;
    cx: number;
    cy: number;
    size: number;
    facing: Dir;
    frame: 0 | 1;
    moving: boolean;
    ownerSlot: number;
    soaked?: boolean;
    soakT?: number;
    colorblind?: boolean;
}
export declare function drawCritter(ctx: CanvasRenderingContext2D, o: CritterOpts): void;
export declare function drawBalloon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, ownerSlot: number, wobbleT: number, fuseFrac: number, colorblind: boolean): void;
export declare function drawFloor(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, theme: MapTheme): void;
export declare function drawBoulder(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, theme: MapTheme): void;
export declare function drawSandcastle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, theme: MapTheme, crumble?: number): void;
export declare function drawFlood(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, theme: MapTheme, t: number): void;
export declare function drawSplashCell(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, ownerSlot: number, life: number, // 0..1 (1 = fresh)
center: boolean, colorblind: boolean): void;
export declare function drawPowerup(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, kind: PowerUpType, bobT: number): void;
export declare function drawDuck(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, ownerSlot: number, colorblind: boolean): void;
export declare function drawLob(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, ownerSlot: number, colorblind: boolean): void;
//# sourceMappingURL=sprites.d.ts.map
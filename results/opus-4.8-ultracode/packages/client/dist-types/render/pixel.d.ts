/**
 * Low-level 2D canvas helpers. Everything renders into the 256x224 backbuffer
 * which is then integer-scaled with image-rendering: pixelated, so plain
 * fillRect / fillText at small sizes reads as chunky pixel art after upscale.
 */
export declare const VW = 256;
export declare const VH = 224;
export declare function prepare(ctx: CanvasRenderingContext2D): void;
export declare function clear(ctx: CanvasRenderingContext2D, color: string): void;
export declare function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void;
export declare function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string): void;
export declare function circle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void;
export declare function ellipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string): void;
export type TextAlign = 'left' | 'center' | 'right';
export declare function text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, opts?: {
    color?: string;
    size?: number;
    align?: TextAlign;
    bold?: boolean;
    shadow?: string;
}): void;
/** Small deterministic hash for tile variants. */
export declare function hash2(x: number, y: number): number;
export declare function withAlpha(ctx: CanvasRenderingContext2D, a: number, fn: () => void): void;
//# sourceMappingURL=pixel.d.ts.map
/**
 * In-canvas HUD: top per-player strip (icon, name, round pips, live stats, ping),
 * plus the kill feed and centred announcer pops.
 */
import type { MatchConfig, Snapshot } from '@splash/shared';
export declare const HUD_H = 28;
export interface FeedItem {
    text: string;
    ms: number;
    color: string;
}
export interface Announce {
    text: string;
    ms: number;
    color: string;
    big: boolean;
}
export declare function drawHud(ctx: CanvasRenderingContext2D, snap: Snapshot | null, config: MatchConfig, ping: number, roundNo: number, nowMs: number, colorblind: boolean): void;
export declare function drawFeed(ctx: CanvasRenderingContext2D, feed: FeedItem[], nowMs: number): void;
export declare function drawAnnounce(ctx: CanvasRenderingContext2D, ann: Announce | null, nowMs: number): void;
export declare function drawBanner(ctx: CanvasRenderingContext2D, msg: string, sub: string): void;
//# sourceMappingURL=hud.d.ts.map
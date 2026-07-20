/**
 * WorldView — client-side prediction for the local player (replay-reconciled,
 * no drag) + snapshot interpolation for everything else. Rebuilds the round's
 * grid from the seed so predicted movement uses the exact sim collision rules.
 */
import { type AnimalId, type Dir, type HatId, type MapTheme, type MatchConfig, type PlayerInput, type Snapshot } from '@splash/shared';
export interface RenderPlayer {
    slot: number;
    animal: AnimalId;
    hat: HatId;
    name: string;
    x: number;
    y: number;
    facing: Dir;
    moving: boolean;
    alive: boolean;
    revenge: boolean;
    soaked: boolean;
    soakElapsed: number;
    emoteId: number;
    emoteUntilTick: number;
    isLocal: boolean;
    connected: boolean;
}
export interface RenderBalloon {
    x: number;
    y: number;
    ownerSlot: number;
    fuseFrac: number;
    ghost?: boolean;
}
export interface RenderView {
    serverTick: number;
    players: RenderPlayer[];
    balloons: RenderBalloon[];
    splashes: Snapshot['splashes'];
    powerups: Snapshot['powerups'];
    lobs: Snapshot['revengeLobs'];
    tideLevel: number;
}
export declare class WorldView {
    config: MatchConfig;
    theme: MapTheme;
    localId: string;
    localSlot: number;
    width: number;
    height: number;
    grid: number[];
    roundNo: number;
    private world;
    private snapPrev;
    private snapCur;
    private offset;
    private offsetInit;
    private predictedTick;
    private started;
    private inputBuf;
    private ghosts;
    private identities;
    private soakInfo;
    constructor(config: MatchConfig, localId: string, theme: MapTheme);
    startRound(mapSeed: number, roundNo: number, theme: MapTheme): void;
    private localPlayer;
    onSnapshot(snap: Snapshot): void;
    private applyTide;
    /** Apply grid-changing events (castle washes). Called from the game screen. */
    applyEvents(events: {
        t: string;
        x?: number;
        y?: number;
        level?: number;
    }[]): void;
    /** One fixed 30Hz prediction step for the local player. */
    fixedStep(input: PlayerInput): void;
    localTile(): {
        x: number;
        y: number;
    } | null;
    localAlive(): boolean;
    renderView(nowMs: number): RenderView | null;
}
//# sourceMappingURL=prediction.d.ts.map
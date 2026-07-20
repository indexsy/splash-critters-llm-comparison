/**
 * Client app store — plain reactive state + settings persistence.
 * Screens subscribe(); net.ts mutates and calls notify().
 */
import type { LeaderboardEntry, LobbyState, MapTheme, MatchConfig, MatchResult, Mode, ProfileDTO, RoomListItem } from '@splash/shared';
export type ScreenName = 'boot' | 'title' | 'tutorial' | 'menu' | 'browser' | 'lobby' | 'queue' | 'game' | 'results' | 'leaderboard' | 'locker' | 'settings' | 'howto';
export type BindAction = 'up' | 'down' | 'left' | 'right' | 'balloon';
export interface Settings {
    sfx: number;
    music: number;
    muted: boolean;
    reduceShake: boolean;
    colorblind: boolean;
    binds: Record<BindAction, string[]>;
}
export interface QueueInfo {
    mode: Mode;
    elapsed: number;
    searchRange: number;
    size: number;
}
export declare class Store {
    screen: ScreenName;
    connected: boolean;
    profile: ProfileDTO | null;
    token: string | null;
    ping: number;
    roomList: RoomListItem[];
    lobby: LobbyState | null;
    queue: QueueInfo | null;
    matchConfig: MatchConfig | null;
    matchTheme: MapTheme;
    result: MatchResult | null;
    lastXp: {
        xp: number;
        level: number;
        leveledUp: boolean;
        unlocked: string[];
    } | null;
    leaderboard: {
        mode: Mode;
        entries: LeaderboardEntry[];
    } | null;
    tutorialSeen: boolean;
    settings: Settings;
    private listeners;
    constructor();
    subscribe(cb: () => void): () => void;
    notify(): void;
    saveSettings(): void;
    saveToken(token: string): void;
    markTutorialSeen(): void;
    actionForCode(code: string): BindAction | null;
}
export declare const store: Store;
//# sourceMappingURL=store.d.ts.map
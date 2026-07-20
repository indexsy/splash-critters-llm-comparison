/**
 * WebSocket client: connects, says hello, dispatches ServerMsg into the store +
 * screen navigation, and forwards live match messages to the active game screen.
 */
import type { ClientMsg, MatchConfig, MatchResult, ServerMsg, Snapshot, SimEvent } from '@splash/shared';
import { type ScreenName } from './store';
export interface MatchHandlers {
    onMatchStart?(config: MatchConfig): void;
    onRoundStart?(msg: Extract<ServerMsg, {
        type: 'round_start';
    }>): void;
    onSnapshot?(snap: Snapshot): void;
    onEvent?(tick: number, events: SimEvent[]): void;
    onRoundEnd?(msg: Extract<ServerMsg, {
        type: 'round_end';
    }>): void;
    onMatchEnd?(result: MatchResult): void;
}
export declare class NetClient {
    private ws;
    private reconnectTimer;
    private backoff;
    private lag;
    navigate: (s: ScreenName) => void;
    toast: (msg: string, bad?: boolean) => void;
    handlers: MatchHandlers;
    connect(): void;
    private scheduleReconnect;
    send(msg: ClientMsg): void;
    private dispatch;
}
export declare const net: NetClient;
export declare function fetchLeaderboard(mode: string): Promise<void>;
//# sourceMappingURL=net.d.ts.map
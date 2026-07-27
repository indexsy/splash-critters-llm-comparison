/**
 * One tiny observable app state. Screens read from it and subscribe; only net.ts
 * and explicit user actions write to it.
 */

import type {
  LobbyState,
  MatchConfig,
  MatchEndMsg,
  PlayerProfile,
  QueueStatusMsg,
  RematchStateMsg,
  RoomSummary,
} from '@splash/shared';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'good';
  msg: string;
  at: number;
}

export interface AppState {
  connected: boolean;
  /** True once `welcome` has landed. */
  ready: boolean;
  playerId: string | null;
  profile: PlayerProfile | null;
  queue: QueueStatusMsg | null;
  rooms: RoomSummary[];
  lobby: LobbyState | null;
  match: MatchConfig | null;
  matchEnd: MatchEndMsg | null;
  rematch: RematchStateMsg | null;
  toasts: Toast[];
  /** Latest measured round-trip time in ms. */
  ping: number;
}

const initial: AppState = {
  connected: false,
  ready: false,
  playerId: null,
  profile: null,
  queue: null,
  rooms: [],
  lobby: null,
  match: null,
  matchEnd: null,
  rematch: null,
  toasts: [],
  ping: 0,
};

type Listener = (state: AppState) => void;

let state: AppState = initial;
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): AppState {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener(state);
  return state;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let toastId = 0;

export function pushToast(kind: Toast['kind'], msg: string, ttlMs = 4000): void {
  const toast: Toast = { id: ++toastId, kind, msg, at: Date.now() };
  setState({ toasts: [...state.toasts, toast] });
  window.setTimeout(() => {
    setState({ toasts: state.toasts.filter((t) => t.id !== toast.id) });
  }, ttlMs);
}

/** Slot this client controls in the live match, or -1. */
export function mySlot(): number {
  return state.match?.yourSlot ?? -1;
}

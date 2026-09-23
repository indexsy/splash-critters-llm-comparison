// Tiny typed observable app store. The global server-message controller (app.ts) writes it;
// screens read it and subscribe for re-renders. State objects are replaced, never mutated,
// so subscribers can compare `next.x !== prev.x` cheaply.
import type {
  ErrorCode,
  LobbyState,
  MatchConfig,
  MatchEndMsg,
  MsgOf,
  Profile,
  RoomSummary,
  S2C,
} from '@splash/shared';

export type QueueInfo = Omit<MsgOf<S2C, 'queue_status'>, 'type'>;
export type MatchFoundInfo = Omit<MsgOf<S2C, 'match_found'>, 'type'>;
export type TutorialStepInfo = Omit<MsgOf<S2C, 'tutorial_step'>, 'type'>;

export interface AppError {
  code: ErrorCode;
  msg: string;
  /** Date.now() when received, so repeated identical errors are distinguishable. */
  at: number;
}

export interface AppState {
  /** True once the server has welcomed this socket (session ready), false while disconnected. */
  connected: boolean;
  profile: Profile | null;
  lobby: LobbyState | null;
  roomList: RoomSummary[];
  queue: QueueInfo | null;
  matchFound: MatchFoundInfo | null;
  match: MatchConfig | null;
  matchEnd: MatchEndMsg | null;
  tutorialStep: TutorialStepInfo | null;
  lastError: AppError | null;
}

type Listener = (next: AppState, prev: AppState) => void;

let state: AppState = {
  connected: false,
  profile: null,
  lobby: null,
  roomList: [],
  queue: null,
  matchFound: null,
  match: null,
  matchEnd: null,
  tutorialStep: null,
  lastError: null,
};

const listeners = new Set<Listener>();

function changes(partial: Partial<AppState>): boolean {
  return (Object.keys(partial) as (keyof AppState)[]).some((k) => partial[k] !== state[k]);
}

export const store = {
  get(): Readonly<AppState> {
    return state;
  },

  /** Shallow-merge `partial`; subscribers run only if at least one field actually changed. */
  update(partial: Partial<AppState>): void {
    if (!changes(partial)) return;
    const prev = state;
    state = { ...state, ...partial };
    for (const fn of [...listeners]) {
      try {
        fn(state, prev);
      } catch (err) {
        console.error('[store] listener failed', err);
      }
    }
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

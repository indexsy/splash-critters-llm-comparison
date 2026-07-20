/**
 * Screen contract + navigation handle (assigned by main.ts).
 */

import type { ScreenName } from './store';

export interface ScreenInstance {
  unmount(): void;
  /** optional per-frame hook (used by the game screen) */
  onFrame?(dtMs: number, nowMs: number): void;
}

export type ScreenMount = (root: HTMLElement) => ScreenInstance;

export const nav: { go: (name: ScreenName) => void } = {
  go: () => {},
};

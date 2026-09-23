// Pure keybind helpers for the settings screen's remapping table.
import { BIND_ACTIONS, type BindAction, type Keybinds } from '../../settings';

/** Keys that clear a binding while capturing instead of being bound. */
export const CLEAR_KEYS: ReadonlySet<string> = new Set(['Backspace', 'Delete']);

/** The action other than `except` that currently uses `code`, or null. */
export function bindOwner(keybinds: Keybinds, code: string, except: BindAction): BindAction | null {
  return BIND_ACTIONS.find((a) => a !== except && keybinds[a].includes(code)) ?? null;
}

/** Actions left without any key (the player should be warned). */
export function unboundActions(keybinds: Keybinds): BindAction[] {
  return BIND_ACTIONS.filter((a) => keybinds[a].length === 0);
}

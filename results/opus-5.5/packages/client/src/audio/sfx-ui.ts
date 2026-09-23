// Interface blips: menu navigation, confirm/back, XP count-up ticks and errors.
import { hz } from './notes';
import { tone, type Sink } from './synth';
import { PRIORITY, type SfxDef } from './types';

type UiSfx = 'ui_move' | 'ui_select' | 'ui_back' | 'xp_tick' | 'error';

/** xp_tick rises one semitone per tick index, capped at an octave. */
const XP_TICK_MAX_RISE = 12;

function uiMove(v: Sink, at: number): void {
  tone(v, { wave: 'pulse12', freq: 1320, at, dur: 0.03, vol: 0.09, attack: 0.001, release: 0.012 });
}

function uiSelect(v: Sink, at: number): void {
  tone(v, { wave: 'pulse25', freq: hz('E6'), at, dur: 0.045, vol: 0.12, release: 0.012 });
  tone(v, { wave: 'pulse25', freq: hz('A6'), at: at + 0.045, dur: 0.08, vol: 0.12, release: 0.03 });
}

function uiBack(v: Sink, at: number): void {
  tone(v, { wave: 'pulse25', freq: hz('A5'), at, dur: 0.045, vol: 0.11, release: 0.012 });
  tone(v, { wave: 'pulse25', freq: hz('E5'), at: at + 0.045, dur: 0.08, vol: 0.11, release: 0.03 });
}

function xpTick(v: Sink, at: number, level: number): void {
  const rise = Math.max(0, Math.min(XP_TICK_MAX_RISE, Math.round(level) - 1));
  tone(v, { wave: 'pulse12', freq: 1400 * Math.pow(2, rise / 12), at, dur: 0.028, vol: 0.07, attack: 0.001, release: 0.01 });
}

/** Two low detuned buzzes. */
function error(v: Sink, at: number): void {
  for (const offset of [0, 0.1]) {
    tone(v, { wave: 'square', freq: 150, detune: -12, at: at + offset, dur: 0.075, vol: 0.12, release: 0.015 });
    tone(v, { wave: 'square', freq: 150, detune: 12, at: at + offset, dur: 0.075, vol: 0.12, release: 0.015 });
  }
}

export const UI_SFX: Record<UiSfx, SfxDef> = {
  ui_move: { priority: PRIORITY.ambient, play: uiMove },
  ui_select: { priority: PRIORITY.action, play: uiSelect },
  ui_back: { priority: PRIORITY.action, play: uiBack },
  xp_tick: { priority: PRIORITY.ambient, play: xpTick },
  error: { priority: PRIORITY.action, play: error },
};

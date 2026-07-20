/**
 * Slot definition shared by Room (lobby management) and Match (runtime),
 * kept here to avoid a room<->match import cycle.
 */

import type { AnimalId, Difficulty, HatId } from '@splash/shared';
import type { BotController } from './bots/bot';
import type { Client } from './net';

export interface Slot {
  index: number;
  kind: 'empty' | 'human' | 'bot' | 'closed';

  // human occupant
  client?: Client;

  // bot config (lobby) + live controller (match)
  botDifficulty?: Difficulty;
  bot?: BotController;

  // identity captured at match start (stable for the whole match)
  playerId?: string;
  name?: string;
  animal?: AnimalId;
  hat?: HatId;
  rating?: number;
  level?: number;
  isBot?: boolean;

  ready: boolean;
  forfeited: boolean;
}

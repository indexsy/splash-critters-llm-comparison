/**
 * GameState construction, per-round reset and deep cloning.
 * cloneState() is what the client snapshots before rewind-replay reconciliation.
 */

import { CONFIG } from './config';
import { generateMap } from './map';
import {
  type Balloon,
  type Dir,
  type GameState,
  type GroundPowerUp,
  type Mode,
  type Player,
  type RevengeLob,
  type SplashCell,
} from './types';

export interface RoundPlayerInit {
  id: string;
  slot: number;
  name: string;
  animal: Player['animal'];
  hat: Player['hat'];
  isBot: boolean;
  botDifficulty?: Player['botDifficulty'];
  roundWins: number;
  connected: boolean;
}

export interface RoundInit {
  mode: Mode;
  mapSeed: number;
  roundNo: number;
  players: RoundPlayerInit[];
  revengeEnabled: boolean;
}

function freshPlayer(
  init: RoundPlayerInit,
  spawn: { x: number; y: number },
  slot: number,
  playerCount: number,
): Player {
  return {
    id: init.id,
    slot,
    name: init.name,
    animal: init.animal,
    hat: init.hat,
    isBot: init.isBot,
    botDifficulty: init.botDifficulty,
    connected: init.connected,
    x: spawn.x,
    y: spawn.y,
    facing: 'down' as Dir,
    moving: false,
    alive: true,
    soakedTick: -1,
    speed: CONFIG.SPEED_BASE,
    maxBalloons: CONFIG.BALLOON_BASE,
    range: CONFIG.RANGE_BASE,
    hasKick: false,
    kickUsed: false,
    activeBalloons: 0,
    soaks: 0,
    castlesWashed: 0,
    roundWins: init.roundWins,
    revenge: false,
    revengeT: slot / Math.max(1, playerCount),
    revengeCooldown: 0,
    emoteId: 0,
    emoteUntilTick: 0,
  };
}

export function createRoundState(init: RoundInit): GameState {
  const map = generateMap(init.mapSeed, init.mode);
  const count = init.players.length;
  const players = init.players
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((p) => freshPlayer(p, map.spawns[p.slot] ?? map.spawns[0], p.slot, count));

  return {
    mode: init.mode,
    width: map.width,
    height: map.height,
    tick: 0,
    grid: map.grid,
    castleContents: map.castleContents,
    players,
    balloons: [],
    splashes: [],
    powerups: [],
    revengeLobs: [],
    tideLevel: 0,
    mapSeed: init.mapSeed,
    roundNo: init.roundNo,
    nextBalloonId: 1,
    nextLobId: 1,
    revengeEnabled: init.revengeEnabled,
    roundOver: false,
    winnerSlot: null,
  };
}

function cloneBalloon(b: Balloon): Balloon {
  return {
    id: b.id,
    owner: b.owner,
    x: b.x,
    y: b.y,
    fuseTick: b.fuseTick,
    range: b.range,
    sliding: b.sliding,
    slideFrom: b.slideFrom ? { x: b.slideFrom.x, y: b.slideFrom.y } : null,
    passableOwners: b.passableOwners.slice(),
  };
}

function clonePlayer(p: Player): Player {
  return { ...p };
}

function cloneSplash(s: SplashCell): SplashCell {
  return { x: s.x, y: s.y, expiresTick: s.expiresTick, ownerSlot: s.ownerSlot, center: s.center };
}

function clonePowerup(p: GroundPowerUp): GroundPowerUp {
  return { x: p.x, y: p.y, type: p.type };
}

function cloneLob(l: RevengeLob): RevengeLob {
  return { id: l.id, owner: l.owner, x: l.x, y: l.y, dir: l.dir, tilesLeft: l.tilesLeft, stepTick: l.stepTick };
}

/** Deep clone — used by the client to snapshot before replaying buffered inputs. */
export function cloneState(s: GameState): GameState {
  return {
    mode: s.mode,
    width: s.width,
    height: s.height,
    tick: s.tick,
    grid: s.grid.slice(),
    castleContents: s.castleContents.slice(),
    players: s.players.map(clonePlayer),
    balloons: s.balloons.map(cloneBalloon),
    splashes: s.splashes.map(cloneSplash),
    powerups: s.powerups.map(clonePowerup),
    revengeLobs: s.revengeLobs.map(cloneLob),
    tideLevel: s.tideLevel,
    mapSeed: s.mapSeed,
    roundNo: s.roundNo,
    nextBalloonId: s.nextBalloonId,
    nextLobId: s.nextLobId,
    revengeEnabled: s.revengeEnabled,
    roundOver: s.roundOver,
    winnerSlot: s.winnerSlot,
  };
}

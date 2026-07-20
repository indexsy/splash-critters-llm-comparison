import { CONFIG } from '../src/config';
import type { Balloon, GameState, Player, PlayerInput } from '../src/types';

/** A blank arena (all empty tiles) with no players — for controlled sim tests. */
export function blankState(w = 11, h = 11): GameState {
  return {
    mode: 'ffa',
    width: w,
    height: h,
    tick: 0,
    grid: new Array(w * h).fill(0),
    castleContents: new Array(w * h).fill(null),
    players: [],
    balloons: [],
    splashes: [],
    powerups: [],
    revengeLobs: [],
    tideLevel: 0,
    mapSeed: 1,
    roundNo: 1,
    nextBalloonId: 1,
    nextLobId: 1,
    revengeEnabled: false,
    roundOver: false,
    winnerSlot: null,
  };
}

export function addBalloon(
  state: GameState,
  x: number,
  y: number,
  opts: Partial<Balloon> = {},
): Balloon {
  const b: Balloon = {
    id: state.nextBalloonId++,
    owner: opts.owner ?? 'p0',
    x,
    y,
    fuseTick: opts.fuseTick ?? state.tick + CONFIG.FUSE_TICKS,
    range: opts.range ?? 2,
    sliding: opts.sliding ?? null,
    slideFrom: opts.slideFrom ?? null,
    passableOwners: opts.passableOwners ?? [],
  };
  state.balloons.push(b);
  return b;
}

export function addPlayer(state: GameState, x: number, y: number, opts: Partial<Player> = {}): Player {
  const slot = opts.slot ?? state.players.length;
  const p: Player = {
    id: opts.id ?? `p${slot}`,
    slot,
    name: opts.name ?? `P${slot}`,
    animal: 'frog',
    hat: 'none',
    isBot: false,
    connected: true,
    x,
    y,
    facing: 'down',
    moving: false,
    alive: true,
    soakedTick: -1,
    speed: opts.speed ?? CONFIG.SPEED_BASE,
    maxBalloons: opts.maxBalloons ?? CONFIG.BALLOON_BASE,
    range: opts.range ?? CONFIG.RANGE_BASE,
    hasKick: opts.hasKick ?? false,
    kickUsed: false,
    activeBalloons: 0,
    soaks: 0,
    castlesWashed: 0,
    roundWins: 0,
    revenge: false,
    revengeT: 0,
    revengeCooldown: 0,
    emoteId: 0,
    emoteUntilTick: 0,
    ...opts,
  };
  state.players.push(p);
  return p;
}

export function input(dir: PlayerInput['dir'] = null, balloon = false): PlayerInput {
  return { seq: 0, tick: 0, dir, balloon };
}

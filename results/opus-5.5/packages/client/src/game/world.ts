// The client's copy of a round: built from round_start (tile grid, spawns, rules) and kept in
// step with the server by snapshots (dynamic state) and `event` messages (tiles, items,
// balloons, soaks, tide), which are applied the moment they arrive.
import {
  CONFIG,
  Dir,
  PowerUp,
  Tile,
  createRoundState,
  decodeTiles,
  idx,
  inBounds,
  passMaskForTile,
  tileCenter,
  tileOf,
  type GameEvent,
  type GeneratedMap,
  type MatchConfig,
  type PlayerState,
  type RoundStartMsg,
  type RoundState,
} from '@splash/shared';

const NO_SLOTS: ReadonlySet<number> = new Set();

/**
 * round_start spawn coordinates are tile coordinates; a value beyond the arena can only be a
 * sub-unit position, which is converted so a server using either convention places critters
 * correctly during the 3-2-1 intro (snapshots take over from the first tick).
 */
function spawnTile(v: number, size: number): number {
  return v >= size ? tileOf(v) : v;
}

/**
 * Slots taking part in this round: seated in the match, given a spawn by the server and not
 * `absent` (ranked players who forfeited earlier in the match).
 */
export function presentSlots(config: MatchConfig, rs: RoundStartMsg, absent: ReadonlySet<number> = NO_SLOTS): boolean[] {
  const seated = new Set(config.players.map((p) => p.slot));
  const maxSlot = Math.max(
    CONFIG.MODES[config.mode].maxPlayers - 1,
    ...config.players.map((p) => p.slot),
    ...rs.spawns.map((s) => s.slot),
  );
  const present = new Array<boolean>(maxSlot + 1).fill(false);
  for (const s of rs.spawns) if (seated.has(s.slot) && !absent.has(s.slot)) present[s.slot] = true;
  return present;
}

/** Fresh client round state for a round_start (hidden contents are always unknown: zeros). */
export function buildRoundWorld(config: MatchConfig, rs: RoundStartMsg, absent: ReadonlySet<number> = NO_SLOTS): RoundState {
  const tiles = decodeTiles(rs.castleGrid);
  if (tiles.length !== rs.w * rs.h) throw new Error(`round_start: grid is ${tiles.length} tiles, expected ${rs.w}x${rs.h}`);
  const map: GeneratedMap = {
    w: rs.w,
    h: rs.h,
    tiles,
    hidden: new Uint8Array(rs.w * rs.h),
    spawns: rs.spawns.map((s) => ({ slot: s.slot, tx: spawnTile(s.x, rs.w), ty: spawnTile(s.y, rs.h) })),
  };
  const state = createRoundState(map, presentSlots(config, rs, absent), { ...config.rules, tideStartTick: rs.tideStartTick });
  if (rs.resumeTick !== undefined) state.tick = rs.resumeTick;
  return state;
}

/** Takes a player out of the round for good (a ranked forfeit): not drawn, not counted. */
export function leaveRound(p: PlayerState): void {
  p.present = false;
  p.alive = false;
  p.moving = false;
  p.duckPos = -1;
}

/**
 * Snapshots list exactly the players taking part, so a present slot missing from one has left
 * the round (the server drops a ranked forfeit from the round it is playing).
 */
export function syncPresence(s: RoundState, inSnapshot: ReadonlySet<number>): void {
  for (const p of s.players) {
    if (inSnapshot.has(p.slot)) p.present = true;
    else if (p.present) leaveRound(p);
  }
}

function removeBalloon(s: RoundState, id: number): void {
  const i = s.balloons.findIndex((b) => b.id === id);
  if (i >= 0) s.balloons.splice(i, 1);
}

function addBalloon(
  s: RoundState,
  spec: { id: number; owner: number; tx: number; ty: number; tick: number; fuse: number; range: number; fromDuck: boolean },
): void {
  if (!inBounds(s.w, s.h, spec.tx, spec.ty) || s.balloons.some((b) => b.id === spec.id)) return;
  s.balloons.push({
    id: spec.id,
    owner: spec.owner,
    tx: spec.tx,
    ty: spec.ty,
    x: tileCenter(spec.tx),
    y: tileCenter(spec.ty),
    placedTick: spec.tick,
    burstTick: spec.tick + spec.fuse,
    range: spec.range,
    slideDir: 0,
    passMask: spec.fromDuck ? 0 : passMaskForTile(s, spec.tx, spec.ty),
    fromDuck: spec.fromDuck,
  });
  s.balloons.sort((a, b) => a.id - b.id);
}

function setItem(s: RoundState, x: number, y: number, kind: number): void {
  if (inBounds(s.w, s.h, x, y)) s.items[idx(s.w, x, y)] = kind;
}

/**
 * Mirror one server event onto a client world, the moment it arrives (`tick` = the tick the
 * event happened on). Balloons announced by events use the server's ids, so the next snapshot
 * simply confirms them.
 */
export function applyWorldEvent(s: RoundState, ev: GameEvent, tick: number): void {
  switch (ev.type) {
    case 'castle_washed':
      if (inBounds(s.w, s.h, ev.x, ev.y)) s.tiles[idx(s.w, ev.x, ev.y)] = Tile.Floor;
      break;
    case 'powerup_revealed':
      setItem(s, ev.x, ev.y, ev.kind);
      break;
    case 'powerup_collected':
    case 'powerup_destroyed':
      setItem(s, ev.x, ev.y, PowerUp.None);
      break;
    case 'balloon_placed':
      addBalloon(s, {
        id: ev.id,
        owner: ev.owner,
        tx: ev.x,
        ty: ev.y,
        tick,
        fuse: CONFIG.FUSE_TICKS,
        range: s.players[ev.owner]?.range ?? CONFIG.RANGE_BASE,
        fromDuck: false,
      });
      break;
    case 'revenge_lob':
      addBalloon(s, { id: ev.id, owner: ev.slot, tx: ev.toX, ty: ev.toY, tick, fuse: CONFIG.DUCK_FUSE_TICKS, range: CONFIG.DUCK_BALLOON_RANGE, fromDuck: true });
      break;
    case 'balloon_burst':
    case 'balloon_fizzled':
      removeBalloon(s, ev.id);
      break;
    case 'balloon_kicked': {
      const b = s.balloons.find((x) => x.id === ev.id);
      if (b) {
        b.slideDir = ev.dir;
        b.passMask = 0;
      }
      break;
    }
    case 'balloon_stopped': {
      // Park it now: the renderer would otherwise glide it past the snapshot into its blocker.
      const b = s.balloons.find((x) => x.id === ev.id);
      if (b && inBounds(s.w, s.h, ev.x, ev.y)) {
        b.slideDir = Dir.None;
        b.tx = ev.x;
        b.ty = ev.y;
        b.x = tileCenter(ev.x);
        b.y = tileCenter(ev.y);
      }
      break;
    }
    case 'player_soaked': {
      const p = s.players[ev.slot];
      if (p && p.alive) {
        p.alive = false;
        p.moving = false;
        p.soakedTick = tick;
        p.soakedBy = ev.by;
      }
      break;
    }
    case 'tide_advance':
      s.tideLevel = Math.max(s.tideLevel, ev.level);
      break;
    case 'round_over':
      s.over = true;
      s.winner = ev.draw ? -1 : ev.winner;
      break;
    case 'chain_burst':
      break;
  }
}

/** Number of present players still dry. */
export function aliveCount(s: RoundState): number {
  return s.players.reduce((n, p) => n + (p.present && p.alive ? 1 : 0), 0);
}

/** Number of players taking part in the round (dry or not). */
export function presentCount(s: RoundState): number {
  return s.players.reduce((n, p) => n + (p.present ? 1 : 0), 0);
}

/**
 * Showdown tempo (SPEC section 4, "speeds up when 2 players remain"): exactly two critters still
 * dry after the field narrowed. A round that started with only two (a duel) has nothing to
 * narrow, so it speeds up when sudden death begins (the first tide ring).
 */
export function isShowdown(s: RoundState, contenders: number): boolean {
  return aliveCount(s) === 2 && (contenders > 2 || s.tideLevel > 0);
}

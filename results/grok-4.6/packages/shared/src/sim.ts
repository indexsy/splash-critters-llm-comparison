import { CONFIG } from "./config.js";
import { generateMap, resolveTheme } from "./map.js";
import type {
  ArenaState,
  BalloonState,
  Dir,
  HiddenPowerup,
  PlayerInput,
  PlayerState,
  RoundState,
  SimEvent,
  SplashState,
  TileKind,
} from "./types.js";
import { dirVec, inBounds, tileIndex } from "./types.js";

const DIRS: Dir[] = ["up", "down", "left", "right"];

function tileAt(arena: ArenaState, x: number, y: number): TileKind {
  if (!inBounds(x, y, arena.width, arena.height)) return "boulder";
  return arena.tiles[tileIndex(x, y, arena.width)]!;
}

function setTile(arena: ArenaState, x: number, y: number, kind: TileKind): void {
  if (!inBounds(x, y, arena.width, arena.height)) return;
  arena.tiles[tileIndex(x, y, arena.width)] = kind;
}

function balloonAt(state: RoundState, tx: number, ty: number): BalloonState | undefined {
  return state.balloons.find((b) => b.tx === tx && b.ty === ty);
}

function playerTile(p: PlayerState): { tx: number; ty: number } {
  return { tx: Math.floor(p.x + 0.5), ty: Math.floor(p.y + 0.5) };
}

function solidForMove(
  state: RoundState,
  tx: number,
  ty: number,
  mover: PlayerState,
  ignoreOwnBalloon: boolean,
): boolean {
  const t = tileAt(state.arena, tx, ty);
  if (t === "boulder" || t === "castle") return true;
  const b = balloonAt(state, tx, ty);
  if (b) {
    if (ignoreOwnBalloon && b.ownerId === mover.id) {
      const pt = playerTile(mover);
      if (pt.tx === tx && pt.ty === ty) return false;
    }
    if (mover.hasKick && CONFIG.ENABLE_KICK) return false;
    return true;
  }
  return false;
}

function pushEvent(state: RoundState, ev: Omit<SimEvent, "tick"> & { type: SimEvent["type"] }): void {
  state.events.push({ ...ev, tick: state.tick });
}

export function createRound(
  seed: number,
  width: number,
  height: number,
  theme: string,
  players: Omit<PlayerState, "x" | "y" | "dir" | "balloonsOut" | "status" | "soakTick" | "revengeCooldown" | "survivedTicks">[],
): RoundState {
  const resolved = resolveTheme(theme, seed);
  const gen = generateMap(seed, width, height, resolved, players.length);
  const ps: PlayerState[] = players.map((p, i) => {
    const spawn = gen.spawns[i] ?? gen.spawns[0]!;
    return {
      ...p,
      x: spawn.x,
      y: spawn.y,
      dir: "down",
      balloonsOut: 0,
      status: "alive",
      soakTick: 0,
      revengeCooldown: 0,
      survivedTicks: 0,
    };
  });
  return {
    tick: 0,
    arena: gen.arena,
    players: ps,
    balloons: [],
    splashes: [],
    exposed: [],
    hidden: gen.hidden,
    tideRing: 0,
    nextBalloonId: 1,
    nextSplashId: 1,
    events: [],
    hitstop: 0,
    ended: false,
    winnerIds: [],
    draw: false,
  };
}

export function cloneRound(state: RoundState): RoundState {
  return {
    ...state,
    arena: { ...state.arena, tiles: state.arena.tiles.slice() },
    players: state.players.map((p) => ({ ...p })),
    balloons: state.balloons.map((b) => ({ ...b })),
    splashes: state.splashes.map((s) => ({ ...s })),
    exposed: state.exposed.map((e) => ({ ...e })),
    hidden: state.hidden.map((h) => ({ ...h })),
    events: [],
    winnerIds: state.winnerIds.slice(),
  };
}

function tryKick(state: RoundState, player: PlayerState, dir: Dir): boolean {
  if (!player.hasKick || !CONFIG.ENABLE_KICK || dir === "none") return false;
  const d = dirVec(dir);
  const pt = playerTile(player);
  const tx = pt.tx + d.x;
  const ty = pt.ty + d.y;
  const b = balloonAt(state, tx, ty);
  if (!b || b.sliding) return false;
  const nx = tx + d.x;
  const ny = ty + d.y;
  if (tileAt(state.arena, nx, ny) !== "empty") return false;
  if (balloonAt(state, nx, ny)) return false;
  if (state.players.some((p) => p.status === "alive" && playerTile(p).tx === nx && playerTile(p).ty === ny)) {
    return false;
  }
  b.sliding = true;
  b.slideDir = dir;
  pushEvent(state, { type: "balloon_kicked", balloonId: b.id, dir, kickerId: player.id });
  return true;
}

function slideBalloons(state: RoundState): void {
  for (const b of state.balloons) {
    if (!b.sliding) continue;
    const d = dirVec(b.slideDir);
    const nx = b.tx + d.x;
    const ny = b.ty + d.y;
    const blocked =
      tileAt(state.arena, nx, ny) !== "empty" ||
      !!balloonAt(state, nx, ny) ||
      state.players.some((p) => p.status === "alive" && playerTile(p).tx === nx && playerTile(p).ty === ny);
    if (blocked) {
      b.sliding = false;
      b.slideDir = "none";
    } else {
      b.tx = nx;
      b.ty = ny;
    }
  }
}

function placeBalloon(state: RoundState, player: PlayerState): void {
  if (player.status !== "alive") return;
  if (player.balloonsOut >= player.balloonCount) return;
  const pt = playerTile(player);
  if (tileAt(state.arena, pt.tx, pt.ty) !== "empty") return;
  if (balloonAt(state, pt.tx, pt.ty)) return;
  const balloon: BalloonState = {
    id: state.nextBalloonId++,
    ownerId: player.id,
    tx: pt.tx,
    ty: pt.ty,
    fuseLeft: CONFIG.FUSE_TICKS,
    range: player.splashRange,
    sliding: false,
    slideDir: "none",
  };
  state.balloons.push(balloon);
  player.balloonsOut++;
  pushEvent(state, { type: "balloon_placed", balloonId: balloon.id, ownerId: player.id, tx: pt.tx, ty: pt.ty });
}

function burstBalloon(state: RoundState, start: BalloonState, chainDepth: Map<number, number>): void {
  const queue: BalloonState[] = [start];
  const seen = new Set<number>([start.id]);
  chainDepth.set(start.id, 1);

  while (queue.length) {
    const b = queue.shift()!;
    const owner = state.players.find((p) => p.id === b.ownerId);
    if (owner && owner.balloonsOut > 0) owner.balloonsOut--;
    state.balloons = state.balloons.filter((x) => x.id !== b.id);

    const center: SplashState = {
      id: state.nextSplashId++,
      tx: b.tx,
      ty: b.ty,
      ticksLeft: CONFIG.SPLASH_LINGER_TICKS,
      ownerId: b.ownerId,
      isCenter: true,
    };
    state.splashes.push(center);
    destroyExposedAt(state, b.tx, b.ty);

    for (const dir of DIRS) {
      const d = dirVec(dir);
      for (let step = 1; step <= b.range; step++) {
        const tx = b.tx + d.x * step;
        const ty = b.ty + d.y * step;
        const tile = tileAt(state.arena, tx, ty);
        if (tile === "boulder") break;
        const splash: SplashState = {
          id: state.nextSplashId++,
          tx,
          ty,
          ticksLeft: CONFIG.SPLASH_LINGER_TICKS,
          ownerId: b.ownerId,
          isCenter: false,
        };
        state.splashes.push(splash);
        destroyExposedAt(state, tx, ty);
        if (tile === "castle") {
          washCastle(state, tx, ty, b.ownerId);
          break;
        }
        const other = balloonAt(state, tx, ty);
        if (other && !seen.has(other.id)) {
          seen.add(other.id);
          chainDepth.set(other.id, (chainDepth.get(b.id) ?? 1) + 1);
          queue.push(other);
        }
      }
    }
  }
}

function destroyExposedAt(state: RoundState, tx: number, ty: number): void {
  const before = state.exposed.length;
  state.exposed = state.exposed.filter((e) => !(e.tx === tx && e.ty === ty));
  if (state.exposed.length !== before) {
    /* destroyed by splash */
  }
}

function washCastle(state: RoundState, tx: number, ty: number, ownerId: string): void {
  setTile(state.arena, tx, ty, "empty");
  const washer = state.players.find((p) => p.id === ownerId);
  if (washer) washer.castlesWashed++;
  pushEvent(state, { type: "castle_washed", tx, ty, ownerId });
  const hid = state.hidden.find((h) => h.tx === tx && h.ty === ty);
  if (hid) {
    state.hidden = state.hidden.filter((h) => !(h.tx === tx && h.ty === ty));
    state.exposed.push({ tx, ty, kind: hid.kind });
    pushEvent(state, { type: "powerup_revealed", tx, ty, kind: hid.kind });
  }
}

function resolveBursts(state: RoundState): void {
  const toBurst: BalloonState[] = [];
  for (const b of state.balloons) {
    b.fuseLeft--;
    if (b.fuseLeft <= 0) toBurst.push(b);
  }
  if (!toBurst.length) return;
  const chainDepth = new Map<number, number>();
  const processed = new Set<number>();
  for (const b of toBurst) {
    if (processed.has(b.id)) continue;
    if (!state.balloons.some((x) => x.id === b.id)) continue;
    burstBalloon(state, b, chainDepth);
    for (const id of chainDepth.keys()) processed.add(id);
  }
  const maxChain = Math.max(0, ...chainDepth.values());
  if (maxChain >= 2) {
    pushEvent(state, { type: "chain_burst", count: maxChain });
  }
  if (toBurst.length) {
    pushEvent(state, { type: "balloon_burst", count: processed.size });
  }
}

function applySplashes(state: RoundState): void {
  const splashTiles = new Set(state.splashes.map((s) => `${s.tx},${s.ty}`));
  const soakedThisTick: string[] = [];
  for (const p of state.players) {
    if (p.status !== "alive") continue;
    const pt = playerTile(p);
    if (splashTiles.has(`${pt.tx},${pt.ty}`)) {
      soakPlayer(state, p);
      soakedThisTick.push(p.id);
    }
  }
  if (soakedThisTick.length) {
    state.hitstop = CONFIG.HITSTOP_TICKS;
  }
}

function soakPlayer(state: RoundState, p: PlayerState): void {
  if (p.status !== "alive") return;
  p.status = "soaked";
  p.soakTick = state.tick;
  const splash = state.splashes.find((s) => {
    const pt = playerTile(p);
    return s.tx === pt.tx && s.ty === pt.ty;
  });
  if (splash) {
    const owner = state.players.find((o) => o.id === splash.ownerId && o.id !== p.id);
    if (owner) owner.soaks++;
  }
  pushEvent(state, { type: "player_soaked", playerId: p.id, by: splash?.ownerId });
}

function collectPowerups(state: RoundState): void {
  for (const p of state.players) {
    if (p.status !== "alive") continue;
    const pt = playerTile(p);
    const pu = state.exposed.find((e) => e.tx === pt.tx && e.ty === pt.ty);
    if (!pu) continue;
    state.exposed = state.exposed.filter((e) => !(e.tx === pu.tx && e.ty === pu.ty));
    switch (pu.kind) {
      case "extraBalloon":
        p.balloonCount = Math.min(CONFIG.BALLOON_COUNT_CAP, p.balloonCount + 1);
        break;
      case "bigSplash":
        p.splashRange = Math.min(CONFIG.SPLASH_RANGE_CAP, p.splashRange + 1);
        break;
      case "flippers":
        p.speed = Math.min(CONFIG.SPEED_CAP, p.speed + CONFIG.SPEED_PER_FLIPPER);
        break;
      case "rubberBoots":
        p.hasKick = true;
        break;
    }
    pushEvent(state, { type: "powerup_collected", playerId: p.id, kind: pu.kind, tx: pu.tx, ty: pu.ty });
  }
}

function movePlayer(state: RoundState, p: PlayerState, dir: Dir): void {
  if (p.status !== "alive" || dir === "none") return;
  const d = dirVec(dir);
  const speed = p.speed / CONFIG.TICK_RATE;
  const nx = p.x + d.x * speed;
  const ny = p.y + d.y * speed;
  const tx = Math.floor(nx + 0.5);
  const ty = Math.floor(ny + 0.5);
  const cur = playerTile(p);
  if (tx !== cur.tx || ty !== cur.ty) {
    if (tryKick(state, p, dir)) {
      /* kicked instead of walking into balloon */
    }
    if (solidForMove(state, tx, ty, p, true)) {
      p.dir = dir;
      return;
    }
  }
  p.x = nx;
  p.y = ny;
  p.dir = dir;
}

function advanceTide(state: RoundState): void {
  if (state.tick < CONFIG.TIDE_START_TICKS) return;
  const elapsed = state.tick - CONFIG.TIDE_START_TICKS;
  if (elapsed % CONFIG.TIDE_INTERVAL_TICKS !== 0) return;
  const next = state.tideRing + 1;
  const maxRing = Math.min(Math.floor(state.arena.width / 2), Math.floor(state.arena.height / 2)) - 1;
  if (next > maxRing) return;
  state.tideRing = next;
  pushEvent(state, { type: "tide_advance", ring: next });

  const { width, height } = state.arena;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ring = Math.min(x, y, width - 1 - x, height - 1 - y);
      if (ring === next && tileAt(state.arena, x, y) === "castle") {
        washCastle(state, x, y, "");
      }
    }
  }
}

function applyTideSoaks(state: RoundState): void {
  if (state.tideRing <= 0) return;
  const { width, height } = state.arena;
  for (const p of state.players) {
    if (p.status !== "alive") continue;
    const pt = playerTile(p);
    const ring = Math.min(pt.tx, pt.ty, width - 1 - pt.tx, height - 1 - pt.ty);
    if (ring <= state.tideRing) soakPlayer(state, p);
  }
}

function tickRevenge(state: RoundState, inputs: Map<string, PlayerInput>, enable: boolean): void {
  if (!enable) return;
  for (const p of state.players) {
    if (p.status !== "soaked") continue;
    p.status = "revenge";
    p.revengeCooldown = 0;
  }
  for (const p of state.players) {
    if (p.status !== "revenge") continue;
    if (p.revengeCooldown > 0) p.revengeCooldown--;
    const input = inputs.get(p.id);
    if (input?.balloonPressed && p.revengeCooldown <= 0) {
      const pt = playerTile(p);
      const dir = input.dir === "none" ? p.dir : input.dir;
      const d = dirVec(dir === "none" ? "right" : dir);
      const tx = pt.tx + d.x * CONFIG.REVENGE_RANGE;
      const ty = pt.ty + d.y * CONFIG.REVENGE_RANGE;
      const splash: SplashState = {
        id: state.nextSplashId++,
        tx,
        ty,
        ticksLeft: CONFIG.SPLASH_LINGER_TICKS,
        ownerId: p.id,
        isCenter: true,
      };
      state.splashes.push(splash);
      p.revengeCooldown = CONFIG.REVENGE_COOLDOWN_TICKS;
      pushEvent(state, { type: "revenge_lob", playerId: p.id, tx, ty });
    }
    const { width, height } = state.arena;
    const perimeter = 2 * (width + height - 2);
    const t = (state.tick * 0.08) % perimeter;
    const pos = perimeterPos(width, height, t);
    p.x = pos.x;
    p.y = pos.y;
  }
}

function perimeterPos(w: number, h: number, t: number): { x: number; y: number } {
  const top = w;
  const right = h - 1;
  const bottom = w;
  if (t < top) return { x: t, y: 0 };
  t -= top;
  if (t < right) return { x: w - 1, y: t + 1 };
  t -= right;
  if (t < bottom) return { x: w - 1 - t, y: h - 1 };
  t -= bottom;
  return { x: 0, y: h - 1 - t };
}

function checkRoundEnd(state: RoundState): void {
  if (state.ended) return;
  const alive = state.players.filter((p) => p.status === "alive");
  if (alive.length === 0) {
    state.ended = true;
    state.draw = true;
    state.winnerIds = [];
    pushEvent(state, { type: "round_draw" });
    return;
  }
  if (alive.length === 1 && state.players.length > 1) {
    state.ended = true;
    state.winnerIds = [alive[0]!.id];
    return;
  }
  if (state.players.length === 1 && alive.length === 0) {
    state.ended = true;
    state.draw = true;
  }
}

export interface TickOptions {
  enableRevengeDucks?: boolean;
}

export function simulateTick(
  state: RoundState,
  inputs: Map<string, PlayerInput>,
  opts: TickOptions = {},
): RoundState {
  state.events = [];
  if (state.ended) return state;

  if (state.hitstop > 0) {
    state.hitstop--;
    return state;
  }

  state.tick++;

  slideBalloons(state);

  for (const p of state.players) {
    if (p.status !== "alive") continue;
    p.survivedTicks++;
    const input = inputs.get(p.id);
    if (!input) continue;
    movePlayer(state, p, input.dir);
    if (input.balloonPressed) placeBalloon(state, p);
  }

  resolveBursts(state);
  applySplashes(state);
  collectPowerups(state);
  advanceTide(state);
  applyTideSoaks(state);
  tickRevenge(state, inputs, opts.enableRevengeDucks ?? false);

  for (const s of state.splashes) s.ticksLeft--;
  state.splashes = state.splashes.filter((s) => s.ticksLeft > 0);

  checkRoundEnd(state);
  return state;
}

export function defaultPlayer(
  id: string,
  slot: number,
  nickname: string,
  extras: Partial<PlayerState> = {},
): Omit<PlayerState, "x" | "y" | "dir" | "balloonsOut" | "status" | "soakTick" | "revengeCooldown" | "survivedTicks"> {
  return {
    id,
    slot,
    nickname,
    tag: extras.tag ?? 1000,
    animal: extras.animal ?? "frog",
    hat: extras.hat ?? "none",
    speed: extras.speed ?? CONFIG.SPEED_BASE,
    balloonCount: extras.balloonCount ?? CONFIG.BALLOON_COUNT_BASE,
    splashRange: extras.splashRange ?? CONFIG.SPLASH_RANGE_BASE,
    soaks: extras.soaks ?? 0,
    castlesWashed: extras.castlesWashed ?? 0,
    isBot: extras.isBot ?? false,
    botDifficulty: extras.botDifficulty,
    hasKick: extras.hasKick ?? false,
  };
}

export function hiddenPowerupsForSeed(
  seed: number,
  width: number,
  height: number,
  playerCount: number,
): HiddenPowerup[] {
  return generateMap(seed, width, height, "backyard", playerCount).hidden;
}

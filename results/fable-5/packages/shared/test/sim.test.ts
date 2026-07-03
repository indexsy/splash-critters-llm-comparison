import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/config.js";
import { generateMap } from "../src/map.js";
import { mulberry32 } from "../src/rng.js";
import { createSimState, simulateTick } from "../src/sim.js";
import { TILE, tileAt, type Dir, type PlayerInput } from "../src/types.js";
import { makeState, noInputs, parkPlayers, placeBalloon, setBoulder, setCastle } from "./helpers.js";

function input(slot: number, dir: Dir, balloon = false): PlayerInput {
  return { seq: 0, tick: 0, dir, balloon };
}

describe("RNG determinism", () => {
  it("mulberry32 yields an identical sequence for an identical seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) expect(a()).toBe(b());
  });

  it("identical seed → identical map AND identical hidden power-up contents", () => {
    const m1 = generateMap("ffa", 123456);
    const m2 = generateMap("ffa", 123456);
    expect(m1.grid).toEqual(m2.grid);
    expect(m1.contents).toEqual(m2.contents);
    const m3 = generateMap("ffa", 654321);
    expect(m3.grid).not.toEqual(m1.grid);
  });

  it("maps have boulders on borders and even pillars, clear spawns", () => {
    const m = generateMap("duel", 7);
    const { w, h } = CONFIG.ARENAS.duel;
    expect(m.grid[0]).toBe(TILE.BOULDER);
    expect(m.grid[2 * w + 2]).toBe(TILE.BOULDER); // pillar
    for (const s of m.spawns) expect(m.grid[s.y * w + s.x]).toBe(TILE.EMPTY);
    // spawn escape lanes stay castle-free
    expect(m.grid[1 * w + 2]).toBe(TILE.EMPTY);
    expect(m.grid[2 * w + 1]).toBe(TILE.EMPTY);
  });

  it("full sim run is deterministic for identical inputs", () => {
    const run = () => {
      const map = generateMap("duel", 99);
      const s = createSimState("duel", map, ["a", "b"], { enableKick: true, revengeDucks: false });
      const log: string[] = [];
      for (let t = 0; t < 240; t++) {
        const dirs: Dir[] = [2, 3, 2, 1];
        const evs = simulateTick(s, [input(0, dirs[t % 4], t % 60 === 10), input(1, 4, t % 90 === 5)]);
        log.push(JSON.stringify({ s, evs }));
      }
      return log.join("\n");
    };
    expect(run()).toBe(run());
  });
});

describe("splash propagation", () => {
  it("a 3-balloon chain bursts in one tick with escalating chain event", () => {
    const s = makeState();
    parkPlayers(s);
    placeBalloon(s, 0, 1, 1, 2, 1); // due next tick
    placeBalloon(s, 0, 3, 1, 2, 500);
    placeBalloon(s, 1, 5, 1, 2, 500);
    const evs = simulateTick(s, noInputs(s));
    expect(s.balloons.length).toBe(0); // all three gone the same tick
    const chain = evs.find((e) => e.t === "chain_burst");
    expect(chain).toBeTruthy();
    expect(chain!.t === "chain_burst" && chain!.size).toBe(3);
    expect(evs.filter((e) => e.t === "balloon_burst").length).toBe(3);
    expect(s.players[0].balloonsActive).toBe(0);
    expect(s.players[1].balloonsActive).toBe(0);
  });

  it("splash washes the FIRST sandcastle per direction and stops", () => {
    const s = makeState();
    parkPlayers(s);
    setCastle(s, 3, 1);
    setCastle(s, 4, 1); // must survive
    placeBalloon(s, 0, 1, 1, 5, 1);
    const evs = simulateTick(s, noInputs(s));
    expect(tileAt(s, 3, 1)).toBe(TILE.EMPTY);
    expect(tileAt(s, 4, 1)).toBe(TILE.CASTLE);
    expect(evs.filter((e) => e.t === "castle_washed").length).toBe(1);
    // splash covers (2,1) but NOT the castle tile or beyond
    expect(s.splashes.some((sp) => sp.x === 2 && sp.y === 1)).toBe(true);
    expect(s.splashes.some((sp) => sp.x === 3 && sp.y === 1)).toBe(false);
    expect(s.splashes.some((sp) => sp.x === 4 && sp.y === 1)).toBe(false);
  });

  it("splash is blocked by boulders", () => {
    const s = makeState();
    parkPlayers(s);
    setBoulder(s, 3, 1);
    placeBalloon(s, 0, 1, 1, 5, 1);
    simulateTick(s, noInputs(s));
    expect(s.splashes.some((sp) => sp.x === 2 && sp.y === 1)).toBe(true);
    expect(s.splashes.some((sp) => sp.x === 4 && sp.y === 1)).toBe(false);
  });

  it("washing a castle reveals its pre-rolled power-up; splash destroys exposed ones", () => {
    const s = makeState();
    parkPlayers(s);
    setCastle(s, 3, 1, "big_splash");
    placeBalloon(s, 0, 1, 1, 3, 1);
    const evs = simulateTick(s, noInputs(s));
    expect(evs.some((e) => e.t === "powerup_revealed" && e.type === "big_splash")).toBe(true);
    expect(s.powerups).toEqual([{ x: 3, y: 1, type: "big_splash" }]);
    // a second balloon splashing the exposed power-up destroys it
    placeBalloon(s, 0, 5, 1, 3, 1);
    const evs2 = simulateTick(s, noInputs(s));
    expect(evs2.some((e) => e.t === "powerup_destroyed")).toBe(true);
    expect(s.powerups.length).toBe(0);
  });

  it("soaks players standing in splash and credits the owner", () => {
    const s = makeState();
    s.players[0].x = 3.5;
    s.players[0].y = 1.5;
    s.players[1].x = 7.5;
    s.players[1].y = 7.5;
    placeBalloon(s, 1, 1, 1, 3, 1);
    const evs = simulateTick(s, noInputs(s));
    expect(s.players[0].alive).toBe(false);
    expect(s.players[1].soaks).toBe(1);
    expect(evs.some((e) => e.t === "player_soaked" && e.slot === 0 && e.bySlot === 1)).toBe(true);
    expect(s.roundOver).toBe(true);
    expect(s.winnerSlot).toBe(1);
  });

  it("last two players soaked on the same tick = draw round", () => {
    const s = makeState();
    s.players[0].x = 2.5;
    s.players[0].y = 1.5;
    s.players[1].x = 4.5;
    s.players[1].y = 1.5;
    placeBalloon(s, 0, 3, 1, 2, 1);
    simulateTick(s, noInputs(s));
    expect(s.players[0].alive).toBe(false);
    expect(s.players[1].alive).toBe(false);
    expect(s.roundOver).toBe(true);
    expect(s.winnerSlot).toBe(-1);
  });
});

describe("power-up collection", () => {
  it("player collects an exposed power-up on contact", () => {
    const s = makeState();
    s.powerups.push({ x: 2, y: 1, type: "extra_balloon" });
    s.players[1].x = 7.5;
    s.players[1].y = 7.5;
    for (let i = 0; i < 12; i++) simulateTick(s, [input(0, 2), null]);
    expect(s.players[0].balloonCount).toBe(CONFIG.BALLOON_BASE + 1);
    expect(s.powerups.length).toBe(0);
  });

  it("rubber boots grant kick once per round", () => {
    const s = makeState();
    const p = s.players[0];
    s.powerups.push({ x: 1, y: 1, type: "rubber_boots" });
    simulateTick(s, noInputs(s));
    expect(p.hasKick).toBe(true);
    p.hasKick = false; // pretend consumed by design change; second boots must not re-grant
    s.powerups.push({ x: 1, y: 1, type: "rubber_boots" });
    simulateTick(s, noInputs(s));
    expect(p.hasKick).toBe(false);
  });
});

describe("balloon kick", () => {
  it("kicked balloon slides tile-by-tile and stops at the wall, keeping its fuse", () => {
    const s = makeState();
    const p = s.players[0];
    p.hasKick = true;
    s.players[1].x = 7.5;
    s.players[1].y = 7.5;
    const b = placeBalloon(s, 1, 2, 1, 1, 500);
    let kicked = false;
    for (let i = 0; i < 40; i++) {
      const evs = simulateTick(s, [input(0, 2), null]);
      if (evs.some((e) => e.t === "balloon_kicked")) kicked = true;
    }
    expect(kicked).toBe(true);
    expect(b.x).toBe(7); // slid to the last open tile before the border boulder
    expect(b.slide).toBeNull();
    expect(s.balloons[0].burstTick).toBe(500); // fuse unchanged
  });

  it("players without boots cannot kick", () => {
    const s = makeState();
    s.players[1].x = 7.5;
    s.players[1].y = 7.5;
    const b = placeBalloon(s, 1, 2, 1, 1, 500);
    for (let i = 0; i < 20; i++) simulateTick(s, [input(0, 2), null]);
    expect(b.x).toBe(2);
  });
});

describe("movement & placement", () => {
  it("players are blocked by castles and can pass their own fresh balloon only", () => {
    const s = makeState();
    const p = s.players[0];
    setCastle(s, 2, 1);
    for (let i = 0; i < 20; i++) simulateTick(s, [input(0, 2), null]);
    expect(p.x).toBeLessThan(2); // clamped before the castle
    // drop a balloon underfoot, walk off, and try to come back
    s.grid[1 * s.w + 2] = TILE.EMPTY;
    simulateTick(s, [input(0, 0, true), null]);
    expect(s.balloons.length).toBe(1);
    for (let i = 0; i < 30; i++) simulateTick(s, [input(0, 2), null]); // walks over own balloon
    expect(p.x).toBeGreaterThan(2.5);
    const xAfterLeaving = p.x;
    for (let i = 0; i < 30; i++) simulateTick(s, [input(0, 4), null]); // try to walk back
    expect(p.x).toBeGreaterThan(Math.floor(xAfterLeaving) === 2 ? 2 : 2.3); // blocked by own balloon now
    expect(s.balloons[0].x).toBe(1);
  });

  it("respects balloonCount and one-per-tile", () => {
    const s = makeState();
    simulateTick(s, [input(0, 0, true), null]);
    expect(s.balloons.length).toBe(1);
    // release then press again on the same tile: still 1 (tile occupied)
    simulateTick(s, [input(0, 0, false), null]);
    simulateTick(s, [input(0, 0, true), null]);
    expect(s.balloons.length).toBe(1);
    expect(s.players[0].balloonsActive).toBe(1);
  });
});

describe("rising tide", () => {
  it("floods inward, dissolves castles, and soaks players", () => {
    const s = makeState();
    setCastle(s, 1, 3);
    s.players[1].x = 4.5;
    s.players[1].y = 4.5;
    s.tick = CONFIG.TIDE_START_TICKS - 1;
    s.tideNextTick = CONFIG.TIDE_START_TICKS;
    const evs = simulateTick(s, noInputs(s));
    expect(evs.some((e) => e.t === "tide_advance" && e.ring === 1)).toBe(true);
    expect(s.players[0].alive).toBe(true); // (1,1) floods at ring 2
    for (let i = 0; i < CONFIG.TIDE_INTERVAL_TICKS + 1; i++) simulateTick(s, noInputs(s));
    expect(s.tideRing).toBe(2);
    expect(tileAt(s, 1, 3)).toBe(TILE.EMPTY); // castle dissolved
    expect(s.players[0].alive).toBe(false); // soaked by the tide
    expect(s.players[1].alive).toBe(true); // center still dry
  });
});

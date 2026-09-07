import { it, expect } from "vitest";
import { parseMessage } from "./net.js";
const parse = (v: unknown) => parseMessage(Buffer.from(JSON.stringify(v)));
it("accepts only bounded, well-typed directional inputs, never client positions", () => {
  const input = {
    type: "input",
    seq: 8,
    tick: 19,
    dir: "right",
    balloonPressed: true,
  };
  expect(parse(input)).toEqual(input);
  for (const patch of [
    { seq: -1 },
    { tick: 2.1 },
    { dir: "diagonal" },
    { balloonPressed: 1 },
    { x: 20 },
    { seq: 1e40 },
  ])
    expect(parse({ ...input, ...patch })).toBeNull();
  expect(parseMessage(Buffer.from("{"))).toBeNull();
  expect(parseMessage(Buffer.alloc(5000))).toBeNull();
});
it("bounds room options and cosmetic identifiers", () => {
  const opts = {
    name: "A Pond",
    mode: "ffa",
    theme: "beach",
    roundsToWin: 3,
    botFill: false,
    isPublic: true,
  };
  expect(parse({ type: "create_room", opts })).not.toBeNull();
  expect(
    parse({ type: "create_room", opts: { ...opts, roundsToWin: 100 } }),
  ).toBeNull();
  expect(
    parse({ type: "create_room", opts: { ...opts, isPublic: "yes" } }),
  ).toBeNull();
  expect(parse({ type: "equip", animal: "frog", hat: "none" })).not.toBeNull();
  expect(parse({ type: "equip", animal: "dragon", hat: "none" })).toBeNull();
});

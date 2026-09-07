import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "../packages/server/src/index.js";
import { BotController } from "../packages/server/src/bots/bot.js";

const dir = mkdtempSync(path.join(tmpdir(), "splash-tutorial-"));
const server = await startServer({ port: 0, dataDir: dir, host: "127.0.0.1" });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const started = Date.now();
  await page.goto(`http://127.0.0.1:${server.port}`);
  await page.locator(".connection.online").waitFor();
  await page.locator('[data-action="tutorial"]').click();
  await page.locator(".tutorial-panel").waitFor();
  const room = [...server.rooms.rooms.values()].find((r) => r.opts.tutorial)!;
  const player = () =>
    room.match!.state.players.find((p) => p.id === room.hostId)!;
  const wait = async (
    condition: () => boolean,
    label: string,
    timeout = 8000,
  ) => {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > timeout)
        throw new Error(
          `Tutorial timed out: ${label}, at ${player().x},${player().y}; goals ${[...room.match!.tutorialGoals]}`,
        );
      await page.waitForTimeout(16);
    }
  };
  const walk = async (x: number, y: number) => {
    const p = player();
    const horizontal = Math.abs(p.x - x) > 0.3;
    const from = horizontal ? p.x : p.y;
    const target = horizontal ? x : y;
    if (Math.abs(from - target) < 0.3) return;
    const key = horizontal
      ? from < target
        ? "ArrowRight"
        : "ArrowLeft"
      : from < target
        ? "ArrowDown"
        : "ArrowUp";
    await page.keyboard.down(key);
    try {
      await wait(() => {
        const value = horizontal ? player().x : player().y;
        return from < target ? value >= target - 0.2 : value <= target + 0.2;
      }, `walk to ${x},${y}`);
    } finally {
      await page.keyboard.up(key);
    }
    await page.waitForTimeout(75);
  };
  await wait(() => room.match!.countdown === 0, "countdown");
  await walk(3.5, 1.5);
  await page.keyboard.press("Space");
  await walk(1.5, 1.5);
  await walk(1.5, 3.5);
  await wait(
    () =>
      room.match!.tutorialGoals.has("castle") &&
      room.match!.state.splashes.length === 0,
    "castle and dodge",
  );
  await walk(3.5, 3.5);
  await walk(3.5, 1.5);
  await walk(4.5, 1.5);
  await wait(() => room.match!.tutorialGoals.has("pickup"), "pickup");
  await walk(3.5, 1.5);
  await walk(3.5, 5.5);
  await walk(1.5, 5.5);
  await page.keyboard.press("Space");
  await walk(3.5, 5.5);
  await page.keyboard.press("Space");
  await walk(3.5, 7.5);
  await walk(4.5, 7.5);
  await wait(() => room.match!.tutorialGoals.has("chain"), "two-balloon chain");
  const driver = new BotController(room.hostId, "hard", 981);
  const controls: Record<string, string> = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  };
  let held: string | undefined;
  while (
    !room.match!.tutorialGoals.has("soak") &&
    Date.now() - started < 115000
  ) {
    const input = driver.nextInput(room.match!.state);
    const key = controls[input.dir];
    if (held !== key) {
      if (held) await page.keyboard.up(held);
      if (key) await page.keyboard.down(key);
      held = key;
    }
    if (input.balloonPressed) await page.keyboard.press("Space");
    await page.waitForTimeout(25);
  }
  if (held) await page.keyboard.up(held);
  assert(
    room.match!.tutorialGoals.has("soak"),
    "Training opponent was not soaked before two minutes",
  );
  await page.locator('[data-action="complete-tutorial"]').click();
  await page.locator(".hero").waitFor();
  const profile = server.store.profile(room.hostId)!;
  assert(profile.tutorialComplete);
  assert(profile.xp >= 50);
  assert.deepEqual(errors, []);
  console.log(
    `Tutorial passed through real browser keyboard inputs: guest -> move -> castle/dodge -> pickup -> chain -> Easy opponent soak -> XP -> menu in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
} finally {
  await browser.close();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "../packages/server/src/index.js";

const dir = mkdtempSync(path.join(tmpdir(), "splash-browser-"));
const server = await startServer({ port: 0, dataDir: dir, host: "127.0.0.1" });
const browser = await chromium.launch({ headless: true });
mkdirSync("test-results", { recursive: true });
const url = `http://127.0.0.1:${server.port}`;
const errors: string[] = [];
try {
  const contextA = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const contextB = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  for (const page of [a, b]) {
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
  }
  await a.goto(url);
  await a.locator(".connection.online").waitFor();
  await a.screenshot({
    path: "test-results/title-desktop.png",
    fullPage: true,
  });
  await a.locator('[data-action="browse"]').first().click();
  await a.locator('[data-action="create-room"]').first().click();
  await a.locator('input[name="name"]').fill("The Browser Test Pond");
  await a.locator('#create-form button[type="submit"]').click();
  await a.locator(".lobby-slots").waitFor();
  await a.locator('select[data-slot="2"]').selectOption("hard");
  await a.waitForTimeout(120);
  await a.locator('select[data-slot="3"]').selectOption("hard");
  await b.goto(`${url}/?latency=150`);
  await b.locator(".connection.online").waitFor();
  await b.locator('[data-action="browse"]').first().click();
  await b.getByText("The Browser Test Pond", { exact: true }).waitFor();
  await b.locator('[data-action="join-room"]').first().click();
  await b.locator(".lobby-slots").waitFor();
  await b.locator('[data-action="ready"]').click();
  await b.waitForTimeout(250);
  await a.screenshot({
    path: "test-results/lobby-desktop.png",
    fullPage: true,
  });
  await a.locator('[data-action="start-match"]').click();
  await Promise.all([
    a.locator("#arena").waitFor(),
    b.locator("#arena").waitFor(),
  ]);
  await a.waitForTimeout(3500);
  await b.keyboard.down("ArrowLeft");
  await b.waitForTimeout(700);
  await b.keyboard.up("ArrowLeft");
  await a.keyboard.down("KeyD");
  await a.waitForTimeout(250);
  await a.keyboard.up("KeyD");
  await a.keyboard.press("Space");
  await a.keyboard.down("KeyA");
  await a.waitForTimeout(250);
  await a.keyboard.up("KeyA");
  await a.keyboard.down("KeyS");
  await a.waitForTimeout(450);
  await a.keyboard.up("KeyS");
  await a.screenshot({ path: "test-results/game-desktop.png", fullPage: true });
  await b.reload();
  await b.locator("#arena").waitFor();
  assert.equal(await b.locator("#arena").getAttribute("width"), "256");
  await a.locator('[data-action="exit-match"]').click();
  await a.locator('[data-action="confirm-exit"]').click();
  await a.locator('[data-action="locker"]').click();
  await a.locator('[data-action="equip-animal"][data-id="duck"]').click();
  await a.waitForTimeout(150);
  assert(
    await a
      .locator('[data-id="duck"]')
      .evaluate((e) => e.classList.contains("selected")),
  );
  await a.screenshot({
    path: "test-results/locker-desktop.png",
    fullPage: true,
  });
  await a.locator('[data-action="settings"]').click();
  await a.locator('[data-setting="colorblind"]').check();
  await a.locator('[data-action="remap"][data-id="up"]').click();
  await a.keyboard.press("i");
  assert.equal(
    await a.locator('[data-action="remap"][data-id="up"]').innerText(),
    "I",
  );
  await a.locator('[data-action="leaderboard"]').click();
  await a.getByText("History Is Still Dry.").waitFor();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  mobile.on("pageerror", (e) => errors.push(e.message));
  await mobile.goto(url);
  await mobile.locator(".connection.online").waitFor();
  assert(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await mobile.screenshot({
    path: "test-results/title-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Browser checks passed: desktop/mobile layout, two isolated sessions, room browser, Hard bot slots, ready/start, keyboard play, 150ms latency, reconnect, cosmetics, key remapping, leaderboard, no browser errors.",
  );
} finally {
  await browser.close();
  await server.close();
  rmSync(dir, { recursive: true, force: true });
}

// Plays the five scripted tutorial lessons with real key presses. The route mirrors what the
// lesson texts ask for on the hand-built 11x9 tutorial arena (player spawn at tile 1,4, a
// passive bot at 9,4, castles hiding an Extra Balloon at 2,3 and 2,5).
import { log, sleep } from './lib.mjs';
import { ArenaModel, dropBalloon, moveAxis, myPos, remotePos, walkPath } from './pilot.mjs';

export const TUTORIAL_ROWS = [
  '###########',
  '#....C....#',
  '#.#C#C#.#.#',
  '#.B.......#',
  '#0#.#.#C#1#',
  '#.B.......#',
  '#.#C#C#.#.#',
  '#....C....#',
  '###########',
];

/** Fuse (3 s) plus the lingering splash (0.4 s) plus a little network slack. */
const BURST_CLEAR_MS = 3700;
const RANGE = 2;
const BOT_SLOT = 1;

/** Current "STEP n/5" number shown by the objectives panel. */
export async function panelStep(page) {
  const text = await page.locator('.tutorial-step').textContent().catch(() => '');
  const m = /STEP (\d)\/(\d)/.exec(text ?? '');
  return m ? Number(m[1]) : 0;
}

export async function panelDone(page) {
  const title = await page.locator('.tutorial-title').textContent().catch(() => '');
  return /complete/i.test(title ?? '');
}

/** Wait until the panel shows step `n` (or the tutorial completed). */
export async function waitStep(page, n, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await panelStep(page)) >= n || (await panelDone(page))) return true;
    await sleep(100);
  }
  return false;
}

/** Wait until the critter can move: the round went live (after the 3-2-1). */
export async function waitLive(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pos = await myPos(page);
    if (pos) {
      const moved = await moveAxis(page, 'up', pos.ty - 1, 600);
      if (moved && moved.y !== pos.y) return moved;
    }
    await sleep(250);
  }
  return null;
}

export class TutorialPilot {
  constructor(page) {
    this.page = page;
    this.arena = new ArenaModel(TUTORIAL_ROWS);
  }

  async at() {
    return myPos(this.page);
  }

  /** Drop at the current tile and remember the burst for the arena model. */
  async drop() {
    const p = await this.at();
    await dropBalloon(this.page);
    return p;
  }

  /** Lesson 1: walk up the left column to the top-left corner (3 tiles). */
  async lesson1() {
    return moveAxis(this.page, 'up', 1);
  }

  /** Lesson 2: next to the castle at (5,1), drop, retreat to the corner out of range. */
  async lesson2() {
    await moveAxis(this.page, 'up', 1);
    await moveAxis(this.page, 'right', 4);
    const b = await this.drop();
    await moveAxis(this.page, 'left', 1);
    await sleep(BURST_CLEAR_MS);
    this.arena.burst(b.tx, b.ty, RANGE);
  }

  /** Lesson 3: splash the castle at (2,3) from (1,3), hide at (1,7), then collect its item. */
  async lesson3() {
    await moveAxis(this.page, 'left', 1);
    await moveAxis(this.page, 'down', 3);
    const b = await this.drop();
    await moveAxis(this.page, 'down', 7);
    await sleep(BURST_CLEAR_MS);
    this.arena.burst(b.tx, b.ty, RANGE);
    await moveAxis(this.page, 'up', 3);
    await moveAxis(this.page, 'right', 2);
  }

  /** Lesson 4: two balloons side by side on row 3, then run right out of both splashes. */
  async lesson4() {
    const first = await this.drop();
    await sleep(150);
    await moveAxis(this.page, 'right', 3);
    const second = await this.drop();
    await sleep(150);
    await moveAxis(this.page, 'right', 9);
    await sleep(BURST_CLEAR_MS);
    this.arena.burst(first.tx, first.ty, RANGE);
    this.arena.burst(second.tx, second.ty, RANGE);
  }

  /** Every tile a pending balloon will splash. */
  danger(balloons) {
    const out = new Set();
    for (const b of balloons) for (const t of this.arena.splash(b.tx, b.ty, RANGE)) out.add(`${t.x},${t.y}`);
    return out;
  }

  /**
   * Lesson 5: hunt the bot. Walk toward it; when it stands in line within splash range, drop a
   * balloon and retreat to the nearest tile outside the splash, then wait for the burst.
   */
  async lesson5(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let attempts = 0;
    while (Date.now() < deadline) {
      if (await panelDone(this.page)) return attempts;
      const me = await this.at();
      const bot = await remotePos(this.page, BOT_SLOT);
      if (!me || !bot) {
        await sleep(200);
        continue;
      }
      const inLine = this.arena.splash(me.tx, me.ty, RANGE).some((t) => t.x === bot.tx && t.y === bot.ty);
      if (inLine && !(me.tx === bot.tx && me.ty === bot.ty)) {
        attempts += 1;
        const b = await this.drop();
        const danger = this.danger([b]);
        const escape = this.arena.path({ x: me.tx, y: me.ty }, (x, y) => !danger.has(`${x},${y}`));
        if (escape) await walkPath(this.page, escape);
        log(`  lesson 5 attempt ${attempts}: bot at ${bot.tx},${bot.ty}, me ${me.tx},${me.ty}`);
        await sleep(BURST_CLEAR_MS);
        this.arena.burst(b.tx, b.ty, RANGE);
        continue;
      }
      const path = this.arena.path({ x: me.tx, y: me.ty }, (x, y) => Math.abs(x - bot.tx) + Math.abs(y - bot.ty) <= 1);
      if (path && path.length) await walkPath(this.page, path.slice(0, 1));
      else await sleep(150);
    }
    return attempts;
  }
}

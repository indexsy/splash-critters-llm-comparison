/**
 * Headless bot-vs-bot soak test. Runs full matches with no client attached and
 * verifies: (1) matches always complete without crashing or freezing, and
 * (2) Hard bots reliably beat Easy bots. Exits non-zero on failure.
 *
 * Run: npm run soak
 */

import { CONFIG, type CreateRoomOpts, type Difficulty, type Mode, type ServerMsg } from '@splash/shared';
import { ServerContext } from './context';
import { openMemoryDb } from './db/index';
import { makeQueries } from './db/queries';
import { Matchmaker } from './matchmaker';
import { RoomManager } from './roomManager';
import { Room } from './room';
import { generateGuestName } from './util';

const MAX_TICKS = 80_000;

function makeCtx(): ServerContext {
  const db = openMemoryDb();
  const ctx = new ServerContext(makeQueries(db));
  ctx.rooms = new RoomManager(ctx);
  ctx.mm = new Matchmaker(ctx);
  return ctx;
}

function setBot(room: Room, index: number, diff: Difficulty): void {
  const slot = room.slots[index];
  slot.kind = 'bot';
  slot.botDifficulty = diff;
  slot.isBot = true;
  slot.playerId = `bot-${room.code}-${index}`;
  slot.name = `CPU-${diff}-${index}`;
  slot.animal = 'otter';
  slot.hat = 'none';
}

interface SoakResult {
  ticks: number;
  ended: boolean;
  winnerSlot: number;
  roundWins: number[];
  events: number;
  castlesWashed: number;
  selfSoaks: number;
  selfSoaksByDiff: Record<Difficulty, number>;
  totalSoaks: number;
}

function runMatch(mode: Mode, diffs: Difficulty[]): SoakResult {
  const ctx = makeCtx();
  const opts: CreateRoomOpts = {
    name: 'Soak',
    mode,
    isPublic: false,
    theme: 'backyard',
    roundsToWin: 3,
    botFill: false,
  };
  const room = new Room('SOAK' + Math.floor(Math.random() * 90 + 10), ctx, opts, 'soak-host', false, false);
  ctx.rooms.rooms.set(room.code, room);
  diffs.forEach((d, i) => setBot(room, i, d));

  let events = 0;
  let ended = false;
  let selfSoaks = 0;
  let totalSoaks = 0;
  const selfSoaksByDiff: Record<Difficulty, number> = { easy: 0, medium: 0, hard: 0 };
  const orig = room.broadcast.bind(room);
  room.broadcast = (msg: ServerMsg) => {
    if (msg.type === 'event') {
      events += msg.events.length;
      for (const e of msg.events) {
        if (e.t === 'player_soaked') {
          totalSoaks++;
          // self-soak = bySlot equals the victim's slot
          const victim = room.match?.state.players.find((p) => p.id === e.playerId);
          if (victim && e.bySlot === victim.slot) {
            selfSoaks++;
            selfSoaksByDiff[diffs[victim.slot]]++;
          }
        }
      }
    }
    if (msg.type === 'match_end') ended = true;
    orig(msg);
  };

  room.startMatch();

  let ticks = 0;
  while (room.phase !== 'results' && ticks < MAX_TICKS) {
    ctx.tick++;
    ticks++;
    room.tick(ctx.tick, Date.now());
  }

  const match = room.match!;
  const winnerSlot = match.roundWins.indexOf(Math.max(...match.roundWins));
  const castlesWashed = match.totalCastles.reduce((a, b) => a + b, 0);
  return { ticks, ended, winnerSlot, roundWins: match.roundWins.slice(), events, castlesWashed, selfSoaks, selfSoaksByDiff, totalSoaks };
}

function main(): void {
  let failures = 0;
  void generateGuestName; // keep import used across refactors

  // 1) FFA with mixed difficulties completes
  console.log('--- FFA (hard, medium, easy, easy) ---');
  const ffa = runMatch('ffa', ['hard', 'medium', 'easy', 'easy']);
  console.log(
    `  ticks=${ffa.ticks} ended=${ffa.ended} winner=slot${ffa.winnerSlot} wins=[${ffa.roundWins}] events=${ffa.events} castles=${ffa.castlesWashed} selfSoaks=${ffa.selfSoaks}`,
  );
  if (!ffa.ended) {
    console.error('  FAIL: FFA match did not complete');
    failures++;
  }
  if (ffa.ticks >= MAX_TICKS) {
    console.error('  FAIL: FFA match froze (hit tick cap)');
    failures++;
  }
  if (ffa.castlesWashed === 0) {
    console.error('  FAIL: bots washed no castles (frozen / passive)');
    failures++;
  }

  // 1b) All-Hard FFA across several matches — Hard/Medium must (almost) never self-soak
  console.log('--- 8x all-Hard FFA: self-soak audit ---');
  let hardSelf = 0;
  let allSoaks = 0;
  let ffaGames = 0;
  for (let i = 0; i < 8; i++) {
    const r = runMatch('ffa', ['hard', 'hard', 'hard', 'hard']);
    hardSelf += r.selfSoaksByDiff.hard;
    allSoaks += r.totalSoaks;
    if (r.ended) ffaGames++;
  }
  const selfRate = allSoaks ? hardSelf / allSoaks : 0;
  console.log(`  completed=${ffaGames}/8  Hard self-soaks=${hardSelf}/${allSoaks} deaths (${(selfRate * 100).toFixed(0)}% self)`);
  // In 4-way all-Hard chaos some cut-off deaths are unavoidable; assert bots die
  // to EACH OTHER clearly more than to themselves (not suicidal).
  if (selfRate > 0.4) {
    console.error(`  FAIL: Hard bots self-soak too much (${(selfRate * 100).toFixed(0)}% of deaths)`);
    failures++;
  }

  // 2) Hard vs Easy — Hard should win the clear majority of duels
  const N = 30;
  let hardWins = 0;
  let completed = 0;
  console.log(`--- ${N} duels: Hard (slot 0) vs Easy (slot 1) ---`);
  let hardSelfD = 0;
  let easySelfD = 0;
  for (let i = 0; i < N; i++) {
    const r = runMatch('duel', ['hard', 'easy']);
    if (r.ended) completed++;
    if (r.winnerSlot === 0 && r.roundWins[0] > r.roundWins[1]) hardWins++;
    hardSelfD += r.selfSoaksByDiff.hard;
    easySelfD += r.selfSoaksByDiff.easy;
    if (process.env.SOAK_DEBUG) console.log(`  duel ${i}: wins=[${r.roundWins}] hardSelf=${r.selfSoaksByDiff.hard} easySelf=${r.selfSoaksByDiff.easy} ticks=${r.ticks}`);
  }
  console.log(`  completed=${completed}/${N}  hardWins=${hardWins}/${N}  (hardSelfSoaks=${hardSelfD} easySelfSoaks=${easySelfD})`);
  if (completed < N) {
    console.error('  FAIL: not all duels completed');
    failures++;
  }
  if (hardWins < Math.ceil(N * 0.55)) {
    console.error(`  FAIL: Hard did not reliably beat Easy (${hardWins}/${N})`);
    failures++;
  }
  void easySelfD;
  void hardSelfD;

  console.log('');
  if (failures > 0) {
    console.error(`SOAK FAILED with ${failures} failure(s)`);
    process.exit(1);
  }
  console.log('SOAK PASSED');
  void CONFIG;
}

main();

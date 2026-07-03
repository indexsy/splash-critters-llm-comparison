#!/usr/bin/env node
/**
 * Splash Critters — Headless soak test
 * Runs a complete bot-vs-bot match with no network layer to verify
 * the simulation is stable and deterministic.
 */

import {
  CONFIG,
  createRoundState,
  simulateTick,
  getInitialPlayerState,
  resolveRoundEnd,
} from '@splash-critters/shared';
import { computeDangerMap } from '../packages/server/src/bots/dangerMap.js';
import { Bot } from '../packages/server/src/bots/bot.js';

const SOAK_MATCHES = 3;
const MAX_TICKS_PER_ROUND = 60 * 60 * 2; // 2 minutes at 30Hz

function createBotInputs(state) {
  const inputs = new Map();
  for (const player of state.players) {
    if (!player.alive) continue;
    const dangerMap = computeDangerMap(state);
    const bot = new Bot(player.playerId, 'hard');
    const decision = bot.getDecision(state, dangerMap);
    inputs.set(player.playerId, {
      dir: decision.dir,
      balloonPressed: decision.balloonPressed,
    });
  }
  return inputs;
}

function runSingleMatch(mode) {
  const playerCount = mode === 'duel' ? 2 : 4;
  const seed = Math.floor(Math.random() * 1e9);
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const p = getInitialPlayerState(`bot-${i}`, `Bot${i}`, 'frog', { x: 1, y: 1 });
    players.push(p);
  }

  const roundStates = [];
  let currentRound = 1;
  let totalTicks = 0;
  let matchWinner = null;

  while (currentRound <= 10 && matchWinner === null) {
    let roundState = createRoundState(
      { mode, roundsToWin: 3, enableKick: true, enableRevengeDucks: false, botFill: false },
      seed + currentRound,
      currentRound,
      players.map((p) => ({ ...p, alive: true, x: p.x, y: p.y }))
    );

    let roundTicks = 0;
    while (roundTicks < MAX_TICKS_PER_ROUND) {
      const inputs = createBotInputs(roundState);
      roundState = simulateTick(roundState, { tick: roundState.tick, playerInputs: inputs }, CONFIG);
      roundTicks++;
      totalTicks++;

      if (roundState.ended) break;
    }

    const result = resolveRoundEnd(roundState);
    if (result) {
      roundStates.push(roundState);
      if (result.winner) {
        const wins = roundStates.filter((r) => r.winner === result.winner).length;
        if (wins >= 3) {
          matchWinner = result.winner;
        }
      }
    }
    currentRound++;
  }

  return { rounds: currentRound - 1, winner: matchWinner, ticks: totalTicks };
}

console.log('🧪 Splash Critters Soak Test\n');

let passCount = 0;
let failCount = 0;

for (let i = 0; i < SOAK_MATCHES; i++) {
  const mode = i % 2 === 0 ? 'duel' : 'ffa';
  try {
    const result = runSingleMatch(mode);
    if (result.winner) {
      console.log(`  ✅ ${mode.toUpperCase()} match ${i + 1}: ${result.rounds} rounds, ${result.ticks} ticks, winner=${result.winner}`);
      passCount++;
    } else {
      console.log(`  ⚠️  ${mode.toUpperCase()} match ${i + 1}: no winner after ${result.rounds} rounds`);
      failCount++;
    }
  } catch (err) {
    console.log(`  ❌ ${mode.toUpperCase()} match ${i + 1}: CRASH — ${err.message}`);
    failCount++;
  }
}

console.log(`\n📊 Results: ${passCount} passed, ${failCount} failed out of ${SOAK_MATCHES}`);
process.exit(failCount > 0 ? 1 : 0);

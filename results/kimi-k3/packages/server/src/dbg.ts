import { createGame, simulateTick, InputFrame, GameState } from '@splash/shared';
import { BotController } from './bots/bot.js';
import { computeDangerMap, tileSafeAt } from './bots/dangerMap.js';

const state = createGame({ mode: 'ffa', mapSeed: 42, playerCount: 4, roundsToWin: 3, enableRevengeDucks: false });
const bots = [0,1,2,3].map(i => new BotController('hard', i));
for (let t = 0; t < 30*120; t++) {
  const inputs = new Map<number, InputFrame>();
  for (let i = 0; i < 4; i++) inputs.set(i, bots[i]!.nextInput(state));
  simulateTick(state, inputs);
  if (t === 900 || t === 1200) {
    const p = state.players[0]!;
    const danger = computeDangerMap(state);
    const myIdx = Math.floor(p.y)*state.w + Math.floor(p.x);
    console.log(`t=${t} p0=(${p.x.toFixed(2)},${p.y.toFixed(2)}) alive=${p.alive} dangerHere=${danger.burstAt[myIdx]}`);
    const b: any = bots[0];
    console.log('  path len', b.path?.length, 'escapeMode', b.escapeMode, 'lastThink', b.lastThinkTick);
    let castles = 0;
    for (const tl of state.tiles) if (tl === 2) castles++;
    console.log('  castles left', castles, 'powerups', state.exposedPowerUps.length, 'phase', state.phase);
  }
}

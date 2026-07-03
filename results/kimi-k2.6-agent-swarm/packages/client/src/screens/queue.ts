import type { Screen } from './types.js';
import { screenManager, audioEngine, netClient } from '../main.js';
import { PALETTE } from '../render/sprites.js';
import type { ServerMsg } from '@shared/protocol.js';
import type { QueueMode } from '@shared/types.js';

let mode: QueueMode = 'duel';
let elapsed = 0;
let searchRange = 100;
let searching = true;
let startTime = 0;

export const queueScreen: Screen & { handleMessage?(msg: ServerMsg): void } = {
  enter(data?: unknown) {
    if (data && typeof data === 'object' && 'mode' in data) {
      mode = (data as { mode: QueueMode }).mode;
    }
    searching = true;
    elapsed = 0;
    searchRange = 100;
    startTime = Date.now();
    netClient.send({ type: 'queue_join', mode });
    audioEngine.playMusic('lobby');
  },
  update(_dt: number) {
    if (searching) {
      elapsed = (Date.now() - startTime) / 1000;
    }
  },
  render(ctx: CanvasRenderingContext2D) {
    const width = 256;
    const tick = Date.now() / 1000;

    // Background
    ctx.fillStyle = PALETTE.darkBlue;
    ctx.fillRect(0, 0, width, 224);

    // Title
    ctx.fillStyle = PALETTE.white;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Ranked Queue', width / 2, 40);

    // Mode
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = '10px monospace';
    ctx.fillText(mode.toUpperCase(), width / 2, 58);

    // Searching indicator
    const dots = '.'.repeat(Math.floor((tick * 2) % 4));
    ctx.fillStyle = PALETTE.lightGray;
    ctx.font = '8px monospace';
    ctx.fillText(`Searching${dots}`, width / 2, 90);

    // Elapsed
    const mins = Math.floor(elapsed / 60);
    const secs = Math.floor(elapsed % 60);
    ctx.fillText(`Elapsed: ${mins}:${secs.toString().padStart(2, '0')}`, width / 2, 110);

    // Search range
    ctx.fillText(`Range: ±${searchRange}`, width / 2, 125);

    // Pulse ring
    const pulse = Math.sin(tick * 3) * 0.3 + 0.7;
    ctx.fillStyle = `rgba(255,255,255,${0.1 * pulse})`;
    ctx.fillRect(40, 70, 176, 60);

    // Cancel button
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(88, 160, 80, 18);
    ctx.fillStyle = PALETTE.white;
    ctx.font = '8px monospace';
    ctx.fillText('Cancel', 128, 171);
  },
  exit() {
    if (searching) {
      netClient.send({ type: 'queue_leave' });
    }
  },
  handleMessage(msg: ServerMsg) {
    if (msg.type === 'queue_status') {
      searchRange = msg.searchRange;
    } else if (msg.type === 'match_found') {
      searching = false;
      screenManager.switchTo('game', { matchId: msg.matchId, mode: msg.mode });
    }
  },
};

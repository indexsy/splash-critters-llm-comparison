import type { Screen } from './types.js';
import { screenManager, netClient } from '../main.js';
import { PALETTE } from '../render/sprites.js';
import type { LobbyState } from '@shared/types.js';
import type { ServerMsg } from '@shared/protocol.js';

let lobby: LobbyState | null = null;
let isHost = false;
let localReady = false;

export const lobbyScreen: Screen & { handleMessage?(msg: ServerMsg): void } = {
  enter(data?: unknown) {
    if (data && typeof data === 'object' && 'practice' in data) {
      // Practice mode: create a local room
      netClient.send({
        type: 'create_room',
        opts: { name: 'Practice', mode: 'duel', visibility: 'private', theme: 'backyard', roundsToWin: 3, botFill: true },
      });
    }
  },
  update(_dt: number) {
    /* nothing */
  },
  render(ctx: CanvasRenderingContext2D) {
    const width = 256;
    ctx.fillStyle = PALETTE.darkBlue;
    ctx.fillRect(0, 0, width, 224);

    if (!lobby) {
      ctx.fillStyle = PALETTE.white;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Connecting to room...', width / 2, 112);
      return;
    }

    // Room info
    ctx.fillStyle = PALETTE.white;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(lobby.name, width / 2, 12);
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = '8px monospace';
    ctx.fillText(`Code: ${lobby.roomCode}  |  ${lobby.mode.toUpperCase()}`, width / 2, 24);

    // Slots
    const slots = lobby.slots;
    const cols = lobby.mode === 'duel' ? 2 : 2;
    const slotW = 100;
    const slotH = 60;
    const startX = (width - cols * slotW - (cols - 1) * 10) / 2;
    const startY = 36;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (slotW + 10);
      const y = startY + row * (slotH + 8);

      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x, y, slotW, slotH);
      ctx.strokeStyle = slot.ready ? PALETTE.green : PALETTE.lightGray;
      ctx.strokeRect(x, y, slotW, slotH);

      if (slot.kind === 'human') {
        ctx.fillStyle = PALETTE.white;
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Human', x + slotW / 2, y + 14);
        ctx.fillStyle = slot.ready ? PALETTE.green : PALETTE.yellow;
        ctx.fillText(slot.ready ? 'READY' : 'Not Ready', x + slotW / 2, y + 28);
      } else if (slot.kind === 'bot') {
        ctx.fillStyle = PALETTE.lightGray;
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`Bot (${slot.difficulty || 'medium'})`, x + slotW / 2, y + 20);
      } else {
        ctx.fillStyle = PALETTE.midGray;
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Empty', x + slotW / 2, y + 20);
      }
    }

    // Controls
    const bottomY = 180;
    if (!isHost) {
      ctx.fillStyle = localReady ? PALETTE.green : PALETTE.blue;
      ctx.fillRect(60, bottomY, 60, 16);
      ctx.fillStyle = PALETTE.white;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(localReady ? 'Unready' : 'Ready', 90, bottomY + 11);
    } else {
      ctx.fillStyle = PALETTE.green;
      ctx.fillRect(60, bottomY, 60, 16);
      ctx.fillStyle = PALETTE.white;
      ctx.textAlign = 'center';
      ctx.fillText('Start', 90, bottomY + 11);
    }

    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(140, bottomY, 60, 16);
    ctx.fillStyle = PALETTE.white;
    ctx.fillText('Leave', 170, bottomY + 11);

    // Back
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(4, 206, 40, 14);
    ctx.fillStyle = PALETTE.white;
    ctx.fillText('Back', 24, 216);
  },
  exit() {
    lobby = null;
    localReady = false;
  },
  handleMessage(msg: ServerMsg) {
    if (msg.type === 'lobby_state') {
      lobby = msg.lobby;
      // Check if we're host
      const myId = (window as any).__localPlayerId || '';
      isHost = lobby.hostId === myId;
    } else if (msg.type === 'room_created') {
      lobby = msg.lobby;
    } else if (msg.type === 'match_start') {
      screenManager.switchTo('game');
    }
  },
};

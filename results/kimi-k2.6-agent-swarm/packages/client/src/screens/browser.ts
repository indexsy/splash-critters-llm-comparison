import type { Screen } from './types.js';
import { netClient } from '../main.js';
import { PALETTE } from '../render/sprites.js';
import type { RoomInfo, GameMode } from '@shared/types.js';
import type { ServerMsg } from '@shared/protocol.js';

let rooms: RoomInfo[] = [];
let filterMode: GameMode | 'all' = 'all';
let joinCode = '';

export const browserScreen: Screen & { handleMessage?(msg: ServerMsg): void } = {
  enter(_data?: unknown) {
    netClient.send({ type: 'room_list_request' });
  },
  update(_dt: number) {
    // Auto-refresh every 5 seconds
    if (Math.floor(Date.now() / 5000) % 2 === 0) {
      // Throttle by only sending occasionally; simplified for this demo
    }
  },
  render(ctx: CanvasRenderingContext2D) {
    const width = 256;

    // Background
    ctx.fillStyle = PALETTE.darkBlue;
    ctx.fillRect(0, 0, width, 224);

    // Header
    ctx.fillStyle = PALETTE.white;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Public Rooms', width / 2, 12);

    // Filter tabs
    const tabs: { label: string; mode: GameMode | 'all' }[] = [
      { label: 'All', mode: 'all' },
      { label: 'Duel', mode: 'duel' },
      { label: 'FFA', mode: 'ffa' },
    ];
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      const x = 10 + i * 50;
      ctx.fillStyle = filterMode === t.mode ? PALETTE.blue : PALETTE.darkGray;
      ctx.fillRect(x, 18, 46, 12);
      ctx.fillStyle = PALETTE.white;
      ctx.font = '6px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(t.label, x + 23, 26);
    }

    // Room list
    const filtered = filterMode === 'all' ? rooms : rooms.filter((r) => r.mode === filterMode);
    const rowH = 22;
    const startY = 36;

    for (let i = 0; i < filtered.length; i++) {
      const room = filtered[i];
      const y = startY + i * rowH;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.3)';
      ctx.fillRect(4, y, 248, rowH - 2);
      ctx.fillStyle = PALETTE.white;
      ctx.font = '6px monospace';
      ctx.textAlign = 'left';
      ctx.fillText(room.name.substring(0, 16), 8, y + 8);
      ctx.fillStyle = PALETTE.lightGray;
      ctx.fillText(`${room.players}/${room.maxPlayers} ${room.theme}`, 8, y + 16);
      ctx.textAlign = 'right';
      ctx.fillStyle = PALETTE.yellow;
      ctx.fillText(room.host.substring(0, 12), 244, y + 8);
      // Join button
      ctx.fillStyle = PALETTE.green;
      ctx.fillRect(200, y + 4, 40, 12);
      ctx.fillStyle = PALETTE.white;
      ctx.textAlign = 'center';
      ctx.fillText('Join', 220, y + 12);
    }

    if (filtered.length === 0) {
      ctx.fillStyle = PALETTE.lightGray;
      ctx.textAlign = 'center';
      ctx.fillText('No public rooms available', width / 2, 100);
    }

    // Bottom controls
    const bottomY = 190;
    ctx.fillStyle = PALETTE.blue;
    ctx.fillRect(10, bottomY, 80, 16);
    ctx.fillStyle = PALETTE.white;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Refresh', 50, bottomY + 11);

    ctx.fillStyle = PALETTE.blue;
    ctx.fillRect(100, bottomY, 80, 16);
    ctx.fillStyle = PALETTE.white;
    ctx.fillText('Create', 140, bottomY + 11);

    // Join by code
    ctx.fillStyle = PALETTE.darkGray;
    ctx.fillRect(190, bottomY, 60, 16);
    ctx.fillStyle = PALETTE.white;
    ctx.fillText(joinCode || 'Code', 220, bottomY + 11);

    // Back button
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(4, 206, 40, 14);
    ctx.fillStyle = PALETTE.white;
    ctx.fillText('Back', 24, 216);
  },
  exit() {
    /* nothing */
  },
  handleMessage(msg: ServerMsg) {
    if (msg.type === 'room_list') {
      rooms = msg.rooms;
    }
  },
};

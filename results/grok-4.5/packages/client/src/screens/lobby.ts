import type { LobbySlot, RoomOptions } from '@splash/shared';
import { drawAnimal } from '../render/sprites.js';
import { panel, pixelBg, text, W, H } from './common.js';

export function drawLobby(
  ctx: CanvasRenderingContext2D,
  tick: number,
  code: string,
  opts: RoomOptions,
  slots: LobbySlot[],
  hostId: string,
  localId: string,
  selectedSlot: number,
): void {
  pixelBg(ctx, tick);
  text(ctx, opts.name, W / 2, 14, '#4fc3f7', 10, 'center');
  text(ctx, `Code: ${code}  ·  ${opts.size}p  ·  ${opts.theme}`, W / 2, 26, '#888', 6, 'center');
  text(ctx, `First to ${opts.roundsToWin}`, W / 2, 36, '#666', 6, 'center');

  slots.forEach((s, i) => {
    const x = 20 + (i % 2) * 120;
    const y = 50 + Math.floor(i / 2) * 60;
    const sel = i === selectedSlot;
    ctx.strokeStyle = sel ? '#fff59d' : '#4fc3f7';
    ctx.strokeRect(x, y, 100, 50);
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(x + 1, y + 1, 98, 48);

    if (s.kind === 'empty') {
      text(ctx, 'Empty', x + 50, y + 28, '#555', 8, 'center');
      if (localId === hostId) text(ctx, '[B]ot [X]', x + 50, y + 40, '#444', 5, 'center');
    } else if (s.kind === 'bot') {
      drawAnimal(ctx, x + 20, y + 24, s.animal ?? 'frog', 'none', 'down', Math.floor(tick / 12) % 2);
      text(ctx, `Bot (${s.difficulty})`, x + 55, y + 20, '#81d4fa', 6, 'center');
      text(ctx, 'Ready', x + 55, y + 32, '#4caf50', 6, 'center');
    } else {
      drawAnimal(ctx, x + 20, y + 24, s.animal ?? 'frog', s.hat ?? 'none', 'down', Math.floor(tick / 12) % 2);
      text(ctx, (s.nickname ?? '?').split('#')[0]!.slice(0, 9), x + 55, y + 18, '#fff', 6, 'center');
      text(ctx, s.ready ? 'READY' : 'not ready', x + 55, y + 30, s.ready ? '#4caf50' : '#e53935', 6, 'center');
      if (s.isHost) text(ctx, 'HOST', x + 55, y + 40, '#fff59d', 5, 'center');
    }
  });

  const isHost = localId === hostId;
  text(ctx, isHost ? '[Enter] Start  [R] Ready  [Esc] Leave' : '[R] Ready  [Esc] Leave', W / 2, H - 12, '#888', 6, 'center');
  if (isHost) text(ctx, 'Select slot: arrows  [B] bot  [1-3] difficulty  [X] clear', W / 2, H - 4, '#555', 5, 'center');
}

export function drawCreateRoom(
  ctx: CanvasRenderingContext2D,
  tick: number,
  fields: { name: string; size: 2 | 4; pub: boolean; theme: string; rounds: number; botFill: boolean },
  fieldIdx: number,
): void {
  pixelBg(ctx, tick);
  text(ctx, 'CREATE ROOM', W / 2, 20, '#4fc3f7', 10, 'center');
  panel(ctx, 30, 36, W - 60, 150);

  const lines = [
    `Name: ${fields.name}_`,
    `Size: ${fields.size === 2 ? '2-player' : '4-player'}`,
    `Visibility: ${fields.pub ? 'Public' : 'Private'}`,
    `Theme: ${fields.theme}`,
    `Rounds to win: ${fields.rounds}`,
    `Bot fill: ${fields.botFill ? 'ON' : 'OFF'}`,
    'CREATE',
    'Cancel',
  ];
  lines.forEach((line, i) => {
    const y = 52 + i * 16;
    text(ctx, line, W / 2, y, i === fieldIdx ? '#fff59d' : '#ccc', 7, 'center');
    if (i === fieldIdx) text(ctx, '>', 40, y, '#fff59d', 7);
  });
  text(ctx, 'Arrows change · Enter confirm · Type for name', W / 2, H - 10, '#666', 5, 'center');
}

export function drawJoinCode(
  ctx: CanvasRenderingContext2D,
  tick: number,
  code: string,
): void {
  pixelBg(ctx, tick);
  text(ctx, 'JOIN BY CODE', W / 2, 60, '#4fc3f7', 10, 'center');
  panel(ctx, 50, 90, W - 100, 40);
  text(ctx, code.padEnd(6, '_'), W / 2, 115, '#fff59d', 16, 'center');
  text(ctx, 'Type 6-char code · Enter · Esc', W / 2, 160, '#888', 6, 'center');
}

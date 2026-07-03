import type { Screen } from './types.js';
import { screenManager, audioEngine } from '../main.js';
import { PALETTE } from '../render/sprites.js';
import type { ServerMsg } from '@shared/protocol.js';

// Shared client state (stored in screens directory since we can't modify main.ts)
export const clientState = {
  localPlayerId: '',
  profile: null as null | { playerId: string; nickname: string; xp: number; level: number; selectedAnimal: string; selectedHat: string },
};

interface Button {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
  hover: boolean;
}

export const titleScreen: Screen & { handleMessage?(msg: ServerMsg): void } = {
  enter(_data?: unknown) {
    audioEngine.playMusic('title');
  },
  update(_dt: number) {
    /* Animation handled in render */
  },
  render(ctx: CanvasRenderingContext2D) {
    const tick = Date.now() / 1000;
    const width = 256;
    const height = 224;

    // Animated water background
    for (let y = 0; y < height; y += 4) {
      const wave = Math.sin(y * 0.05 + tick * 2) * 8;
      const shimmer = Math.sin(y * 0.1 + tick * 3) > 0;
      ctx.fillStyle = shimmer ? PALETTE.skyBlue : PALETTE.blue;
      ctx.fillRect(0, y, width, 4);
      // Wave lines
      ctx.fillStyle = PALETTE.white;
      ctx.fillRect(wave + 50, y, 20, 1);
      ctx.fillRect(width - wave - 70, y, 20, 1);
    }

    // Title: "SPLASH" line 1, "CRITTERS" line 2
    ctx.fillStyle = PALETTE.white;
    ctx.strokeStyle = PALETTE.darkBlue;
    ctx.lineWidth = 2;

    // Draw pixel-like text with shadow
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.strokeText('SPLASH', width / 2, 70);
    ctx.fillText('SPLASH', width / 2, 70);
    ctx.strokeText('CRITTERS', width / 2, 100);
    ctx.fillText('CRITTERS', width / 2, 100);

    // Subtitle
    ctx.fillStyle = PALETTE.yellow;
    ctx.font = '8px monospace';
    ctx.fillText('8-Bit Water Balloon Battler', width / 2, 120);

    // Buttons
    const buttons: Button[] = [
      { text: 'Play', x: 88, y: 145, w: 80, h: 16, action: () => screenManager.switchTo('menu'), hover: false },
      { text: 'How to Play', x: 88, y: 168, w: 80, h: 16, action: () => screenManager.switchTo('tutorial'), hover: false },
      { text: 'Settings', x: 88, y: 191, w: 80, h: 16, action: () => screenManager.switchTo('settings'), hover: false },
    ];

    // Check hover ( simplistic - we don't have mouse tracking in this module,
    // but we can render them and the main loop would need mouse support )
    for (const btn of buttons) {
      ctx.fillStyle = btn.hover ? PALETTE.yellow : PALETTE.blue;
      ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
      ctx.fillStyle = PALETTE.white;
      ctx.strokeStyle = PALETTE.darkBlue;
      ctx.lineWidth = 1;
      ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btn.text, btn.x + btn.w / 2, btn.y + btn.h / 2 + 1);
    }

    // Animated critter in corner
    const critterX = 20 + Math.sin(tick) * 10;
    const critterY = 170 + Math.cos(tick * 1.5) * 5;
    const walkFrame = Math.floor(tick * 4) % 2;
    ctx.fillStyle = PALETTE.green;
    ctx.fillRect(critterX, critterY, 8, 8);
    ctx.fillStyle = PALETTE.teal;
    ctx.fillRect(critterX + 2, critterY + 4, 4, 2);
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(critterX + 2, critterY + 1, 1, 1);
    ctx.fillRect(critterX + 5, critterY + 1, 1, 1);
    if (walkFrame === 1) {
      ctx.fillStyle = PALETTE.green;
      ctx.fillRect(critterX + 1, critterY + 7, 2, 1);
      ctx.fillRect(critterX + 5, critterY + 7, 2, 1);
    }
  },
  exit() {
    /* nothing */
  },
  handleMessage(msg: ServerMsg) {
    if (msg.type === 'welcome') {
      clientState.localPlayerId = msg.playerId;
      clientState.profile = msg.profile;
    }
  },
};

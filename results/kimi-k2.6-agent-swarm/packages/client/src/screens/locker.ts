import type { Screen } from './types.js';
import { audioEngine } from '../main.js';
import { PALETTE } from '../render/sprites.js';
import { clientState } from './title.js';
import type { Animal, Hat } from '@shared/types.js';

const ANIMALS: Animal[] = ['frog', 'duck', 'otter', 'penguin', 'cat', 'raccoon', 'turtle', 'capybara'];
const HATS: Hat[] = ['none', 'bucket', 'snorkel', 'crown', 'pirate', 'propeller'];

const ANIMAL_UNLOCK_LEVELS: Record<Animal, number> = {
  frog: 1,
  duck: 1,
  otter: 3,
  penguin: 5,
  cat: 7,
  raccoon: 10,
  turtle: 15,
  capybara: 20,
};

let selectedAnimal: Animal = 'frog';
let selectedHat: Hat = 'none';
let previewTick = 0;

export const lockerScreen: Screen = {
  enter(_data?: unknown) {
    const profile = clientState.profile;
    if (profile) {
      selectedAnimal = profile.selectedAnimal as Animal;
      selectedHat = profile.selectedHat as Hat;
    }
    previewTick = 0;
    audioEngine.playMusic('menu');
  },
  update(dt: number) {
    previewTick += dt * 4;
  },
  render(ctx: CanvasRenderingContext2D) {
    const width = 256;
    ctx.fillStyle = PALETTE.darkBlue;
    ctx.fillRect(0, 0, width, 224);

    // Header
    ctx.fillStyle = PALETTE.white;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Locker', width / 2, 12);

    const profile = clientState.profile;
    const level = profile?.level || 1;
    const xp = profile?.xp || 0;
    const xpForLevel = 100 + 25 * level;
    const xpPct = Math.min(1, xp / xpForLevel);

    ctx.fillStyle = PALETTE.yellow;
    ctx.font = '8px monospace';
    ctx.fillText(`Lv.${level}  XP: ${xp}/${xpForLevel}`, width / 2, 24);
    ctx.fillStyle = PALETTE.darkGray;
    ctx.fillRect(60, 28, 136, 4);
    ctx.fillStyle = PALETTE.green;
    ctx.fillRect(60, 28, 136 * xpPct, 4);

    // Animal grid (left side)
    const gridX = 10;
    const gridY = 40;
    const cellSize = 24;
    for (let i = 0; i < ANIMALS.length; i++) {
      const animal = ANIMALS[i];
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = gridX + col * (cellSize + 4);
      const y = gridY + row * (cellSize + 4);
      const unlocked = level >= ANIMAL_UNLOCK_LEVELS[animal];
      const isSelected = animal === selectedAnimal;

      ctx.fillStyle = isSelected ? PALETTE.blue : unlocked ? PALETTE.darkGray : PALETTE.black;
      ctx.fillRect(x, y, cellSize, cellSize);
      ctx.strokeStyle = isSelected ? PALETTE.yellow : PALETTE.lightGray;
      ctx.strokeRect(x, y, cellSize, cellSize);

      if (unlocked) {
        ctx.fillStyle = PALETTE.green;
        ctx.fillRect(x + 4, y + 4, 16, 16);
        ctx.fillStyle = PALETTE.teal;
        ctx.fillRect(x + 8, y + 10, 8, 4);
      } else {
        ctx.fillStyle = PALETTE.midGray;
        ctx.fillRect(x + 4, y + 4, 16, 16);
        ctx.fillStyle = PALETTE.red;
        ctx.font = '6px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${ANIMAL_UNLOCK_LEVELS[animal]}`, x + 12, y + 14);
      }
    }

    // Preview (center)
    const previewX = 110;
    const previewY = 70;
    const previewSize = 36;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(previewX, previewY, previewSize, previewSize);

    // Draw selected animal in preview
    const walkFrame = Math.floor(previewTick) % 2;
    const colors = getAnimalColors(selectedAnimal);
    ctx.fillStyle = colors.body;
    ctx.fillRect(previewX + 10, previewY + 12, 16, 16);
    ctx.fillStyle = colors.belly;
    ctx.fillRect(previewX + 14, previewY + 18, 8, 6);
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(previewX + 12, previewY + 14, 2, 2);
    ctx.fillRect(previewX + 22, previewY + 14, 2, 2);
    if (walkFrame === 1) {
      ctx.fillStyle = colors.body;
      ctx.fillRect(previewX + 12, previewY + 28, 4, 2);
      ctx.fillRect(previewX + 20, previewY + 28, 4, 2);
    }
    // Hat on preview
    if (selectedHat !== 'none') {
      ctx.fillStyle = PALETTE.gold;
      ctx.fillRect(previewX + 12, previewY + 8, 12, 4);
    }

    // Hat grid (right side)
    const hatGridX = 170;
    const hatGridY = 40;
    for (let i = 0; i < HATS.length; i++) {
      const hat = HATS[i];
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = hatGridX + col * (cellSize + 4);
      const y = hatGridY + row * (cellSize + 4);
      const isSelected = hat === selectedHat;

      ctx.fillStyle = isSelected ? PALETTE.blue : PALETTE.darkGray;
      ctx.fillRect(x, y, cellSize, cellSize);
      ctx.strokeStyle = isSelected ? PALETTE.yellow : PALETTE.lightGray;
      ctx.strokeRect(x, y, cellSize, cellSize);

      ctx.fillStyle = PALETTE.white;
      ctx.font = '5px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(hat === 'none' ? 'None' : hat.substring(0, 4), x + 12, y + 14);
    }

    // Save button
    ctx.fillStyle = PALETTE.green;
    ctx.fillRect(88, 180, 80, 16);
    ctx.fillStyle = PALETTE.white;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Save', 128, 190);

    // Back button
    ctx.fillStyle = PALETTE.red;
    ctx.fillRect(4, 206, 40, 14);
    ctx.fillStyle = PALETTE.white;
    ctx.fillText('Back', 24, 216);
  },
  exit() {
    /* nothing */
  },
};

function getAnimalColors(animal: Animal): { body: string; belly: string } {
  switch (animal) {
    case 'frog':
      return { body: PALETTE.green, belly: PALETTE.teal };
    case 'duck':
      return { body: PALETTE.yellow, belly: PALETTE.beige };
    case 'otter':
      return { body: PALETTE.brown, belly: PALETTE.beige };
    case 'penguin':
      return { body: PALETTE.darkGray, belly: PALETTE.white };
    case 'cat':
      return { body: PALETTE.orange, belly: PALETTE.beige };
    case 'raccoon':
      return { body: PALETTE.darkGray, belly: PALETTE.lightGray };
    case 'turtle':
      return { body: PALETTE.darkGreen, belly: PALETTE.green };
    case 'capybara':
      return { body: PALETTE.brown, belly: PALETTE.beige };
  }
}

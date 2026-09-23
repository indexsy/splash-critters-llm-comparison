// Locker preview: the selected critter + hat walking on a patch of backyard grass, turning
// through all four facings, drawn at 1x into a small canvas that CSS scales up crisply.
import { Dir, type AnimalId, type DirCode, type HatId } from '@splash/shared';
import { ctx2d } from '../../render/pixelart';
import { CRITTER_H, CRITTER_W, animalFrameAt, getCritter, getShadow } from '../../render/sprites';
import { getFloorTile, TILE } from '../../render/tiles';
import { settings } from '../../settings';
import type { Scope } from './scope';
import { pixelCanvas } from './sprite';

const PREVIEW_SIZE = 48;
const FACING_MS = 1300;
const FACINGS: readonly DirCode[] = [Dir.Down, Dir.Left, Dir.Up, Dir.Right];

export interface CritterPreview {
  readonly el: HTMLCanvasElement;
  show(animal: AnimalId, hat: HatId): void;
}

function drawGrass(ctx: CanvasRenderingContext2D): void {
  for (let y = 0; y < PREVIEW_SIZE; y += TILE) {
    for (let x = 0; x < PREVIEW_SIZE; x += TILE) ctx.drawImage(getFloorTile('backyard', (x + y) / TILE, (x / TILE + y / TILE) & 1, false), x, y);
  }
}

export function critterPreview(scope: Scope, animal: AnimalId, hat: HatId, scale = 2): CritterPreview {
  const el = pixelCanvas(PREVIEW_SIZE, PREVIEW_SIZE, scale, 'locker-preview');
  el.setAttribute('role', 'img');
  const ctx = ctx2d(el);
  let current = { animal, hat };
  const t0 = performance.now();
  scope.loop((now) => {
    const t = now - t0;
    const dir = FACINGS[Math.floor(t / FACING_MS) % FACINGS.length];
    const frame = animalFrameAt(true, t);
    drawGrass(ctx);
    const x = (PREVIEW_SIZE - CRITTER_W) / 2;
    const y = (PREVIEW_SIZE - CRITTER_H) / 2 + 2;
    ctx.drawImage(getShadow(12), x + 2, y + CRITTER_H - 3);
    ctx.drawImage(getCritter(current.animal, current.hat, dir, frame, 0, settings.get().colorblind, Math.floor(t / 80)), x, y);
  });
  const show = (a: AnimalId, h: HatId) => {
    current = { animal: a, hat: h };
    el.setAttribute('aria-label', `Preview: ${a}${h === 'none' ? '' : ` wearing ${h}`}`);
  };
  show(animal, hat);
  return { el, show };
}

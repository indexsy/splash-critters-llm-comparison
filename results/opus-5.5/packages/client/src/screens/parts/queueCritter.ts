// The queue screen's waiting critter: the player's own animal + hat pacing on a strip of sand,
// pausing to look around, with a thought bubble of dots while matchmaking searches.
import { Dir, type AnimalId, type DirCode, type HatId } from '@splash/shared';
import { PAL } from '../../render/palette';
import { ctx2d } from '../../render/pixelart';
import { CRITTER_H, CRITTER_W, animalFrameAt, getCritter, getShadow } from '../../render/sprites';
import { settings } from '../../settings';
import type { Scope } from './scope';

export const QUEUE_SCENE_W = 104;
export const QUEUE_SCENE_H = 34;
const GROUND = 28;
const SPEED = 14;
/** Seconds per behaviour beat: walk right, look, walk left, look. */
const BEAT_S = [3.2, 1.4, 3.2, 1.4] as const;

interface Pose {
  x: number;
  dir: DirCode;
  moving: boolean;
}

function poseAt(seconds: number): Pose {
  const cycle = BEAT_S.reduce((a, b) => a + b, 0);
  let t = seconds % cycle;
  const span = QUEUE_SCENE_W - CRITTER_W - 8;
  const walk = Math.min(span, BEAT_S[0] * SPEED);
  const left = 4 + (span - walk) / 2;
  if (t < BEAT_S[0]) return { x: left + t * SPEED, dir: Dir.Right, moving: true };
  t -= BEAT_S[0];
  if (t < BEAT_S[1]) return { x: left + walk, dir: t < BEAT_S[1] / 2 ? Dir.Down : Dir.Up, moving: false };
  t -= BEAT_S[1];
  if (t < BEAT_S[2]) return { x: left + walk - t * SPEED, dir: Dir.Left, moving: true };
  t -= BEAT_S[2];
  return { x: left, dir: t < BEAT_S[3] / 2 ? Dir.Down : Dir.Up, moving: false };
}

function drawGround(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, QUEUE_SCENE_W, QUEUE_SCENE_H);
  ctx.fillStyle = PAL.sandDark;
  ctx.fillRect(0, GROUND, QUEUE_SCENE_W, 1);
  ctx.fillStyle = PAL.sand;
  ctx.fillRect(0, GROUND + 1, QUEUE_SCENE_W, QUEUE_SCENE_H - GROUND - 1);
  ctx.fillStyle = PAL.cream;
  for (let x = 3; x < QUEUE_SCENE_W; x += 11) ctx.fillRect(x, GROUND + 3 + (x % 3), 1, 1);
}

function drawThought(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const dots = 1 + (Math.floor(t * 2.5) % 3);
  ctx.fillStyle = PAL.white;
  ctx.fillRect(x + 12, y - 1, 13, 7);
  ctx.fillRect(x + 13, y - 2, 11, 9);
  ctx.fillRect(x + 11, y + 7, 2, 2);
  ctx.fillStyle = PAL.ink;
  for (let i = 0; i < dots; i++) ctx.fillRect(x + 15 + i * 3, y + 2, 2, 2);
}

/** Animate the critter on `canvas` (QUEUE_SCENE_W x QUEUE_SCENE_H) until `scope` is disposed. */
export function runQueueCritter(canvas: HTMLCanvasElement, scope: Scope, animal: AnimalId, hat: HatId): void {
  const ctx = ctx2d(canvas);
  const t0 = performance.now();
  scope.loop((now) => {
    const t = (now - t0) / 1000;
    const pose = poseAt(t);
    drawGround(ctx);
    const x = Math.round(pose.x);
    const frame = animalFrameAt(pose.moving, now);
    const sprite = getCritter(animal, hat, pose.dir, frame, 0, settings.get().colorblind, Math.floor(now / 80));
    ctx.drawImage(getShadow(12), x + 2, GROUND - 3);
    ctx.drawImage(sprite, x, GROUND - CRITTER_H + 1);
    if (!pose.moving) drawThought(ctx, x, GROUND - CRITTER_H - 6, t);
  });
}

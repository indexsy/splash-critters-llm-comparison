/**
 * Hats. Each one is drawn relative to whatever head box the species reported,
 * so a bucket hat fits the frog's wide skull and the turtle's narrow one without
 * a per-species table. Hats always draw last, over the ears and the brow.
 */

import type { HatId } from '@splash/shared';
import { shade, tint } from './palette';
import type { Pen } from './pen';

export interface HeadBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CLOTH = {
  bucketDark: '#2f4d2a',
  bucketLight: '#6f9c4c',
  strap: '#20303f',
  glass: '#a8ecff',
  glassEdge: '#4fb4d8',
  tube: '#ff8a3d',
  tubeDark: '#c25a1c',
  gold: '#ffd24a',
  goldDark: '#8a6a12',
  gem: '#ff5d5d',
  bandana: '#c8302f',
  bandanaDark: '#7a1a1a',
  cap: '#3f6fd8',
  capDark: '#1f3f8a',
  blade: '#f2f6ff',
  stalk: '#ffd24a',
};

function drawBucket(pen: Pen, head: HeadBox): void {
  const brimY = head.y + 1;
  pen.rect(head.x - 2, brimY, head.w + 4, 2, CLOTH.bucketDark);
  pen.rect(head.x - 1, brimY, head.w + 2, 1, CLOTH.bucketLight);
  pen.rect(head.x + 1, head.y - 3, head.w - 2, 4, CLOTH.bucketLight);
  pen.rect(head.x + 1, head.y - 3, head.w - 2, 1, CLOTH.bucketDark);
  pen.rect(head.x + 2, head.y - 1, head.w - 4, 1, CLOTH.bucketDark);
}

function drawSnorkel(pen: Pen, head: HeadBox): void {
  const maskY = head.y + 1;
  pen.rect(head.x, maskY, head.w, 4, CLOTH.strap);
  pen.rect(head.x + 1, maskY + 1, head.w - 2, 2, CLOTH.glass);
  pen.rect(head.x + 1, maskY + 1, head.w - 2, 1, CLOTH.glassEdge);
  // Breathing tube up the side, with the mouthpiece bending back inward.
  const tubeX = head.x + head.w;
  pen.rect(tubeX, head.y - 4, 2, 7, CLOTH.tube);
  pen.rect(tubeX, head.y - 4, 1, 7, CLOTH.tubeDark);
  pen.rect(tubeX - 1, head.y + 3, 3, 1, CLOTH.tubeDark);
}

function drawCrown(pen: Pen, head: HeadBox): void {
  const centre = head.x + Math.floor(head.w / 2);
  const y = head.y - 4;
  pen.rect(centre - 4, y + 3, 9, 2, CLOTH.gold);
  pen.rect(centre - 4, y + 5, 9, 1, CLOTH.goldDark);
  for (const dx of [-4, 0, 4]) {
    pen.rect(centre + dx, y, 1, 3, CLOTH.gold);
    pen.dot(centre + dx, y, tint(CLOTH.gold, 0.4));
  }
  pen.dot(centre, y + 3, CLOTH.gem);
}

function drawBandana(pen: Pen, head: HeadBox): void {
  pen.rect(head.x, head.y, head.w, 3, CLOTH.bandana);
  pen.rect(head.x, head.y + 2, head.w, 1, CLOTH.bandanaDark);
  pen.rect(head.x + 1, head.y - 1, head.w - 2, 1, CLOTH.bandana);
  // Knot and two trailing ends on the left, so the wrap reads as tied.
  pen.rect(head.x - 2, head.y + 1, 2, 2, CLOTH.bandanaDark);
  pen.rect(head.x - 4, head.y + 2, 2, 1, CLOTH.bandana);
  pen.rect(head.x - 4, head.y + 4, 3, 1, CLOTH.bandana);
  pen.dot(head.x + 2, head.y + 1, tint(CLOTH.bandana, 0.5));
}

function drawPropeller(pen: Pen, head: HeadBox, frame: number): void {
  const centre = head.x + Math.floor(head.w / 2);
  const y = head.y - 1;
  pen.rect(head.x + 1, y - 2, head.w - 2, 3, CLOTH.cap);
  pen.rect(head.x + 1, y, head.w - 2, 1, CLOTH.capDark);
  pen.rect(head.x + 2, y - 3, head.w - 4, 1, CLOTH.cap);
  pen.rect(centre, y - 5, 1, 2, CLOTH.stalk);
  // Two blade positions: edge-on and flat-on, which reads as a spin at 8fps.
  if (frame === 0) {
    pen.rect(centre - 4, y - 6, 9, 1, CLOTH.blade);
    pen.dot(centre - 4, y - 5, shade(CLOTH.blade, 0.35));
    pen.dot(centre + 4, y - 7, shade(CLOTH.blade, 0.35));
  } else {
    pen.rect(centre - 2, y - 6, 5, 1, CLOTH.blade);
    pen.dot(centre - 1, y - 7, shade(CLOTH.blade, 0.35));
    pen.dot(centre + 1, y - 5, shade(CLOTH.blade, 0.35));
  }
}

export function drawHat(pen: Pen, hat: HatId, head: HeadBox, frame: number): void {
  switch (hat) {
    case 'bucket':
      drawBucket(pen, head);
      break;
    case 'snorkel':
      drawSnorkel(pen, head);
      break;
    case 'crown':
      drawCrown(pen, head);
      break;
    case 'bandana':
      drawBandana(pen, head);
      break;
    case 'propeller':
      drawPropeller(pen, head, frame);
      break;
    default:
      break;
  }
}

/** Compact hat mark for the 8x8 portrait, so the locker preview still shows it. */
export function drawHatIcon(pen: Pen, hat: HatId): void {
  switch (hat) {
    case 'bucket':
      pen.rect(0, 1, 8, 1, CLOTH.bucketDark);
      pen.rect(2, 0, 4, 1, CLOTH.bucketLight);
      break;
    case 'snorkel':
      pen.rect(1, 2, 6, 2, CLOTH.glass);
      pen.rect(7, 0, 1, 4, CLOTH.tube);
      break;
    case 'crown':
      pen.rect(2, 1, 5, 1, CLOTH.gold);
      pen.dot(2, 0, CLOTH.gold);
      pen.dot(4, 0, CLOTH.gold);
      pen.dot(6, 0, CLOTH.gold);
      break;
    case 'bandana':
      pen.rect(1, 1, 6, 1, CLOTH.bandana);
      pen.dot(0, 2, CLOTH.bandanaDark);
      break;
    case 'propeller':
      pen.rect(2, 1, 4, 1, CLOTH.cap);
      pen.rect(1, 0, 6, 1, CLOTH.blade);
      break;
    default:
      break;
  }
}

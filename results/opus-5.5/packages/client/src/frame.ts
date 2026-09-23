// The one 256x224 backbuffer canvas, integer-scaled to the largest fit of the window and
// letterboxed, plus the DOM overlay (#ui) that exactly covers the scaled canvas. The current
// scale is exposed as the unitless CSS variable --px on <html>, so every UI dimension can be
// written in backbuffer pixels: `calc(8px * var(--px))`.

const W = 256;
const H = 224;

type ResizeListener = (scale: number) => void;

export interface Frame {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** DOM overlay layer sized and positioned exactly over the scaled canvas. */
  readonly ui: HTMLDivElement;
  /** Current integer scale (CSS px per backbuffer px), >= 1. */
  readonly scale: number;
  readonly W: typeof W;
  readonly H: typeof H;
  /** Called after every scale/position change; returns an unsubscribe function. */
  onResize(fn: ResizeListener): () => void;
}

function createStage(): { stage: HTMLDivElement; canvas: HTMLCanvasElement; ui: HTMLDivElement } {
  const host = document.getElementById('app') ?? document.body;
  const stage = document.createElement('div');
  stage.id = 'stage';
  const canvas = document.createElement('canvas');
  canvas.id = 'screen';
  canvas.width = W;
  canvas.height = H;
  canvas.setAttribute('aria-hidden', 'true');
  const ui = document.createElement('div');
  ui.id = 'ui';
  stage.append(canvas, ui);
  host.append(stage);
  return { stage, canvas, ui };
}

function acquireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not supported in this browser');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function fitScale(): number {
  return Math.max(1, Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H)));
}

const { stage, canvas, ui } = createStage();
const ctx = acquireContext(canvas);
const listeners = new Set<ResizeListener>();
let scale = 0;
let pending = 0;

function layout(): void {
  pending = 0;
  const next = fitScale();
  const width = W * next;
  const height = H * next;
  stage.style.width = `${width}px`;
  stage.style.height = `${height}px`;
  stage.style.left = `${Math.max(0, Math.floor((window.innerWidth - width) / 2))}px`;
  stage.style.top = `${Math.max(0, Math.floor((window.innerHeight - height) / 2))}px`;
  if (next === scale) return;
  scale = next;
  document.documentElement.style.setProperty('--px', String(next));
  for (const fn of [...listeners]) fn(next);
}

function scheduleLayout(): void {
  if (!pending) pending = requestAnimationFrame(layout);
}

layout();
window.addEventListener('resize', scheduleLayout);

export const frame: Frame = {
  canvas,
  ctx,
  ui,
  get scale() {
    return scale;
  },
  W,
  H,
  onResize(fn: ResizeListener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

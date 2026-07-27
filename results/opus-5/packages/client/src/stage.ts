/**
 * The 256x224 canvas. Everything the game draws goes through here, scaled by a
 * whole number so pixels stay square and crisp.
 */

export const STAGE_WIDTH = 256;
export const STAGE_HEIGHT = 224;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let scale = 1;

export function getCanvas(): HTMLCanvasElement {
  if (!canvas) {
    const found = document.getElementById('stage');
    if (!(found instanceof HTMLCanvasElement)) throw new Error('#stage canvas is missing');
    canvas = found;
    canvas.width = STAGE_WIDTH;
    canvas.height = STAGE_HEIGHT;
  }
  return canvas;
}

export function getContext(): CanvasRenderingContext2D {
  if (!ctx) {
    const context = getCanvas().getContext('2d', { alpha: false });
    if (!context) throw new Error('2d canvas context unavailable');
    context.imageSmoothingEnabled = false;
    ctx = context;
  }
  return ctx;
}

let fitPending = true;

/** Ask for a refit on the next frame, once the DOM around the canvas has settled. */
export function requestFit(): void {
  fitPending = true;
}

/** Called once per frame. Measuring layout is only worth it when something moved. */
export function tickStageFit(): void {
  if (!fitPending) return;
  fitPending = false;
  fitStage();
}

/**
 * Largest whole-number scale that still fits the viewport, leaving room for
 * whatever the active screen renders underneath. The title screen puts real
 * buttons below the canvas, and at full scale they fall off a laptop viewport.
 */
export function fitStage(): void {
  const element = getCanvas();
  const screen = document.getElementById('screen');
  const reserved =
    screen !== null && screen.childElementCount > 0 ? screen.getBoundingClientRect().height + 20 : 0;
  const padding = 24;
  const maxWidth = Math.max(1, window.innerWidth - padding);
  const maxHeight = Math.max(1, window.innerHeight - padding - reserved);
  const next = Math.max(1, Math.floor(Math.min(maxWidth / STAGE_WIDTH, maxHeight / STAGE_HEIGHT)));
  if (next === scale && element.style.width) return;
  scale = next;
  element.style.width = `${STAGE_WIDTH * scale}px`;
  element.style.height = `${STAGE_HEIGHT * scale}px`;
}

export function getScale(): number {
  return scale;
}

export function showStage(visible: boolean): void {
  const element = getCanvas();
  element.hidden = !visible;
  // The screen's own DOM is usually mounted right after this, so measure next
  // frame rather than against a layout that is about to change.
  if (visible) requestFit();
}

/** Convert a viewport point into stage pixels, for the tutorial's pointer hints. */
export function toStagePoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = getCanvas().getBoundingClientRect();
  return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
}

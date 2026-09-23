// Announcer text pops over the arena ("DOUBLE SPLASH!", "RISING TIDE!", "DRAW!"): chunky
// banded pixel text that punches in, floats up and blinks out. Newer calls push older ones up.
import { labelCanvas } from './label';
import { PAL } from './palette';

export type AnnouncerTone = 'chain' | 'tide' | 'info' | 'win' | 'lose';

const TONES: Record<AnnouncerTone, readonly string[]> = {
  chain: [PAL.yellowLight, PAL.yellow, PAL.orange],
  tide: [PAL.foam, PAL.skyLight, PAL.sky],
  info: [PAL.white, PAL.cloud],
  win: [PAL.yellowLight, PAL.yellow, PAL.gold],
  lose: [PAL.pinkLight, PAL.pink, PAL.red],
};

interface Pop {
  text: string;
  tone: AnnouncerTone;
  bold: boolean;
  startMs: number;
  durationMs: number;
}

const PUNCH_MS = 90;
/** Announcer text is drawn at 2x (bold calls double the glyphs on top of that). */
const SCALE = 2;
const MAX_POPS = 3;
const LINE_GAP = 4;
/** A punch-in frame never grows wider than the screen. */
const MAX_WIDTH = 250;

export class Announcer {
  private pops: Pop[] = [];

  /** `bold` doubles the glyphs (headline calls); the default is 2x chunky text. */
  say(text: string, tone: AnnouncerTone, nowMs: number, opts: { bold?: boolean; ms?: number } = {}): void {
    this.pops = this.pops.filter((p) => p.text !== text);
    this.pops.push({ text, tone, bold: opts.bold === true, startMs: nowMs, durationMs: opts.ms ?? 1300 });
    if (this.pops.length > MAX_POPS) this.pops.shift();
  }

  clear(): void {
    this.pops = [];
  }

  /** Draw live pops centred on (cx, cy); the newest sits lowest. */
  draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, nowMs: number): void {
    this.pops = this.pops.filter((p) => nowMs - p.startMs < p.durationMs);
    let y = cy;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      const t = nowMs - p.startMs;
      const left = p.durationMs - t;
      const rise = Math.min(6, Math.floor(t / 120));
      const style = { bands: TONES[p.tone], outline: PAL.ink, bold: p.bold };
      const punched = t < PUNCH_MS ? labelCanvas(p.text, { ...style, scale: SCALE + 1 }) : null;
      const cv = punched && punched.width <= MAX_WIDTH ? punched : labelCanvas(p.text, { ...style, scale: SCALE });
      const blinkedOut = left < 240 && Math.floor(left / 60) % 2 === 1;
      if (!blinkedOut) ctx.drawImage(cv, Math.round(cx - cv.width / 2), Math.round(y - rise - cv.height / 2));
      y -= cv.height + LINE_GAP;
    }
  }
}

// Kill feed: the last few soaks as short pixel lines with names in their slot colours.
// FFA shows it over the arena's top border row; Duel uses the strip below the arena. The
// tutorial's strip below holds the objectives panel, so it uses the top border row too.
import { clip, type FeedLine } from '../game/labels';
import type { ArenaLayout } from './camera';
import { SCREEN_W } from './camera';
import { drawText, measureText } from './font';
import { PAL, slotColor } from './palette';
import { PixelGrid, cached } from './pixelart';

const LINE_MS = 4500;
const LINE_H = 7;
const NAME_MAX = 10;

interface Entry {
  line: FeedLine;
  atMs: number;
}

/** 5x5 rubber-duck marker for revenge soaks. */
function duckMarker(): HTMLCanvasElement {
  return cached('feed-duck', () =>
    PixelGrid.fromRows(['.yy..', 'yyko.', '.yyyy', 'yyyyy', '.yyy.'], { y: PAL.yellow, k: PAL.ink, o: PAL.orange }).toCanvas(),
  );
}

/** Text of one feed span: names are clipped (marked with '.' like the HUD's), the rest as is. */
export function feedSpanText(text: string, slot: number | null): string {
  return slot === null ? text : clip(text, NAME_MAX);
}

function lineWidth(line: FeedLine): number {
  const text = line.spans.map((s) => feedSpanText(s.text, s.slot)).join('');
  return measureText(text, 'small') + (line.revenge ? 7 : 0);
}

export class KillFeed {
  private entries: Entry[] = [];

  push(line: FeedLine, nowMs: number): void {
    this.entries.push({ line, atMs: nowMs });
    if (this.entries.length > 6) this.entries.shift();
  }

  clear(): void {
    this.entries = [];
  }

  private visible(nowMs: number, max: number): Entry[] {
    this.entries = this.entries.filter((e) => nowMs - e.atMs < LINE_MS);
    return this.entries.slice(-max);
  }

  private drawLine(ctx: CanvasRenderingContext2D, e: Entry, x: number, y: number, colorblind: boolean, nowMs: number): void {
    const w = lineWidth(e.line);
    const age = nowMs - e.atMs;
    ctx.globalAlpha = age > LINE_MS - 400 ? (LINE_MS - age) / 400 : 1;
    ctx.fillStyle = e.line.mine ? PAL.slate : PAL.ink;
    ctx.fillRect(x - 2, y - 1, w + 4, LINE_H);
    let cx = x;
    if (e.line.revenge) {
      ctx.drawImage(duckMarker(), cx, y);
      cx += 7;
    }
    for (const span of e.line.spans) {
      const color = span.slot === null ? PAL.cloud : slotColor(span.slot, colorblind).light;
      cx += drawText(ctx, feedSpanText(span.text, span.slot), cx, y, { font: 'small', color }) + 1;
    }
    ctx.globalAlpha = 1;
  }

  /** `onBorder`: draw over the arena's top border row instead of the strip below it. */
  draw(ctx: CanvasRenderingContext2D, layout: ArenaLayout, colorblind: boolean, nowMs: number, onBorder: boolean): void {
    if (onBorder || layout.hud === 'compact') {
      const list = this.visible(nowMs, 2);
      list.forEach((e, i) => this.drawLine(ctx, e, layout.ax + 3, layout.ay + 2 + i * LINE_H, colorblind, nowMs));
      return;
    }
    const rows = Math.max(1, Math.min(3, Math.floor((layout.bottomH - 2) / LINE_H)));
    const list = this.visible(nowMs, rows);
    list.forEach((e, i) => {
      const w = lineWidth(e.line);
      this.drawLine(ctx, e, Math.round((SCREEN_W - w) / 2), layout.bottomY + 2 + i * LINE_H, colorblind, nowMs);
    });
  }
}

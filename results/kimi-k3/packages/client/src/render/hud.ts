import { AnimalId, HatId } from '@splash/shared';
import { MatchPlayerConfig, Placement } from '@splash/shared';

export interface KillFeedItem {
  text: string;
  until: number;
}

export class Hud {
  root: HTMLElement;
  private cards: HTMLElement;
  private feed: HTMLElement;
  private announceEl: HTMLElement;
  private banner: HTMLElement;
  private announceTimer: number | null = null;

  constructor() {
    this.root = document.getElementById('hud')!;
    this.root.innerHTML = '';
    this.cards = document.createElement('div');
    this.cards.style.cssText = 'position:absolute;top:6px;left:6px;display:flex;flex-direction:column;gap:4px;';
    this.feed = document.createElement('div');
    this.feed.style.cssText = 'position:absolute;top:6px;right:6px;display:flex;flex-direction:column;gap:3px;align-items:flex-end;font-size:11px;';
    this.announceEl = document.createElement('div');
    this.announceEl.style.cssText =
      'position:absolute;top:34%;left:50%;transform:translate(-50%,-50%);font-size:26px;font-weight:bold;color:#73eff7;text-shadow:2px 2px 0 #0d2b45;letter-spacing:2px;text-align:center;pointer-events:none;';
    this.banner = document.createElement('div');
    this.banner.style.cssText =
      'position:absolute;bottom:8px;left:50%;transform:translateX(-50%);font-size:12px;color:#ffcd75;text-shadow:1px 1px 0 #000;';
    this.root.append(this.cards, this.feed, this.announceEl, this.banner);
  }

  destroy(): void {
    this.root.innerHTML = '';
  }

  setCards(players: MatchPlayerConfig[], mySlot: number, wins: number[], soaks: number[], alive: boolean[], pingMs: number): void {
    this.cards.innerHTML = '';
    for (const p of players) {
      const card = document.createElement('div');
      card.style.cssText = `display:flex;align-items:center;gap:6px;background:rgba(20,23,42,.85);border:2px solid ${p.slot === mySlot ? '#73eff7' : '#333c68'};padding:3px 8px;font-size:11px;${alive[p.slot] === false ? 'opacity:.45;' : ''}`;
      const c = document.createElement('canvas');
      c.width = 12;
      c.height = 12;
      c.style.cssText = 'width:24px;height:24px;image-rendering:pixelated;';
      drawMiniIcon(c, p.animal, p.hat);
      const name = document.createElement('span');
      name.textContent = p.nickname;
      const stats = document.createElement('span');
      stats.style.cssText = 'color:#ffcd75;';
      stats.textContent = ` ${'●'.repeat(Math.max(0, wins[p.slot] ?? 0))}${'○'.repeat(Math.max(0, 3 - (wins[p.slot] ?? 0)))}`;
      const soak = document.createElement('span');
      soak.style.cssText = 'color:#41a6f6;';
      soak.textContent = `~${soaks[p.slot] ?? 0}`;
      card.append(c, name, stats, soak);
      if (p.slot === mySlot && pingMs > 0) {
        const ping = document.createElement('span');
        ping.style.cssText = 'color:#94e044;font-size:9px;';
        ping.textContent = `${pingMs}ms`;
        card.append(ping);
      }
      this.cards.append(card);
    }
  }

  kill(text: string): void {
    const item = document.createElement('div');
    item.style.cssText = 'background:rgba(20,23,42,.9);border:1px solid #333c68;padding:2px 8px;';
    item.textContent = text;
    this.feed.prepend(item);
    while (this.feed.children.length > 5) this.feed.lastChild!.remove();
    setTimeout(() => {
      item.style.transition = 'opacity .5s';
      item.style.opacity = '0';
      setTimeout(() => item.remove(), 500);
    }, 4000);
  }

  announce(text: string, sub = '', ms = 1600): void {
    this.announceEl.innerHTML = '';
    const t = document.createElement('div');
    t.textContent = text;
    this.announceEl.append(t);
    if (sub) {
      const s = document.createElement('div');
      s.style.cssText = 'font-size:13px;color:#ffcd75;';
      s.textContent = sub;
      this.announceEl.append(s);
    }
    if (this.announceTimer !== null) clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(() => {
      this.announceEl.innerHTML = '';
    }, ms);
  }

  setBanner(text: string): void {
    this.banner.textContent = text;
  }
}

import { animalSprite, drawSprite, hatSprite } from '../render/sprites.js';

export function drawMiniIcon(canvas: HTMLCanvasElement, animal: AnimalId, hat: HatId): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 12, 12);
  const spr = animalSprite(animal, 0);
  const yOff = Math.max(0, spr.rows.length - 12);
  drawSprite(ctx, spr.rows, spr.pal, 0, -yOff);
  const h = hatSprite(hat);
  if (h) drawSprite(ctx, h.rows, h.pal, 0, Math.max(0, 2 - yOff));
}

export interface ResultsData {
  placements: Placement[];
  xp: Record<string, number>;
  ratingDeltas: Record<string, number>;
  myPlayerId: string;
  ranked: boolean;
}

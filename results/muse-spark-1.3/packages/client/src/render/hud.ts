import type { SnapPlayer } from '@splash/shared';

export function renderHud(el: HTMLElement, players: SnapPlayer[], myId: string, ping: number, roundNo: number, scores: Record<string, number>): void {
  el.innerHTML = '';
  const info = document.createElement('div');
  info.className = 'small';
  info.textContent = `Round ${roundNo} · Ping ${Math.round(ping)}ms · M mute · 1-4 emotes · Space balloon`;
  el.appendChild(info);
  const wrap = document.createElement('div');
  wrap.className = 'hud';
  const sorted = [...players].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  for (const p of sorted) {
    const d = document.createElement('div');
    d.className = 'p';
    d.style.borderColor = p.id === myId ? '#5df2ff' : p.alive ? '#2b3a67' : '#553';
    const trophy = scores[p.id] ?? 0;
    d.innerHTML = `${p.alive ? '💧' : '💦'} <b>${escapeHtml(p.nick)}</b> ${p.isDuck ? '🦆' : ''}<br/>🏆${trophy} · 🎈${p.balloons} · ✸${p.range} · ${p.boots ? '🥾' : ''}`;
    el.appendChild(wrap);
    wrap.appendChild(d);
  }
  el.appendChild(wrap);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export class Feed {
  el: HTMLElement;
  lines: string[] = [];
  constructor(el: HTMLElement) {
    this.el = el;
  }
  push(t: string): void {
    this.lines.push(t);
    if (this.lines.length > 6) this.lines.shift();
    this.el.innerHTML = this.lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  }
}

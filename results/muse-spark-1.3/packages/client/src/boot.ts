import { app, setProfile } from './state.js';
import { net } from './net.js';
import type { ServerMsg } from '@splash/shared';

let started = false;

export function ensureNet(): void {
  if (started) return;
  started = true;
  net.on((m: ServerMsg) => {
    if (m.kind === 'welcome') {
      setProfile({
        playerId: m.playerId,
        token: m.token,
        nickname: m.nickname,
        tag: m.tag,
        level: m.level,
        xp: m.xp,
        animal: m.animal,
        hat: m.hat,
      });
      void app;
      renderProfileBits();
    }
  });
  net.connect();
}

function renderProfileBits(): void {
  document.querySelectorAll('[data-profile]').forEach((el) => {
    const p = app.profile;
    el.textContent = p ? `${p.nickname}#${p.tag} · Lv${p.level}` : '…';
  });
}

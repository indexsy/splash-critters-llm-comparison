import { CONFIG } from '@splash/shared';
import { tickMatchmaker } from './matchmaker.js';
import { tickRooms } from './rooms.js';
import { sendTo, sessions } from './wire.js';

export function startLoops() {
  let last = Date.now();
  let mm = Date.now();
  let pingAt = Date.now();
  setInterval(() => {
    const now = Date.now();
    let steps = 0;
    while (now - last >= 1000 / CONFIG.TICK_RATE && steps < 5) {
      last += 1000 / CONFIG.TICK_RATE;
      tickRooms(now);
      steps++;
    }
    if (now - last > 1000) last = now;
    if (now - mm >= CONFIG.MM_INTERVAL_MS) {
      mm = now;
      tickMatchmaker(now);
    }
    if (now - pingAt >= 2000) {
      pingAt = now;
      for (const s of sessions.values()) {
        if (!s.ws) continue;
        sendTo(s.playerId, { t: 'ping', serverTime: now, rtt: s.rtt });
      }
    }
  }, 10);
}

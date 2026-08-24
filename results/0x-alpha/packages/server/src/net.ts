import type { ClientMsg } from "@sc/shared";

export interface RateLimiter {
  allow(key: string): boolean;
}

export function createRateLimiter(maxPerSec: number): RateLimiter {
  const counts = new Map<string, { n: number; windowStart: number }>();
  return {
    allow(key: string): boolean {
      const now = Date.now();
      let entry = counts.get(key);
      if (!entry || now - entry.windowStart > 1000) {
        entry = { n: 0, windowStart: now };
        counts.set(key, entry);
      }
      entry.n++;
      // periodic GC
      if (counts.size > 5000) {
        for (const [k, v] of counts) if (now - v.windowStart > 5000) counts.delete(k);
      }
      return entry.n <= maxPerSec;
    },
  };
}

const MAX_MSG_BYTES = 2048;

export function validateClientMsg(data: string): ClientMsg | null {
  if (data.length > MAX_MSG_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const msg = parsed as Record<string, unknown>;
  switch (msg.t) {
    case "hello":
      return { t: "hello", token: typeof msg.token === "string" ? msg.token.slice(0, 64) : undefined };
    case "set_nickname":
      return typeof msg.nickname === "string" ? { t: "set_nickname", nickname: msg.nickname } : null;
    case "select": {
      if (typeof msg.animal !== "string") return null;
      if (msg.hat !== null && typeof msg.hat !== "string") return null;
      return { t: "select", animal: msg.animal.slice(0, 24), hat: msg.hat };
    }
    case "queue_join":
      return msg.mode === "duel" || msg.mode === "ffa" ? { t: "queue_join", mode: msg.mode } : null;
    case "queue_leave":
      return { t: "queue_leave" };
    case "create_room": {
      if (typeof msg.name !== "string" || msg.name.length > 32) return null;
      if (msg.mode !== "duel" && msg.mode !== "ffa") return null;
      const theme = msg.theme;
      if (theme !== "random" && theme !== "backyard" && theme !== "beach" && theme !== "pool") return null;
      const rtw = msg.roundsToWin;
      if (rtw !== 2 && rtw !== 3 && rtw !== 5) return null;
      return {
        t: "create_room",
        name: msg.name.trim() || "Room",
        mode: msg.mode,
        isPublic: !!msg.isPublic,
        theme,
        roundsToWin: rtw,
        botFill: !!msg.botFill,
      };
    }
    case "join_room":
      return typeof msg.code === "string" ? { t: "join_room", code: msg.code.toUpperCase().slice(0, 6) } : null;
    case "room_list_request":
      return { t: "room_list_request" };
    case "leave_room":
      return { t: "leave_room" };
    case "set_slot": {
      if (typeof msg.slot !== "number" || msg.slot < 0 || msg.slot > 3) return null;
      if (msg.kind !== "open" && msg.kind !== "bot") return null;
      const d = msg.difficulty;
      if (d !== undefined && d !== "easy" && d !== "medium" && d !== "hard") return null;
      return { t: "set_slot", slot: msg.slot, kind: msg.kind, difficulty: d ?? "medium" };
    }
    case "set_ready":
      return typeof msg.ready === "boolean" ? { t: "set_ready", ready: msg.ready } : null;
    case "start_match":
      return { t: "start_match" };
    case "input": {
      if (
        typeof msg.seq !== "number" ||
        typeof msg.dirX !== "number" ||
        typeof msg.dirY !== "number" ||
        typeof msg.balloonPressed !== "boolean"
      )
        return null;
      const dx = Number.isFinite(msg.dirX) ? Math.max(-1, Math.min(1, msg.dirX)) : 0;
      const dy = Number.isFinite(msg.dirY) ? Math.max(-1, Math.min(1, msg.dirY)) : 0;
      return {
        t: "input",
        seq: msg.seq | 0,
        tick: typeof msg.tick === "number" ? msg.tick | 0 : 0,
        dirX: dx,
        dirY: dy,
        balloonPressed: msg.balloonPressed,
      };
    }
    case "emote":
      return typeof msg.id === "number" && msg.id >= 1 && msg.id <= 4 ? { t: "emote", id: msg.id | 0 } : null;
    case "rematch_vote":
      return { t: "rematch_vote" };
    case "pong":
      return typeof msg.t1 === "number" ? { t: "pong", t1: msg.t1 } : null;
    default:
      return null;
  }
}

// Frame-trace analysis for the netcode feel flow: local input latency (frames from a key press
// to the first on-screen movement), remote smoothness (per-frame displacement while a remote
// critter walks steadily) and local rubber-banding. Input: window.splashNetStats traces.

const KEY_DIR = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
const TILE = 16;
/** Leg start/stop easing window: 1.5 snapshot intervals (15 Hz), 3 input ticks (30 Hz). */
const EASE_MS = 100;

const same = (a, b) => a && b && a.x === b.x && a.y === b.y;

/**
 * For every movement key-down taken from rest, how many rendered frames it took until the
 * local critter was drawn somewhere else. Returns one entry per press.
 */
export function inputLatency(frames, keys) {
  const out = [];
  for (const k of keys) {
    if (k.type !== 'down' || !KEY_DIR[k.code]) continue;
    const before = frames.filter((f) => f.t <= k.t && f.local);
    const after = frames.filter((f) => f.t > k.t && f.local);
    if (before.length < 6 || after.length === 0) continue;
    const rest = before.slice(-6);
    if (!rest.every((f) => same(f.local, rest[0].local))) continue; // was still moving: not from rest
    const idx = after.findIndex((f) => !same(f.local, rest[0].local));
    if (idx < 0) continue;
    out.push({ code: k.code, frames: idx + 1, ms: Math.round(after[idx].t - k.t) });
  }
  return out;
}

/** Per-frame displacement of `pick(frame)` over a window. */
function displacements(frames, pick) {
  const out = [];
  for (let i = 1; i < frames.length; i++) {
    const a = pick(frames[i - 1]);
    const b = pick(frames[i]);
    if (!a || !b) continue;
    out.push({ t: frames[i].t, dt: frames[i].t - frames[i - 1].t, dx: b.x - a.x, dy: b.y - a.y });
  }
  return out;
}

/** Walking smoothness of remote critter `slot` as drawn in this tab (see walkSmoothness). */
export function remoteSmoothness(frames, slot, speedTilesPerSec = 4) {
  return walkSmoothness(frames, (f) => f.remote.find((r) => r.slot === slot), speedTilesPerSec);
}

/** Walking smoothness of this tab's own critter. */
export function localSmoothness(frames, speedTilesPerSec = 4) {
  return walkSmoothness(frames, (f) => f.local, speedTilesPerSec);
}

/**
 * Split a critter's trace into legs of steady walking along one axis (sign changes and long
 * stops end a leg) and measure each leg: per-frame displacement, zero-then-jump stutters (a
 * frame that stood still followed by a catch-up larger than the walking speed allows) and
 * snaps longer than a tile.
 */
function walkSmoothness(frames, pick, speedTilesPerSec) {
  const d = displacements(frames, pick);
  const pxPerMs = (speedTilesPerSec * TILE) / 1000;
  const legs = [];
  let cur = [];
  let sign = 0;
  let still = 0;
  const flush = () => {
    const moving = cur.filter((s) => s.dx || s.dy);
    if (moving.length >= 8) legs.push(cur.slice(0, cur.lastIndexOf(moving[moving.length - 1]) + 1));
    cur = [];
    still = 0;
  };
  for (const s of d) {
    const v = s.dx + s.dy;
    const sg = Math.sign(v);
    if (sg !== 0 && sign !== 0 && sg !== sign) {
      flush();
    }
    if (sg !== 0) sign = sg;
    still = sg === 0 ? still + s.dt : 0;
    if (still > 150) {
      flush();
      sign = 0;
      continue;
    }
    if (sg !== 0 || cur.length) cur.push(s);
  }
  flush();
  let maxPx = 0;
  let minPx = Infinity;
  let stutters = 0;
  let snaps = 0;
  let framesIn = 0;
  let zeroFrames = 0;
  let midZeroFrames = 0;
  let midMaxPx = 0;
  for (const leg of legs) {
    let run = 0;
    const [t0, t1] = [leg[0].t, leg[leg.length - 1].t];
    for (const s of leg) {
      const px = Math.abs(s.dx) + Math.abs(s.dy);
      framesIn += 1;
      maxPx = Math.max(maxPx, px);
      minPx = Math.min(minPx, px);
      if (px > TILE) snaps += 1;
      // Starting and stopping happen inside one snapshot interval (and a key press moves the
      // local critter a whole tick at once), so the first and last ~100 ms of a leg may ease.
      const mid = s.t - t0 > EASE_MS && t1 - s.t > EASE_MS;
      if (mid) midMaxPx = Math.max(midMaxPx, px);
      if (px === 0) {
        zeroFrames += 1;
        if (mid) midZeroFrames += 1;
        run += s.dt;
        continue;
      }
      // After standing still for `run` ms, a walking critter may catch up at most the distance
      // covered in that time plus this frame, plus one pixel of rounding.
      if (run > 0 && px > Math.ceil(pxPerMs * (run + s.dt)) + 1) stutters += 1;
      run = 0;
    }
  }
  return { legs: legs.length, frames: framesIn, maxPx, minPx: minPx === Infinity ? 0 : minPx, zeroFrames, midZeroFrames, midMaxPx, stutters, snaps };
}

/**
 * Local rubber-banding: while one movement key is held, the critter must never be drawn moving
 * backwards (a correction yanking it back) or jumping more than a tile.
 */
export function localRubberBand(frames, keys) {
  const d = displacements(frames, (f) => f.local);
  let backwards = 0;
  let jumps = 0;
  let maxBack = 0;
  let checked = 0;
  const downs = keys.filter((k) => k.type === 'down' && KEY_DIR[k.code]);
  for (const k of downs) {
    const up = keys.find((u) => u.type === 'up' && u.code === k.code && u.t > k.t);
    if (!up) continue;
    const [dx, dy] = KEY_DIR[k.code];
    for (const s of d) {
      if (s.t <= k.t + 60 || s.t >= up.t) continue;
      checked += 1;
      const along = s.dx * dx + s.dy * dy;
      if (along < 0) {
        backwards += 1;
        maxBack = Math.max(maxBack, -along);
      }
      if (Math.abs(s.dx) + Math.abs(s.dy) > TILE) jumps += 1;
    }
  }
  return { checked, backwards, maxBack, jumps };
}

export function summarize(values) {
  if (!values.length) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { n: values.length, min: sorted[0], median: sorted[sorted.length >> 1], max: sorted[sorted.length - 1], mean: Math.round(mean * 100) / 100 };
}

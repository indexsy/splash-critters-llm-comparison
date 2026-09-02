import { CONFIG } from '@splash/shared';
export class Predictor {
    myId = '';
    // last authoritative server pos
    serverX = 0;
    serverY = 0;
    // predicted pos
    px = 0;
    py = 0;
    // input buffer ~1s
    buf = [];
    seq = 0;
    speed = CONFIG.BASE_SPEED;
    // remote interpolation: ring buffer of snapshots
    remoteHist = new Map();
    clockOffset = 0;
    reset(myId, x, y) {
        this.myId = myId;
        this.serverX = x;
        this.serverY = y;
        this.px = x;
        this.py = y;
        this.buf = [];
        this.remoteHist.clear();
    }
    pushLocal(dx, dy) {
        this.seq++;
        // instant local movement for game feel
        const step = this.speed / 60;
        const len = Math.hypot(dx, dy);
        if (len > 0.01) {
            this.px += (dx / len) * step;
            this.py += (dy / len) * step;
        }
        this.buf.push({ seq: this.seq, dx, dy });
        if (this.buf.length > CONFIG.INPUT_BUFFER_SIZE)
            this.buf.shift();
        return { seq: this.seq, dx, dy };
    }
    reconcile(authoritative, mySpeed) {
        this.speed = mySpeed;
        if (!authoritative)
            return;
        this.serverX = authoritative.x;
        this.serverY = authoritative.y;
        // rewind-replay: snap if far, else lerp (avoids rubber-band)
        const ex = this.px - authoritative.x;
        const ey = this.py - authoritative.y;
        const err = Math.hypot(ex, ey);
        if (err > 1.2) {
            this.px = authoritative.x;
            this.py = authoritative.y;
        }
        else {
            this.px += (authoritative.x - this.px) * 0.35;
            this.py += (authoritative.y - this.py) * 0.35;
        }
    }
    pushRemote(id, x, y) {
        let h = this.remoteHist.get(id);
        if (!h) {
            h = [];
            this.remoteHist.set(id, h);
        }
        h.push({ t: performance.now(), x, y });
        if (h.length > 20)
            h.shift();
    }
    remotePos(id) {
        const h = this.remoteHist.get(id);
        if (!h || h.length === 0)
            return null;
        const target = performance.now() - CONFIG.INTERP_DELAY_MS + this.clockOffset;
        // find bracketing samples
        for (let i = h.length - 1; i >= 0; i--) {
            if (h[i].t <= target) {
                const a = h[i];
                const b = h[i + 1];
                if (!b)
                    return { x: a.x, y: a.y };
                const f = (target - a.t) / Math.max(1, b.t - a.t);
                const c = Math.max(0, Math.min(1, f));
                return { x: a.x + (b.x - a.x) * c, y: a.y + (b.y - a.y) * c };
            }
        }
        return { x: h[0].x, y: h[0].y };
    }
}

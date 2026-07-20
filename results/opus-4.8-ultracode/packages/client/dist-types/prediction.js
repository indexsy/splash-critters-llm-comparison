/**
 * WorldView — client-side prediction for the local player (replay-reconciled,
 * no drag) + snapshot interpolation for everything else. Rebuilds the round's
 * grid from the seed so predicted movement uses the exact sim collision rules.
 */
import { CONFIG, createRoundState, Tile, idx, predictLocalPlayer, } from '@splash/shared';
const SOAK_ANIM_MS = 750;
export class WorldView {
    config;
    theme;
    localId;
    localSlot = -1;
    width = 0;
    height = 0;
    grid = [];
    roundNo = 0;
    world; // reused as the prediction state
    snapPrev = null;
    snapCur = null;
    offset = 0; // serverTimeMs - Date.now(), smoothed
    offsetInit = false;
    predictedTick = 0;
    started = false;
    inputBuf = [];
    ghosts = [];
    identities = new Map();
    soakInfo = new Map();
    constructor(config, localId, theme) {
        this.config = config;
        this.localId = localId;
        this.theme = theme;
        this.localSlot = config.players.find((p) => p.id === localId)?.slot ?? -1;
        for (const p of config.players) {
            this.identities.set(p.slot, { slot: p.slot, animal: p.animal, hat: p.hat, name: p.name, ownerSlot: p.slot });
        }
    }
    startRound(mapSeed, roundNo, theme) {
        this.theme = theme;
        this.roundNo = roundNo;
        this.world = createRoundState({
            mode: this.config.mode,
            mapSeed,
            roundNo,
            revengeEnabled: this.config.revengeEnabled,
            players: this.config.players.map((p) => ({
                id: p.id,
                slot: p.slot,
                name: p.name,
                animal: p.animal,
                hat: p.hat,
                isBot: p.isBot,
                botDifficulty: p.botDifficulty,
                roundWins: 0,
                connected: true,
            })),
        });
        this.grid = this.world.grid;
        this.width = this.world.width;
        this.height = this.world.height;
        this.snapPrev = null;
        this.snapCur = null;
        this.inputBuf = [];
        this.ghosts = [];
        this.started = false;
        this.soakInfo.clear();
    }
    localPlayer() {
        return this.world.players.find((p) => p.id === this.localId);
    }
    onSnapshot(snap) {
        const nowOff = snap.serverTimeMs - Date.now();
        if (!this.offsetInit) {
            this.offset = nowOff;
            this.offsetInit = true;
        }
        else {
            // track the minimum-ish offset (lowest latency sample) with slow decay
            this.offset = nowOff < this.offset ? nowOff : this.offset * 0.98 + nowOff * 0.02;
        }
        this.snapPrev = this.snapCur;
        this.snapCur = snap;
        // reconcile grid tide with authoritative level
        this.applyTide(snap.tideLevel);
        // sync prediction balloons and reconcile the local player
        this.world.balloons = snap.balloons.map(toBalloon);
        const lp = this.localPlayer();
        const auth = snap.players.find((p) => p.slot === this.localSlot);
        if (lp && auth) {
            lp.x = auth.x;
            lp.y = auth.y;
            lp.facing = auth.facing;
            lp.alive = auth.alive;
            lp.speed = auth.speed;
            lp.maxBalloons = auth.maxBalloons;
            lp.range = auth.range;
            lp.hasKick = auth.hasKick;
            lp.activeBalloons = auth.activeBalloons;
            if (!this.started) {
                this.predictedTick = snap.tick + 3;
                this.started = true;
            }
            // replay unacked inputs (movement only) to remove reconciliation drag
            this.inputBuf = this.inputBuf.filter((b) => b.tick > snap.tick);
            for (const b of this.inputBuf) {
                predictLocalPlayer(this.world, this.localId, { ...b.input, balloon: false });
            }
        }
        // prune ghosts that now exist authoritatively (or timed out)
        this.ghosts = this.ghosts.filter((g) => !snap.balloons.some((b) => Math.round(b.x) === g.x && Math.round(b.y) === g.y) && snap.tick < g.expiry);
    }
    applyTide(level) {
        if (level <= 0)
            return;
        const w = this.width;
        const h = this.height;
        const ring = (x, y) => Math.min(x, y, w - 1 - x, h - 1 - y);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const r = ring(x, y);
                if (r >= 1 && r <= level) {
                    const i = idx(x, y, w);
                    if (this.grid[i] !== Tile.Boulder)
                        this.grid[i] = Tile.Flooded;
                }
            }
        }
    }
    /** Apply grid-changing events (castle washes). Called from the game screen. */
    applyEvents(events) {
        for (const e of events) {
            if (e.t === 'castle_washed' && e.x !== undefined && e.y !== undefined) {
                this.grid[idx(e.x, e.y, this.width)] = Tile.Empty;
            }
            else if (e.t === 'tide_advance' && e.level !== undefined) {
                this.applyTide(e.level);
            }
        }
    }
    /** One fixed 30Hz prediction step for the local player. */
    fixedStep(input) {
        if (!this.world)
            return;
        this.predictedTick++;
        const stamped = { ...input, tick: this.predictedTick };
        this.inputBuf.push({ tick: this.predictedTick, input: stamped });
        if (this.inputBuf.length > CONFIG.INPUT_BUFFER_TICKS * 2)
            this.inputBuf.shift();
        const lp = this.localPlayer();
        if (!lp || !lp.alive)
            return;
        const placed = predictLocalPlayer(this.world, this.localId, stamped);
        if (placed) {
            this.ghosts.push({
                x: Math.round(lp.x),
                y: Math.round(lp.y),
                ownerSlot: this.localSlot,
                placedTick: this.predictedTick,
                expiry: this.predictedTick + CONFIG.FUSE_TICKS + 5,
            });
        }
    }
    localTile() {
        const lp = this.localPlayer();
        if (!lp)
            return null;
        return { x: Math.round(lp.x), y: Math.round(lp.y) };
    }
    localAlive() {
        return this.localPlayer()?.alive ?? false;
    }
    renderView(nowMs) {
        if (!this.snapCur)
            return null;
        const cur = this.snapCur;
        const prev = this.snapPrev ?? cur;
        const renderT = nowMs + this.offset - CONFIG.INTERP_DELAY_MS;
        const span = cur.serverTimeMs - prev.serverTimeMs;
        const alpha = span > 0 ? Math.max(0, Math.min(1, (renderT - prev.serverTimeMs) / span)) : 1;
        const serverTick = cur.tick;
        const players = [];
        for (const id of this.identities.values()) {
            const c = cur.players.find((p) => p.slot === id.slot);
            if (!c)
                continue;
            const p0 = prev.players.find((p) => p.slot === id.slot);
            let x = c.x;
            let y = c.y;
            let facing = c.facing;
            let moving = c.moving;
            const isLocal = id.slot === this.localSlot;
            if (isLocal && this.localAlive()) {
                const lp = this.localPlayer();
                x = lp.x;
                y = lp.y;
                facing = lp.facing;
                moving = lp.moving;
            }
            else if (p0) {
                x = p0.x + (c.x - p0.x) * alpha;
                y = p0.y + (c.y - p0.y) * alpha;
            }
            // soak transition tracking
            const prevInfo = this.soakInfo.get(id.slot);
            if (!prevInfo)
                this.soakInfo.set(id.slot, { alive: c.alive, ms: nowMs });
            else if (prevInfo.alive && !c.alive)
                this.soakInfo.set(id.slot, { alive: false, ms: nowMs });
            else if (!prevInfo.alive && c.alive)
                this.soakInfo.set(id.slot, { alive: true, ms: nowMs });
            const info = this.soakInfo.get(id.slot);
            const soakElapsed = c.alive ? 0 : nowMs - info.ms;
            const soaked = !c.alive && soakElapsed < SOAK_ANIM_MS && !c.revenge;
            players.push({
                slot: id.slot,
                animal: id.animal,
                hat: id.hat,
                name: id.name,
                x,
                y,
                facing,
                moving,
                alive: c.alive,
                revenge: c.revenge,
                soaked,
                soakElapsed,
                emoteId: c.emoteId,
                emoteUntilTick: c.emoteUntilTick,
                isLocal,
                connected: c.connected,
            });
        }
        const balloons = cur.balloons.map((b) => {
            const p0 = prev.balloons.find((x) => x.id === b.id);
            const x = p0 ? p0.x + (b.x - p0.x) * alpha : b.x;
            const y = p0 ? p0.y + (b.y - p0.y) * alpha : b.y;
            const owner = cur.players.find((p) => p.id === b.owner);
            const fuseFrac = Math.max(0, Math.min(1, (b.fuseTick - serverTick) / CONFIG.FUSE_TICKS));
            return { x, y, ownerSlot: owner?.slot ?? -1, fuseFrac };
        });
        for (const g of this.ghosts) {
            if (balloons.some((b) => Math.round(b.x) === g.x && Math.round(b.y) === g.y))
                continue;
            const fuseFrac = Math.max(0, Math.min(1, (g.placedTick + CONFIG.FUSE_TICKS - this.predictedTick) / CONFIG.FUSE_TICKS));
            balloons.push({ x: g.x, y: g.y, ownerSlot: g.ownerSlot, fuseFrac, ghost: true });
        }
        return {
            serverTick,
            players,
            balloons,
            splashes: cur.splashes,
            powerups: cur.powerups,
            lobs: cur.revengeLobs,
            tideLevel: cur.tideLevel,
        };
    }
}
function toBalloon(b) {
    return {
        id: b.id,
        owner: b.owner,
        x: b.x,
        y: b.y,
        fuseTick: b.fuseTick,
        range: b.range,
        sliding: b.sliding,
        slideFrom: null,
        passableOwners: [],
    };
}
//# sourceMappingURL=prediction.js.map
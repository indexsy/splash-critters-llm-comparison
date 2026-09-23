// Turns server events into juice: splash visuals, droplets, crumbs and sparkles, screen shake,
// hit-stop, announcer calls, kill-feed lines and sound effects. Runs after MatchState has
// applied the event to the worlds, so tiles and items are already up to date.
import {
  CONFIG,
  PowerUp,
  maxTideLevel,
  type EmoteId,
  type GameEvent,
  type MatchConfig,
  type PowerUpKind,
} from '@splash/shared';
import { audio, type SfxName } from '../audio';
import { panForTile, subToPx, tilePx } from '../render/camera';
import type { GameRenderer } from '../render/gameRenderer';
import { pushCapped } from '../render/fx';
import { PAL, THEME_PALETTES, splashPalette } from '../render/palette';
import { chainLabel, displayName, killFeedLine } from './labels';
import { tileCenterXY, type MatchState } from './matchState';

const EMOTE_SFX: Record<EmoteId, SfxName> = { 0: 'emote_quack', 1: 'emote_ribbit', 2: 'emote_squeak', 3: 'emote_honk' };

const PICKUP_TEXT: Record<Exclude<PowerUpKind, 0>, { text: string; color: string }> = {
  [PowerUp.Balloon]: { text: '+BALLOON', color: PAL.pinkLight },
  [PowerUp.Range]: { text: '+SPLASH', color: PAL.skyLight },
  [PowerUp.Speed]: { text: '+SPEED', color: PAL.lime },
  [PowerUp.Boots]: { text: 'KICK BOOTS!', color: PAL.yellow },
};

const SPARKLE = [PAL.white, PAL.yellowLight, PAL.yellow] as const;
const HIT_STOP_MS = CONFIG.HIT_STOP_TICKS * CONFIG.TICK_MS;

export class EventPresenter {
  constructor(
    private readonly state: MatchState,
    private readonly view: GameRenderer,
    private readonly colorblind: () => boolean,
  ) {}

  private get config(): MatchConfig | null {
    return this.state.config;
  }

  private nameOf = (slot: number): string => displayName(this.config?.players.find((p) => p.slot === slot));

  private pan(tx: number): number {
    return panForTile(tx, this.state.predicted?.w ?? 1);
  }

  /**
   * `at`: where a remote soak's critter was drawn when soaked (sub-units), for soaks held until
   * the remote render clock reached them; the local critter's soak is where it is drawn now.
   */
  present(ev: GameEvent, nowMs: number, at: { x: number; y: number } | null = null): void {
    switch (ev.type) {
      case 'balloon_placed':
        if (ev.owner !== this.state.mySlot) audio.sfx('drop', { pan: this.pan(ev.x) });
        break;
      case 'balloon_burst':
        this.burst(ev, nowMs);
        break;
      case 'chain_burst':
        this.view.announcer.say(chainLabel(ev.count), 'chain', nowMs);
        audio.sfx('chain', { level: ev.count, pan: this.pan(ev.x) });
        this.view.fx.shake.kick(CONFIG.SHAKE_CHAIN_PX + Math.min(2, ev.count - 2), nowMs);
        break;
      case 'castle_washed':
        this.castleWashed(ev.x, ev.y, nowMs);
        break;
      case 'powerup_revealed':
        pushCapped(this.view.fx.pops, { tx: ev.x, ty: ev.y, startMs: nowMs });
        this.view.fx.particles.sparkles(tilePx(ev.x), tilePx(ev.y), SPARKLE, 5);
        audio.sfx('reveal', { pan: this.pan(ev.x) });
        break;
      case 'powerup_collected':
        this.collected(ev.x, ev.y, ev.kind, ev.slot, nowMs);
        break;
      case 'powerup_destroyed':
        this.view.fx.particles.sparkles(tilePx(ev.x), tilePx(ev.y), [PAL.greyLight, PAL.cloud], 4);
        break;
      case 'player_soaked':
        this.soaked(ev, nowMs, at);
        break;
      case 'balloon_kicked':
        // Our own predicted kicks already sounded on the tick they happened.
        if (!this.state.isHeardKick(ev.id, ev.slot)) audio.sfx('kick');
        break;
      case 'balloon_fizzled':
        pushCapped(this.view.fx.rings, { x: tilePx(ev.x), y: tilePx(ev.y), maxR: 7, color: PAL.foam, startMs: nowMs, durationMs: 300 });
        break;
      case 'tide_advance':
        this.tide(ev.level, nowMs);
        break;
      case 'revenge_lob':
        pushCapped(this.view.fx.lobs, { id: ev.id, slot: ev.slot, fromX: ev.fromX, fromY: ev.fromY, toX: ev.toX, toY: ev.toY, startMs: nowMs });
        audio.sfx('revenge_lob', { pan: this.pan(ev.fromX) });
        break;
      case 'round_over':
        this.roundOver(ev.winner, ev.draw, nowMs);
        break;
      case 'balloon_stopped':
        break;
    }
  }

  private burst(ev: Extract<GameEvent, { type: 'balloon_burst' }>, nowMs: number): void {
    const fx = this.view.fx;
    pushCapped(fx.splashes, { cx: ev.x, cy: ev.y, arms: ev.arms, owner: ev.owner, fromDuck: ev.fromDuck, startMs: nowMs });
    const drops = splashPalette(this.colorblind()).droplets;
    const cx = tilePx(ev.x);
    const cy = tilePx(ev.y);
    fx.particles.droplets(cx, cy, 14, drops, 46);
    const dirs: readonly [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    dirs.forEach(([dx, dy], i) => {
      const len = ev.arms[i];
      if (len > 0) fx.particles.spray(cx + dx * len * 16, cy + dy * len * 16, dx, dy, 5, drops);
    });
    fx.shake.kick(CONFIG.SHAKE_BURST_PX, nowMs);
    audio.sfx('burst', { level: Math.max(...ev.arms), pan: this.pan(ev.x) });
  }

  private castleWashed(x: number, y: number, nowMs: number): void {
    const world = this.state.predicted;
    if (world) this.view.washTile(world, x, y);
    pushCapped(this.view.fx.crumbles, { tx: x, ty: y, startMs: nowMs });
    const t = THEME_PALETTES[this.view.currentTheme];
    this.view.fx.particles.crumbs(tilePx(x), tilePx(y), [t.castleLight, t.castleMid, t.castleDark]);
  }

  private collected(x: number, y: number, kind: PowerUpKind, slot: number, nowMs: number): void {
    this.view.fx.particles.sparkles(tilePx(x), tilePx(y), SPARKLE, 8);
    if (slot !== this.state.mySlot || kind === PowerUp.None) return;
    const label = PICKUP_TEXT[kind];
    pushCapped(this.view.fx.floaters, { text: label.text, color: label.color, x: tilePx(x), y: tilePx(y), startMs: nowMs });
    audio.sfx('pickup');
  }

  private soaked(ev: Extract<GameEvent, { type: 'player_soaked' }>, nowMs: number, anchor: { x: number; y: number } | null): void {
    const fx = this.view.fx;
    const at = anchor ?? this.state.drawnPosition(ev.slot) ?? tileCenterXY(ev.x, ev.y);
    fx.soaks.set(ev.slot, { x: at.x, y: at.y, startMs: nowMs });
    fx.emotes.delete(ev.slot);
    fx.hitStop(HIT_STOP_MS);
    const info = this.config?.players.find((p) => p.slot === ev.slot);
    const cat = info?.animal === 'cat';
    fx.particles.droplets(subToPx(at.x), subToPx(at.y), cat ? 26 : 16, splashPalette(this.colorblind()).droplets, cat ? 60 : 44);
    fx.shake.kick(CONFIG.SHAKE_BURST_PX + (cat ? 2 : 1), nowMs);
    audio.sfx(cat ? 'soak_cat' : 'soak', { pan: this.pan(ev.x) });
    this.view.killFeed.push(killFeedLine(ev, this.nameOf, this.state.mySlot), nowMs);
    if (ev.slot === this.state.mySlot) this.view.announcer.say('SOAKED!', 'lose', nowMs);
  }

  private tide(level: number, nowMs: number): void {
    const world = this.state.predicted;
    const fx = this.view.fx;
    fx.flood = { level, startMs: nowMs };
    if (world) {
      const x0 = level;
      const y0 = level;
      const x1 = world.w - 1 - level;
      const y1 = world.h - 1 - level;
      const midX = Math.floor(world.w / 2);
      const midY = Math.floor(world.h / 2);
      for (const [tx, ty] of [[midX, y0], [midX, y1], [x0, midY], [x1, midY], [x0, y0], [x1, y1], [x0, y1], [x1, y0]]) {
        pushCapped(fx.rings, { x: tilePx(tx), y: tilePx(ty), maxR: 12, color: PAL.foam, startMs: nowMs + Math.random() * 150, durationMs: 520 });
      }
    }
    fx.shake.kick(1, nowMs);
    if (level === 1) {
      audio.sfx('tide_alarm');
      this.view.announcer.say('RISING TIDE!', 'tide', nowMs, { ms: 1800 });
    } else {
      audio.sfx('tide_step');
      if (world && level === maxTideLevel(world.w, world.h)) this.view.announcer.say('FULL FLOOD!', 'tide', nowMs);
    }
  }

  private roundOver(winner: number, draw: boolean, nowMs: number): void {
    const me = this.state.mySlot;
    if (draw || winner < 0) {
      this.view.announcer.say('DRAW!', 'info', nowMs, { bold: true, ms: 1500 });
      audio.sfx('draw');
    } else if (winner === me) {
      this.view.announcer.say('YOU WIN!', 'win', nowMs, { bold: true, ms: 1500 });
      audio.sfx('round_win');
    } else {
      this.view.announcer.say(`${this.nameOf(winner).toUpperCase()} WINS!`, 'info', nowMs, { ms: 1500 });
      audio.sfx('round_lose');
    }
  }

  /** match_end without a decided final round (a forfeit): say so while the results load. */
  matchEnded(nowMs: number): void {
    this.view.announcer.say('MATCH OVER!', 'info', nowMs, { bold: true, ms: 2400 });
  }

  /** An emote from any player (the local one included): bubble + animal sound. */
  emote(slot: number, id: EmoteId, nowMs: number): void {
    this.view.fx.emotes.set(slot, { id, startMs: nowMs });
    audio.sfx(EMOTE_SFX[id]);
  }
}

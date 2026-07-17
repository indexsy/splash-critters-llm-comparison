import {
  CONFIG,
  Dir,
  GameEvent,
  MatchConfigDto,
  ThemeId,
  tierFor,
} from '@splash/shared';
import { audio } from '../audio.js';
import { net } from '../net.js';
import { PredictedGame } from '../prediction.js';
import { ParticleSystem } from '../render/particles.js';
import { Hud, ResultsData } from '../render/hud.js';
import { SPLASH_COLORS, THEMES } from '../render/sprites.js';
import { drawWorld, setPlayerMetaProvider, worldOrigin, TILE } from '../render/world.js';
import { settings } from '../settings.js';
import { fitGameCanvas, showGame, toast } from './common.js';

export interface GameScreenCallbacks {
  onMatchEnd: (data: ResultsData, rematchAllowed: boolean) => void;
}

export class GameScreen {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private prediction = new PredictedGame();
  private particles = new ParticleSystem();
  private hud: Hud | null = null;
  private config: MatchConfigDto | null = null;
  private mySlot = 0;
  private keys = new Set<string>();
  private simTimer: number | null = null;
  private rafId = 0;
  private shakeTicks = 0;
  private hitStopTicks = 0;
  private frameTick = 0;
  private ended = false;
  private balloonHeld = false;
  private countdownLast = -1;
  private callbacks: GameScreenCallbacks;
  private detachFns: (() => void)[] = [];
  private keyDownHandler: (e: KeyboardEvent) => void;
  private keyUpHandler: (e: KeyboardEvent) => void;

  constructor(callbacks: GameScreenCallbacks) {
    this.callbacks = callbacks;
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;

    this.keyDownHandler = (e) => this.onKey(e, true);
    this.keyUpHandler = (e) => this.onKey(e, false);
  }

  attachNet(): void {
    const onSnapshot = (msg: Extract<import('@splash/shared').ServerMessage, { t: 'snapshot' }>) => {
      this.prediction.applySnapshot(msg.s);
    };
    const onRoundStart = (msg: Extract<import('@splash/shared').ServerMessage, { t: 'round_start' }>) => {
      if (!this.config) return;
      if (msg.castleGrid.length > 0) {
        this.prediction.initRound(
          this.mySlot,
          this.config.mode,
          this.config.players.length,
          msg.mapSeed,
          msg.castleGrid,
          this.config.roundsToWin,
          this.config.enableRevengeDucks,
        );
      } else if (this.prediction.state) {
        this.prediction.state.roundNo = msg.roundNo;
      }
      this.hud?.setBanner(`ROUND ${msg.roundNo}`);
      this.hud?.announce(`ROUND ${msg.roundNo}`, '', 1200);
      this.countdownLast = -1;
    };
    const onEvent = (msg: Extract<import('@splash/shared').ServerMessage, { t: 'event' }>) => {
      for (const e of msg.events) this.handleEvent(e as GameEvent);
    };
    const onRoundEnd = (msg: Extract<import('@splash/shared').ServerMessage, { t: 'round_end' }>) => {
      if (msg.draw) {
        this.hud?.announce('DRAW!', '', 2000);
        audio.roundLose();
      } else {
        const name = this.config?.players.find((p) => p.slot === msg.winnerSlot)?.nickname ?? '';
        this.hud?.announce(`${name} WINS THE ROUND!`, '', 2000);
        if (msg.winnerSlot === this.mySlot) audio.fanfare();
        else audio.roundLose();
      }
    };
    const onMatchEnd = (msg: Extract<import('@splash/shared').ServerMessage, { t: 'match_end' }>) => {
      this.ended = true;
      audio.fanfare();
      audio.playMusic('menu');
      setTimeout(() => {
        this.callbacks.onMatchEnd(
          { placements: msg.placements, xp: msg.xp, ratingDeltas: msg.ratingDeltas, myPlayerId: net.playerId, ranked: this.config?.ranked ?? false },
          msg.rematch,
        );
      }, 1800);
    };

    this.detachFns.push(
      net.on('snapshot', onSnapshot),
      net.on('round_start', onRoundStart),
      net.on('event', onEvent),
      net.on('round_end', onRoundEnd),
      net.on('match_end', onMatchEnd),
    );
  }

  start(): void {
    showGame();
    fitGameCanvas();
    this.hud = new Hud();
    this.ended = false;
    window.addEventListener('keydown', this.keyDownHandler);
    window.addEventListener('keyup', this.keyUpHandler);
    this.attachNet();

    const stored = sessionStorage.getItem('splash-match-config');
    if (stored) {
      this.config = JSON.parse(stored) as MatchConfigDto;
      this.applyConfig(this.config);
    }

    this.simTimer = window.setInterval(() => this.simStep(), 1000 / CONFIG.TICK_RATE);
    const loop = () => {
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  applyConfig(config: MatchConfigDto): void {
    this.config = config;
    const me = config.players.find((p) => p.playerId === net.playerId);
    this.mySlot = me?.slot ?? 0;
    const meta = new Map<number, { animal: typeof config.players[0]['animal']; hat: typeof config.players[0]['hat'] }>();
    for (const p of config.players) meta.set(p.slot, { animal: p.animal, hat: p.hat });
    setPlayerMetaProvider((slot) => meta.get(slot) ?? { animal: 'frog', hat: 'none' });
    if (config.ranked) {
      const opp = config.players.find((p) => p.slot !== this.mySlot);
      if (config.mode === 'duel' && opp) {
        this.hud?.announce(
          `${me?.nickname ?? 'YOU'}  VS  ${opp.nickname}`,
          `${tierFor(me?.rating ?? 1000)} ${me?.rating ?? ''} — ${tierFor(opp.rating ?? 1000)} ${opp.rating ?? ''}`,
          2600,
        );
      } else {
        this.hud?.announce('FREE-FOR-ALL!', config.players.map((p) => p.nickname).join(' vs '), 2600);
      }
    }
    audio.playMusic('game');
  }

  stop(): void {
    window.removeEventListener('keydown', this.keyDownHandler);
    window.removeEventListener('keyup', this.keyUpHandler);
    if (this.simTimer !== null) clearInterval(this.simTimer);
    this.simTimer = null;
    cancelAnimationFrame(this.rafId);
    this.detachFns.forEach((f) => f());
    this.detachFns = [];
    this.hud?.destroy();
    this.hud = null;
    this.keys.clear();
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.repeat) return;
    const k = e.key;
    if (down) this.keys.add(k);
    else this.keys.delete(k);
    if (down && (k === 'm' || k === 'M')) {
      settings.muted = !settings.muted;
      audio.applyVolumes();
      toast(settings.muted ? 'Muted' : 'Unmuted', 800);
    }
    if (down && ['1', '2', '3', '4'].includes(k)) {
      net.send({ t: 'emote', id: parseInt(k, 10) - 1 });
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
  }

  private currentDir(): Dir {
    const kb = settings.keys;
    if (this.keys.has(kb.up) || this.keys.has('w') || this.keys.has('W')) return 1;
    if (this.keys.has(kb.right) || this.keys.has('d') || this.keys.has('D')) return 2;
    if (this.keys.has(kb.down) || this.keys.has('s') || this.keys.has('S')) return 3;
    if (this.keys.has(kb.left) || this.keys.has('a') || this.keys.has('A')) return 4;
    return 0;
  }

  private simStep(): void {
    const st = this.prediction.state;
    if (!st || this.ended) return;
    const dir = this.currentDir();
    const balloonNow = this.keys.has(settings.keys.balloon) || this.keys.has('e') || this.keys.has('E');
    const balloonPressed = balloonNow && !this.balloonHeld;
    this.balloonHeld = balloonNow;
    const frame = this.prediction.nextInput(dir, balloonPressed);
    this.prediction.pushInput(frame);
    net.send({ t: 'input', seq: frame.seq, dir: frame.dir, balloon: frame.balloon });
  }

  private handleEvent(e: GameEvent): void {
    const st = this.prediction.state;
    const theme = THEMES[(this.config?.theme ?? 'backyard') as ThemeId]!;
    const splashColors = settings.colorblind ? SPLASH_COLORS.colorblind : SPLASH_COLORS.normal;
    switch (e.type) {
      case 'balloon_dropped':
        if (e.slot === this.mySlot) audio.drop();
        break;
      case 'balloon_burst': {
        if (!st) break;
        const { ox, oy } = worldOrigin(st.w, st.h);
        this.particles.burst(ox + (e.tx + 0.5) * TILE, oy + (e.ty + 0.5) * TILE, splashColors, 16, 2);
        audio.burst();
        this.shakeTicks = Math.max(this.shakeTicks, 8);
        break;
      }
      case 'chain_burst': {
        audio.chainJingle(e.depth);
        if (e.depth === 2) this.hud?.announce('DOUBLE SPLASH!', '', 900);
        else if (e.depth === 3) this.hud?.announce('TRIPLE SPLASH!', '', 1000);
        else if (e.depth >= 4) this.hud?.announce(`${e.depth}x SPLASH!!`, '', 1100);
        this.shakeTicks = Math.max(this.shakeTicks, 6 + e.depth * 2);
        break;
      }
      case 'castle_washed': {
        if (!st) break;
        const idx = e.ty * st.w + e.tx;
        st.tiles[idx] = 0;
        const { ox, oy } = worldOrigin(st.w, st.h);
        this.particles.crumble(ox + (e.tx + 0.5) * TILE, oy + (e.ty + 0.5) * TILE, [theme.castle, theme.castleHi, theme.castleDark]);
        break;
      }
      case 'powerup_revealed': {
        if (!st) break;
        if (!st.exposedPowerUps.some((p) => p.id === e.id)) {
          st.exposedPowerUps.push({ id: e.id, tx: e.tx, ty: e.ty, kind: e.kind, revealedTick: st.tick, revealGroup: -1 });
        }
        break;
      }
      case 'powerup_destroyed': {
        if (!st) break;
        st.exposedPowerUps = st.exposedPowerUps.filter((p) => p.id !== e.id);
        break;
      }
      case 'powerup_collected':
        audio.pickup();
        if (e.slot === this.mySlot) {
          const names = { balloon: '+1 BALLOON', range: 'BIG SPLASH', speed: 'FLIPPERS', boots: 'RUBBER BOOTS' } as const;
          this.hud?.announce(names[e.kind], '', 800);
        }
        break;
      case 'player_soaked': {
        audio.soak();
        this.hitStopTicks = 2;
        this.shakeTicks = Math.max(this.shakeTicks, 10);
        const victim = this.config?.players.find((p) => p.slot === e.slot);
        const killer = this.config?.players.find((p) => p.slot === e.bySlot);
        if (e.byTide) {
          this.hud?.kill(`🌊 ${victim?.nickname ?? '?'} was swept away by the tide!`);
        } else if (e.slot === e.bySlot || e.bySlot < 0) {
          this.hud?.kill(`💦 ${victim?.nickname ?? '?'} soaked themselves!`);
        } else {
          this.hud?.kill(`💦 ${killer?.nickname ?? '?'} soaked ${victim?.nickname ?? '?'}!`);
        }
        if (st) {
          const { ox, oy } = worldOrigin(st.w, st.h);
          const p = st.players[e.slot];
          if (p) this.particles.burst(ox + p.x * TILE, oy + p.y * TILE, splashColors, 22, 2.4);
        }
        if (e.slot === this.mySlot) {
          if (this.config?.enableRevengeDucks) this.hud?.announce('SOAKED!', 'Revenge duck mode — arrows to swim, SPACE to lob!', 2500);
          else this.hud?.announce('SOAKED!', '', 1800);
        }
        break;
      }
      case 'tide_advance':
        audio.tideAlarm();
        this.hud?.announce('THE TIDE IS RISING!', '', 1500);
        break;
      case 'balloon_kicked':
        audio.drop();
        break;
      case 'revenge_lob':
        audio.drop();
        break;
      case 'emote':
        audio.emote(e.emoteId);
        break;
      default:
        break;
    }
  }

  private render(): void {
    this.frameTick++;
    const st = this.prediction.state;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 256, 224);
    if (!st || !this.config) {
      ctx.fillStyle = '#1a1c2c';
      ctx.fillRect(0, 0, 256, 224);
      ctx.fillStyle = '#73eff7';
      ctx.font = '8px monospace';
      ctx.fillText('CONNECTING...', 100, 112);
      return;
    }

    if (this.hitStopTicks > 0) {
      this.hitStopTicks--;
    } else {
      this.particles.update();
    }
    if (this.shakeTicks > 0) this.shakeTicks--;

    const playersAlive = st.players.filter((p) => p.alive && !p.isDuck).length;
    if (playersAlive === 2 && this.config.players.length > 2) {
      audio.playMusic('showdown');
    }

    drawWorld(
      ctx,
      st,
      {
        theme: this.config.theme,
        colorblind: settings.colorblind,
        reducedShake: settings.reducedShake,
        shakeTicks: this.shakeTicks,
        hitStopTicks: this.hitStopTicks,
        interp: (slot) => (slot === this.mySlot ? null : this.prediction.remoteInterp(slot)),
        estTick: () => this.prediction.estimatedServerTick(),
        frameTick: this.frameTick,
      },
      this.particles,
    );

    if (st.phase === 'countdown') {
      const left = st.countdownUntilTick - this.prediction.estimatedServerTick();
      const n = Math.ceil(left / CONFIG.TICK_RATE);
      ctx.fillStyle = '#f4f4f4';
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      const label = n > 0 ? String(n) : 'SPLASH!';
      ctx.fillText(label, 128, 118);
      ctx.textAlign = 'left';
      if (n !== this.countdownLast && n >= 0 && n <= 3) {
        this.countdownLast = n;
        audio.countdownBeep(n === 0);
      }
    }

    const me = st.players[this.mySlot];
    if (me?.isDuck) {
      ctx.fillStyle = '#ffcd75';
      ctx.font = '7px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('REVENGE DUCK — swim with arrows, SPACE to lob!', 128, 12);
      ctx.textAlign = 'left';
    }

    this.hud?.setCards(
      this.config.players,
      this.mySlot,
      st.players.map((p) => p.roundWins),
      st.players.map((p) => p.soaks),
      st.players.map((p) => p.alive && !p.isDuck),
      net.rtt,
    );
  }
}

export function storeMatchConfig(config: MatchConfigDto): void {
  sessionStorage.setItem('splash-match-config', JSON.stringify(config));
}

export function clearMatchConfig(): void {
  sessionStorage.removeItem('splash-match-config');
}

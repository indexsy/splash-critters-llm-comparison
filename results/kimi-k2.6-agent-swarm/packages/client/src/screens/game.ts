import type { Screen } from './types.js';
import { screenManager, audioEngine, netClient, predictor } from '../main.js';
import { PALETTE, SpriteRenderer } from '../render/sprites.js';
import { ParticleSystem } from '../render/particles.js';
import { HUD } from '../render/hud.js';
import { clientState } from './title.js';
import type { ServerMsg } from '@shared/protocol.js';
import type { InputFrame, Direction, GameConfig, SimEvent } from '@shared/types.js';
import type { RoundState } from '@shared/sim.js';
import { CONFIG } from '@shared/config.js';
import { currentInput } from '../main.js';

interface MatchData {
  config: GameConfig;
  players: { playerId: string; nickname: string; animal: string; hat: string }[];
}

let matchData: MatchData | null = null;
let localPlayerId = '';
let inputSeq = 0;
let inputAccumulator = 0;
let sprites: SpriteRenderer | null = null;
let particles: ParticleSystem | null = null;
let hud: HUD | null = null;
let showRoundEnd = false;
let roundEndTimer = 0;
let roundWinner: string | null = null;
let matchResult: { placements: string[]; stats: Record<string, unknown> } | null = null;

function getScreenOffsets(state: RoundState): { ox: number; oy: number } {
  const w = 256;
  const h = 224;
  const tileSize = 16;
  const ox = Math.floor((w - state.map.width * tileSize) / 2);
  const oy = Math.floor((h - state.map.height * tileSize) / 2);
  return { ox, oy };
}

function getPlayerColor(playerIndex: number): string {
  const colors = [PALETTE.red, PALETTE.blue, PALETTE.green, PALETTE.yellow];
  return colors[playerIndex % colors.length];
}

function handleEvent(ev: SimEvent, state: RoundState): void {
  if (!particles || !hud) return;
  const { ox, oy } = getScreenOffsets(state);
  const tileSize = 16;

  switch (ev.type) {
    case 'castle_washed':
      particles.emit('castle_crumble', ox + ev.x * tileSize + tileSize / 2, oy + ev.y * tileSize + tileSize / 2);
      audioEngine.play('burst');
      break;
    case 'powerup_revealed':
      // Subtle glow when power-up revealed
      break;
    case 'powerup_collected':
      particles.emit('powerup_glow', ox + ev.x * tileSize + tileSize / 2, oy + ev.y * tileSize + tileSize / 2);
      audioEngine.play('pickup');
      break;
    case 'powerup_destroyed':
      particles.emit('splash_droplets', ox + ev.x * tileSize + tileSize / 2, oy + ev.y * tileSize + tileSize / 2);
      break;
    case 'player_soaked': {
      const soaked = state.players.find((p) => p.playerId === ev.playerId);
      const soaker = ev.soakedBy ? state.players.find((p) => p.playerId === ev.soakedBy) : null;
      particles.emit('soak_sparkle', ox + ev.x * tileSize + tileSize / 2, oy + ev.y * tileSize + tileSize / 2);
      audioEngine.play('soak');
      if (soaker && soaked) {
        hud.addKillFeed(soaker.nickname, soaked.nickname);
      }
      break;
    }
    case 'chain_burst':
      if (ev.chainCount === 2) {
        hud.addAnnouncement('DOUBLE SPLASH!');
        audioEngine.play('chain2');
      } else if (ev.chainCount >= 3) {
        hud.addAnnouncement('TRIPLE SPLASH!+');
        audioEngine.play('chain3');
      }
      particles.triggerShake(4);
      break;
    case 'balloon_kicked':
      audioEngine.play('kick');
      break;
    case 'tide_advance':
      audioEngine.play('tide');
      break;
    case 'revenge_lob':
      audioEngine.play('drop');
      break;
  }
}

export const gameScreen: Screen & { handleMessage?(msg: ServerMsg): void } = {
  enter(data?: unknown) {
    localPlayerId = clientState.localPlayerId || (data && typeof data === 'object' && 'localPlayerId' in data ? (data as { localPlayerId: string }).localPlayerId : '');
    sprites = new SpriteRenderer();
    sprites.setTileSize(16);
    particles = new ParticleSystem();
    hud = new HUD();
    inputSeq = 0;
    inputAccumulator = 0;
    showRoundEnd = false;
    roundEndTimer = 0;
    matchResult = null;
    audioEngine.playMusic('game');
  },
  update(dt: number) {
    if (!particles || !hud) return;
    particles.update(dt);
    hud.update(dt);

    const state = predictor.getLocalState();
    if (!state) return;

    // Round timer countdown
    hud.setRoundTimer(Math.max(0, CONFIG.TIDE_START_TICKS - state.tick));

    // Showdown mode when 2 alive in FFA
    const aliveCount = state.players.filter((p) => p.alive).length;
    if (state.matchConfig.mode === 'ffa' && aliveCount === 2) {
      audioEngine.setShowdownMode(true);
    } else {
      audioEngine.setShowdownMode(false);
    }

    // Input sampling
    inputAccumulator += dt;
    const dir = currentInput.dir;
    const balloonPressed = currentInput.balloonPressed;
    const emoteId = currentInput.emoteId;

    const input: InputFrame = { dir, balloonPressed };

    // Apply local prediction every frame (60Hz)
    predictor.applyInput(input);

    // Send to server at 30Hz (every other frame, ~16.7ms)
    if (inputAccumulator >= 1 / 30) {
      inputAccumulator -= 1 / 30;
      inputSeq++;
      const msg: { type: 'input'; seq: number; tick: number; balloonPressed: boolean; dir?: Direction } = {
        type: 'input',
        seq: inputSeq,
        tick: predictor.getLocalTick(),
        balloonPressed,
      };
      if (dir) msg.dir = dir;
      netClient.send(msg);
      if (emoteId) {
        netClient.send({ type: 'emote', id: emoteId as 1 | 2 | 3 | 4 });
      }
    }

    // Round end overlay timer
    if (showRoundEnd) {
      roundEndTimer -= dt;
      if (roundEndTimer <= 0) {
        showRoundEnd = false;
        if (matchResult) {
          screenManager.switchTo('results', matchResult);
        }
      }
    }
  },
  render(ctx: CanvasRenderingContext2D) {
    if (!sprites || !particles || !hud) return;

    const state = predictor.getLocalState();
    if (!state) {
      // Waiting for round
      ctx.fillStyle = PALETTE.black;
      ctx.fillRect(0, 0, 256, 224);
      ctx.fillStyle = PALETTE.white;
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for round...', 128, 112);
      return;
    }

    const { ox, oy } = getScreenOffsets(state);

    // Screen shake
    const shake = particles.getShakeOffset();
    ctx.save();
    ctx.translate(shake.x, shake.y);

    // Background
    ctx.fillStyle = PALETTE.black;
    ctx.fillRect(0, 0, 256, 224);

    // Map
    sprites.setTheme(state.map.theme);
    sprites.setTick(state.tick);
    sprites.drawMap(ctx, state.map, ox, oy);

    // Draw power-ups
    for (const [key, type] of state.exposedPowerUps) {
      const [x, y] = key.split(',').map(Number);
      sprites.drawPowerUp(ctx, x, y, type, ox, oy);
    }

    // Draw balloons
    for (let i = 0; i < state.balloons.length; i++) {
      const b = state.balloons[i];
      const ownerIdx = state.players.findIndex((p) => p.playerId === b.ownerId);
      sprites.drawBalloon(ctx, b, ox, oy, getPlayerColor(ownerIdx));
    }

    // Draw splashes
    for (const s of state.splashes) {
      const ownerIdx = state.players.findIndex((p) => p.playerId === s.ownerId);
      sprites.drawSplash(ctx, s, ox, oy, getPlayerColor(ownerIdx));
    }

    // Draw players
    for (const p of state.players) {
      if (!p.alive && state.matchConfig.enableRevengeDucks) {
        sprites.drawRubberDuck(ctx, p, ox, oy);
      } else {
        sprites.drawPlayer(ctx, p, ox, oy, false);
      }
    }

    // Particles
    particles.draw(ctx);

    // HUD
    hud.drawHUD(ctx, state, localPlayerId, particles);

    // Emote bubbles above players
    // (In a full implementation, we'd track emotes per player)

    ctx.restore();

    // Round end overlay
    if (showRoundEnd) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, 256, 224);
      ctx.fillStyle = PALETTE.yellow;
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      if (roundWinner) {
        const winner = state.players.find((p) => p.playerId === roundWinner);
        ctx.fillText(`${winner?.nickname || 'Someone'} wins!`, 128, 90);
      } else {
        ctx.fillText('Draw!', 128, 90);
      }
      ctx.fillStyle = PALETTE.white;
      ctx.font = '8px monospace';
      ctx.fillText('Next round starting...', 128, 110);
    }
  },
  exit() {
    sprites = null;
    particles = null;
    hud = null;
    showRoundEnd = false;
    audioEngine.setShowdownMode(false);
  },
  handleMessage(msg: ServerMsg) {
    if (!hud || !particles) return;

    switch (msg.type) {
      case 'match_start': {
        matchData = {
          config: msg.config,
          players: msg.players,
        };
        break;
      }
      case 'round_start': {
        const spawnPoints = msg.spawnPoints;
        const players =
          matchData?.players.map((p) => ({
            playerId: p.playerId,
            nickname: p.nickname,
            animal: p.animal as any,
            hat: p.hat as any,
          })) || [];
        predictor.startRound(
          matchData?.config || { mode: 'duel', roundsToWin: 3, mapTheme: 'backyard', enableKick: true, enableRevengeDucks: false, botFill: false },
          msg.roundNo,
          msg.mapSeed,
          msg.castleGrid,
          msg.theme,
          spawnPoints,
          players
        );
        hud.setRoundInfo(msg.roundNo, matchData?.config.roundsToWin || 3);
        showRoundEnd = false;
        break;
      }
      case 'snapshot': {
        predictor.reconcile(msg.snapshot);
        const state = predictor.getLocalState();
        if (state) {
          for (const ev of state.events) {
            handleEvent(ev, state);
          }
        }
        break;
      }
      case 'event': {
        // Server-sent event (if not already processed via snapshot)
        const state = predictor.getLocalState();
        if (state) {
          handleEvent(msg.event, state);
        }
        break;
      }
      case 'round_end': {
        showRoundEnd = true;
        roundEndTimer = 3;
        roundWinner = msg.winner;
        break;
      }
      case 'match_end': {
        matchResult = {
          placements: msg.result.placements,
          stats: msg.result.stats,
        };
        showRoundEnd = true;
        roundEndTimer = 3;
        break;
      }
      case 'ping': {
        hud.setPing(netClient.ping);
        break;
      }
    }
  },
};

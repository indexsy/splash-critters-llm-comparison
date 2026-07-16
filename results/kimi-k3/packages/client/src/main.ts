import type {
  AnimalId,
  GameMode,
  HatId,
  PlayerJoinInfo,
  ServerMsg,
  ThemeId,
} from '@splash/shared';
import { CONFIG, tierForRating } from '@splash/shared';
import { isMuted, resumeAudio, setVolume, sfx, startMusic, stopMusic, toggleMute } from './audio.js';
import { loadBinds } from './input.js';
import { net } from './net.js';
import {
  H,
  P,
  W,
  drawAnimal,
  drawPanel,
  drawPixelRect,
  drawText,
  drawTextCenter,
} from './render/sprites.js';
import {
  type AppProfile,
  type Keys,
  type ScreenId,
  bg,
  btn,
  clearPressed,
  hit,
} from './screens/common.js';
import {
  createGameScreen,
  drawGame,
  gameOnEvents,
  gameOnMatchEnd,
  gameOnMatchStart,
  gameOnRoundStart,
  gameOnSnapshot,
  updateGame,
  type GameScreenState,
} from './screens/game.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

function resize(): void {
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H)));
  canvas.style.width = `${W * scale}px`;
  canvas.style.height = `${H * scale}px`;
}
window.addEventListener('resize', resize);
resize();

const keys: Keys = { down: new Set(), pressed: new Set() };
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!keys.down.has(e.code)) keys.pressed.add(e.code);
  keys.down.add(e.code);
  if (e.code === loadBinds().mute) toggleMute();
  resumeAudio();
});
window.addEventListener('keyup', (e) => keys.down.delete(e.code));

let mouse = { x: 0, y: 0, click: false };
canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.x = ((e.clientX - r.left) / r.width) * W;
  mouse.y = ((e.clientY - r.top) / r.height) * H;
});
canvas.addEventListener('mousedown', () => {
  mouse.click = true;
  resumeAudio();
});

// App state
let screen: ScreenId = 'title';
let profile: AppProfile | null = null;
let playerId = '';
let t = 0;
let game: GameScreenState = createGameScreen();
let lobby: {
  code: string;
  name: string;
  hostId: string;
  size: number;
  slots: {
    slot: number;
    kind: string;
    nickname?: string;
    ready: boolean;
    difficulty?: string;
    playerId?: string;
  }[];
  theme: string;
  roundsToWin: number;
  mode: string;
  isPublic: boolean;
} | null = null;
let roomList: {
  code: string;
  name: string;
  mode: string;
  players: number;
  maxPlayers: number;
  theme: string;
  host: string;
}[] = [];
let queueInfo: { mode: GameMode; eta: number; searchRange: number; elapsed: number } | null = null;
let matchResult: {
  placements: { slot: number; placement: number; soaks: number; castles: number; roundWins: number }[];
  ratingDeltas: (number | null)[];
  xp: number[];
  funStats: { mostSoaks: number; castleCrusher: number; longestSurvivor: number; biggestChain: number };
} | null = null;
let matchPlayers: PlayerJoinInfo[] = [];
let leaderboard: {
  rank: number;
  nickname: string;
  tag: string;
  rating: number;
  tier: string;
  games: number;
  winrate: number;
}[] = [];
let lbMode: GameMode = 'duel';
let createForm = {
  name: 'My Room',
  size: 4 as 2 | 4,
  isPublic: true,
  theme: 'random' as ThemeId | 'random',
  roundsToWin: 3 as 2 | 3 | 5,
  botFill: true,
};
let joinCode = '';
let nickInput = '';
let tutorialStep = 0;
let settingsVol = Number(localStorage.getItem('splash_vol') ?? '0.35');
let titlePhase = 0;

const animals: AnimalId[] = ['frog', 'duck', 'otter', 'penguin', 'cat', 'raccoon', 'turtle', 'capybara'];
const hats: HatId[] = ['none', 'bucket', 'snorkel', 'crown', 'bandana', 'propeller'];

net.on((msg: ServerMsg) => {
  switch (msg.type) {
    case 'welcome':
      playerId = msg.playerId;
      if (msg.token) localStorage.setItem('splash_token', msg.token);
      profile = msg.profile as AppProfile;
      if (screen === 'title' && titlePhase > 60) {
        // stay on title until click
      }
      break;
    case 'error':
      console.warn(msg.code, msg.msg);
      break;
    case 'queue_status':
      queueInfo = msg;
      screen = 'queue';
      break;
    case 'match_found':
      matchPlayers = msg.players;
      break;
    case 'room_created':
      break;
    case 'room_list':
      roomList = msg.rooms;
      break;
    case 'lobby_state':
      lobby = msg as typeof lobby;
      if (msg.phase === 'lobby') screen = 'lobby';
      break;
    case 'match_start':
      matchPlayers = msg.players;
      game = createGameScreen();
      gameOnMatchStart(game, msg.config, msg.players, playerId);
      screen = 'game';
      break;
    case 'round_start':
      gameOnRoundStart(game, msg.roundNo, msg.mapSeed, msg.castleGrid, msg.theme, msg.w, msg.h);
      break;
    case 'snapshot':
      gameOnSnapshot(game, msg.snap);
      break;
    case 'event':
      gameOnEvents(game, msg.events);
      break;
    case 'match_end':
      matchResult = msg;
      gameOnMatchEnd(game, msg);
      screen = 'results';
      stopMusic();
      sfx.victory();
      break;
    default:
      break;
  }
});

net.connect();

function go(s: ScreenId): void {
  screen = s;
  sfx.click();
  if (s === 'menu') startMusic('menu');
  if (s === 'title') startMusic('title');
  if (s === 'browser') net.send({ type: 'room_list_request' });
  if (s === 'leaderboard') void fetchLb();
}

async function fetchLb(): Promise<void> {
  try {
    const r = await fetch(`/api/leaderboard?mode=${lbMode}`);
    leaderboard = await r.json();
  } catch {
    leaderboard = [];
  }
}

function unlocked(item: string): boolean {
  return profile?.unlocks.includes(item) ?? false;
}

function drawTitle(): void {
  bg(ctx, t);
  titlePhase++;
  drawTextCenter(ctx, 'SPLASH', 50, P.splash, 2);
  drawTextCenter(ctx, 'CRITTERS', 70, P.gold, 2);
  drawTextCenter(ctx, '8-bit water balloon battler', 95, P.gray);
  // critters parade
  const parade = animals.slice(0, 4);
  parade.forEach((a, i) => {
    drawAnimal(ctx, 40 + i * 48, 120, a, 'none', 2, (t >> 4) + i);
  });
  if (Math.floor(t / 30) % 2 === 0) drawTextCenter(ctx, 'Click / Enter to start', 180, P.white);
  if (profile) drawTextCenter(ctx, `${profile.nickname}#${profile.tag}`, 200, P.gray);
  if (mouse.click || keys.pressed.has('Enter')) {
    const done = localStorage.getItem('splash_tutorial') === '1';
    go(done ? 'menu' : 'tutorial');
  }
}

function drawTutorial(): void {
  bg(ctx, t);
  drawPanel(ctx, 16, 20, W - 32, H - 40);
  const steps = [
    'WASD / Arrows — move your critter',
    'Space / E — drop a water balloon',
    'Balloons burst in a CROSS splash',
    'Wash sandcastles for power-ups!',
    'Chain balloons for DOUBLE SPLASH!',
    'Last critter dry wins the round',
  ];
  drawTextCenter(ctx, 'HOW TO SPLASH', 30, P.gold);
  steps.forEach((s, i) => drawText(ctx, `${i + 1}. ${s}`, 28, 50 + i * 14, i === tutorialStep ? P.white : P.gray));
  drawTextCenter(ctx, 'Enter: next · Esc: skip', 190, P.accent);
  if (keys.pressed.has('Enter') || mouse.click) {
    tutorialStep++;
    if (tutorialStep >= steps.length) {
      localStorage.setItem('splash_tutorial', '1');
      net.send({ type: 'tutorial_complete' });
      go('menu');
      tutorialStep = 0;
    }
  }
  if (keys.pressed.has('Escape')) {
    localStorage.setItem('splash_tutorial', '1');
    go('menu');
  }
}

function drawMenu(): void {
  bg(ctx, t);
  drawTextCenter(ctx, 'SPLASH CRITTERS', 12, P.splash);
  if (profile) {
    drawText(ctx, `Lv${profile.level} ${profile.nickname}#${profile.tag}`, 8, 28, P.gray);
    const duel = profile.ratings.find((r) => r.mode === 'duel');
    if (duel) drawText(ctx, `${tierForRating(duel.rating)} ${duel.rating}`, 160, 28, P.gold);
  }
  const items: { label: string; action: () => void }[] = [
    { label: 'Ranked Duel (1v1)', action: () => { net.send({ type: 'queue_join', mode: 'duel' }); go('queue'); } },
    { label: 'Ranked Free-for-All', action: () => { net.send({ type: 'queue_join', mode: 'ffa' }); go('queue'); } },
    { label: 'Browse Casual Rooms', action: () => go('browser') },
    { label: 'Create Room', action: () => go('create') },
    { label: 'Join by Code', action: () => { joinCode = ''; go('joincode'); } },
    { label: 'Practice vs Bots', action: () => net.send({ type: 'practice', difficulty: 'medium', mode: 'ffa' }) },
    { label: 'Leaderboard', action: () => go('leaderboard') },
    { label: 'Locker', action: () => go('locker') },
    { label: 'How to Play', action: () => go('howto') },
    { label: 'Settings', action: () => go('settings') },
  ];
  items.forEach((it, i) => {
    const y = 42 + i * 16;
    const hov = hit(mouse.x, mouse.y, 40, y, 176, 14);
    btn(ctx, it.label, 40, y, 176, 14, hov);
    if (hov && mouse.click) it.action();
  });
}

function drawBrowser(): void {
  bg(ctx, t);
  drawTextCenter(ctx, 'ROOM BROWSER', 8, P.gold);
  btn(ctx, 'Refresh', 8, 8, 50, 12, hit(mouse.x, mouse.y, 8, 8, 50, 12));
  if (hit(mouse.x, mouse.y, 8, 8, 50, 12) && mouse.click) net.send({ type: 'room_list_request' });
  btn(ctx, 'Back', W - 48, 8, 40, 12, hit(mouse.x, mouse.y, W - 48, 8, 40, 12));
  if (hit(mouse.x, mouse.y, W - 48, 8, 40, 12) && mouse.click) go('menu');

  if (roomList.length === 0) {
    drawTextCenter(ctx, 'No public rooms — create one!', 100, P.gray);
  }
  roomList.forEach((r, i) => {
    const y = 28 + i * 22;
    if (y > 200) return;
    drawPanel(ctx, 8, y, W - 16, 20);
    drawText(ctx, r.name.slice(0, 14), 12, y + 3, P.white);
    drawText(ctx, `${r.mode} ${r.players}/${r.maxPlayers}`, 120, y + 3, P.gray);
    drawText(ctx, r.host.slice(0, 8), 12, y + 11, P.accent);
    const jx = W - 52;
    btn(ctx, 'Join', jx, y + 4, 36, 12, hit(mouse.x, mouse.y, jx, y + 4, 36, 12));
    if (hit(mouse.x, mouse.y, jx, y + 4, 36, 12) && mouse.click) {
      net.send({ type: 'join_room', code: r.code });
    }
  });
}

function drawCreate(): void {
  bg(ctx, t);
  drawTextCenter(ctx, 'CREATE ROOM', 8, P.gold);
  const rows: { label: string; val: string; cycle: () => void }[] = [
    {
      label: 'Size',
      val: createForm.size === 2 ? '2 players' : '4 players',
      cycle: () => {
        createForm.size = createForm.size === 2 ? 4 : 2;
      },
    },
    {
      label: 'Visibility',
      val: createForm.isPublic ? 'Public' : 'Private',
      cycle: () => {
        createForm.isPublic = !createForm.isPublic;
      },
    },
    {
      label: 'Theme',
      val: createForm.theme,
      cycle: () => {
        const th = ['random', 'backyard', 'beach', 'pool'] as const;
        createForm.theme = th[(th.indexOf(createForm.theme as typeof th[number]) + 1) % th.length]!;
      },
    },
    {
      label: 'Rounds',
      val: String(createForm.roundsToWin),
      cycle: () => {
        const r = [2, 3, 5] as const;
        createForm.roundsToWin = r[(r.indexOf(createForm.roundsToWin) + 1) % r.length]!;
      },
    },
    {
      label: 'Bot fill',
      val: createForm.botFill ? 'ON' : 'OFF',
      cycle: () => {
        createForm.botFill = !createForm.botFill;
      },
    },
  ];
  rows.forEach((row, i) => {
    const y = 30 + i * 22;
    drawText(ctx, row.label, 24, y + 4, P.gray);
    btn(ctx, row.val, 100, y, 120, 16, hit(mouse.x, mouse.y, 100, y, 120, 16));
    if (hit(mouse.x, mouse.y, 100, y, 120, 16) && mouse.click) row.cycle();
  });
  btn(ctx, 'CREATE', 70, 160, 50, 16, hit(mouse.x, mouse.y, 70, 160, 50, 16));
  btn(ctx, 'BACK', 136, 160, 50, 16, hit(mouse.x, mouse.y, 136, 160, 50, 16));
  if (hit(mouse.x, mouse.y, 70, 160, 50, 16) && mouse.click) {
    net.send({
      type: 'create_room',
      name: createForm.name,
      size: createForm.size,
      isPublic: createForm.isPublic,
      theme: createForm.theme,
      roundsToWin: createForm.roundsToWin,
      botFill: createForm.botFill,
    });
  }
  if (hit(mouse.x, mouse.y, 136, 160, 50, 16) && mouse.click) go('menu');
}

function drawLobby(): void {
  bg(ctx, t);
  if (!lobby) {
    drawTextCenter(ctx, 'No lobby', 100, P.gray);
    return;
  }
  drawTextCenter(ctx, lobby.name, 6, P.gold);
  drawTextCenter(ctx, `Code: ${lobby.code}`, 18, P.splash);
  drawText(ctx, `${lobby.mode} · first to ${lobby.roundsToWin}`, 8, 32, P.gray);

  lobby.slots.forEach((s, i) => {
    const y = 48 + i * 28;
    drawPanel(ctx, 16, y, W - 32, 24);
    if (s.kind === 'human') {
      drawText(ctx, `${s.nickname ?? '?'} ${s.ready ? '✓' : '…'}`, 24, y + 8, P.white);
    } else if (s.kind === 'bot') {
      drawText(ctx, `Bot (${s.difficulty})`, 24, y + 8, P.accent);
    } else {
      drawText(ctx, 'Empty', 24, y + 8, P.gray);
      if (lobby!.hostId === playerId) {
        btn(ctx, '+Bot', W - 70, y + 5, 40, 14, hit(mouse.x, mouse.y, W - 70, y + 5, 40, 14));
        if (hit(mouse.x, mouse.y, W - 70, y + 5, 40, 14) && mouse.click) {
          net.send({ type: 'set_slot', slot: i, kind: 'bot', difficulty: 'medium' });
        }
      }
    }
  });

  const isHost = lobby.hostId === playerId;
  if (isHost) {
    btn(ctx, 'START', 40, 190, 60, 16, hit(mouse.x, mouse.y, 40, 190, 60, 16));
    if (hit(mouse.x, mouse.y, 40, 190, 60, 16) && mouse.click) net.send({ type: 'start_match' });
  } else {
    btn(ctx, 'READY', 40, 190, 60, 16, hit(mouse.x, mouse.y, 40, 190, 60, 16));
    if (hit(mouse.x, mouse.y, 40, 190, 60, 16) && mouse.click) net.send({ type: 'set_ready', ready: true });
  }
  btn(ctx, 'LEAVE', 150, 190, 60, 16, hit(mouse.x, mouse.y, 150, 190, 60, 16));
  if (hit(mouse.x, mouse.y, 150, 190, 60, 16) && mouse.click) {
    net.send({ type: 'leave_room' });
    go('menu');
  }
}

function drawQueue(): void {
  bg(ctx, t);
  drawTextCenter(ctx, 'SEARCHING…', 60, P.gold);
  if (queueInfo) {
    drawTextCenter(ctx, queueInfo.mode.toUpperCase(), 80, P.white);
    drawTextCenter(ctx, `${queueInfo.elapsed}s · ±${queueInfo.searchRange} Elo`, 100, P.gray);
    drawTextCenter(ctx, `ETA ~${queueInfo.eta}s`, 120, P.accent);
  }
  btn(ctx, 'CANCEL', 98, 160, 60, 16, hit(mouse.x, mouse.y, 98, 160, 60, 16));
  if (hit(mouse.x, mouse.y, 98, 160, 60, 16) && mouse.click) {
    net.send({ type: 'queue_leave' });
    go('menu');
  }
}

function drawResults(): void {
  bg(ctx, t);
  drawTextCenter(ctx, 'MATCH RESULTS', 8, P.gold);
  if (!matchResult) {
    drawTextCenter(ctx, '…', 100, P.gray);
    return;
  }
  const sorted = [...matchResult.placements].sort((a, b) => a.placement - b.placement);
  sorted.forEach((p, i) => {
    const info = matchPlayers[p.slot];
    const y = 28 + i * 22;
    drawText(ctx, `#${p.placement + 1} ${info?.nickname ?? '?'}`, 16, y, P.white);
    drawText(ctx, `${p.roundWins}W ${p.soaks} soaks`, 140, y, P.gray);
    const d = matchResult!.ratingDeltas[p.slot];
    if (d != null) drawText(ctx, d >= 0 ? `+${d}` : `${d}`, 220, y, d >= 0 ? P.green : P.red);
    if (p.slot === game.localSlot) {
      const xp = matchResult!.xp[p.slot] ?? 0;
      drawText(ctx, `+${xp} XP`, 16, y + 10, P.gold);
    }
  });
  const fs = matchResult.funStats;
  drawText(ctx, `Chain x${fs.biggestChain}`, 16, 130, P.accent);
  btn(ctx, 'CONTINUE', 70, 180, 50, 16, hit(mouse.x, mouse.y, 70, 180, 50, 16));
  btn(ctx, 'REMATCH', 136, 180, 50, 16, hit(mouse.x, mouse.y, 136, 180, 50, 16));
  if (hit(mouse.x, mouse.y, 70, 180, 50, 16) && mouse.click) {
    net.send({ type: 'leave_room' });
    go('menu');
  }
  if (hit(mouse.x, mouse.y, 136, 180, 50, 16) && mouse.click) {
    net.send({ type: 'rematch_vote', yes: true });
  }
}

function drawLeaderboard(): void {
  bg(ctx, t);
  drawTextCenter(ctx, 'LEADERBOARD', 6, P.gold);
  btn(ctx, lbMode === 'duel' ? '[Duel]' : 'Duel', 20, 20, 50, 12, hit(mouse.x, mouse.y, 20, 20, 50, 12));
  btn(ctx, lbMode === 'ffa' ? '[FFA]' : 'FFA', 80, 20, 50, 12, hit(mouse.x, mouse.y, 80, 20, 50, 12));
  if (hit(mouse.x, mouse.y, 20, 20, 50, 12) && mouse.click) {
    lbMode = 'duel';
    void fetchLb();
  }
  if (hit(mouse.x, mouse.y, 80, 20, 50, 12) && mouse.click) {
    lbMode = 'ffa';
    void fetchLb();
  }
  btn(ctx, 'Back', W - 48, 8, 40, 12, hit(mouse.x, mouse.y, W - 48, 8, 40, 12));
  if (hit(mouse.x, mouse.y, W - 48, 8, 40, 12) && mouse.click) go('menu');
  leaderboard.slice(0, 12).forEach((r, i) => {
    const y = 40 + i * 14;
    drawText(ctx, `${r.rank}. ${r.nickname}#${r.tag}`, 12, y, P.white);
    drawText(ctx, `${r.rating} ${r.tier}`, 150, y, P.gold);
    drawText(ctx, `${r.winrate}%`, 220, y, P.gray);
  });
}

function drawLocker(): void {
  bg(ctx, t);
  drawTextCenter(ctx, 'LOCKER', 6, P.gold);
  if (!profile) return;
  const animal = profile.selectedAnimal as AnimalId;
  const hat = profile.selectedHat as HatId;
  drawAnimal(ctx, 112, 40, animal, hat, 3, t >> 4);
  drawTextCenter(ctx, `${animal} · ${hat}`, 70, P.white);

  drawText(ctx, 'Animals', 12, 90, P.accent);
  animals.forEach((a, i) => {
    const x = 12 + (i % 4) * 58;
    const y = 104 + Math.floor(i / 4) * 20;
    const ok = unlocked(`animal:${a}`);
    btn(ctx, ok ? a.slice(0, 6) : '???', x, y, 54, 16, hit(mouse.x, mouse.y, x, y, 54, 16));
    if (ok && hit(mouse.x, mouse.y, x, y, 54, 16) && mouse.click) {
      net.send({ type: 'select_cosmetic', animal: a });
      profile!.selectedAnimal = a;
    }
  });
  drawText(ctx, 'Hats', 12, 150, P.accent);
  hats.forEach((h, i) => {
    const x = 12 + i * 40;
    const y = 164;
    const ok = unlocked(`hat:${h}`);
    btn(ctx, ok ? h.slice(0, 4) : '?', x, y, 36, 14, hit(mouse.x, mouse.y, x, y, 36, 14));
    if (ok && hit(mouse.x, mouse.y, x, y, 36, 14) && mouse.click) {
      net.send({ type: 'select_cosmetic', hat: h });
      profile!.selectedHat = h;
    }
  });
  btn(ctx, 'Back', W - 48, 8, 40, 12, hit(mouse.x, mouse.y, W - 48, 8, 40, 12));
  if (hit(mouse.x, mouse.y, W - 48, 8, 40, 12) && mouse.click) go('menu');
}

function drawSettings(): void {
  bg(ctx, t);
  drawTextCenter(ctx, 'SETTINGS', 8, P.gold);
  drawText(ctx, `Volume: ${Math.round(settingsVol * 100)}%`, 30, 40, P.white);
  btn(ctx, '-', 30, 56, 24, 14, hit(mouse.x, mouse.y, 30, 56, 24, 14));
  btn(ctx, '+', 60, 56, 24, 14, hit(mouse.x, mouse.y, 60, 56, 24, 14));
  if (hit(mouse.x, mouse.y, 30, 56, 24, 14) && mouse.click) {
    settingsVol = Math.max(0, settingsVol - 0.1);
    setVolume(settingsVol);
  }
  if (hit(mouse.x, mouse.y, 60, 56, 24, 14) && mouse.click) {
    settingsVol = Math.min(1, settingsVol + 0.1);
    setVolume(settingsVol);
  }
  drawText(ctx, `Mute (M): ${isMuted() ? 'ON' : 'OFF'}`, 30, 80, P.white);
  const cb = localStorage.getItem('splash_cb') === '1';
  btn(ctx, `Colorblind splash: ${cb ? 'ON' : 'OFF'}`, 30, 100, 180, 14, hit(mouse.x, mouse.y, 30, 100, 180, 14));
  if (hit(mouse.x, mouse.y, 30, 100, 180, 14) && mouse.click) {
    localStorage.setItem('splash_cb', cb ? '0' : '1');
  }
  const ns = localStorage.getItem('splash_noshake') === '1';
  btn(ctx, `Reduce shake: ${ns ? 'ON' : 'OFF'}`, 30, 120, 180, 14, hit(mouse.x, mouse.y, 30, 120, 180, 14));
  if (hit(mouse.x, mouse.y, 30, 120, 180, 14) && mouse.click) {
    localStorage.setItem('splash_noshake', ns ? '0' : '1');
  }
  const lag = localStorage.getItem('splash_lag') ?? '0';
  btn(ctx, `Art. latency: ${lag}ms`, 30, 140, 180, 14, hit(mouse.x, mouse.y, 30, 140, 180, 14));
  if (hit(mouse.x, mouse.y, 30, 140, 180, 14) && mouse.click) {
    const next = lag === '0' ? '150' : lag === '150' ? '300' : '0';
    localStorage.setItem('splash_lag', next);
  }
  drawText(ctx, 'Losing your device token loses', 30, 165, P.gray);
  drawText(ctx, 'this account. No password in v1.', 30, 175, P.gray);

  drawText(ctx, 'Nickname:', 30, 190, P.white);
  // simple nick set via prompt on click
  btn(ctx, nickInput || 'Set nick', 100, 188, 80, 14, hit(mouse.x, mouse.y, 100, 188, 80, 14));
  if (hit(mouse.x, mouse.y, 100, 188, 80, 14) && mouse.click) {
    const n = window.prompt('Nickname (3-16 chars)', profile?.nickname ?? '');
    if (n) net.send({ type: 'set_nickname', nickname: n });
  }
  btn(ctx, 'Back', W - 48, 8, 40, 12, hit(mouse.x, mouse.y, W - 48, 8, 40, 12));
  if (hit(mouse.x, mouse.y, W - 48, 8, 40, 12) && mouse.click) go('menu');
}

function drawHowto(): void {
  bg(ctx, t);
  drawPanel(ctx, 12, 12, W - 24, H - 24);
  drawTextCenter(ctx, 'HOW TO PLAY', 20, P.gold);
  const lines = [
    'Drop water balloons (Space/E)',
    'Cross splash washes castles',
    'Grab power-ups: balloons, range,',
    '  flippers (speed), rubber boots',
    'Boots let you KICK balloons',
    'Rising Tide floods the map',
    'Soaked? Ride a Revenge Duck!',
    'Emotes: keys 1-4',
    'Last dry critter wins the round',
  ];
  lines.forEach((l, i) => drawText(ctx, l, 24, 40 + i * 12, P.white));
  btn(ctx, 'Back', 108, 190, 40, 14, hit(mouse.x, mouse.y, 108, 190, 40, 14));
  if (hit(mouse.x, mouse.y, 108, 190, 40, 14) && mouse.click) go('menu');
}

function drawJoinCode(): void {
  bg(ctx, t);
  drawTextCenter(ctx, 'JOIN BY CODE', 40, P.gold);
  drawTextCenter(ctx, joinCode || '______', 80, P.white, 2);
  drawTextCenter(ctx, 'Type 6-char code, Enter to join', 120, P.gray);
  btn(ctx, 'Back', 108, 180, 40, 14, hit(mouse.x, mouse.y, 108, 180, 40, 14));
  if (hit(mouse.x, mouse.y, 108, 180, 40, 14) && mouse.click) go('menu');
  // capture keys
  for (const k of keys.pressed) {
    if (k.startsWith('Key') && joinCode.length < 6) joinCode += k.slice(3);
    if (k.startsWith('Digit') && joinCode.length < 6) joinCode += k.slice(5);
    if (k === 'Backspace') joinCode = joinCode.slice(0, -1);
    if (k === 'Enter' && joinCode.length >= 4) {
      net.send({ type: 'join_room', code: joinCode.toUpperCase() });
    }
  }
}

// deep link room
if (location.hash.startsWith('#/room/')) {
  const code = location.hash.replace('#/room/', '').toUpperCase();
  setTimeout(() => {
    if (playerId) net.send({ type: 'join_room', code });
  }, 500);
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(50, now - last);
  last = now;
  t++;

  if (screen === 'game') {
    updateGame(game, keys, dt);
    drawGame(ctx, game, Math.round(net.latency));
  } else if (screen === 'title') drawTitle();
  else if (screen === 'tutorial') drawTutorial();
  else if (screen === 'menu') drawMenu();
  else if (screen === 'browser') drawBrowser();
  else if (screen === 'create') drawCreate();
  else if (screen === 'lobby') drawLobby();
  else if (screen === 'queue') drawQueue();
  else if (screen === 'results') drawResults();
  else if (screen === 'leaderboard') drawLeaderboard();
  else if (screen === 'locker') drawLocker();
  else if (screen === 'settings') drawSettings();
  else if (screen === 'howto') drawHowto();
  else if (screen === 'joincode') drawJoinCode();

  mouse.click = false;
  clearPressed(keys);
  requestAnimationFrame(frame);
}
startMusic('title');
requestAnimationFrame(frame);

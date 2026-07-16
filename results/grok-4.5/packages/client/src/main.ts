import type {
  C2S,
  FunStats,
  GameMode,
  LobbySlot,
  MatchConfig,
  Placement,
  Profile,
  RoomInfo,
  RoomOptions,
  S2C,
} from '@splash/shared';
import { Net } from './net.js';
import { Prediction } from './prediction.js';
import { initAudio, playMusic, stopMusic, sfx, setMuted, setSfxVolume, setMusicVolume, toggleMute, setShowdown } from './audio.js';
import { ParticleSystem } from './render/particles.js';
import { W, H, type ScreenId } from './screens/common.js';
import { drawTitle } from './screens/title.js';
import { drawMainMenu, MENU_ITEMS, RANKED_ITEMS, CASUAL_ITEMS } from './screens/menu.js';
import { drawBrowser } from './screens/browser.js';
import { drawLobby, drawCreateRoom, drawJoinCode } from './screens/lobby.js';
import { drawQueue } from './screens/queue.js';
import { drawGame, processGameEvents, type GameView } from './screens/game.js';
import { drawResults } from './screens/results.js';
import { drawLeaderboard, type LbRow } from './screens/leaderboard.js';
import { drawLocker, ANIMALS, HATS } from './screens/locker.js';
import { drawSettings, defaultSettings, type SettingsState } from './screens/settings.js';
import { drawTutorial, STEPS } from './screens/tutorial.js';
import { drawHowto } from './screens/howto.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.imageSmoothingEnabled = false;

function resize(): void {
  const scale = Math.floor(Math.min(window.innerWidth / W, window.innerHeight / H));
  const s = Math.max(1, scale);
  canvas.style.width = `${W * s}px`;
  canvas.style.height = `${H * s}px`;
}
window.addEventListener('resize', resize);
resize();

const net = new Net();
const pred = new Prediction();
const particles = new ParticleSystem();

let screen: ScreenId = 'title';
let tick = 0;
let menuSel = 0;
let menuItems = MENU_ITEMS;
let menuTitle = 'MAIN MENU';
let profile: Profile | null = null;
let playerId: string | null = null;
let settings: SettingsState = loadSettings();
let keysDown = new Set<string>();
let balloonEdge = false;

// Lobby
let lobbyCode = '';
let lobbyOpts: RoomOptions | null = null;
let lobbySlots: LobbySlot[] = [];
let lobbyHost = '';
let lobbySlotSel = 0;

// Create room
let createFields = {
  name: 'Puddle Party',
  size: 4 as 2 | 4,
  pub: true,
  theme: 'random' as string,
  rounds: 3,
  botFill: true,
};
let createIdx = 0;
let joinCode = '';

// Browser
let roomList: RoomInfo[] = [];
let browserSel = 0;
let browserFilter: 'all' | 'duel' | 'ffa' = 'all';

// Queue
let queueMode: GameMode = 'duel';
let queueElapsed = 0;
let queueRange = 100;
let queueEta = 30;

// Game
let matchConfig: MatchConfig | null = null;
let gameView: GameView | null = null;
let inputSendAccum = 0;
let lastInputSeq = 0;
let announcerTimer = 0;

// Results
let resultsPlacements: Placement[] = [];
let resultsFun: FunStats = { mostSoaks: null, castleCrusher: null, longestSurvivor: null, biggestChain: 0 };
let resultsDeltas: Record<string, number> | undefined;
let resultsXp: Record<string, number> = {};
let rematchEligible = false;
let rematchVotes: Record<string, boolean> = {};

// Leaderboard
let lbRows: LbRow[] = [];
let lbMode: 'duel' | 'ffa' = 'duel';
let lbLoading = false;

// Locker
let lockerAnimal = 0;
let lockerHat = 0;
let lockerTab: 'animal' | 'hat' = 'animal';

// Tutorial
let tutStep = 0;
let settingsSel = 0;
let sawTutorial = localStorage.getItem('splash_tutorial') === '1';

// Practice submenu
let practiceDiff: 'easy' | 'medium' | 'hard' = 'medium';

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem('splash_settings');
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch { /* */ }
  return defaultSettings();
}

function saveSettings(): void {
  localStorage.setItem('splash_settings', JSON.stringify(settings));
  setSfxVolume(settings.sfxVol);
  setMusicVolume(settings.musicVol);
  setMuted(settings.muted);
}

function goMenu(): void {
  screen = 'menu';
  menuItems = MENU_ITEMS;
  menuTitle = 'MAIN MENU';
  menuSel = 0;
  playMusic('menu');
}

function startGame(config: MatchConfig): void {
  matchConfig = config;
  gameView = {
    config,
    grid: [],
    width: config.width,
    height: config.height,
    theme: config.theme === 'random' ? 'backyard' : config.theme,
    snap: null,
    scores: {},
    countdown: null,
    announcer: null,
    killFeed: [],
    shake: 0,
    colorblind: settings.colorblind,
    reducedShake: settings.reducedShake,
    hitstop: 0,
  };
  for (const p of config.players) gameView.scores[p.id] = 0;
  screen = 'game';
  playMusic('game');
}

net.handlers.onWelcome = (id, prof) => {
  playerId = id;
  profile = prof;
  if (prof.selectedAnimal) {
    lockerAnimal = Math.max(0, ANIMALS.indexOf(prof.selectedAnimal));
    lockerHat = Math.max(0, HATS.indexOf(prof.selectedHat));
  }
};

net.handlers.onMessage = (msg: S2C) => {
  switch (msg.t) {
    case 'profile_update':
      profile = msg.profile;
      break;
    case 'error':
      gameView && (gameView.announcer = msg.msg);
      announcerTimer = 90;
      break;
    case 'queue_status':
      queueElapsed = msg.elapsed;
      queueRange = msg.searchRange;
      queueEta = msg.eta;
      queueMode = msg.mode;
      break;
    case 'match_found':
    case 'match_start':
      startGame(msg.config);
      break;
    case 'room_created':
      lobbyCode = msg.code;
      break;
    case 'room_list':
      roomList = msg.rooms;
      break;
    case 'lobby_state':
      lobbyCode = msg.code;
      lobbyOpts = msg.opts;
      lobbySlots = msg.slots;
      lobbyHost = msg.hostId;
      if (screen !== 'game') screen = 'lobby';
      break;
    case 'round_start':
      if (!matchConfig || !gameView) break;
      gameView.grid = msg.castleGrid.slice();
      gameView.width = msg.width;
      gameView.height = msg.height;
      gameView.theme = msg.theme;
      gameView.scores = msg.scores;
      gameView.snap = null;
      pred.startRound(matchConfig, msg, playerId!);
      break;
    case 'snapshot':
      if (gameView) {
        gameView.snap = msg.snap;
        pred.applySnapshot(msg.snap);
        if (msg.snap.livingCount === 2) setShowdown(true);
      }
      break;
    case 'event':
      if (gameView) {
        const tile = Math.floor(Math.min((W - 8) / gameView.width, (H - 24) / gameView.height));
        const ox = Math.floor((W - gameView.width * tile) / 2);
        const oy = 18;
        processGameEvents(msg.events, particles, gameView, tile, ox, oy, sfx);
        pred.applyEvents(msg.events);
        if (gameView.announcer) announcerTimer = 60;
      }
      break;
    case 'round_end':
      if (gameView) {
        gameView.scores = msg.scores;
        gameView.announcer = msg.draw ? 'DRAW!' : 'ROUND OVER';
        announcerTimer = 90;
        gameView.countdown = null;
      }
      setShowdown(false);
      break;
    case 'match_end':
      resultsPlacements = msg.placements;
      resultsFun = msg.funStats;
      resultsDeltas = msg.ratingDeltas;
      resultsXp = msg.xp;
      rematchEligible = msg.rematchEligible;
      rematchVotes = {};
      screen = 'results';
      sfx.victory();
      stopMusic();
      if (matchConfig?.kind === 'tutorial') {
        net.send({ t: 'tutorial_complete' });
        localStorage.setItem('splash_tutorial', '1');
        sawTutorial = true;
      }
      break;
    case 'countdown':
      if (gameView) {
        gameView.countdown = msg.value;
        if (msg.value === 'SPLASH!' || msg.value === 0) sfx.splash();
        else if (typeof msg.value === 'number') sfx.countdown();
        if (msg.value === 'SPLASH!') {
          setTimeout(() => {
            if (gameView) gameView.countdown = null;
          }, 400);
        }
      }
      break;
    case 'emote':
      sfx.emote();
      if (gameView) {
        const p = gameView.config.players.find((x) => x.id === msg.playerId);
        if (p) {
          const sounds = ['QUACK!', 'RIBBIT!', 'SQUEAK!', 'HONK!'];
          gameView.announcer = `${p.nickname.split('#')[0]}: ${sounds[msg.id] ?? '!'}`;
          announcerTimer = 40;
        }
      }
      break;
    case 'rematch_status':
      rematchVotes = msg.votes;
      break;
  }
};

net.handlers.onConnect = () => {
  initAudio();
  setSfxVolume(settings.sfxVol);
  setMusicVolume(settings.musicVol);
  setMuted(settings.muted);
};

// Input
window.addEventListener('keydown', (e) => {
  initAudio();
  if (e.code === 'KeyM' && screen !== 'settings') {
    settings.muted = toggleMute();
    saveSettings();
    return;
  }
  keysDown.add(e.code);

  if (screen === 'title') {
    if (!playerId) return;
    sfx.click();
    if (!sawTutorial) {
      screen = 'tutorial';
      tutStep = 0;
    } else {
      goMenu();
    }
    return;
  }

  if (screen === 'tutorial') {
    if (e.code === 'Escape') {
      localStorage.setItem('splash_tutorial', '1');
      sawTutorial = true;
      goMenu();
    } else if (e.code === 'Enter') {
      tutStep++;
      if (tutStep >= STEPS.length) {
        localStorage.setItem('splash_tutorial', '1');
        sawTutorial = true;
        net.send({ t: 'tutorial_start' });
      }
    }
    return;
  }

  if (screen === 'menu') {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') {
      menuSel = (menuSel - 1 + menuItems.length) % menuItems.length;
      sfx.click();
    }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      menuSel = (menuSel + 1) % menuItems.length;
      sfx.click();
    }
    if (e.code === 'Enter' || e.code === 'Space') {
      sfx.click();
      handleMenuAction(menuItems[menuSel]!.action);
    }
    if (e.code === 'Escape' && menuItems !== MENU_ITEMS) {
      menuItems = MENU_ITEMS;
      menuTitle = 'MAIN MENU';
      menuSel = 0;
    }
    return;
  }

  if (screen === 'browser') {
    if (e.code === 'Escape') {
      screen = 'menu';
      menuItems = CASUAL_ITEMS;
      menuTitle = 'CASUAL';
      return;
    }
    if (e.code === 'KeyR') net.send({ t: 'room_list_request' });
    if (e.code === 'KeyF') {
      browserFilter = browserFilter === 'all' ? 'duel' : browserFilter === 'duel' ? 'ffa' : 'all';
    }
    if (e.code === 'ArrowUp') browserSel = Math.max(0, browserSel - 1);
    if (e.code === 'ArrowDown') browserSel = Math.min(roomList.length - 1, browserSel + 1);
    if (e.code === 'Enter') {
      const filtered = roomList.filter((r) => {
        if (browserFilter === 'duel') return r.size === 2;
        if (browserFilter === 'ffa') return r.size === 4;
        return true;
      });
      const room = filtered[browserSel];
      if (room) net.send({ t: 'join_room', code: room.code });
    }
    return;
  }

  if (screen === 'create') {
    handleCreateInput(e);
    return;
  }

  if (screen === 'join') {
    if (e.code === 'Escape') {
      screen = 'menu';
      menuItems = CASUAL_ITEMS;
      menuTitle = 'CASUAL';
      return;
    }
    if (e.code === 'Enter' && joinCode.length === 6) {
      net.send({ t: 'join_room', code: joinCode });
    }
    if (e.code === 'Backspace') joinCode = joinCode.slice(0, -1);
    if (/^[a-zA-Z0-9]$/.test(e.key) && joinCode.length < 6) {
      joinCode += e.key.toUpperCase();
    }
    return;
  }

  if (screen === 'lobby') {
    handleLobbyInput(e);
    return;
  }

  if (screen === 'queue') {
    if (e.code === 'Escape') {
      net.send({ t: 'queue_leave' });
      goMenu();
    }
    return;
  }

  if (screen === 'game') {
    if (e.code === 'Digit1') net.send({ t: 'emote', id: 0 });
    if (e.code === 'Digit2') net.send({ t: 'emote', id: 1 });
    if (e.code === 'Digit3') net.send({ t: 'emote', id: 2 });
    if (e.code === 'Digit4') net.send({ t: 'emote', id: 3 });
    if (e.code === 'Escape') {
      net.send({ t: 'leave_room' });
      goMenu();
    }
    // Balloon edge trigger
    if (e.code === settings.keys.balloon || e.code === 'KeyE' || e.code === 'Space') {
      balloonEdge = true;
    }
    return;
  }

  if (screen === 'results') {
    if (e.code === 'KeyR' && rematchEligible) {
      net.send({ t: 'rematch_vote', yes: true });
    }
    if (e.code === 'Enter' || e.code === 'Escape') {
      goMenu();
    }
    return;
  }

  if (screen === 'leaderboard') {
    if (e.code === 'Escape') goMenu();
    if (e.code === 'Tab') {
      e.preventDefault();
      lbMode = lbMode === 'duel' ? 'ffa' : 'duel';
      fetchLeaderboard();
    }
    return;
  }

  if (screen === 'locker') {
    handleLockerInput(e);
    return;
  }

  if (screen === 'settings') {
    handleSettingsInput(e);
    return;
  }

  if (screen === 'howto') {
    if (e.code === 'Escape' || e.code === 'Enter') goMenu();
  }
});

window.addEventListener('keyup', (e) => {
  keysDown.delete(e.code);
});

function handleMenuAction(action: string): void {
  switch (action) {
    case 'ranked':
      menuItems = RANKED_ITEMS;
      menuTitle = 'RANKED';
      menuSel = 0;
      break;
    case 'casual':
      menuItems = CASUAL_ITEMS;
      menuTitle = 'CASUAL';
      menuSel = 0;
      break;
    case 'practice':
      net.send({ t: 'practice', size: 2, difficulty: practiceDiff });
      break;
    case 'leaderboard':
      screen = 'leaderboard';
      fetchLeaderboard();
      break;
    case 'locker':
      screen = 'locker';
      break;
    case 'howto':
      screen = 'howto';
      break;
    case 'settings':
      screen = 'settings';
      settingsSel = 0;
      break;
    case 'queue_duel':
      queueMode = 'duel';
      net.send({ t: 'queue_join', mode: 'duel' });
      screen = 'queue';
      break;
    case 'queue_ffa':
      queueMode = 'ffa';
      net.send({ t: 'queue_join', mode: 'ffa' });
      screen = 'queue';
      break;
    case 'browser':
      screen = 'browser';
      browserSel = 0;
      net.send({ t: 'room_list_request' });
      break;
    case 'create':
      screen = 'create';
      createIdx = 0;
      break;
    case 'join':
      screen = 'join';
      joinCode = '';
      break;
    case 'back':
      menuItems = MENU_ITEMS;
      menuTitle = 'MAIN MENU';
      menuSel = 0;
      break;
  }
}

function handleCreateInput(e: KeyboardEvent): void {
  if (e.code === 'Escape') {
    screen = 'menu';
    menuItems = CASUAL_ITEMS;
    menuTitle = 'CASUAL';
    return;
  }
  if (e.code === 'ArrowUp') createIdx = Math.max(0, createIdx - 1);
  if (e.code === 'ArrowDown') createIdx = Math.min(7, createIdx + 1);
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    const dir = e.code === 'ArrowRight' ? 1 : -1;
    if (createIdx === 1) createFields.size = createFields.size === 2 ? 4 : 2;
    if (createIdx === 2) createFields.pub = !createFields.pub;
    if (createIdx === 3) {
      const themes = ['random', 'backyard', 'beach', 'pool'];
      const i = themes.indexOf(createFields.theme);
      createFields.theme = themes[(i + dir + themes.length) % themes.length]!;
    }
    if (createIdx === 4) {
      const r = [2, 3, 5];
      const i = r.indexOf(createFields.rounds);
      createFields.rounds = r[(i + dir + r.length) % r.length]!;
    }
    if (createIdx === 5) createFields.botFill = !createFields.botFill;
  }
  if (createIdx === 0 && e.key.length === 1 && createFields.name.length < 20 && !e.metaKey && !e.ctrlKey) {
    if (/[a-zA-Z0-9 ]/.test(e.key)) createFields.name += e.key;
  }
  if (createIdx === 0 && e.code === 'Backspace') createFields.name = createFields.name.slice(0, -1);
  if (e.code === 'Enter') {
    if (createIdx === 6) {
      const opts: RoomOptions = {
        name: createFields.name || 'Room',
        size: createFields.size,
        public: createFields.pub,
        theme: createFields.theme as RoomOptions['theme'],
        roundsToWin: createFields.rounds as 2 | 3 | 5,
        botFill: createFields.botFill,
        mode: createFields.size === 2 ? 'duel' : 'ffa',
      };
      net.send({ t: 'create_room', opts });
    } else if (createIdx === 7) {
      screen = 'menu';
      menuItems = CASUAL_ITEMS;
      menuTitle = 'CASUAL';
    }
  }
}

function handleLobbyInput(e: KeyboardEvent): void {
  if (e.code === 'Escape') {
    net.send({ t: 'leave_room' });
    goMenu();
    return;
  }
  if (e.code === 'KeyR') {
    const me = lobbySlots.find((s) => s.playerId === playerId);
    net.send({ t: 'set_ready', ready: !me?.ready });
  }
  if (e.code === 'Enter' && playerId === lobbyHost) {
    net.send({ t: 'start_match' });
  }
  if (playerId === lobbyHost) {
    if (e.code === 'ArrowLeft') lobbySlotSel = Math.max(0, lobbySlotSel - 1);
    if (e.code === 'ArrowRight') lobbySlotSel = Math.min(lobbySlots.length - 1, lobbySlotSel + 1);
    if (e.code === 'ArrowUp') lobbySlotSel = Math.max(0, lobbySlotSel - 2);
    if (e.code === 'ArrowDown') lobbySlotSel = Math.min(lobbySlots.length - 1, lobbySlotSel + 2);
    if (e.code === 'KeyB') {
      net.send({ t: 'set_slot', slot: lobbySlotSel, kind: 'bot', difficulty: 'medium' });
    }
    if (e.code === 'Digit1') net.send({ t: 'set_slot', slot: lobbySlotSel, kind: 'bot', difficulty: 'easy' });
    if (e.code === 'Digit2') net.send({ t: 'set_slot', slot: lobbySlotSel, kind: 'bot', difficulty: 'medium' });
    if (e.code === 'Digit3') net.send({ t: 'set_slot', slot: lobbySlotSel, kind: 'bot', difficulty: 'hard' });
    if (e.code === 'KeyX') net.send({ t: 'set_slot', slot: lobbySlotSel, kind: 'empty' });
  }
}

function handleLockerInput(e: KeyboardEvent): void {
  if (e.code === 'Escape') {
    goMenu();
    return;
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    lockerTab = lockerTab === 'animal' ? 'hat' : 'animal';
  }
  const items = lockerTab === 'animal' ? ANIMALS : HATS;
  let sel = lockerTab === 'animal' ? lockerAnimal : lockerHat;
  if (e.code === 'ArrowLeft') sel = Math.max(0, sel - 1);
  if (e.code === 'ArrowRight') sel = Math.min(items.length - 1, sel + 1);
  if (e.code === 'ArrowUp') sel = Math.max(0, sel - 4);
  if (e.code === 'ArrowDown') sel = Math.min(items.length - 1, sel + 4);
  if (lockerTab === 'animal') lockerAnimal = sel;
  else lockerHat = sel;
  if (e.code === 'Enter' && profile) {
    const animal = ANIMALS[lockerAnimal]!;
    const hat = HATS[lockerHat]!;
    net.send({ t: 'set_cosmetic', animal, hat });
    sfx.pickup();
  }
}

function handleSettingsInput(e: KeyboardEvent): void {
  if (settings.rebinding) {
    if (e.code === 'Escape') {
      settings.rebinding = null;
      return;
    }
    (settings.keys as any)[settings.rebinding] = e.code;
    settings.rebinding = null;
    saveSettings();
    return;
  }
  if (e.code === 'Escape') {
    saveSettings();
    goMenu();
    return;
  }
  if (e.code === 'ArrowUp') settingsSel = Math.max(0, settingsSel - 1);
  if (e.code === 'ArrowDown') settingsSel = Math.min(10, settingsSel + 1);
  if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    const dir = e.code === 'ArrowRight' ? 0.05 : -0.05;
    if (settingsSel === 0) settings.sfxVol = Math.max(0, Math.min(1, settings.sfxVol + dir));
    if (settingsSel === 1) settings.musicVol = Math.max(0, Math.min(1, settings.musicVol + dir));
    if (settingsSel === 2) settings.muted = !settings.muted;
    if (settingsSel === 3) settings.colorblind = !settings.colorblind;
    if (settingsSel === 4) settings.reducedShake = !settings.reducedShake;
    saveSettings();
  }
  if (e.code === 'Enter') {
    if (settingsSel >= 5 && settingsSel <= 9) {
      const keys = ['up', 'down', 'left', 'right', 'balloon'];
      settings.rebinding = keys[settingsSel - 5]!;
    }
    if (settingsSel === 10) {
      saveSettings();
      goMenu();
    }
  }
}

async function fetchLeaderboard(): Promise<void> {
  lbLoading = true;
  try {
    const res = await fetch(`/api/leaderboard?mode=${lbMode}`);
    lbRows = await res.json();
  } catch {
    lbRows = [];
  }
  lbLoading = false;
}

function currentDir(): import('@splash/shared').Dir {
  const k = settings.keys;
  const up = keysDown.has(k.up) || keysDown.has('ArrowUp');
  const down = keysDown.has(k.down) || keysDown.has('ArrowDown');
  const left = keysDown.has(k.left) || keysDown.has('ArrowLeft');
  const right = keysDown.has(k.right) || keysDown.has('ArrowRight');
  if (up && !down) return 'up';
  if (down && !up) return 'down';
  if (left && !right) return 'left';
  if (right && !left) return 'right';
  return 'none';
}

// Game loop 60fps render, 30Hz input send
let lastTime = performance.now();
function frame(now: number): void {
  const dt = now - lastTime;
  lastTime = now;
  tick++;

  // Send inputs
  if (screen === 'game' && matchConfig && playerId) {
    inputSendAccum += dt;
    const interval = 1000 / 30;
    if (inputSendAccum >= interval) {
      inputSendAccum %= interval;
      const dir = currentDir();
      const balloon = balloonEdge;
      balloonEdge = false;
      const serverTick = gameView?.snap?.tick ?? 0;
      const input = pred.pushInput(dir, balloon, serverTick);
      lastInputSeq = input.seq;
      net.send({
        t: 'input',
        seq: input.seq,
        tick: input.tick,
        dir: input.dir,
        balloonPressed: input.balloonPressed,
      });
    }

    if (gameView) {
      if (gameView.shake > 0) gameView.shake *= 0.85;
      if (gameView.shake < 0.5) gameView.shake = 0;
      if (announcerTimer > 0) {
        announcerTimer--;
        if (announcerTimer === 0) gameView.announcer = null;
      }
      if (gameView.hitstop > 0) gameView.hitstop--;
    }
  }

  particles.update();
  render();
  requestAnimationFrame(frame);
}

function render(): void {
  switch (screen) {
    case 'title':
      drawTitle(ctx, tick, !!playerId);
      break;
    case 'tutorial':
      drawTutorial(ctx, tick, tutStep);
      break;
    case 'menu':
      drawMainMenu(ctx, tick, menuSel, menuItems, menuTitle, profile);
      break;
    case 'browser':
      drawBrowser(ctx, tick, roomList, browserSel, browserFilter);
      break;
    case 'create':
      drawCreateRoom(ctx, tick, createFields, createIdx);
      break;
    case 'join':
      drawJoinCode(ctx, tick, joinCode);
      break;
    case 'lobby':
      if (lobbyOpts)
        drawLobby(ctx, tick, lobbyCode, lobbyOpts, lobbySlots, lobbyHost, playerId ?? '', lobbySlotSel);
      break;
    case 'queue':
      drawQueue(ctx, tick, queueMode, queueElapsed, queueRange, queueEta);
      break;
    case 'game':
      if (gameView) {
        if (gameView.hitstop > 0) break; // freeze frame
        drawGame(ctx, gameView, pred, playerId, particles, tick, Math.round(net.rtt));
      }
      break;
    case 'results':
      drawResults(
        ctx,
        tick,
        resultsPlacements,
        resultsFun,
        resultsDeltas,
        resultsXp,
        playerId ?? '',
        rematchEligible,
        rematchVotes,
      );
      break;
    case 'leaderboard':
      drawLeaderboard(ctx, tick, lbRows, lbMode, lbLoading);
      break;
    case 'locker':
      if (profile) drawLocker(ctx, tick, profile, lockerAnimal, lockerHat, lockerTab);
      break;
    case 'settings':
      drawSettings(ctx, tick, settings, settingsSel);
      break;
    case 'howto':
      drawHowto(ctx, tick);
      break;
  }
}

// Hash route for private rooms
function checkHash(): void {
  const hash = location.hash;
  const m = hash.match(/#\/room\/([A-Z0-9]{6})/i);
  if (m) {
    const wait = setInterval(() => {
      if (playerId) {
        clearInterval(wait);
        net.send({ t: 'join_room', code: m[1]! });
      }
    }, 200);
  }
}

net.connect();
checkHash();
requestAnimationFrame(frame);

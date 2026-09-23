// Hash router (one mounted Screen at a time inside frame.ui) plus the GLOBAL server-message
// controller: it keeps the store in sync with the server and performs the few navigations that
// the server drives (join links, entering a lobby, match start, leaving a room).
import { CONFIG, type MsgOf, type S2C } from '@splash/shared';
import { frame } from './frame';
import { input } from './input';
import { net } from './net';
import { screens, type Screen, type ScreenName } from './screens';
import { store } from './store';
import { clearToasts, closeAllModals, createBanner, h, layer, MENU_BACKDROP, placeToasts, toast, type Banner } from './ui';

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export type RouteName =
  | 'title'
  | 'tutorial'
  | 'menu'
  | 'browse'
  | 'lobby'
  | 'room'
  | 'queue'
  | 'game'
  | 'results'
  | 'leaderboard'
  | 'locker'
  | 'settings'
  | 'howto';

export interface Route {
  name: RouteName;
  screen: ScreenName;
  params: Record<string, string>;
  /** Normalised path, e.g. '/queue/duel'. */
  path: string;
}

interface RouteDef {
  name: RouteName;
  screen: ScreenName;
  pattern: RegExp;
  keys: string[];
}

const simple = (name: RouteName, screen: ScreenName, path: string): RouteDef => ({
  name,
  screen,
  pattern: new RegExp(`^${path}$`),
  keys: [],
});

const ROUTES: RouteDef[] = [
  simple('title', 'title', '/'),
  simple('tutorial', 'tutorial', '/tutorial'),
  simple('menu', 'menu', '/menu'),
  simple('browse', 'browser', '/browse'),
  simple('lobby', 'lobby', '/lobby'),
  { name: 'room', screen: 'lobby', pattern: /^\/room\/([^/]+)$/, keys: ['code'] },
  { name: 'queue', screen: 'queue', pattern: /^\/queue\/(duel|ffa)$/, keys: ['mode'] },
  simple('game', 'game', '/game'),
  simple('results', 'results', '/results'),
  simple('leaderboard', 'leaderboard', '/leaderboard'),
  simple('locker', 'locker', '/locker'),
  simple('settings', 'settings', '/settings'),
  simple('howto', 'howto', '/howto'),
];

function normalisePath(hash: string): string {
  const raw = hash.replace(/^#/, '').split('?')[0];
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function parseRoute(hash: string): Route | null {
  const path = normalisePath(hash);
  for (const def of ROUTES) {
    const match = def.pattern.exec(path);
    if (!match) continue;
    const params: Record<string, string> = {};
    try {
      def.keys.forEach((key, i) => (params[key] = decodeURIComponent(match[i + 1])));
    } catch {
      return null;
    }
    return { name: def.name, screen: def.screen, params, path };
  }
  return null;
}

/** The route in the address bar (unknown hashes resolve to the title route). */
export function currentRoute(): Route {
  return parseRoute(window.location.hash) ?? { name: 'title', screen: 'title', params: {}, path: '/' };
}

/**
 * Path the app itself is navigating to. A hash change to any other path came from the browser
 * (Back/Forward, an edited URL) and is subject to the live-match guard.
 */
let appNavPath: string | null = null;

/** Go to `path` (e.g. '/menu', '/queue/duel'). `replace` swaps the history entry instead. */
export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const target = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (opts.replace) {
    appNavPath = normalisePath(target);
    window.history.replaceState(window.history.state, '', target);
    renderRoute();
  } else if (window.location.hash !== target) {
    appNavPath = normalisePath(target);
    window.location.hash = target;
  }
}

interface Mounted {
  route: Route;
  screen: Screen;
  root: HTMLElement;
}

let mounted: Mounted | null = null;
let routing = false;
let rerouteQueued = false;

function clearCanvas(): void {
  frame.ctx.fillStyle = MENU_BACKDROP;
  frame.ctx.fillRect(0, 0, frame.W, frame.H);
}

function unmountCurrent(): void {
  if (!mounted) return;
  const { screen, root, route } = mounted;
  mounted = null;
  try {
    screen.unmount();
  } catch (err) {
    console.error(`[app] unmounting "${route.screen}" failed`, err);
  }
  root.remove();
}

/** Screens whose intro card owns the whole screen: toasts from before are dropped. */
const MATCH_SCREENS = new Set<ScreenName>(['game', 'tutorial']);

function mountScreen(route: Route): void {
  unmountCurrent();
  closeAllModals();
  if (MATCH_SCREENS.has(route.screen)) clearToasts();
  input.setGameplayActive(false);
  clearCanvas();
  const root = h('div', { class: 'screen-root', dataset: { screen: route.screen } });
  frame.ui.prepend(root);
  const screen = screens[route.screen];
  mounted = { route, screen, root };
  try {
    screen.mount(root, route.params);
  } catch (err) {
    console.error(`[app] mounting "${route.screen}" failed`, err);
    toast('Something went wrong opening that screen', 'error');
  }
  placeToasts();
}

function applyRoute(): void {
  const route = parseRoute(window.location.hash);
  const byApp = route !== null && route.path === appNavPath;
  appNavPath = null;
  if (!route) {
    navigate(liveMatchPath() ?? '/', { replace: true });
    return;
  }
  if (mounted && mounted.route.path === route.path) return;
  if (holdLiveMatch(route, byApp)) return;
  if (route.name === 'room') {
    const code = prepareJoin(route.params.code);
    if (!code) return;
    route.params.code = code;
  } else if (route.name !== 'lobby') {
    pendingJoin = null;
  }
  mountScreen(route);
}

/** Re-entrancy safe: navigations requested while mounting run right after it. */
function renderRoute(): void {
  if (routing) {
    rerouteQueued = true;
    return;
  }
  routing = true;
  try {
    do {
      rerouteQueued = false;
      applyRoute();
    } while (rerouteQueued);
  } finally {
    routing = false;
  }
}

// ---------------------------------------------------------------------------
// Global server-message controller
// ---------------------------------------------------------------------------

const ROOM_CODE_RE = new RegExp(`^[${CONFIG.ROOM_CODE_ALPHABET}]{${CONFIG.ROOM_CODE_LEN}}$`);
/** Screens the server must never pull the player away from when a lobby update arrives. */
const NO_YANK_ROUTES = new Set<RouteName>(['game', 'results', 'tutorial']);
/** Waiting screens a starting match replaces in history, so Back never re-enters a queue or stale room. */
const TRANSIENT_ROUTES = new Set<RouteName>(['queue', 'lobby', 'room', 'results']);
/** How long a reconnecting player waits for the server to re-attach them to their match. */
const REATTACH_TIMEOUT_MS = 4000;

/** Room code of the join link being joined (sent on every welcome until answered or abandoned). */
let pendingJoin: string | null = null;
let welcomedBefore = false;
let lastLobbyStateAt = 0;
/** Route of the match in progress, guarded against browser navigation; null once the app leaves it. */
let matchPath: string | null = null;

/** Where the running match lives, or null when no match is in progress (or the app left it). */
function liveMatchPath(): string | null {
  const { match, matchEnd } = store.get();
  return match && !matchEnd ? matchPath : null;
}

/**
 * A match still running on the server owns the screen: browser Back/Forward or an edited URL
 * bounce the player straight back to it (the screen stays mounted). The app's own navigations
 * away (a leave button, skipping the tutorial) are deliberate and stand the guard down.
 * Returns true when the route change was cancelled.
 */
function holdLiveMatch(route: Route, byApp: boolean): boolean {
  const path = liveMatchPath();
  if (!path || route.path === path) return false;
  if (byApp) {
    matchPath = null;
    return false;
  }
  toast('Match in progress', 'info');
  navigate(path, { replace: true });
  return true;
}

function payload<T extends { type: string }>(msg: T): Omit<T, 'type'> {
  const { type, ...rest } = msg;
  void type;
  return rest;
}

function sendPendingJoin(): void {
  if (pendingJoin && store.get().connected) net.send({ type: 'join_room', code: pendingJoin });
}

/** Handle a #/room/CODE link. Returns the normalised code, or null after redirecting away. */
function prepareJoin(rawCode: string): string | null {
  const code = rawCode.trim().toUpperCase();
  const { lobby } = store.get();
  if (lobby) {
    if (lobby.code !== code) toast('Leave your current room first', 'warn');
    navigate('/lobby', { replace: true });
    return null;
  }
  if (!ROOM_CODE_RE.test(code)) {
    toast('That room link is not valid', 'error');
    navigate('/menu', { replace: true });
    return null;
  }
  pendingJoin = code;
  sendPendingJoin();
  return code;
}

/** After a reconnect nothing server-side survives outside a match: rejoin or requeue. */
function recoverSession(): void {
  const { queue, matchFound, lobby } = store.get();
  if (matchFound || lobby?.phase === 'in_match') {
    expectReattach();
    return;
  }
  if (queue) {
    net.send({ type: 'queue_join', mode: queue.mode });
    return;
  }
  if (!lobby) return;
  store.update({ lobby: null });
  if (lobby.phase === 'lobby') {
    pendingJoin = lobby.code;
    sendPendingJoin();
  }
}

/** The server re-sends lobby_state when it re-attaches us; if it does not, the seat is gone. */
function expectReattach(): void {
  const since = Date.now();
  window.setTimeout(() => {
    if (lastLobbyStateAt >= since || !store.get().connected) return;
    store.update({ lobby: null, match: null, queue: null, matchFound: null });
    const route = currentRoute().name;
    if (route === 'game' || route === 'queue') {
      toast('Your match went on without you', 'warn');
      navigate('/menu');
    }
  }, REATTACH_TIMEOUT_MS);
}

function onWelcome(msg: MsgOf<S2C, 'welcome'>): void {
  const resumed = welcomedBefore;
  welcomedBefore = true;
  store.update({ connected: true, profile: msg.profile });
  if (pendingJoin) sendPendingJoin();
  else if (resumed) recoverSession();
}

function onLobbyState({ lobby }: MsgOf<S2C, 'lobby_state'>): void {
  const prev = store.get().lobby;
  lastLobbyStateAt = Date.now();
  pendingJoin = null;
  store.update({ lobby });
  const entered = !prev || prev.code !== lobby.code || prev.phase !== 'lobby';
  const route = currentRoute().name;
  if (lobby.phase === 'lobby' && entered && route !== 'lobby' && !NO_YANK_ROUTES.has(route)) {
    navigate('/lobby', { replace: route === 'room' });
  }
}

function onLeftRoom({ reason }: MsgOf<S2C, 'left_room'>): void {
  const matchOver = reason === 'match_over';
  pendingJoin = null;
  store.update(matchOver ? { lobby: null } : { lobby: null, match: null });
  if (reason === 'kicked') toast('You were removed from the room', 'warn');
  else if (reason === 'closed') toast('The room was closed', 'info');
  const route = currentRoute().name;
  if (route === 'lobby' || route === 'room' || (route === 'game' && !matchOver)) navigate('/menu');
}

/**
 * How long the queue screen's MATCH FOUND! flash stays up before the game screen takes over.
 * The first round_start only arrives after CONFIG.MATCH_INTRO_MS, so the VS card still shows.
 */
const MATCH_FOUND_HOLD_MS = 1200;

function onMatchStart({ config }: MsgOf<S2C, 'match_start'>): void {
  const route = currentRoute();
  const flashMatchFound = route.name === 'queue' && store.get().matchFound !== null;
  const path = config.tutorial || route.name === 'tutorial' ? '/tutorial' : '/game';
  matchPath = path;
  store.update({ match: config, matchEnd: null, queue: null });
  const enterMatch = () => {
    if (store.get().match !== config) return;
    store.update({ matchFound: null });
    const now = currentRoute();
    if (now.path !== path) navigate(path, { replace: TRANSIENT_ROUTES.has(now.name) });
  };
  if (flashMatchFound) window.setTimeout(enterMatch, MATCH_FOUND_HOLD_MS);
  else enterMatch();
}

/** A pending join is the only request in flight while it waits, so any error means it failed. */
function failPendingJoin(): void {
  pendingJoin = null;
  const route = currentRoute().name;
  if (route === 'room' || route === 'lobby') navigate('/menu', { replace: true });
}

/** Open dialogs awaiting a server reply show its error inline, so the global toast stays quiet. */
let inlineErrorClaims = 0;

/** Claim the next server errors for inline display (no toast). Call the returned release when done. */
export function claimServerErrors(): () => void {
  inlineErrorClaims += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inlineErrorClaims -= 1;
  };
}

function onError(msg: MsgOf<S2C, 'error'>): void {
  // Read the claim before updating the store: a claiming dialog releases its claim synchronously
  // from its store subscription as soon as lastError changes.
  const shownInline = inlineErrorClaims > 0;
  store.update({ lastError: { code: msg.code, msg: msg.msg, at: Date.now() } });
  if (msg.code === 'bad_version') {
    renderConnection();
    return;
  }
  if (pendingJoin) failPendingJoin();
  if (!shownInline) toast(msg.msg || msg.code.replace(/_/g, ' '), 'error');
}

function wireServerMessages(): void {
  net.on('welcome', onWelcome);
  net.on('profile', ({ profile }) => store.update({ profile }));
  net.on('lobby_state', onLobbyState);
  net.on('left_room', onLeftRoom);
  net.on('match_found', (m) => store.update({ matchFound: payload(m) }));
  net.on('queue_status', (m) => store.update({ queue: payload(m) }));
  net.on('queue_left', () => store.update({ queue: null, matchFound: null }));
  net.on('match_start', onMatchStart);
  net.on('match_end', (matchEnd) => store.update({ matchEnd }));
  net.on('room_list', ({ rooms }) => store.update({ roomList: rooms }));
  net.on('tutorial_step', (m) => store.update({ tutorialStep: payload(m) }));
  net.on('error', onError);
}

// ---------------------------------------------------------------------------
// Connection banner & dev badges
// ---------------------------------------------------------------------------

/** First-connect grace before "Connecting" shows (avoids a flash on normal loads). */
const BANNER_GRACE_MS = 700;

let banner: Banner | null = null;
let bannerTimer = 0;
let everOpened = false;
let downSince = Date.now();

function renderConnection(): void {
  if (!banner) return;
  const strip = banner;
  window.clearTimeout(bannerTimer);
  if (net.outdated) {
    strip.show('A new version is available', { action: { label: 'Reload', onClick: () => window.location.reload() } });
    return;
  }
  if (net.status === 'open') {
    everOpened = true;
    downSince = 0;
    strip.hide();
    return;
  }
  if (!downSince) downSince = Date.now();
  const text = everOpened ? 'Connection lost. Reconnecting' : 'Connecting to server';
  const wait = everOpened ? 0 : Math.max(0, downSince + BANNER_GRACE_MS - Date.now());
  bannerTimer = window.setTimeout(() => strip.show(text, { busy: true }), wait);
}

function wireConnectionStatus(): void {
  banner = createBanner();
  net.onStatus((status) => {
    if (status !== 'open') store.update({ connected: false });
    renderConnection();
  });
  renderConnection();
}

/** Visible reminder that ?lag=N artificial latency is on. */
function showLagBadge(): void {
  if (net.lagMs > 0) layer('badges').append(h('div', { class: 'lag-badge' }, `Lag +${net.lagMs}ms`));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export function startApp(): void {
  wireServerMessages();
  wireConnectionStatus();
  showLagBadge();
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

import './style.css';
import { App } from './app.js';
import { audio } from './audio.js';
import { loadToken } from './state.js';

/** Boots the client: canvas scaling, websocket handshake and the app loop. */
function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const overlay = document.getElementById('overlay');
  const bootScreen = document.getElementById('boot');
  if (!canvas || !overlay) throw new Error('the splash screen is broken');

  const stage = document.getElementById('stage') as HTMLDivElement | null;

  const resize = (): void => {
    const scale = Math.max(
      1,
      Math.floor(Math.min(window.innerWidth / 256, (window.innerHeight - 16) / 224)),
    );
    canvas.style.width = `${256 * scale}px`;
    canvas.style.height = `${224 * scale}px`;
    if (stage) {
      stage.style.width = `${256 * scale}px`;
      stage.style.height = `${224 * scale}px`;
    }
  };
  window.addEventListener('resize', resize);
  resize();

  const app = new App(canvas, overlay);
  (window as unknown as { splash: App }).splash = app;

  const token = loadToken();
  app.net.connect(token, app.state.settings.latency);

  const handleHash = (): void => {
    const match = window.location.hash.match(/#\/room\/([A-Za-z0-9]{4,12})/);
    if (!match) return;
    app.send({ t: 'join_room', code: match[1].toUpperCase() });
    window.history.replaceState(null, '', window.location.pathname);
  };
  window.addEventListener('hashchange', handleHash);
  // the first interaction unlocks the audio context
  window.addEventListener('pointerdown', () => audio.ensure());
  window.addEventListener('keydown', () => audio.ensure());

  app.startLoop();
  setTimeout(() => {
    bootScreen?.classList.add('hidden');
    handleHash();
  }, 300);
}

boot();

// Client boot: key-code fallback, theme tokens, keyboard input, audio settings + unlock, router/controller, network.
import './styles.css';
import { audio } from './audio';
import { startApp } from './app';
import { input } from './input';
import { installKeyCodeFallback } from './keyFallback';
import { net } from './net';
import { settings, type Settings } from './settings';
import { applyThemeTokens } from './ui';

function applyAudioSettings(s: Readonly<Settings>): void {
  audio.applySettings({ sfxVolume: s.sfxVolume, musicVolume: s.musicVolume, muted: s.muted });
}

/** Keep the mixer in sync with settings and unlock Web Audio on user gestures (autoplay policy). */
function wireAudio(): void {
  applyAudioSettings(settings.get());
  settings.subscribe((next) => applyAudioSettings(next));
  const unlock = () => {
    if (!audio.ready) audio.unlock();
  };
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true, passive: true });
}

function boot(): void {
  installKeyCodeFallback();
  applyThemeTokens();
  input.init();
  wireAudio();
  startApp();
  net.connect();
}

boot();

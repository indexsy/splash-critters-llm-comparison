import type { Profile, ServerMsg } from '@splash/shared';
import type { AudioEngine } from './audio.js';
import type { Net } from './net.js';
import type { Settings } from './settings.js';

export interface Session {
  matchStart: Extract<ServerMsg, { t: 'match_start' }> | null;
  matchEnd: Extract<ServerMsg, { t: 'match_end' }> | null;
  lobby: Extract<ServerMsg, { t: 'lobby_state' }> | null;
  queue: Extract<ServerMsg, { t: 'queue_status' }> | null;
}

export interface App {
  net: Net;
  audio: AudioEngine;
  settings: Settings;
  profile: Profile | null;
  session: Session;
  goto(name: string): void;
  toast(msg: string): void;
  saveSettings(): void;
}

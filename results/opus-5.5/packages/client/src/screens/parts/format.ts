// Pure display formatting shared by the menu screens (no DOM, unit-tested in node).
import { CONFIG, type Difficulty, type Mode, type ThemeChoice } from '@splash/shared';

/** "Nick#1234". */
export function nameTag(name: string, tag: string): string {
  return tag ? `${name}#${tag}` : name;
}

/** MILLISECONDS elapsed or remaining as mm:ss ("00:07", "12:34"); negatives clamp to 00:00. */
export function formatClockMs(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Matchmaking search window, e.g. "±150". */
export function rangeText(searchRange: number): string {
  return `±${Math.max(0, Math.round(Number.isFinite(searchRange) ? searchRange : 0))}`;
}

/** 0..1 position of the search window between its base and its cap (for the widening bar). */
export function rangeProgress(searchRange: number): number {
  const span = CONFIG.MM_MAX_RANGE - CONFIG.MM_BASE_RANGE;
  if (span <= 0 || !Number.isFinite(searchRange)) return 0;
  return Math.min(1, Math.max(0, (searchRange - CONFIG.MM_BASE_RANGE) / span));
}

/** Estimated wait in whole seconds ("~8s", "~1m 05s"); unknown or non-positive -> "--". */
export function etaText(etaSeconds: number): string {
  if (!Number.isFinite(etaSeconds) || etaSeconds <= 0) return '--';
  const s = Math.round(etaSeconds);
  if (s < 60) return `~${s}s`;
  return `~${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". */
export function ordinal(n: number): string {
  const v = Math.max(0, Math.floor(n));
  const teen = v % 100;
  if (teen >= 11 && teen <= 13) return `${v}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][v % 10] ?? 'th';
  return `${v}${v % 10 > 3 ? 'th' : suffix}`;
}

/** Signed integer: "+12", "-8", "+0". */
export function signed(n: number): string {
  const v = Math.round(Number.isFinite(n) ? n : 0);
  return v < 0 ? `${v}` : `+${v}`;
}

/** 0..1 win rate as a whole percentage ("57%"). */
export function percent(fraction: number): string {
  const v = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return `${Math.round(v * 100)}%`;
}

/** Compact age of a past timestamp: "just now", "5m ago", "3h ago", "2d ago". */
export function timeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Whole seconds left until `deadline` (both in the same clock), never negative. */
export function secondsLeft(deadline: number, now: number): number {
  if (!Number.isFinite(deadline) || deadline <= 0) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

const THEME_LABELS: Record<ThemeChoice, string> = {
  backyard: 'Backyard',
  beach: 'Beach',
  pool: 'Pool Party',
  random: 'Random',
};

export function themeLabel(theme: ThemeChoice): string {
  return THEME_LABELS[theme] ?? theme;
}

export function modeLabel(mode: Mode): string {
  return mode === 'duel' ? 'Duel' : 'Free-for-All';
}

/** "2P" / "4P" from a mode's player count. */
export function modeSize(mode: Mode): string {
  return `${CONFIG.MODES[mode].maxPlayers}P`;
}

function difficultyLabel(d: Difficulty): string {
  return d === 'easy' ? 'Easy' : d === 'medium' ? 'Medium' : 'Hard';
}

/** Difficulty tag for narrow slot cards ("Med" instead of "Medium"). */
export function difficultyShort(d: Difficulty): string {
  return d === 'medium' ? 'Med' : difficultyLabel(d);
}

/** Rematch votes needed: a strict majority of the connected humans (1 of 1, 2 of 2, 2 of 3, 3 of 4). */
export function rematchNeeded(connectedHumans: number): number {
  const humans = Math.max(1, Math.floor(Number.isFinite(connectedHumans) ? connectedHumans : 1));
  return Math.floor(humans / 2) + 1;
}

const NOT_IN_CODE_ALPHABET = new RegExp(`[^${CONFIG.ROOM_CODE_ALPHABET}]`, 'g');

/** Room codes: uppercase, only the server's code alphabet, at most ROOM_CODE_LEN chars. */
export function normaliseRoomCode(raw: string): string {
  return raw.toUpperCase().replace(NOT_IN_CODE_ALPHABET, '').slice(0, CONFIG.ROOM_CODE_LEN);
}

export function isRoomCode(code: string): boolean {
  return code.length === CONFIG.ROOM_CODE_LEN && normaliseRoomCode(code) === code;
}

/** Local nickname pre-check mirroring the server's length rule (the server has the final say). */
export function nicknameProblem(raw: string): string | null {
  const nick = raw.trim();
  if (nick.length < CONFIG.NICK_MIN) return `At least ${CONFIG.NICK_MIN} characters`;
  if (nick.length > CONFIG.NICK_MAX) return `At most ${CONFIG.NICK_MAX} characters`;
  return null;
}

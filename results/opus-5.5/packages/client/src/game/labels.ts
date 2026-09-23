// Text the match presents: announcer calls, kill-feed lines, clock and name formatting.
// Pure functions so the wording is testable without a canvas.
import type { GameEvent, MatchPlayerInfo, ThemeChoice } from '@splash/shared';
import type { MatchVerdict } from './verdict';

/** Announcer call for a cascade of `count` balloons (2+). */
export function chainLabel(count: number): string {
  if (count <= 2) return 'DOUBLE SPLASH!';
  if (count === 3) return 'TRIPLE SPLASH!';
  if (count === 4) return 'QUAD SPLASH!';
  return 'MEGA SPLASH!';
}

/** m:ss for a number of SECONDS (rounded up, never negative): the HUD round clock. */
export function formatClockSeconds(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A run of kill-feed text; `slot` colours it as that player's name. */
export interface FeedSpan {
  text: string;
  slot: number | null;
}

export interface FeedLine {
  spans: FeedSpan[];
  /** Soaked by a revenge-duck lob (drawn with a duck marker). */
  revenge: boolean;
  /** The local player was involved (highlighted). */
  mine: boolean;
}

type SoakEvent = Extract<GameEvent, { type: 'player_soaked' }>;

/** "DuckyDan soaked SoggyCat!", "X soaked themselves!", "X got washed away by the tide!". */
export function killFeedLine(ev: SoakEvent, nameOf: (slot: number) => string, mySlot: number): FeedLine {
  const victim: FeedSpan = { text: nameOf(ev.slot), slot: ev.slot };
  const mine = ev.slot === mySlot || ev.by === mySlot;
  if (ev.cause === 'tide' || ev.by < 0) {
    return { spans: [victim, { text: ' got washed away by the tide!', slot: null }], revenge: false, mine };
  }
  if (ev.by === ev.slot) {
    return { spans: [victim, { text: ' soaked themselves!', slot: null }], revenge: false, mine };
  }
  const soaker: FeedSpan = { text: nameOf(ev.by), slot: ev.by };
  return { spans: [soaker, { text: ' soaked ', slot: null }, victim, { text: '!', slot: null }], revenge: ev.cause === 'revenge', mine };
}

/** Plain text of a feed line (accessibility / tests). */
export function feedText(line: FeedLine): string {
  return line.spans.map((s) => s.text).join('');
}

/** In-match display name: nickname, or "Bot <name>" when the server sent a bare bot name. */
export function displayName(p: MatchPlayerInfo | undefined): string {
  if (!p) return '???';
  if (p.isBot && !/^bot\b/i.test(p.name)) return `Bot ${p.name}`;
  return p.name;
}

/**
 * Shorten `text` to at most `max` characters, marking the cut with `mark` (a dot by default).
 * Spaces before the mark are dropped ("Bot Ottr." rather than "Bot Ottr .").
 */
export function clip(text: string, max: number, mark = '.'): string {
  if (text.length <= max) return text;
  return max <= mark.length ? text.slice(0, max) : `${text.slice(0, max - mark.length).trimEnd()}${mark}`;
}

const THEME_NAMES: Record<ThemeChoice, string> = {
  backyard: 'BACKYARD',
  beach: 'BEACH',
  pool: 'POOL PARTY',
  random: 'RANDOM MAP',
};

/** Upper-case theme name for canvas cards (the menus use format.ts themeLabel). */
export function canvasThemeLabel(theme: ThemeChoice): string {
  return THEME_NAMES[theme];
}

/** Headline of the in-match round result card. */
export interface ResultHeadline {
  /** Critter the card features (the round or match winner), or -1 for none. */
  hero: number;
  /** The winner's name when the headline starts with it (a long name can take its own line). */
  name: string | null;
  /** The words after the name (the whole headline when `name` is null). */
  rest: string;
  /** Good news for the local player, someone else's win, or neither. */
  tone: 'mine' | 'theirs' | 'neutral';
}

const neutral = (rest: string): ResultHeadline => ({ hero: -1, name: null, rest, tone: 'neutral' });

/**
 * Headline for a finished round. The final round (with a verdict) names the match winner, who
 * need not have won that round; a verdict still waiting for match_end shows the round result.
 */
export function roundCardHeadline(
  r: { winner: number; matchOver: boolean; verdict: MatchVerdict | null },
  mySlot: number,
  nameOf: (slot: number) => string,
): ResultHeadline {
  const v = r.matchOver ? r.verdict : null;
  if (v?.kind === 'winner') {
    if (v.slot === mySlot) return { hero: v.slot, name: null, rest: 'YOU WIN THE MATCH!', tone: 'mine' };
    return { hero: v.slot, name: nameOf(v.slot), rest: 'WINS THE MATCH!', tone: 'theirs' };
  }
  if (v?.kind === 'shared') {
    if (v.all) return neutral('MATCH DRAWN!');
    return v.slots.includes(mySlot) ? { hero: -1, name: null, rest: 'YOU TIE FOR 1ST!', tone: 'mine' } : neutral('TIED FOR 1ST!');
  }
  if (r.winner < 0) return neutral('DRAW!');
  if (r.winner === mySlot) return { hero: r.winner, name: null, rest: 'YOU WIN THE ROUND!', tone: 'mine' };
  return { hero: r.winner, name: nameOf(r.winner), rest: 'WINS!', tone: 'theirs' };
}

/** The headline as one line of text. */
export function headlineText(h: ResultHeadline): string {
  return h.name ? `${h.name} ${h.rest}` : h.rest;
}

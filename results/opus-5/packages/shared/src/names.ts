/**
 * Guest name generation and nickname validation. Lives in shared so the client
 * can show the same rejection message the server would give.
 */

import { CONFIG } from './config.js';
import type { Rng } from './rng.js';

const ADJECTIVES = [
  'Soggy', 'Splashy', 'Damp', 'Bubbly', 'Drippy', 'Sunny', 'Salty', 'Wobbly',
  'Puddly', 'Breezy', 'Chunky', 'Zippy', 'Snappy', 'Foamy', 'Misty', 'Sandy',
  'Squishy', 'Glossy', 'Jumpy', 'Plucky', 'Rowdy', 'Cheery', 'Dizzy', 'Frosty',
];

const NOUNS = [
  'Otter', 'Duck', 'Frog', 'Penguin', 'Cat', 'Raccoon', 'Turtle', 'Capybara',
  'Newt', 'Gecko', 'Heron', 'Crab', 'Pelican', 'Beaver', 'Seal', 'Puffin',
];

/**
 * Deliberately small and blunt: substring matching over a handful of stems.
 * Nicknames are cosmetic, so a false positive just asks for another try.
 */
const BLOCKED_STEMS = [
  'fuck', 'shit', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'kike',
  'spic', 'chink', 'whore', 'slut', 'retard', 'pedo', 'bitch', 'dick', 'penis',
  'vagina', 'anal', 'porn', 'sex',
];

/** Leetspeak folding so `sh1t` is caught alongside `shit`. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[013457@$!|]/g, (ch) => {
      switch (ch) {
        case '0':
          return 'o';
        case '1':
        case '!':
        case '|':
          return 'i';
        case '3':
          return 'e';
        case '4':
        case '@':
          return 'a';
        case '5':
        case '$':
          return 's';
        case '7':
          return 't';
        default:
          return ch;
      }
    })
    .replace(/[^a-z]/g, '');
}

export function isProfane(value: string): boolean {
  const normalized = normalize(value);
  return BLOCKED_STEMS.some((stem) => normalized.includes(stem));
}

export interface NicknameCheck {
  ok: boolean;
  reason?: string;
}

export function validateNickname(raw: string): NicknameCheck {
  const value = raw.trim();
  if (value.length < CONFIG.NICKNAME_MIN) {
    return { ok: false, reason: `Nickname must be at least ${CONFIG.NICKNAME_MIN} characters.` };
  }
  if (value.length > CONFIG.NICKNAME_MAX) {
    return { ok: false, reason: `Nickname must be at most ${CONFIG.NICKNAME_MAX} characters.` };
  }
  if (!/^[A-Za-z0-9 _-]+$/.test(value)) {
    return { ok: false, reason: 'Letters, numbers, spaces, underscore and hyphen only.' };
  }
  if (isProfane(value)) {
    return { ok: false, reason: 'That nickname is not allowed. Try another.' };
  }
  return { ok: true };
}

/** `SoggyOtter` - the numeric #tag is assigned separately by the server. */
export function generateGuestName(rng: Rng): string {
  return `${rng.pick(ADJECTIVES)}${rng.pick(NOUNS)}`;
}

/** Four-digit discriminator, zero padded. */
export function generateTag(rng: Rng): string {
  return String(rng.range(1, 9999)).padStart(4, '0');
}

export function displayName(nickname: string, tag: string): string {
  return `${nickname}#${tag}`;
}

const BOT_NAMES = [
  'Bubbles', 'Pebble', 'Sprout', 'Waddles', 'Nibbles', 'Marlin', 'Coral',
  'Pippin', 'Tadpole', 'Skipper', 'Muddy', 'Ripple',
];

export function botName(rng: Rng, difficulty: string): string {
  const suffix = difficulty.charAt(0).toUpperCase();
  return `${rng.pick(BOT_NAMES)}-${suffix}`;
}

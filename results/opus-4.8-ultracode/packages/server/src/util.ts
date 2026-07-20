/**
 * Small server-side helpers: id/token generation, guest naming, nickname rules.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

export function newToken(): string {
  return randomBytes(24).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newId(): string {
  return randomUUID();
}

export function roomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let out = '';
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const ADJECTIVES = [
  'Soggy', 'Splashy', 'Damp', 'Bubbly', 'Drippy', 'Sunny', 'Puddle', 'Wavy',
  'Misty', 'Foamy', 'Dewy', 'Salty', 'Sandy', 'Breezy', 'Slippy', 'Squishy',
];
const CRITTERS = [
  'Otter', 'Frog', 'Duck', 'Penguin', 'Cat', 'Raccoon', 'Turtle', 'Capybara',
  'Newt', 'Seal', 'Crab', 'Koi', 'Toad', 'Heron', 'Beaver', 'Platypus',
];

export function generateGuestName(): { nickname: string; tag: string } {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const c = CRITTERS[Math.floor(Math.random() * CRITTERS.length)];
  const tag = String(1000 + Math.floor(Math.random() * 9000));
  return { nickname: `${a}${c}`, tag };
}

export function randomTag(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

const BANNED = ['fuck', 'shit', 'cunt', 'nigger', 'faggot', 'rape', 'nazi', 'bitch', 'dick', 'slut'];

export function isCleanNickname(name: string): boolean {
  const lower = name.toLowerCase();
  return !BANNED.some((b) => lower.includes(b));
}

export function validateNickname(name: string): { ok: boolean; reason?: string; clean?: string } {
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 16) return { ok: false, reason: 'Nickname must be 3-16 characters' };
  if (!/^[A-Za-z0-9 _-]+$/.test(trimmed)) return { ok: false, reason: 'Letters, numbers, space, _ and - only' };
  if (!isCleanNickname(trimmed)) return { ok: false, reason: 'Please pick a cleaner nickname' };
  return { ok: true, clean: trimmed };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

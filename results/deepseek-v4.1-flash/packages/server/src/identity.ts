import crypto from "node:crypto";
import type { SplashDb } from "./db/index.js";
import { playerNameExists } from "./db/queries.js";

const ADJECTIVES = [
  "Soggy",
  "Salty",
  "Bubbly",
  "Damp",
  "Splashy",
  "Wavy",
  "Puddly",
  "Misty",
  "Drippy",
  "Foamy",
  "Sunny",
  "Sandy",
  "Breezy",
  "Tidal",
  "Muddy",
  "Slippery",
  "Soaked",
  "Chilly",
];

const CRITTERS = [
  "Otter",
  "Duck",
  "Frog",
  "Cat",
  "Penguin",
  "Raccoon",
  "Turtle",
  "Capybara",
  "Newt",
  "Gull",
  "Beaver",
  "Seal",
  "Puffin",
  "Gecko",
  "Squid",
  "Minnow",
];

const BLOCKED = new Set([
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "asshole",
  "dick",
  "pussy",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "bastard",
  "whore",
  "slut",
  "rape",
  "nazi",
  "hitler",
  "pedo",
]);

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return crypto.randomUUID();
}

export function tokenLooksValid(token: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    token,
  );
}

function hasProfanity(value: string): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/[0134577@$]/g, (char) => {
      const map: Record<string, string> = {
        "0": "o",
        "1": "i",
        "3": "e",
        "4": "a",
        "5": "s",
        "7": "t",
        "@": "a",
        "$": "s",
      };
      return map[char] ?? char;
    })
    .replace(/[^a-z]/g, "");
  for (const word of BLOCKED) {
    if (normalized.includes(word)) return true;
  }
  return false;
}

export function validateNickname(raw: string): { ok: true; nickname: string } | { ok: false; msg: string } {
  const nickname = raw.trim().replace(/\s+/g, " ");
  if (nickname.length < 3 || nickname.length > 16) {
    return { ok: false, msg: "Nickname must be 3-16 characters." };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(nickname)) {
    return { ok: false, msg: "Use letters, numbers, spaces, _ or -." };
  }
  if (hasProfanity(nickname)) {
    return { ok: false, msg: "That nickname is not allowed." };
  }
  return { ok: true, nickname };
}

function randomTag(): string {
  return String(crypto.randomInt(1000, 10000));
}

export function availableTag(db: SplashDb, nickname: string): string {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const tag = randomTag();
    if (!playerNameExists(db, nickname, tag)) return tag;
  }
  return String(crypto.randomInt(10000, 100000)).slice(0, 5);
}

export function guestIdentity(db: SplashDb): { nickname: string; tag: string } {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const adjective = ADJECTIVES[crypto.randomInt(0, ADJECTIVES.length)] ?? "Soggy";
    const critter = CRITTERS[crypto.randomInt(0, CRITTERS.length)] ?? "Otter";
    const nickname = `${adjective}${critter}`;
    const tag = randomTag();
    if (!playerNameExists(db, nickname, tag)) return { nickname, tag };
  }
  return { nickname: "MysteryCritter", tag: randomTag() };
}

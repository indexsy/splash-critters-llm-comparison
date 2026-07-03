// Guest-name generation and the nickname profanity/shape filter.

const ADJECTIVES = [
  "Soggy", "Splashy", "Drippy", "Bubbly", "Misty", "Soaked", "Damp", "Wavy",
  "Salty", "Sandy", "Squishy", "Slippy", "Puddly", "Foamy", "Drizzly", "Snorkel",
];
const CRITTERS = [
  "Otter", "Frog", "Duck", "Penguin", "Cat", "Raccoon", "Turtle", "Capybara",
  "Newt", "Crab", "Gull", "Minnow", "Tadpole", "Beaver", "Heron", "Axolotl",
];

const BANNED_SUBSTRINGS = [
  "fuck", "shit", "cunt", "nigg", "fag", "bitch", "cock", "dick", "pussy",
  "rape", "nazi", "hitler", "whore", "slut", "penis", "vagin", "anal", "sex",
];

export function randomGuestName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const critter = CRITTERS[Math.floor(Math.random() * CRITTERS.length)];
  return `${adj}${critter}`;
}

export function randomTag(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

export function validateNickname(raw: string): { ok: true; nickname: string } | { ok: false; msg: string } {
  const nickname = raw.trim();
  if (nickname.length < 3 || nickname.length > 16) {
    return { ok: false, msg: "Nickname must be 3-16 characters." };
  }
  if (!/^[A-Za-z0-9_\- ]+$/.test(nickname)) {
    return { ok: false, msg: "Letters, numbers, spaces, _ and - only." };
  }
  const flat = nickname.toLowerCase().replace(/[^a-z]/g, "");
  for (const bad of BANNED_SUBSTRINGS) {
    if (flat.includes(bad)) return { ok: false, msg: "That nickname isn't allowed." };
  }
  return { ok: true, nickname };
}

const BOT_NAMES = [
  "Bubbles", "Squirt", "Puddles", "Drizzle", "Splash", "Ripple", "Dew", "Misty",
  "Soaker", "Drencher", "Sprinkle", "Monsoon",
];

export function botName(difficulty: string, slot: number): string {
  const base = BOT_NAMES[(slot * 5 + difficulty.length) % BOT_NAMES.length];
  const tag = difficulty === "easy" ? "Jr" : difficulty === "hard" ? "MAX" : "";
  return `${base}${tag ? " " + tag : ""}`;
}

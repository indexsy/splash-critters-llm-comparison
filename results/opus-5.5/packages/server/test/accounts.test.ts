import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, STARTER_UNLOCKS } from '@splash/shared';
import {
  AccountError,
  GUEST_ADJECTIVES,
  GUEST_ANIMALS,
  buildProfile,
  buildPublicProfile,
  claimNickname,
  completeTutorial,
  generateGuestIdentity,
  hashToken,
  loginOrCreate,
  setCosmetics,
  skipTutorial,
  validateNickname,
  validateToken,
} from '../src/accounts';
import { awardXp } from '../src/progression';
import { insertPlayer, openDb, type Db } from '../src/db';

const openDbs: Db[] = [];
function memoryDb(): Db {
  const db = openDb(':memory:');
  openDbs.push(db);
  return db;
}
afterEach(() => openDbs.splice(0).forEach((db) => db.close()));

function accountErrorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof AccountError) return err.code;
    throw err;
  }
  throw new Error('expected an AccountError');
}

describe('tokens', () => {
  it('hashes with sha256 hex', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('accepts uuid-ish tokens up to 64 chars only', () => {
    expect(validateToken(randomUUID())).toBe(true);
    expect(validateToken('a'.repeat(64))).toBe(true);
    expect(validateToken('a'.repeat(65))).toBe(false);
    expect(validateToken('short')).toBe(false);
    expect(validateToken('has spaces in the token!')).toBe(false);
    expect(validateToken(12345678901234567890)).toBe(false);
    expect(validateToken(undefined)).toBe(false);
  });
});

describe('loginOrCreate', () => {
  it('creates a guest with a fresh token when none is sent', () => {
    const db = memoryDb();
    const { player, token, created } = loginOrCreate(db);
    expect(created).toBe(true);
    expect(validateToken(token)).toBe(true);
    expect(player.nickname).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
    expect(player.tag).toMatch(/^\d{4}$/);
    expect(player).toMatchObject({ hasNickname: false, tutorialDone: false, xp: 0, level: 1, animal: 'frog', hat: 'none' });
    expect(buildProfile(db, player.id).unlocks.sort()).toEqual([...STARTER_UNLOCKS].sort());
    const stored = db.prepare<[string], { token_hash: string }>('SELECT token_hash FROM players WHERE id = ?').get(player.id);
    expect(stored?.token_hash).toBe(hashToken(token));
    expect(stored?.token_hash).not.toBe(token);
  });

  it('logs back in with the same token', () => {
    const db = memoryDb();
    const first = loginOrCreate(db);
    const again = loginOrCreate(db, first.token);
    expect(again.created).toBe(false);
    expect(again.token).toBe(first.token);
    expect(again.player.id).toBe(first.player.id);
  });

  it('binds an unknown valid token to a new guest, and replaces an invalid token', () => {
    const db = memoryDb();
    const clientToken = randomUUID();
    const bound = loginOrCreate(db, clientToken);
    expect(bound).toMatchObject({ created: true, token: clientToken });
    expect(loginOrCreate(db, clientToken).player.id).toBe(bound.player.id);

    const replaced = loginOrCreate(db, 'bad token!');
    expect(replaced.created).toBe(true);
    expect(replaced.token).not.toBe('bad token!');
    expect(validateToken(replaced.token)).toBe(true);
  });
});

describe('guest identities', () => {
  it('every generated name is a valid, friendly nickname', () => {
    for (const adjective of GUEST_ADJECTIVES) {
      for (const animal of GUEST_ANIMALS) {
        const check = validateNickname(adjective + animal);
        expect(check, adjective + animal).toEqual({ ok: true, value: adjective + animal });
      }
    }
  });

  it('never repeats a nickname#tag', () => {
    const db = memoryDb();
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const { player } = loginOrCreate(db);
      const key = `${player.nickname.toLowerCase()}#${player.tag}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    const identity = generateGuestIdentity(db);
    expect(seen.has(`${identity.nickname.toLowerCase()}#${identity.tag}`)).toBe(false);
  });
});

describe('validateNickname', () => {
  it('trims and collapses whitespace', () => {
    expect(validateNickname('  Big    Wave  ')).toEqual({ ok: true, value: 'Big Wave' });
    expect(validateNickname('Tab\tName')).toEqual({ ok: true, value: 'Tab Name' });
    expect(validateNickname('Soggy_Otter-99')).toEqual({ ok: true, value: 'Soggy_Otter-99' });
  });

  it.each([
    ['ab', 'length'],
    ['   ab   ', 'length'],
    ['a'.repeat(CONFIG.NICK_MAX + 1), 'length'],
    ['Bob!', 'charset'],
    ['Bób', 'charset'],
    ['1234', 'letter'],
    ['___', 'letter'],
  ])('rejects %j (%s)', (raw) => {
    expect(validateNickname(raw).ok).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(validateNickname(42).ok).toBe(false);
    expect(validateNickname(null).ok).toBe(false);
  });

  it.each([
    'fuck', 'FuCkEr', 'fuuuuuck', 'f_u_c_k', 'Fu ck', 'Phuck It', 'sh1t', '5hit', 'SHIIIT',
    'b1tch', 'a55', 'A S S', 'Big Ass', 'BigDick', 'xXDickXx', 'c0ck', 'n1gg3r', 'Cum Dog', 's1ut',
    'Faggot', 'Nazi Frog', 'GrammarNazi', 'KKKlan', 'T1ts', 'b00bs', 'Pu55y Cat', 'D1ck',
    // roots glued to another word, spelled out letter by letter, or hidden next to a clean word
    'Dickhead', 'Bigdick', 'BIGDICK', 'Asswipe', 'Cockface', 'Cumdump', 'Faggy', 'Naziboy', 'Heilfrog',
    'Fukboy', 'Sexyfrog', 'Rapeface', 'Cumming', 'Boobies', 'Fatass', 'Twatface', 'B i g D i c k',
    'Peacockdick', 'Grassass', 'B1gd1ck',
  ])('blocks profanity %j', (raw) => {
    expect(validateNickname(raw)).toMatchObject({ ok: false });
  });

  it.each([
    'Peacock', 'Classic', 'Assassin', 'Grape', 'Therapist', 'Dickens', 'Cocktail', 'Raccoon Rider',
    'Titan', 'Bass Drop', 'Sussex', 'Analyst', 'Swanky', 'Scuba Steve', 'Spicy Duck', 'Homer', 'Cumulus',
    'Hot Water', 'Saltwater', 'Pondscum', 'Seabass', 'Grasshopper', 'Peacocks', 'Cockatiel', 'Hancock',
    'Rapper', 'Vacuum', 'Annalise', 'Milford', 'Botany', 'Assistant',
  ])('allows clean name %j', (raw) => {
    expect(validateNickname(raw)).toEqual({ ok: true, value: raw });
  });

  it.each([
    'Bot Bubbles', 'BotBubbles', 'bot_drizzle', 'Admin', 'The Server', 'Staff Pick',
    'B0t Bubbles', 'B0tBubbles', 'Adm1n', '4dmin', 'Serv3r', 'A dmin',
  ])('reserves %j', (raw) => {
    expect(validateNickname(raw)).toEqual({ ok: false, reason: 'That nickname is reserved.' });
  });
});

describe('claimNickname', () => {
  it('assigns the nickname with a 4-digit tag and marks the player named', () => {
    const db = memoryDb();
    const { player } = loginOrCreate(db);
    const profile = claimNickname(db, player.id, '  Captain   Splash ');
    expect(profile.nickname).toBe('Captain Splash');
    expect(profile.tag).toMatch(/^\d{4}$/);
    expect(profile.hasNickname).toBe(true);
  });

  it('gives case-insensitively equal nicknames different tags', () => {
    const db = memoryDb();
    const tags = new Set<string>();
    for (const name of ['Splashy', 'splashy', 'SPLASHY', 'SpLaShY']) {
      tags.add(claimNickname(db, loginOrCreate(db).player.id, name).tag);
    }
    expect(tags.size).toBe(4);
  });

  it('keeps the tag when re-claiming the current name in another casing', () => {
    const db = memoryDb();
    const { player } = loginOrCreate(db);
    const first = claimNickname(db, player.id, 'Wave Rider');
    const recased = claimNickname(db, player.id, 'wave rider');
    expect(recased).toMatchObject({ nickname: 'wave rider', tag: first.tag });
    const guest = loginOrCreate(db).player;
    expect(claimNickname(db, guest.id, guest.nickname.toUpperCase()).tag).toBe(guest.tag);
  });

  it('finds the last free tag and reports nickname_taken when all are used', () => {
    const db = memoryDb();
    const fill = db.transaction((skip: string | null) => {
      for (let n = 0; n < 10_000; n++) {
        const tag = String(n).padStart(4, '0');
        if (tag === skip) continue;
        insertPlayer(db, { id: `crowd-${tag}`, tokenHash: `crowd-${tag}`, nickname: 'Crowded', tag, createdAt: 1, animal: 'frog', hat: 'none' });
      }
    });
    fill('0420');
    const { player } = loginOrCreate(db);
    expect(claimNickname(db, player.id, 'crowded').tag).toBe('0420');
    const other = loginOrCreate(db).player;
    expect(accountErrorCode(() => claimNickname(db, other.id, 'CROWDED'))).toBe('nickname_taken');
  });

  it('rejects invalid names and unknown players', () => {
    const db = memoryDb();
    const { player } = loginOrCreate(db);
    expect(accountErrorCode(() => claimNickname(db, player.id, 'sh1t head'))).toBe('nickname_invalid');
    expect(accountErrorCode(() => claimNickname(db, 'nobody', 'Valid Name'))).toBe('not_found');
    expect(buildProfile(db, player.id).hasNickname).toBe(false);
  });
});

describe('setCosmetics', () => {
  it('allows owned items and rejects locked or unknown ones', () => {
    const db = memoryDb();
    const { player } = loginOrCreate(db);
    expect(setCosmetics(db, player.id, 'duck', 'none')).toMatchObject({ animal: 'duck', hat: 'none' });
    expect(accountErrorCode(() => setCosmetics(db, player.id, 'otter', 'none'))).toBe('locked_item');
    expect(accountErrorCode(() => setCosmetics(db, player.id, 'frog', 'crown'))).toBe('locked_item');
    expect(accountErrorCode(() => setCosmetics(db, player.id, 'dragon', 'none'))).toBe('invalid');
    expect(buildProfile(db, player.id)).toMatchObject({ animal: 'duck', hat: 'none' });
  });

  it('unlocks items by levelling up', () => {
    const db = memoryDb();
    const { player } = loginOrCreate(db);
    const award = awardXp(db, player.id, 275, [{ label: 'Test', xp: 275 }]); // level 3, slot defaults to 0
    expect(award).toMatchObject({ slot: 0, levelBefore: 1, levelAfter: 3, unlocked: ['otter', 'bucket'] });
    expect(setCosmetics(db, player.id, 'otter', 'bucket')).toMatchObject({ animal: 'otter', hat: 'bucket', level: 3 });
  });
});

describe('profiles + tutorial', () => {
  it('builds the owner profile with default ratings', () => {
    const db = memoryDb();
    const { player } = loginOrCreate(db);
    const profile = buildProfile(db, player.id);
    expect(profile).toMatchObject({ id: player.id, level: 1, xp: 0, xpIntoLevel: 0, xpForNext: 125, tutorialDone: false });
    expect(profile.ratings.duel).toEqual({ mode: 'duel', rating: 1000, games: 0, wins: 0, peak: 1000, tier: 'pond' });
    expect(profile.ratings.ffa.mode).toBe('ffa');
    expect(accountErrorCode(() => buildProfile(db, 'nobody'))).toBe('not_found');
  });

  it('builds a public profile, or null for unknown ids', () => {
    const db = memoryDb();
    const { player } = loginOrCreate(db);
    const pub = buildPublicProfile(db, player.id);
    expect(pub).toMatchObject({ id: player.id, nickname: player.nickname, level: 1, recentMatches: [] });
    expect(pub && 'tutorialDone' in pub).toBe(false);
    expect(buildPublicProfile(db, 'nobody')).toBeNull();
  });

  it('awards tutorial XP exactly once', () => {
    const db = memoryDb();
    const { player } = loginOrCreate(db);
    const award = completeTutorial(db, player.id);
    expect(award).toMatchObject({
      playerId: player.id, earned: CONFIG.XP.TUTORIAL, xpBefore: 0, xpAfter: 150, levelBefore: 1, levelAfter: 2,
      unlocked: ['bucket'], breakdown: [{ label: 'Tutorial complete', xp: 150 }],
    });
    expect(completeTutorial(db, player.id)).toBeNull();
    expect(buildProfile(db, player.id)).toMatchObject({ xp: 150, level: 2, tutorialDone: true });
  });

  it('skipping marks the tutorial done without XP', () => {
    const db = memoryDb();
    const { player } = loginOrCreate(db);
    expect(skipTutorial(db, player.id)).toBe(true);
    expect(skipTutorial(db, player.id)).toBe(false);
    expect(completeTutorial(db, player.id)).toBeNull();
    expect(buildProfile(db, player.id)).toMatchObject({ xp: 0, tutorialDone: true });
  });
});

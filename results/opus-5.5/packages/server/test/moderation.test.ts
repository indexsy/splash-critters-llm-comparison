import { describe, expect, it } from 'vitest';
import { isAllowedDisplayText } from '../src/moderation';

describe('isAllowedDisplayText (room names)', () => {
  it.each([
    'FUCK YOU N1GGERS', 'Shithead Admin Official', 'OFFICIAL ADMIN fuck kike', 'motherfucker lounge',
    // separators, spelled-out letters and a root running on from the start of a word
    'F.U.C.K', 'S h i t', 'Fu ck you', 'Big shi t', 'sh.it', 'Co ck',
    // accents, full-width forms, Cyrillic look-alikes and symbols inside a word
    'fück', 'ｆｕｃｋ', 'fu\u0441k', 'a$$hole', 'n!gga', 'b1tch please', 'Big D1ck energy', 'H1tler youth',
    // posing as staff
    'Admin room', 'Official Tournament', 'Adm1n only',
  ])('blocks %j', (name) => {
    expect(isAllowedDisplayText(name)).toBe(false);
  });

  it.each([
    "Hosty's room", 'Pool party', 'Pros only!', 'Come play :)', '1v1 me', 'Bots welcome', 'Bot brawl',
    'Classic mode', 'Peacock party', 'Raccoon Club', 'Glass house', 'Cocktail hour', 'Assassins',
    'Café au lait', 'Mañana', 'たのしい部屋', 'Room #1', 'Rock$tar', "Let's go!!",
    // a root straddling two clean words is not a word anyone wrote
    'Splash it up', 'Smash it', 'Splash hits', 'Tennis hitters',
  ])('allows %j', (name) => {
    expect(isAllowedDisplayText(name)).toBe(true);
  });
});

// Word filter for names other players see: nicknames and room names. Rejects profanity and slurs
// (leetspeak, spelled-out letters and separator tricks included) and names posing as staff or as
// a bot. Used by accounts.ts (nicknames) and rooms/options.ts (room names).

/**
 * Roots written in their shortest form; a run of n equal letters matches n or more
 * ("fagot" also catches "faggot", "fuuuck" is caught by "fuck").
 * Substring roots are rejected anywhere in the separator-free name.
 */
const SUBSTRING_ROOTS = [
  'fuck', 'fck', 'fvck', 'phuck', 'phuk', 'shit', 'cunt', 'kunt', 'nigg', 'fagot', 'whore', 'slut',
  'bitch', 'biatch', 'jizz', 'porn', 'penis', 'vagina', 'pussy', 'dildo', 'hitler', 'kkk',
  'retard', 'bastard', 'bollock', 'asshole', 'dumbass', 'jackass', 'douche', 'piss', 'clit',
  'orgasm', 'blowjob', 'handjob', 'rimjob', 'cocksuck', 'wetback',
];
/**
 * Word roots hide inside innocent words ("classic", "scuba"), so they are rejected only at a word's
 * edges: the whole word, its start ("Dickhead", "Faggy") or its end, optionally plural ("Bigdick").
 */
const WORD_ROOTS = [
  'ass', 'arse', 'anal', 'anus', 'dick', 'cock', 'tits', 'titty', 'titties', 'boob', 'fag', 'fuk',
  'fuq', 'cum', 'sex', 'sexy', 'rape', 'rapist', 'raping', 'spic', 'chink', 'kike', 'coon', 'gook',
  'negro', 'homo', 'tranny', 'prick', 'wank', 'wanker', 'nazi', 'heil', 'boner', 'twat', 'milf',
];
/**
 * Clean words (or stems) that carry a word root at an edge. They are cut out of a word before the
 * edge test, so "Peacock" and "Raccoon" pass while "Peacockdick" still fails.
 */
const CLEAN_WORDS = [
  'bass', 'cass', 'lass', 'mass', 'pass', 'rass', 'sass', 'assassin', 'assault', 'assemb', 'assert',
  'assess', 'asset', 'assign', 'assist', 'associat', 'assort', 'assum', 'assur', 'arsenal', 'arsenic',
  'parse', 'coarse', 'hoarse', 'hearse', 'analy', 'analog', 'annali', 'canal', 'banal', 'janus',
  'peacock', 'hancock', 'woodcock', 'gamecock', 'hitchcock', 'shuttlecock', 'weathercock', 'poppycock',
  'cockatoo', 'cockatiel', 'cockerel', 'cockle', 'cockney', 'cockpit', 'cockroach', 'cocktail',
  'dickens', 'dickinson', 'dickson', 'cumulus', 'cumin', 'cumber', 'scum', 'vacuum', 'talcum',
  'modicum', 'capsicum', 'fagan', 'fagen', 'essex', 'sussex', 'middlesex', 'sextant', 'sextet',
  'sexton', 'grape', 'drape', 'scrape', 'crape', 'frappe', 'rapeseed', 'therapist', 'rapper', 'rappel',
  'rapping', 'draping', 'scraping', 'spice', 'spicy', 'raccoon', 'racoon', 'cocoon', 'tycoon',
  'coonhound', 'montenegro', 'negroni', 'nazia', 'nazim', 'nazir', 'prickl', 'swank', 'milford', 'milfoil',
];
const RESERVED_WORDS = ['admin', 'administrator', 'moderator', 'server', 'system', 'official', 'staff'];

/** Digits commonly used as letters; '1' reads as both 'i' and 'l'. */
const LEET: Record<string, string> = { '0': 'o', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g' };

function rootPattern(root: string): string {
  return root.replace(/(.)\1*/g, (run: string, ch: string) => (run.length === 1 ? `${ch}+` : `${ch}{${run.length},}`));
}

const SUBSTRING_PATTERN = SUBSTRING_ROOTS.map(rootPattern).join('|');
const SUBSTRING_RE = new RegExp(SUBSTRING_PATTERN);
const SUBSTRING_START_RE = new RegExp(`^(?:${SUBSTRING_PATTERN})`);
const WORD_ROOTS_PATTERN = WORD_ROOTS.map(rootPattern).join('|');
const WORD_RE = new RegExp(`^(?:${WORD_ROOTS_PATTERN})(?:e?s)?$`);
const WORD_EDGE_RE = new RegExp(`^(?:${WORD_ROOTS_PATTERN})|(?:${WORD_ROOTS_PATTERN})(?:e?s)?$`);
/** Longest first, so a clean word is never cut short by a stem it contains. */
const CLEAN_RE = new RegExp([...CLEAN_WORDS].sort((a, b) => b.length - a.length).join('|'));

/** Glues runs of single characters back together: "B i g D i c k" spells one word. */
function joinSpelledOut(tokens: string[]): string[] {
  const words: string[] = [];
  let spelled = '';
  for (const token of tokens) {
    if (token.length === 1) {
      spelled += token;
      continue;
    }
    if (spelled) words.push(spelled);
    spelled = '';
    words.push(token);
  }
  if (spelled) words.push(spelled);
  return words;
}

/** Words of a name: split on separators and camelCase boundaries ("BigDuck_2" -> big, duck, 2). */
function nameWords(name: string): string[] {
  const tokens = name
    .split(/[\s_-]+/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
  return joinSpelledOut(tokens);
}

/** Both leetspeak readings of a lower-case string. */
function deLeet(text: string): string[] {
  const mapped = text.replace(/[0-9]/g, (d) => LEET[d] ?? d);
  return [mapped.replace(/1/g, 'i'), mapped.replace(/1/g, 'l')];
}

/** A word root at the edge of a word, once the clean words inside it are cut out. */
function hasEdgeRoot(word: string): boolean {
  return word.split(CLEAN_RE).some((fragment) => WORD_EDGE_RE.test(fragment));
}

function isReservedWord(word: string): boolean {
  return deLeet(word).some((plain) => RESERVED_WORDS.includes(plain));
}

/**
 * Profanity or a slur in a nickname, leetspeak and separator tricks included. Words are glued
 * back together before the substring check ("Fu ck", but also "SplashIt"): a nickname is short
 * and a split is far more often a trick than two real words.
 */
export function isProfane(name: string): boolean {
  const words = nameWords(name);
  const joined = words.join('');
  return deLeet(joined).some((plain) => SUBSTRING_RE.test(plain) || WORD_RE.test(plain))
    || words.some((word) => deLeet(word).some(hasEdgeRoot));
}

/** Poses as staff or the game itself ("Adm1n", "A dmin", "Official"), leetspeak included. */
export function impersonatesStaff(name: string): boolean {
  const words = nameWords(name);
  return words.some(isReservedWord) || isReservedWord(words.join(''));
}

/** Poses as a bot: the first word reads "bot" ("Bot Bubbles", "B0t Bubbles"). */
export function impersonatesBot(name: string): boolean {
  return deLeet(nameWords(name)[0] ?? '').includes('bot');
}

/**
 * Profanity or a slur in free text of real words: a substring root counts inside a word or when it
 * starts a word and runs on into the next ("Fu ck", "Sh it"), but not when it only straddles two
 * clean words ("Splash it", "Tennis hitters").
 */
function isProfaneText(text: string): boolean {
  const words = nameWords(text);
  const joined = words.join('');
  let offset = 0;
  for (const word of words) {
    if (deLeet(joined.slice(offset)).some((plain) => SUBSTRING_START_RE.test(plain))) return true;
    offset += word.length;
  }
  return deLeet(joined).some((plain) => WORD_RE.test(plain))
    || words.some((word) => deLeet(word).some((plain) => SUBSTRING_RE.test(plain) || hasEdgeRoot(plain)));
}

/** Cyrillic and Greek letters drawn like Latin ones ("fuсk" typed with a Cyrillic "с"): from, to. */
const LOOKALIKE_PAIRS = [
  'аa', 'вb', 'еe', 'кk', 'мm', 'нh', 'оo', 'рp', 'сc', 'тt', 'уy', 'хx', 'іi', 'јj', 'ѕs',
  'αa', 'βb', 'εe', 'ιi', 'κk', 'νv', 'οo', 'ρp', 'τt', 'υu', 'χx',
];
const LOOKALIKES = new Map<string, string>(
  LOOKALIKE_PAIRS.flatMap(([from, to]): [string, string][] => [[from, to], [from.toUpperCase(), to.toUpperCase()]]),
);
/** Symbols written for a letter inside a word ("a$$hole", "n!gga"). */
const SYMBOL_LETTERS: Record<string, string> = { '@': 'a', $: 's', '!': 'i', '|': 'l' };

/**
 * Free text reduced to the ASCII words the filter reads: accents dropped, full-width and other
 * compatibility forms folded, look-alike letters and in-word symbols mapped, and every other
 * character a word separator.
 */
function foldToAscii(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x00-\x7f]/gu, (ch) => LOOKALIKES.get(ch) ?? ch)
    .replace(/(?<=[A-Za-z0-9])[@$!|]+(?=[A-Za-z0-9])/g, (run) => [...run].map((ch) => SYMBOL_LETTERS[ch]).join(''))
    .replace(/[^A-Za-z0-9]+/g, ' ');
}

/**
 * Free text other players see besides nicknames (room names): no profanity or slurs and no posing
 * as staff. Unlike nicknames it may use any character, so accents, look-alike letters and symbols
 * are folded away first.
 */
export function isAllowedDisplayText(text: string): boolean {
  const plain = foldToAscii(text);
  return !isProfaneText(plain) && !impersonatesStaff(plain);
}

// Room codes: CONFIG.ROOM_CODE_LEN characters from CONFIG.ROOM_CODE_ALPHABET (no look-alikes such
// as I, O, 0, 1). The alphabet lives in shared config so clients validate codes against the same set.
import { randomInt } from 'node:crypto';
import { CONFIG } from '@splash/shared';

/** 32^6 codes: collisions are astronomically rare, but the loop still guarantees uniqueness. */
const MAX_ATTEMPTS = 100;

function randomCode(): string {
  const alphabet = CONFIG.ROOM_CODE_ALPHABET;
  let code = '';
  for (let i = 0; i < CONFIG.ROOM_CODE_LEN; i++) code += alphabet[randomInt(alphabet.length)];
  return code;
}

/** A fresh code not currently used by any room. */
export function uniqueRoomCode(taken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = randomCode();
    if (!taken(code)) return code;
  }
  throw new Error('uniqueRoomCode: code space exhausted');
}

export function roomLink(code: string): string {
  return `/#/room/${code}`;
}

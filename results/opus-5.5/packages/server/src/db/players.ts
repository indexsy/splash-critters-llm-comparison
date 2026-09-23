// Typed queries for the players table.
import type { AnimalId, HatId } from '@splash/shared';
import { isAnimalId, isHatId } from '@splash/shared';
import type { Db } from './connection';
import { preparedStatements } from './prepared';

/** A player row in camelCase (the token hash never leaves the db layer). */
export interface PlayerRecord {
  id: string;
  nickname: string;
  tag: string;
  createdAt: number;
  xp: number;
  level: number;
  animal: AnimalId;
  hat: HatId;
  hasNickname: boolean;
  tutorialDone: boolean;
}

export interface NewPlayer {
  id: string;
  tokenHash: string;
  nickname: string;
  tag: string;
  createdAt: number;
  animal: AnimalId;
  hat: HatId;
}

interface PlayerRow {
  id: string;
  nickname: string;
  tag: string;
  created_at: number;
  xp: number;
  level: number;
  selected_animal: string;
  selected_hat: string;
  has_nickname: number;
  tutorial_done: number;
}

const PLAYER_COLUMNS = 'id, nickname, tag, created_at, xp, level, selected_animal, selected_hat, has_nickname, tutorial_done';

const statements = preparedStatements((db: Db) => ({
  insert: db.prepare<{ id: string; tokenHash: string; nickname: string; tag: string; createdAt: number; animal: string; hat: string }>(
    `INSERT INTO players (id, token_hash, nickname, tag, created_at, selected_animal, selected_hat)
     VALUES (@id, @tokenHash, @nickname, @tag, @createdAt, @animal, @hat)`,
  ),
  byId: db.prepare<[string], PlayerRow>(`SELECT ${PLAYER_COLUMNS} FROM players WHERE id = ?`),
  byTokenHash: db.prepare<[string], PlayerRow>(`SELECT ${PLAYER_COLUMNS} FROM players WHERE token_hash = ?`),
  nicknameTagTaken: db.prepare<[string, string], { taken: number }>(
    'SELECT 1 AS taken FROM players WHERE nickname = ? COLLATE NOCASE AND tag = ? LIMIT 1',
  ),
  tagsForNickname: db.prepare<[string], { tag: string }>('SELECT tag FROM players WHERE nickname = ? COLLATE NOCASE'),
  setNickname: db.prepare<[string, string, string]>('UPDATE players SET nickname = ?, tag = ?, has_nickname = 1 WHERE id = ?'),
  setCosmetics: db.prepare<[string, string, string]>('UPDATE players SET selected_animal = ?, selected_hat = ? WHERE id = ?'),
  markTutorialDone: db.prepare<[string]>('UPDATE players SET tutorial_done = 1 WHERE id = ? AND tutorial_done = 0'),
  setXp: db.prepare<[number, number, string]>('UPDATE players SET xp = ?, level = ? WHERE id = ?'),
}));

/** Stored animal id, falling back to the default if the catalogue ever drops an id a row still references. */
export function storedAnimal(value: string): AnimalId {
  return isAnimalId(value) ? value : 'frog';
}

/** Stored hat id, falling back to no hat for unknown ids. */
function storedHat(value: string): HatId {
  return isHatId(value) ? value : 'none';
}

function toPlayerRecord(row: PlayerRow): PlayerRecord {
  return {
    id: row.id,
    nickname: row.nickname,
    tag: row.tag,
    createdAt: row.created_at,
    xp: row.xp,
    level: row.level,
    animal: storedAnimal(row.selected_animal),
    hat: storedHat(row.selected_hat),
    hasNickname: row.has_nickname === 1,
    tutorialDone: row.tutorial_done === 1,
  };
}

/** Inserts a new player (xp 0, level 1, guest name). Throws on a duplicate id, token hash or nickname#tag. */
export function insertPlayer(db: Db, player: NewPlayer): void {
  statements(db).insert.run(player);
}

export function getPlayer(db: Db, playerId: string): PlayerRecord | null {
  const row = statements(db).byId.get(playerId);
  return row ? toPlayerRecord(row) : null;
}

export function findPlayerByTokenHash(db: Db, tokenHash: string): PlayerRecord | null {
  const row = statements(db).byTokenHash.get(tokenHash);
  return row ? toPlayerRecord(row) : null;
}

/** True if nickname#tag is already used by anyone (nickname compared case-insensitively). */
export function isNicknameTagTaken(db: Db, nickname: string, tag: string): boolean {
  return statements(db).nicknameTagTaken.get(nickname, tag) !== undefined;
}

/** Every tag in use with this nickname (case-insensitive), for picking a free one. */
export function takenTagsForNickname(db: Db, nickname: string): Set<string> {
  return new Set(statements(db).tagsForNickname.all(nickname).map((row) => row.tag));
}

/** Sets nickname#tag and marks the player as having chosen a nickname. */
export function setPlayerNickname(db: Db, playerId: string, nickname: string, tag: string): void {
  statements(db).setNickname.run(nickname, tag, playerId);
}

export function setPlayerCosmetics(db: Db, playerId: string, animal: AnimalId, hat: HatId): void {
  statements(db).setCosmetics.run(animal, hat, playerId);
}

/** Marks the tutorial done. Returns true only if this call changed it (first completion). */
export function markTutorialDone(db: Db, playerId: string): boolean {
  return statements(db).markTutorialDone.run(playerId).changes === 1;
}

/** Stores a player's lifetime XP total and the level it corresponds to. */
export function setPlayerXp(db: Db, playerId: string, xp: number, level: number): void {
  statements(db).setXp.run(xp, level, playerId);
}

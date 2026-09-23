// Typed queries for owned cosmetics.
import type { Db } from './connection';
import { preparedStatements } from './prepared';

const statements = preparedStatements((db: Db) => ({
  list: db.prepare<[string], { item_id: string }>(
    'SELECT item_id FROM unlocks WHERE player_id = ? ORDER BY unlocked_at ASC, rowid ASC',
  ),
  add: db.prepare<[string, string, number]>(
    'INSERT OR IGNORE INTO unlocks (player_id, item_id, unlocked_at) VALUES (?, ?, ?)',
  ),
}));

/** Cosmetic ids the player owns, in unlock order. */
export function getUnlocks(db: Db, playerId: string): string[] {
  return statements(db).list.all(playerId).map((row) => row.item_id);
}

/** Grants cosmetics; already-owned ids are ignored. Returns only the ids that were newly added. */
export function addUnlocks(db: Db, playerId: string, itemIds: readonly string[], unlockedAt: number): string[] {
  const { add } = statements(db);
  return db.transaction(() => itemIds.filter((itemId) => add.run(playerId, itemId, unlockedAt).changes === 1))();
}

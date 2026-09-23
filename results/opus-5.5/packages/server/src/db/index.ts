// Public surface of the persistence layer: `import { openDb, getPlayer, ... } from './db'`.
export { openDb, DB_FILE_NAME, type Db } from './connection';
export { runMigrations } from './migrate';
export { MIGRATIONS, type Migration } from './migrations';
export {
  findPlayerByTokenHash,
  getPlayer,
  insertPlayer,
  isNicknameTagTaken,
  markTutorialDone,
  setPlayerCosmetics,
  setPlayerNickname,
  setPlayerXp,
  takenTagsForNickname,
  type NewPlayer,
  type PlayerRecord,
} from './players';
export { getLeaderboard, getRating, getRatingInfos, upsertRating, type RatingRecord } from './ratings';
export { getRecentMatches, insertMatch, insertMatchPlayer, type MatchPlayerRecord, type MatchRecord } from './matches';
export { addUnlocks, getUnlocks } from './unlocks';

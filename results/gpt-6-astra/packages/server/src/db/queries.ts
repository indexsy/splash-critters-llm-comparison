import Database from "better-sqlite3";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CONFIG,
  levelProgress,
  rankTier,
  type Animal,
  type Hat,
  type LeaderboardEntry,
  type MatchResult,
  type Mode,
  type Profile,
  type Rating,
  type RecentMatch,
} from "@splash/shared";

interface PlayerRow {
  id: string;
  nickname: string;
  tag: string;
  xp: number;
  level: number;
  selected_animal: Animal;
  selected_hat: Hat;
  nickname_set: number;
  tutorial_complete: number;
}
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export class Store {
  readonly db: Database.Database;
  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, "splash.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
    );
    const dir = fileURLToPath(
      new URL("../../src/db/migrations/", import.meta.url),
    );
    // Source migrations are shipped with dist so boot works in both tsx and production.
    const sourceDir = dir.includes("/src/src/")
      ? fileURLToPath(new URL("./migrations/", import.meta.url))
      : dir;
    for (const file of readdirSync(sourceDir)
      .filter((f) => /^\d+.*\.sql$/.test(f))
      .sort()) {
      if (
        this.db
          .prepare("SELECT 1 FROM schema_migrations WHERE version=?")
          .get(file)
      )
        continue;
      this.db.transaction(() => {
        this.db.exec(readFileSync(path.join(sourceDir, file), "utf8"));
        this.db
          .prepare("INSERT INTO schema_migrations VALUES (?,?)")
          .run(file, Date.now());
      })();
    }
  }
  authenticate(provided?: string): { token: string; profile: Profile } {
    const token =
      provided &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        provided,
      )
        ? provided
        : randomUUID();
    const existing = this.db
      .prepare("SELECT id FROM players WHERE token_hash=?")
      .get(hash(token)) as { id: string } | undefined;
    if (existing) return { token, profile: this.profile(existing.id)! };
    const id = randomUUID();
    const nickname = [
      "SoggyOtter",
      "PuddleDuck",
      "MistyFrog",
      "SunnyCat",
      "SplashPanda",
    ][randomInt(5)];
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO players (id,token_hash,nickname,tag,created_at) VALUES (?,?,?,?,?)",
        )
        .run(id, hash(token), nickname, this.tag(nickname), Date.now());
      for (const mode of ["duel", "ffa"])
        this.db
          .prepare("INSERT INTO ratings (player_id,mode) VALUES (?,?)")
          .run(id, mode);
      this.syncUnlocks(id, 1);
    })();
    return { token, profile: this.profile(id)! };
  }
  private tag(nickname: string): string {
    for (let i = 0; i < 100; i++) {
      const tag = String(randomInt(1000, 10000));
      if (
        !this.db
          .prepare("SELECT 1 FROM players WHERE nickname=? AND tag=?")
          .get(nickname, tag)
      )
        return tag;
    }
    throw new Error("That name is very popular. Please try another.");
  }
  profile(id: string): Profile | null {
    const p = this.db
      .prepare(
        "SELECT id,nickname,tag,xp,level,selected_animal,selected_hat,nickname_set,tutorial_complete FROM players WHERE id=?",
      )
      .get(id) as PlayerRow | undefined;
    if (!p) return null;
    return {
      id: p.id,
      nickname: p.nickname,
      tag: p.tag,
      xp: p.xp,
      level: p.level,
      nicknameSet: !!p.nickname_set,
      selectedAnimal: p.selected_animal,
      selectedHat: p.selected_hat,
      tutorialComplete: !!p.tutorial_complete,
      ratings: this.db
        .prepare(
          "SELECT mode,rating,games,wins,peak FROM ratings WHERE player_id=? ORDER BY mode",
        )
        .all(id) as Rating[],
      unlocks: (
        this.db
          .prepare("SELECT item_id FROM unlocks WHERE player_id=?")
          .all(id) as { item_id: string }[]
      ).map((u) => u.item_id),
    };
  }
  nickname(id: string, value: string): Profile {
    const nickname = value.normalize("NFKC").trim();
    const normalized = nickname
      .toLowerCase()
      .replace(
        /[013457@$]/g,
        (c) =>
          ({
            "0": "o",
            "1": "i",
            "3": "e",
            "4": "a",
            "5": "s",
            "7": "t",
            "@": "a",
            $: "s",
          })[c]!,
      )
      .replace(/[^a-z]/g, "");
    if (!/^[a-zA-Z0-9_ ]{3,16}$/.test(nickname))
      throw new Error("Use 3-16 letters, numbers, spaces or underscores.");
    if (
      /fuck|shit|bitch|cunt|nigg|fagg|hitler|nazi|rape|porn|asshole/.test(
        normalized,
      )
    )
      throw new Error("Keep your nickname friendly.");
    const p = this.profile(id)!;
    this.db
      .prepare("UPDATE players SET nickname=?,tag=?,nickname_set=1 WHERE id=?")
      .run(nickname, nickname === p.nickname ? p.tag : this.tag(nickname), id);
    return this.profile(id)!;
  }
  equip(id: string, animal: Animal, hat: Hat): Profile {
    const profile = this.profile(id)!;
    if (!profile.unlocks.includes(animal) || !profile.unlocks.includes(hat))
      throw new Error("Reach the required level to unlock that look.");
    this.db
      .prepare("UPDATE players SET selected_animal=?,selected_hat=? WHERE id=?")
      .run(animal, hat, id);
    return this.profile(id)!;
  }
  private syncUnlocks(id: string, level: number): void {
    for (const item of [...CONFIG.ANIMALS, ...CONFIG.HATS])
      if (item.level <= level)
        this.db
          .prepare("INSERT OR IGNORE INTO unlocks VALUES (?,?,?)")
          .run(id, item.id, Date.now());
  }
  private addXp(id: string, earned: number): void {
    this.db.prepare("UPDATE players SET xp=xp+? WHERE id=?").run(earned, id);
    const xp = (
      this.db.prepare("SELECT xp FROM players WHERE id=?").get(id) as {
        xp: number;
      }
    ).xp;
    const level = levelProgress(xp).level;
    this.db.prepare("UPDATE players SET level=? WHERE id=?").run(level, id);
    this.syncUnlocks(id, level);
  }
  tutorial(id: string): Profile {
    this.db.transaction(() => {
      if (
        this.db
          .prepare(
            "UPDATE players SET tutorial_complete=1 WHERE id=? AND tutorial_complete=0",
          )
          .run(id).changes
      )
        this.addXp(id, CONFIG.XP.tutorial);
    })();
    return this.profile(id)!;
  }
  saveMatch(result: MatchResult, startedAt: number): void {
    this.db.transaction(() => {
      if (
        this.db.prepare("SELECT 1 FROM matches WHERE id=?").get(result.matchId)
      )
        return;
      this.db
        .prepare("INSERT INTO matches VALUES (?,?,?,?,?)")
        .run(
          result.matchId,
          result.mode,
          +result.ranked,
          startedAt,
          Date.now(),
        );
      for (const p of result.placements) {
        if (!this.profile(p.playerId)) continue;
        const rating = result.ratingDeltas[p.playerId];
        const xp = result.xp[p.playerId] ?? 0;
        this.db
          .prepare("INSERT INTO match_players VALUES (?,?,?,?,?,?,?,?)")
          .run(
            result.matchId,
            p.playerId,
            p.placement,
            p.soaks,
            p.roundsWon,
            rating?.before ?? null,
            rating?.after ?? null,
            xp,
          );
        if (rating)
          this.db
            .prepare(
              "UPDATE ratings SET rating=?, games=games+1, wins=wins+?, peak=MAX(peak,?) WHERE player_id=? AND mode=?",
            )
            .run(
              rating.after,
              +(p.placement === 1 && !p.forfeited),
              rating.after,
              p.playerId,
              result.mode,
            );
        this.addXp(p.playerId, xp);
      }
    })();
  }
  leaderboard(mode: Mode): LeaderboardEntry[] {
    const rows = this.db
      .prepare(
        "SELECT p.id playerId,p.nickname||'#'||p.tag nickname,p.selected_animal animal,r.rating,r.games,r.wins FROM ratings r JOIN players p ON p.id=r.player_id WHERE r.mode=? AND r.games>0 ORDER BY r.rating DESC,r.wins DESC,p.created_at ASC LIMIT 100",
      )
      .all(mode) as (LeaderboardEntry & { wins: number })[];
    return rows.map((row, i) => ({
      rank: i + 1,
      playerId: row.playerId,
      nickname: row.nickname,
      animal: row.animal,
      rating: row.rating,
      games: row.games,
      tier: rankTier(row.rating).name,
      winrate: row.games ? Math.round((100 * row.wins) / row.games) : 0,
    }));
  }
  recentMatches(id: string): RecentMatch[] {
    const rows = this.db
      .prepare(
        "SELECT m.id,m.mode,m.ranked,m.ended_at endedAt,mp.placement,mp.soaks,mp.rating_before ratingBefore,mp.rating_after ratingAfter,mp.xp_earned xpEarned FROM match_players mp JOIN matches m ON m.id=mp.match_id WHERE mp.player_id=? ORDER BY m.ended_at DESC LIMIT 20",
      )
      .all(id) as RecentMatch[];
    return rows.map((r) => ({ ...r, ranked: !!r.ranked }));
  }
  close(): void {
    this.db.close();
  }
}

import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "./queries.js";
it("migrates, persists hashed guest identities, validates names, and grants tutorial XP once", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "splash-db-"));
  let store = new Store(dir);
  try {
    const token = randomUUID();
    const a = store.authenticate(token);
    const b = store.authenticate(token);
    expect(a.profile.id).toBe(b.profile.id);
    expect(a.token).toBe(token);
    const row = store.db
      .prepare("SELECT token_hash FROM players WHERE id=?")
      .get(a.profile.id) as { token_hash: string };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toHaveLength(64);
    expect(JSON.stringify(store.profile(a.profile.id))).not.toContain(
      row.token_hash,
    );
    expect(() => store.nickname(a.profile.id, "<script>")).toThrow();
    expect(() => store.nickname(a.profile.id, "Sh1t")).toThrow();
    expect(store.nickname(a.profile.id, "SunnyCritter").nicknameSet).toBe(true);
    expect(() => store.equip(a.profile.id, "capybara", "crown")).toThrow();
    expect(store.equip(a.profile.id, "duck", "none").selectedAnimal).toBe(
      "duck",
    );
    expect(store.tutorial(a.profile.id).xp).toBe(50);
    expect(store.tutorial(a.profile.id).xp).toBe(50);
    store.close();
    store = new Store(dir);
    expect(store.authenticate(token).profile.nickname).toBe("SunnyCritter");
    expect(store.db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(
      store.db.prepare("SELECT COUNT(*) n FROM schema_migrations").get(),
    ).toEqual({ n: 1 });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

import type Database from "better-sqlite3";
import type { Profile } from "@splash/shared";

export interface DbApi {
  raw: Database.Database;
  loadProfile: (id: string) => Profile | null;
}

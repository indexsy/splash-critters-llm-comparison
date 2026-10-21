import Database from 'better-sqlite3'
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export type DB = Database.Database

function findMigrationsDir(explicit?: string): string {
  if (explicit) return explicit
  const here = dirname(fileURLToPath(import.meta.url))
  for (const cand of [join(here, '../../migrations'), join(here, '../../../../migrations')]) {
    if (existsSync(cand)) return cand
  }
  return 'migrations'
}

export function openDb(dataDir?: string): DB {
  const dir = dataDir ?? process.env.DATA_DIR ?? '.'
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const db = new Database(join(dir, 'splash.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export function runMigrations(db: DB, migrationsDir?: string): number {
  const dir = findMigrationsDir(migrationsDir)
  const userV = db.pragma('user_version', { simple: true }) as number
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  let applied = 0
  const tx = db.transaction((f: string, v: number) => {
    db.exec(readFileSync(join(dir, f), 'utf8'))
    db.pragma(`user_version = ${v}`)
  })
  files.forEach((f, i) => {
    const v = i + 1
    if (v <= userV) return
    tx(f, v)
    applied++
  })
  return applied
}

export function migrate(db: DB): number {
  return runMigrations(db)
}

export function ensureSchema(db: DB, migrationsDir?: string): number {
  return runMigrations(db, migrationsDir)
}

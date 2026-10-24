import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;
export type DbHandle = { db: Db; sqlite: Database.Database };

const candidateParent = fileURLToPath(new URL('../drizzle', import.meta.url));
const MIGRATIONS_FOLDER = existsSync(candidateParent)
  ? candidateParent
  : fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Default file location; `/var/lib/habait/habait.db` in production via DB_PATH. */
export const resolveDbPath = (): string => process.env['DB_PATH'] ?? './data/habait.db';

/**
 * Opens (creating if needed) the SQLite database and applies the mandatory pragmas.
 * Pass `:memory:` for throwaway DBs (WAL is not available there; SQLite reports `memory`).
 */
export function createDb(path: string = resolveDbPath()): DbHandle {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return { db: drizzle(sqlite, { schema }), sqlite };
}

/** Applies pending SQL migrations from `packages/server/drizzle`. */
export function migrateDb({ db }: DbHandle, migrationsFolder: string = MIGRATIONS_FOLDER): void {
  migrate(db, { migrationsFolder });
}

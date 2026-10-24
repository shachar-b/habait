import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DbHandle } from '../src/db/connection.js';
import * as schema from '../src/db/schema.js';

const EXPECTED_TABLES = [
  'app_settings',
  'one_off_tasks',
  'peer_requests',
  'pool_task_executions',
  'pool_tasks',
  'routine_daily_logs',
  'routine_templates',
  'star_transactions',
  'users',
];

let dir: string;
let handle: DbHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'habait-'));
  handle = createDb(join(dir, 'test.db'));
  migrateDb(handle);
});

afterEach(() => {
  handle.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const pragma = (name: string) => handle.sqlite.pragma(name, { simple: true });
const now = 1_700_000_000_000;

const addParent = () =>
  handle.db
    .insert(schema.users)
    .values({ name: 'אבא', avatarEmoji: '🦸', avatarBgColor: 'bg-sky-200', role: 'PARENT', pinHash: 'x', createdAt: now })
    .returning({ id: schema.users.id })
    .get().id;

const addChild = (name: string) =>
  handle.db
    .insert(schema.users)
    .values({ name, avatarEmoji: '🦁', avatarBgColor: 'bg-amber-200', role: 'CHILD', createdAt: now })
    .returning({ id: schema.users.id })
    .get().id;

describe('connection pragmas', () => {
  it('activates WAL, NORMAL sync, foreign keys and busy timeout', () => {
    expect(pragma('journal_mode')).toBe('wal');
    expect(pragma('synchronous')).toBe(1); // NORMAL
    expect(pragma('foreign_keys')).toBe(1);
    expect(pragma('busy_timeout')).toBe(5000);
  });
});

describe('migration', () => {
  it('creates every domain table', () => {
    const rows = handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '%drizzle%' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(EXPECTED_TABLES);
  });
});

describe('database-level safety nets', () => {
  it('rejects a PARENT without a PIN hash', () => {
    expect(() =>
      handle.db
        .insert(schema.users)
        .values({ name: 'x', avatarEmoji: '🙂', avatarBgColor: 'bg-red-200', role: 'PARENT', createdAt: now })
        .run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('allows a CHILD without a PIN hash', () => {
    expect(() => addChild('נועה')).not.toThrow();
  });

  it('enforces the singleton app_settings row', () => {
    expect(() => handle.db.insert(schema.appSettings).values({ id: 2, updatedAt: now }).run()).toThrow(/CHECK constraint failed/);
    expect(() => handle.db.insert(schema.appSettings).values({ id: 1, updatedAt: now }).run()).not.toThrow();
  });

  it('rejects foreign keys that point nowhere', () => {
    expect(() =>
      handle.db
        .insert(schema.oneOffTasks)
        .values({ assigneeId: 99, createdById: 99, title: 't', iconEmoji: '🧹', status: 'PENDING', issuedDate: '2026-10-25', issuedAt: now })
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('keeps one routine log per routine per day', () => {
    const parent = addParent();
    const kid = addChild('דנה');
    const routineId = handle.db
      .insert(schema.routineTemplates)
      .values({ assigneeId: kid, title: 'צחצוח שיניים', iconEmoji: '🪥', timeWindow: 'MORNING', daysOfWeekJson: '[0,1,2,3,4,5]', createdBy: parent, createdAt: now })
      .returning({ id: schema.routineTemplates.id })
      .get().id;
    const log = { routineId, assigneeId: kid, titleSnapshot: 't', iconEmojiSnapshot: '🪥', timeWindowSnapshot: 'MORNING' as const, logicalDate: '2026-10-25', status: 'MISSED' as const };
    handle.db.insert(schema.routineDailyLogs).values(log).run();
    expect(() => handle.db.insert(schema.routineDailyLogs).values(log).run()).toThrow(/UNIQUE constraint failed/);
  });

  it('enforces the 1-WIP pool claim limit per user', () => {
    const parent = addParent();
    const kid = addChild('יובל');
    const task = (title: string) => ({ title, iconEmoji: '🧺', stars: 1, resetMode: 'COOLDOWN' as const, createdById: parent });
    const claimed = { state: 'CLAIMED' as const, claimedByUserId: kid, claimedAt: now, claimExpiresAt: now + 3_600_000 };
    handle.db.insert(schema.poolTasks).values({ ...task('a'), ...claimed }).run();
    expect(() => handle.db.insert(schema.poolTasks).values({ ...task('b'), ...claimed }).run()).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects a CLAIMED pool task without claim data', () => {
    const parent = addParent();
    expect(() =>
      handle.db.insert(schema.poolTasks).values({ title: 'a', iconEmoji: '🧺', stars: 1, resetMode: 'COOLDOWN', state: 'CLAIMED', createdById: parent }).run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('rejects a peer request to oneself and negative stars', () => {
    const parent = addParent();
    const kid = addChild('גל');
    expect(() =>
      handle.db.insert(schema.peerRequests).values({ requesterId: kid, recipientId: kid, title: 't', status: 'PENDING', issuedDate: '2026-10-25', issuedAt: now }).run(),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      handle.db.insert(schema.oneOffTasks).values({ assigneeId: kid, createdById: parent, title: 't', iconEmoji: '🧹', stars: -1, status: 'PENDING', issuedDate: '2026-10-25', issuedAt: now }).run(),
    ).toThrow(/CHECK constraint failed/);
  });

  it('derives star balance from the ledger', () => {
    const kid = addChild('רוני');
    const tx = (starsDelta: number, sourceType: 'ONE_OFF' | 'REVERT') =>
      handle.db.insert(schema.starTransactions).values({ userId: kid, sourceType, sourceId: 1, starsDelta, description: 't', logicalDate: '2026-10-25', createdAt: now }).run();
    tx(3, 'ONE_OFF');
    tx(-3, 'REVERT');
    tx(2, 'ONE_OFF');
    const row = handle.sqlite.prepare('SELECT SUM(stars_delta) AS total FROM star_transactions WHERE user_id = ?').get(kid) as { total: number };
    expect(row.total).toBe(2);
  });
});

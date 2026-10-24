import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DbHandle } from '../../src/db/connection.js';
import * as schema from '../../src/db/schema.js';
import { DomainError, DomainValidationError } from '../../src/errors.js';
import {
  authenticateUser,
  createUser,
  getAppSettings,
  getLobbyData,
  signSessionToken,
  updateAppSettings,
  updateUser,
  verifySessionToken,
} from '../../src/services/user.service.js';

let handle: DbHandle;
// Sunday 2026-10-25 09:00 Asia/Jerusalem (dayOfWeek = 0)
const NOW = Date.parse('2026-10-25T09:00:00+02:00');

beforeEach(() => {
  handle = createDb(':memory:');
  migrateDb(handle);
});

describe('user.service — creation & PIN enforcement', () => {
  it('creates a PARENT when a valid 4-digit PIN is provided and hashes it', () => {
    const parent = createUser(
      handle.db,
      {
        name: 'אמא',
        avatarEmoji: '🦸‍♀️',
        avatarBgColor: 'bg-emerald-200',
        role: 'PARENT',
        pin: '1234',
      },
      NOW,
    );
    expect(parent.id).toBeGreaterThan(0);
    expect(parent.role).toBe('PARENT');
    expect(parent.hasPin).toBe(true);
    expect('pinHash' in parent).toBe(false);

    const row = handle.db.select().from(schema.users).get();
    expect(row?.pinHash).toBeTruthy();
    expect(row?.pinHash).not.toBe('1234');
  });

  it('throws DomainValidationError when creating a PARENT with empty/null/invalid PIN', () => {
    expect(() =>
      createUser(
        handle.db,
        // @ts-expect-error testing runtime enforcement of missing PIN on PARENT
        { name: 'אבא', avatarEmoji: '🦁', avatarBgColor: 'bg-sky-200', role: 'PARENT', pin: null },
        NOW,
      ),
    ).toThrow(DomainValidationError);

    expect(() =>
      createUser(
        handle.db,
        { name: 'אבא', avatarEmoji: '🦁', avatarBgColor: 'bg-sky-200', role: 'PARENT', pin: '' },
        NOW,
      ),
    ).toThrow(DomainValidationError);
  });

  it('creates a CHILD with or without a PIN', () => {
    const childNoPin = createUser(
      handle.db,
      { name: 'נועה', avatarEmoji: '🦄', avatarBgColor: 'bg-pink-200', role: 'CHILD' },
      NOW,
    );
    expect(childNoPin.hasPin).toBe(false);

    const childWithPin = createUser(
      handle.db,
      { name: 'יובל', avatarEmoji: '🦖', avatarBgColor: 'bg-amber-200', role: 'CHILD', pin: '5678' },
      NOW,
    );
    expect(childWithPin.hasPin).toBe(true);
  });

  it('forbids removing a PARENT PIN or promoting a PIN-less CHILD to PARENT without a PIN', () => {
    const parent = createUser(
      handle.db,
      { name: 'אמא', avatarEmoji: '🦸‍♀️', avatarBgColor: 'bg-emerald-200', role: 'PARENT', pin: '1234' },
      NOW,
    );
    expect(() => updateUser(handle.db, parent.id, { pin: null })).toThrow(DomainValidationError);

    const child = createUser(
      handle.db,
      { name: 'נועה', avatarEmoji: '🦄', avatarBgColor: 'bg-pink-200', role: 'CHILD', pin: '4321' },
      NOW,
    );
    const updatedChild = updateUser(handle.db, child.id, { pin: null });
    expect(updatedChild.hasPin).toBe(false);

    expect(() => updateUser(handle.db, child.id, { role: 'PARENT' })).toThrow(DomainValidationError);
  });
});

describe('user.service — authentication & session tokens', () => {
  it('authenticates a PIN-less CHILD without a PIN and rejects wrong PIN when PIN is set', () => {
    const parent = createUser(
      handle.db,
      { name: 'אמא', avatarEmoji: '🦸‍♀️', avatarBgColor: 'bg-emerald-200', role: 'PARENT', pin: '1234' },
      NOW,
    );
    const childNoPin = createUser(
      handle.db,
      { name: 'נועה', avatarEmoji: '🦄', avatarBgColor: 'bg-pink-200', role: 'CHILD' },
      NOW,
    );

    const childLogin = authenticateUser(handle.db, { userId: childNoPin.id }, NOW);
    expect(childLogin.user.id).toBe(childNoPin.id);
    expect(verifySessionToken(childLogin.token)).toEqual({
      userId: childNoPin.id,
      role: 'CHILD',
      issuedAt: NOW,
    });

    expect(() => authenticateUser(handle.db, { userId: parent.id }, NOW)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PIN' }),
    );
    expect(() => authenticateUser(handle.db, { userId: parent.id, pin: '9999' }, NOW)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PIN' }),
    );

    const parentLogin = authenticateUser(handle.db, { userId: parent.id, pin: '1234' }, NOW);
    expect(parentLogin.user.id).toBe(parent.id);
    expect(verifySessionToken(parentLogin.token)?.role).toBe('PARENT');
  });

  it('fails closed in production when SESSION_SECRET is unset (no forgeable default secret)', () => {
    const saved = { env: process.env['NODE_ENV'], secret: process.env['SESSION_SECRET'] };
    process.env['NODE_ENV'] = 'production';
    delete process.env['SESSION_SECRET'];
    try {
      expect(() => signSessionToken({ userId: 1, role: 'PARENT', issuedAt: NOW })).toThrow(
        /SESSION_SECRET/,
      );
      expect(() => verifySessionToken('a.b')).toThrow(/SESSION_SECRET/);
    } finally {
      process.env['NODE_ENV'] = saved.env;
      if (saved.secret !== undefined) process.env['SESSION_SECRET'] = saved.secret;
    }
  });

  it('rejects tampered session tokens', () => {
    const token = signSessionToken({ userId: 1, role: 'PARENT', issuedAt: NOW });
    expect(verifySessionToken(token)).toEqual({ userId: 1, role: 'PARENT', issuedAt: NOW });
    expect(verifySessionToken(`${token}tamper`)).toBeNull();
    expect(verifySessionToken('invalid.token')).toBeNull();
  });
});

describe('user.service — lobby summary & settings', () => {
  it('computes hasOpenTasks boolean across routines, one-offs, pool claims, and peer requests without leaking counts', () => {
    const parent = createUser(
      handle.db,
      { name: 'אמא', avatarEmoji: '🦸‍♀️', avatarBgColor: 'bg-emerald-200', role: 'PARENT', pin: '1234' },
      NOW,
    );
    const child1 = createUser(
      handle.db,
      { name: 'נועה', avatarEmoji: '🦄', avatarBgColor: 'bg-pink-200', role: 'CHILD' },
      NOW,
    );
    const child2 = createUser(
      handle.db,
      { name: 'יובל', avatarEmoji: '🦖', avatarBgColor: 'bg-amber-200', role: 'CHILD' },
      NOW,
    );

    // Initially nobody has open tasks
    let lobby = getLobbyData(handle.db, NOW);
    expect(lobby.appSettings.appTitle).toBe('הבית שלנו');
    expect(lobby.profiles.find((p) => p.id === child1.id)?.hasOpenTasks).toBe(false);

    // 1. Add a routine scheduled for Sunday (0) for child1 -> hasOpenTasks = true
    const routine = handle.db
      .insert(schema.routineTemplates)
      .values({
        assigneeId: child1.id,
        title: 'צחצוח שיניים',
        iconEmoji: '🪥',
        timeWindow: 'MORNING',
        daysOfWeekJson: '[0]',
        createdBy: parent.id,
        createdAt: NOW,
      })
      .returning()
      .get();

    lobby = getLobbyData(handle.db, NOW);
    const c1Card = lobby.profiles.find((p) => p.id === child1.id)!;
    expect(c1Card.hasOpenTasks).toBe(true);
    expect('openTasksCount' in c1Card).toBe(false);

    // Complete that routine for today -> hasOpenTasks becomes false
    handle.db
      .insert(schema.routineDailyLogs)
      .values({
        routineId: routine.id,
        assigneeId: child1.id,
        titleSnapshot: routine.title,
        iconEmojiSnapshot: routine.iconEmoji,
        timeWindowSnapshot: routine.timeWindow,
        logicalDate: '2026-10-25',
        status: 'COMPLETED',
        completedAt: NOW,
      })
      .run();

    expect(getLobbyData(handle.db, NOW).profiles.find((p) => p.id === child1.id)?.hasOpenTasks).toBe(false);

    // 2. Pending one-off task for child2 -> hasOpenTasks = true
    handle.db
      .insert(schema.oneOffTasks)
      .values({
        assigneeId: child2.id,
        createdById: parent.id,
        title: 'סידור חדר',
        iconEmoji: '🧹',
        stars: 3,
        status: 'PENDING',
        issuedDate: '2026-10-25',
        issuedAt: NOW,
      })
      .run();
    expect(getLobbyData(handle.db, NOW).profiles.find((p) => p.id === child2.id)?.hasOpenTasks).toBe(true);

    // 3. Pending peer request for parent -> hasOpenTasks = true
    handle.db
      .insert(schema.peerRequests)
      .values({
        requesterId: child1.id,
        recipientId: parent.id,
        title: 'עזרה בשיעורים',
        iconEmoji: '📚',
        status: 'PENDING',
        issuedDate: '2026-10-25',
        issuedAt: NOW,
      })
      .run();
    expect(getLobbyData(handle.db, NOW).profiles.find((p) => p.id === parent.id)?.hasOpenTasks).toBe(true);

    // 4. Stars total reflected on lobby card
    handle.db
      .insert(schema.starTransactions)
      .values({
        userId: child1.id,
        sourceType: 'ONE_OFF',
        sourceId: 1,
        starsDelta: 5,
        description: 'בונוס',
        logicalDate: '2026-10-25',
        createdAt: NOW,
      })
      .run();
    expect(getLobbyData(handle.db, NOW).profiles.find((p) => p.id === child1.id)?.totalStars).toBe(5);
  });

  it('updates app settings and announcement banner', () => {
    const parent = createUser(
      handle.db,
      { name: 'אמא', avatarEmoji: '🦸‍♀️', avatarBgColor: 'bg-emerald-200', role: 'PARENT', pin: '1234' },
      NOW,
    );
    const updated = updateAppSettings(
      handle.db,
      { appTitle: 'משפחת כהן', announcementText: 'ערב פיצה היום!', announcementEmoji: '🍕' },
      parent.id,
      NOW,
    );
    expect(updated.appTitle).toBe('משפחת כהן');
    expect(updated.announcementText).toBe('ערב פיצה היום!');
    expect(updated.announcementEmoji).toBe('🍕');
    expect(getAppSettings(handle.db, NOW).appTitle).toBe('משפחת כהן');
  });
});

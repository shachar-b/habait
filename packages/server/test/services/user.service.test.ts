import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DbHandle } from '../../src/db/connection.js';
import * as schema from '../../src/db/schema.js';
import { DomainError, DomainValidationError } from '../../src/errors.js';
import {
  authenticateUser,
  createUser,
  deleteUser,
  getAppSettings,
  getLobbyData,
  signSessionToken,
  updateAppSettings,
  updateOwnProfile,
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

describe('user.service - PIN brute-force throttling', () => {
  it('locks a profile after 5 wrong PINs, rejects even the right PIN while locked, then unlocks', () => {
    const parent = createUser(
      handle.db,
      { name: 'אבא', avatarEmoji: '🧔', avatarBgColor: 'bg-sky-200', role: 'PARENT', pin: '1234' },
      NOW,
    );
    for (let i = 0; i < 5; i++) {
      expect(() => authenticateUser(handle.db, { userId: parent.id, pin: '0000' }, NOW)).toThrowError(
        expect.objectContaining({ code: 'INVALID_PIN' }),
      );
    }
    expect(() => authenticateUser(handle.db, { userId: parent.id, pin: '1234' }, NOW + 1_000)).toThrowError(
      expect.objectContaining({ code: 'TOO_MANY_ATTEMPTS', statusCode: 429 }),
    );
    expect(authenticateUser(handle.db, { userId: parent.id, pin: '1234' }, NOW + 5 * 60_000).user.id).toBe(
      parent.id,
    );

    // Re-trigger 5 wrong PIN attempts -> locked out
    for (let i = 0; i < 5; i++) {
      expect(() => authenticateUser(handle.db, { userId: parent.id, pin: '0000' }, NOW)).toThrowError(
        expect.objectContaining({ code: 'INVALID_PIN' }),
      );
    }
    expect(() => authenticateUser(handle.db, { userId: parent.id, pin: '1234' }, NOW + 1_000)).toThrowError(
      expect.objectContaining({ code: 'TOO_MANY_ATTEMPTS', statusCode: 429 }),
    );

    // Admin resets PIN via updateUser -> lockout clears immediately
    updateUser(handle.db, parent.id, { pin: '4321' });
    expect(authenticateUser(handle.db, { userId: parent.id, pin: '4321' }, NOW + 1_000).user.id).toBe(
      parent.id,
    );
  });
});

describe('user.service — self-service profile (updateOwnProfile) & nickname', () => {
  it('stores and updates nickname, normalizing whitespace to null, and includes nickname in lobby', () => {
    const child = createUser(
      handle.db,
      {
        name: 'נועה',
        nickname: 'נועה המלכה',
        avatarEmoji: '🦄',
        avatarBgColor: 'bg-rose-200',
        role: 'CHILD',
      },
      NOW,
    );
    expect(child.nickname).toBe('נועה המלכה');
    const lobby = getLobbyData(handle.db, NOW);
    expect(lobby.profiles.find((p) => p.id === child.id)?.nickname).toBe('נועה המלכה');

    const cleared = updateOwnProfile(handle.db, child.id, { nickname: '   ' });
    expect(cleared.nickname).toBeNull();
  });

  it('allows any user to update their own nickname, compound emoji, bgColor, and PIN, while blocking PARENT from removing PIN', () => {
    const parent = createUser(
      handle.db,
      { name: 'אמא', avatarEmoji: '🦸‍♀️', avatarBgColor: 'bg-emerald-200', role: 'PARENT', pin: '1234' },
      NOW,
    );
    const child = createUser(
      handle.db,
      { name: 'יובל', avatarEmoji: '🦖', avatarBgColor: 'bg-amber-200', role: 'CHILD' },
      NOW,
    );

    const updatedChild = updateOwnProfile(handle.db, child.id, {
      nickname: 'שוער העל',
      avatarEmoji: '🧑‍🚀',
      avatarBgColor: 'bg-sky-200',
      pin: '5555',
    });
    expect(updatedChild.name).toBe('יובל');
    expect(updatedChild.nickname).toBe('שוער העל');
    expect(updatedChild.avatarEmoji).toBe('🧑‍🚀');
    expect(updatedChild.avatarBgColor).toBe('bg-sky-200');
    expect(updatedChild.hasPin).toBe(true);
    expect(authenticateUser(handle.db, { userId: child.id, pin: '5555' }, NOW).user.id).toBe(child.id);

    const removedChildPin = updateOwnProfile(handle.db, child.id, { pin: null });
    expect(removedChildPin.hasPin).toBe(false);

    const updatedParent = updateOwnProfile(handle.db, parent.id, { pin: '9876', nickname: 'הבוסית' });
    expect(updatedParent.nickname).toBe('הבוסית');
    expect(authenticateUser(handle.db, { userId: parent.id, pin: '9876' }, NOW).user.id).toBe(parent.id);

    expect(() => updateOwnProfile(handle.db, parent.id, { pin: null })).toThrow(DomainValidationError);
  });
});

describe('user.service — hard-delete cascade (deleteUser)', () => {
  it('hard-deletes a child and purges their routines, logs, one-offs, pool claims/executions, peer requests, and stars', () => {
    const parent = createUser(
      handle.db,
      { name: 'אמא', avatarEmoji: '🦸‍♀️', avatarBgColor: 'bg-emerald-200', role: 'PARENT', pin: '1234' },
      NOW,
    );
    const noa = createUser(
      handle.db,
      { name: 'נועה', avatarEmoji: '🦄', avatarBgColor: 'bg-rose-200', role: 'CHILD' },
      NOW,
    );
    const yuval = createUser(
      handle.db,
      { name: 'יובל', avatarEmoji: '🦖', avatarBgColor: 'bg-amber-200', role: 'CHILD' },
      NOW,
    );

    const routine = handle.db
      .insert(schema.routineTemplates)
      .values({
        assigneeId: noa.id,
        title: 'צחצוח שיניים',
        iconEmoji: '🪥',
        timeWindow: 'MORNING',
        daysOfWeekJson: '[0,1,2]',
        createdBy: parent.id,
        createdAt: NOW,
      })
      .returning()
      .get();

    handle.db
      .insert(schema.routineDailyLogs)
      .values({
        routineId: routine.id,
        assigneeId: noa.id,
        titleSnapshot: routine.title,
        iconEmojiSnapshot: routine.iconEmoji,
        timeWindowSnapshot: routine.timeWindow,
        logicalDate: '2026-10-25',
        status: 'COMPLETED',
        completedAt: NOW,
      })
      .run();

    handle.db
      .insert(schema.oneOffTasks)
      .values({
        assigneeId: noa.id,
        createdById: parent.id,
        title: 'סידור מדף',
        iconEmoji: '📖',
        stars: 3,
        status: 'PENDING',
        issuedDate: '2026-10-25',
        issuedAt: NOW,
      })
      .run();

    const poolTask = handle.db
      .insert(schema.poolTasks)
      .values({
        title: 'פינוי מדיח',
        iconEmoji: '🍽️',
        stars: 3,
        resetMode: 'COOLDOWN',
        cooldownMinutes: 60,
        isActive: true,
        state: 'CLAIMED',
        claimedByUserId: noa.id,
        claimedAt: NOW,
        claimExpiresAt: NOW + 3_600_000,
        createdById: parent.id,
      })
      .returning()
      .get();

    handle.db
      .insert(schema.poolTaskExecutions)
      .values({
        poolTaskId: poolTask.id,
        userId: noa.id,
        titleSnapshot: poolTask.title,
        iconEmojiSnapshot: poolTask.iconEmoji,
        starsAwarded: 3,
        claimedAt: NOW - 1000,
        completedAt: NOW,
        logicalDate: '2026-10-25',
      })
      .run();

    handle.db
      .insert(schema.peerRequests)
      .values({
        requesterId: noa.id,
        recipientId: yuval.id,
        title: 'עזרה בלגו',
        iconEmoji: '🧱',
        status: 'PENDING',
        issuedDate: '2026-10-25',
        issuedAt: NOW,
      })
      .run();

    handle.db
      .insert(schema.starTransactions)
      .values({
        userId: noa.id,
        sourceType: 'POOL',
        sourceId: 1,
        starsDelta: 3,
        description: 'פינוי מדיח',
        logicalDate: '2026-10-25',
        createdAt: NOW,
      })
      .run();

    deleteUser(handle.db, noa.id, parent.id);

    expect(handle.db.select().from(schema.users).all().map((u) => u.id)).toEqual([parent.id, yuval.id]);
    const refreshedPool = handle.db.select().from(schema.poolTasks).get()!;
    expect(refreshedPool.state).toBe('AVAILABLE');
    expect(refreshedPool.claimedByUserId).toBeNull();
    expect(handle.db.select().from(schema.routineTemplates).all()).toHaveLength(0);
    expect(handle.db.select().from(schema.routineDailyLogs).all()).toHaveLength(0);
    expect(handle.db.select().from(schema.oneOffTasks).all()).toHaveLength(0);
    expect(handle.db.select().from(schema.poolTaskExecutions).all()).toHaveLength(0);
    expect(handle.db.select().from(schema.peerRequests).all()).toHaveLength(0);
    expect(handle.db.select().from(schema.starTransactions).all()).toHaveLength(0);
  });

  it('reassigns authored tasks when deleting a secondary parent, and blocks self-delete or deleting the last parent', () => {
    const p1 = createUser(
      handle.db,
      { name: 'אמא', avatarEmoji: '🦸‍♀️', avatarBgColor: 'bg-emerald-200', role: 'PARENT', pin: '1234' },
      NOW,
    );
    const p2 = createUser(
      handle.db,
      { name: 'אבא', avatarEmoji: '🦁', avatarBgColor: 'bg-sky-200', role: 'PARENT', pin: '1234' },
      NOW,
    );
    const child = createUser(
      handle.db,
      { name: 'יובל', avatarEmoji: '🦖', avatarBgColor: 'bg-amber-200', role: 'CHILD' },
      NOW,
    );

    updateAppSettings(handle.db, { announcementText: 'שלום' }, p2.id, NOW);
    handle.db
      .insert(schema.poolTasks)
      .values({
        title: 'מיחזור',
        iconEmoji: '♻️',
        stars: 2,
        resetMode: 'COOLDOWN',
        cooldownMinutes: 60,
        isActive: true,
        state: 'AVAILABLE',
        createdById: p2.id,
      })
      .run();
    handle.db
      .insert(schema.oneOffTasks)
      .values({
        assigneeId: child.id,
        createdById: p2.id,
        title: 'אופניים',
        iconEmoji: '🚲',
        stars: 4,
        status: 'PENDING',
        issuedDate: '2026-10-25',
        issuedAt: NOW,
      })
      .run();

    // Cannot delete oneself
    expect(() => deleteUser(handle.db, p1.id, p1.id)).toThrow(DomainValidationError);

    // p1 deletes p2 -> authored pool & one-off tasks reassigned to p1
    deleteUser(handle.db, p2.id, p1.id);
    expect(handle.db.select().from(schema.poolTasks).get()?.createdById).toBe(p1.id);
    expect(handle.db.select().from(schema.oneOffTasks).get()?.createdById).toBe(p1.id);
    expect(getAppSettings(handle.db, NOW).announcementUpdatedBy).toBeNull();

    // Now p1 is the last parent -> cannot be deleted even by another actor id
    expect(() => deleteUser(handle.db, p1.id, child.id)).toThrow(DomainValidationError);
  });

  it('prevents demoting or deactivating the last active PARENT in updateUser', () => {
    const p1 = createUser(
      handle.db,
      { name: 'אמא', avatarEmoji: '🦸‍♀️', avatarBgColor: 'bg-emerald-200', role: 'PARENT', pin: '1234' },
      NOW,
    );
    const p2 = createUser(
      handle.db,
      { name: 'אבא', avatarEmoji: '🦁', avatarBgColor: 'bg-sky-200', role: 'PARENT', pin: '1234' },
      NOW,
    );

    // Demoting p2 succeeds while p1 is still an active PARENT
    const demotedP2 = updateUser(handle.db, p2.id, { role: 'CHILD' });
    expect(demotedP2.role).toBe('CHILD');

    // Now p1 is the last active PARENT -> demoting p1 to CHILD or deactivating p1 must throw DomainValidationError
    expect(() => updateUser(handle.db, p1.id, { role: 'CHILD' })).toThrow(DomainValidationError);
    expect(() => updateUser(handle.db, p1.id, { isActive: false })).toThrow(DomainValidationError);
  });
});

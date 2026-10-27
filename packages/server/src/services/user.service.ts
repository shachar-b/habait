import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import {
  DEFAULT_APP_TITLE,
  PinSchema,
  UserRoleSchema,
  type AppSettings,
  type CreateUserRequest,
  type LobbyProfile,
  type LobbyResponse,
  type LoginRequest,
  type UpdateSettingsRequest,
  type UpdateUserRequest,
  type User,
  type UserRole,
} from '@habait/shared';
import type { Db } from '../db/connection.js';
import * as schema from '../db/schema.js';
import { DomainError, DomainValidationError } from '../errors.js';
import { getServerTime } from './date.service.js';

export type SessionPayload = {
  userId: number;
  role: UserRole;
  issuedAt: number;
};

/** Throws in production when unset: the dev default is public, so anyone could forge PARENT tokens. */
export function getSessionSecret(): string {
  const secret = process.env['SESSION_SECRET'];
  if (secret) return secret;
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }
  return 'habait-local-dev-secret-key';
}

export function hashPin(pin: string): string {
  const parsed = PinSchema.safeParse(pin);
  if (!parsed.success) {
    throw new DomainValidationError('PIN must be a 4-digit numeric string');
  }
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(parsed.data, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPin(pin: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(pin, salt, 32);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function signSessionToken(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  if (!data || !sig) return null;
  const expectedSig = createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const raw = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as unknown;
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'userId' in raw &&
      typeof raw.userId === 'number' &&
      'role' in raw &&
      UserRoleSchema.safeParse(raw.role).success &&
      'issuedAt' in raw &&
      typeof raw.issuedAt === 'number'
    ) {
      return { userId: raw.userId, role: raw.role as UserRole, issuedAt: raw.issuedAt };
    }
    return null;
  } catch {
    return null;
  }
}

/** Session → actor using the user's *current* DB role; null if the user is gone or deactivated. */
export function resolveSessionActor(
  db: Db,
  token: string,
): { userId: number; role: UserRole } | null {
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const row = db
    .select({ role: schema.users.role, isActive: schema.users.isActive })
    .from(schema.users)
    .where(eq(schema.users.id, payload.userId))
    .get();
  if (!row?.isActive) return null;
  return { userId: payload.userId, role: row.role };
}

type UserRow = typeof schema.users.$inferSelect;

export function toUserDto(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    avatarEmoji: row.avatarEmoji,
    avatarBgColor: row.avatarBgColor,
    role: row.role,
    hasPin: row.pinHash !== null,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

export function getUserById(db: Db, userId: number): User {
  const row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!row) throw new DomainError('NOT_FOUND', `User ${userId} not found`);
  return toUserDto(row);
}

export function listUsers(db: Db, options?: { activeOnly?: boolean }): User[] {
  const rows = options?.activeOnly
    ? db
        .select()
        .from(schema.users)
        .where(eq(schema.users.isActive, true))
        .orderBy(asc(schema.users.sortOrder), asc(schema.users.id))
        .all()
    : db
        .select()
        .from(schema.users)
        .orderBy(asc(schema.users.sortOrder), asc(schema.users.id))
        .all();
  return rows.map(toUserDto);
}

export function createUser(db: Db, input: CreateUserRequest, now: number = Date.now()): User {
  if (input.role === 'PARENT') {
    if (!input.pin) {
      throw new DomainValidationError('PARENT profile requires a 4-digit PIN');
    }
  }
  const pinHash = input.pin ? hashPin(input.pin) : null;
  const row = db
    .insert(schema.users)
    .values({
      name: input.name.trim(),
      avatarEmoji: input.avatarEmoji.trim(),
      avatarBgColor: input.avatarBgColor.trim(),
      role: input.role,
      pinHash,
      isActive: true,
      sortOrder: input.sortOrder ?? 0,
      createdAt: now,
    })
    .returning()
    .get();
  return toUserDto(row);
}

export function updateUser(db: Db, userId: number, input: UpdateUserRequest): User {
  const existing = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!existing) throw new DomainError('NOT_FOUND', `User ${userId} not found`);

  const nextRole = input.role ?? existing.role;
  let nextPinHash = existing.pinHash;
  if (input.pin !== undefined) {
    nextPinHash = input.pin === null ? null : hashPin(input.pin);
  }
  if (nextRole === 'PARENT' && !nextPinHash) {
    throw new DomainValidationError('PARENT profile must always have a PIN');
  }

  const updated = db
    .update(schema.users)
    .set({
      name: input.name !== undefined ? input.name.trim() : existing.name,
      avatarEmoji: input.avatarEmoji !== undefined ? input.avatarEmoji.trim() : existing.avatarEmoji,
      avatarBgColor:
        input.avatarBgColor !== undefined ? input.avatarBgColor.trim() : existing.avatarBgColor,
      role: nextRole,
      pinHash: nextPinHash,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
      sortOrder: input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder,
    })
    .where(eq(schema.users.id, userId))
    .returning()
    .get();

  return toUserDto(updated);
}

const MAX_PIN_FAILURES = 5;
const PIN_LOCKOUT_MS = 5 * 60_000;
// shortcut: in-memory per process (resets on restart), fine for one LXC process; persist if we ever run >1 instance.
const pinFailures = new WeakMap<Db, Map<number, { count: number; lockedUntil: number }>>();

export function authenticateUser(
  db: Db,
  input: LoginRequest,
  now: number = Date.now(),
): { user: User; token: string } {
  const row = db.select().from(schema.users).where(eq(schema.users.id, input.userId)).get();
  if (!row || !row.isActive) {
    throw new DomainError('NOT_FOUND', 'User not found or inactive');
  }
  if (row.pinHash !== null) {
    let failures = pinFailures.get(db);
    if (!failures) pinFailures.set(db, (failures = new Map()));
    const entry = failures.get(row.id) ?? { count: 0, lockedUntil: 0 };
    if (now < entry.lockedUntil) {
      throw new DomainError('TOO_MANY_ATTEMPTS', 'יותר מדי ניסיונות — נסו שוב בעוד כמה דקות');
    }
    if (!input.pin || !verifyPin(input.pin, row.pinHash)) {
      entry.count += 1;
      if (entry.count >= MAX_PIN_FAILURES) {
        entry.count = 0;
        entry.lockedUntil = now + PIN_LOCKOUT_MS;
      }
      failures.set(row.id, entry);
      throw new DomainError('INVALID_PIN', 'קוד סודי שגוי');
    }
    failures.delete(row.id);
  }
  const user = toUserDto(row);
  const token = signSessionToken({ userId: user.id, role: user.role, issuedAt: now });
  return { user, token };
}

export function getAppSettings(db: Db, now: number = Date.now()): AppSettings {
  let row = db.select().from(schema.appSettings).where(eq(schema.appSettings.id, 1)).get();
  if (!row) {
    row = db
      .insert(schema.appSettings)
      .values({
        id: 1,
        appTitle: DEFAULT_APP_TITLE,
        announcementText: null,
        announcementEmoji: null,
        announcementUpdatedBy: null,
        updatedAt: now,
      })
      .returning()
      .get();
  }
  return {
    appTitle: row.appTitle,
    announcementText: row.announcementText,
    announcementEmoji: row.announcementEmoji,
    announcementUpdatedBy: row.announcementUpdatedBy,
    updatedAt: row.updatedAt,
  };
}

export function updateAppSettings(
  db: Db,
  input: UpdateSettingsRequest,
  updatedByUserId: number,
  now: number = Date.now(),
): AppSettings {
  const current = getAppSettings(db, now);
  const nextTitle = input.appTitle !== undefined ? input.appTitle.trim() : current.appTitle;
  const nextText =
    input.announcementText !== undefined
      ? input.announcementText && input.announcementText.trim().length > 0
        ? input.announcementText.trim()
        : null
      : current.announcementText;
  const nextEmoji =
    input.announcementEmoji !== undefined ? input.announcementEmoji : current.announcementEmoji;

  const row = db
    .update(schema.appSettings)
    .set({
      appTitle: nextTitle,
      announcementText: nextText,
      announcementEmoji: nextEmoji,
      announcementUpdatedBy: updatedByUserId,
      updatedAt: now,
    })
    .where(eq(schema.appSettings.id, 1))
    .returning()
    .get();

  return {
    appTitle: row.appTitle,
    announcementText: row.announcementText,
    announcementEmoji: row.announcementEmoji,
    announcementUpdatedBy: row.announcementUpdatedBy,
    updatedAt: row.updatedAt,
  };
}

export function getLobbyData(db: Db, now: number = Date.now()): LobbyResponse {
  const appSettings = getAppSettings(db, now);
  const serverTime = getServerTime(now);
  const activeUsers = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.isActive, true))
    .orderBy(asc(schema.users.sortOrder), asc(schema.users.id))
    .all();

  const starRows = db
    .select({
      userId: schema.starTransactions.userId,
      total: sql<number>`COALESCE(SUM(${schema.starTransactions.starsDelta}), 0)`,
    })
    .from(schema.starTransactions)
    .groupBy(schema.starTransactions.userId)
    .all();
  const starsByUser = new Map<number, number>(starRows.map((r) => [r.userId, Number(r.total)]));

  const activeRoutines = db
    .select()
    .from(schema.routineTemplates)
    .where(eq(schema.routineTemplates.isActive, true))
    .all();

  const todayLogs = db
    .select()
    .from(schema.routineDailyLogs)
    .where(
      and(
        eq(schema.routineDailyLogs.logicalDate, serverTime.logicalDate),
        eq(schema.routineDailyLogs.status, 'COMPLETED'),
      ),
    )
    .all();
  const completedRoutineIds = new Set(todayLogs.map((l) => l.routineId));

  const pendingOneOffs = db
    .select({ assigneeId: schema.oneOffTasks.assigneeId })
    .from(schema.oneOffTasks)
    .where(eq(schema.oneOffTasks.status, 'PENDING'))
    .all();
  const usersWithOneOffs = new Set(pendingOneOffs.map((t) => t.assigneeId));

  const activeClaims = db
    .select({ claimedByUserId: schema.poolTasks.claimedByUserId })
    .from(schema.poolTasks)
    .where(
      and(
        eq(schema.poolTasks.isActive, true),
        eq(schema.poolTasks.state, 'CLAIMED'),
        gt(schema.poolTasks.claimExpiresAt, now),
      ),
    )
    .all();
  const usersWithPoolClaims = new Set(
    activeClaims.map((c) => c.claimedByUserId).filter((id): id is number => id !== null),
  );

  const pendingPeers = db
    .select({ recipientId: schema.peerRequests.recipientId })
    .from(schema.peerRequests)
    .where(eq(schema.peerRequests.status, 'PENDING'))
    .all();
  const usersWithPeers = new Set(pendingPeers.map((p) => p.recipientId));

  const profiles: LobbyProfile[] = activeUsers.map((u) => {
    const hasOpenRoutine = activeRoutines.some((r) => {
      if (r.assigneeId !== u.id || completedRoutineIds.has(r.id)) return false;
      const days = JSON.parse(r.daysOfWeekJson) as number[];
      return days.includes(serverTime.dayOfWeek);
    });

    const hasOpenTasks =
      hasOpenRoutine ||
      usersWithOneOffs.has(u.id) ||
      usersWithPoolClaims.has(u.id) ||
      usersWithPeers.has(u.id);

    return {
      id: u.id,
      name: u.name,
      avatarEmoji: u.avatarEmoji,
      avatarBgColor: u.avatarBgColor,
      role: u.role,
      hasPin: u.pinHash !== null,
      hasOpenTasks,
      totalStars: starsByUser.get(u.id) ?? 0,
    };
  });

  return { appSettings, serverTime, profiles };
}

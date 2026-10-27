import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  DEFAULT_PEER_REQUEST_EMOJI,
  type CompletedItem,
  type CreateOneOffRequest,
  type CreatePeerRequest,
  type CreateRoutineRequest,
  type DashboardResponse,
  type CompleteResponse,
  type HistoryResponse,
  type LogicalDate,
  type OneOffTask,
  type PeerRequest,
  type RevertResponse,
  type RoutineDailyLog,
  type RoutineTemplate,
  type UpdateOneOffRequest,
  type UpdateRoutineRequest,
  type DayOfWeek,
} from '@habait/shared';
import type { Db } from '../db/connection.js';
import * as schema from '../db/schema.js';
import { DomainError, DomainValidationError } from '../errors.js';
import { getLogicalDateString, getServerTime } from './date.service.js';
import {
  getUserActivePoolClaim,
  toPoolExecutionDto,
  type Actor,
} from './pool.service.js';
import { getStarSummaryForUser } from './star.service.js';
import { getUserById, listUsers } from './user.service.js';

type RoutineRow = typeof schema.routineTemplates.$inferSelect;
type RoutineLogRow = typeof schema.routineDailyLogs.$inferSelect;
type OneOffRow = typeof schema.oneOffTasks.$inferSelect;
type PeerRequestRow = typeof schema.peerRequests.$inferSelect;

export function toRoutineDto(row: RoutineRow): RoutineTemplate {
  return {
    id: row.id,
    assigneeId: row.assigneeId,
    title: row.title,
    iconEmoji: row.iconEmoji,
    timeWindow: row.timeWindow,
    daysOfWeek: JSON.parse(row.daysOfWeekJson) as DayOfWeek[],
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export function toRoutineLogDto(row: RoutineLogRow): RoutineDailyLog {
  return {
    id: row.id,
    routineId: row.routineId,
    assigneeId: row.assigneeId,
    titleSnapshot: row.titleSnapshot,
    iconEmojiSnapshot: row.iconEmojiSnapshot,
    timeWindowSnapshot: row.timeWindowSnapshot,
    logicalDate: row.logicalDate,
    status: row.status,
    completedAt: row.completedAt,
  };
}

export function toOneOffDto(row: OneOffRow): OneOffTask {
  return {
    id: row.id,
    assigneeId: row.assigneeId,
    createdById: row.createdById,
    title: row.title,
    iconEmoji: row.iconEmoji,
    stars: row.stars,
    status: row.status,
    issuedDate: row.issuedDate,
    issuedAt: row.issuedAt,
    finishedDate: row.finishedDate,
    finishedAt: row.finishedAt,
  };
}

export function toPeerRequestDto(row: PeerRequestRow): PeerRequest {
  return {
    id: row.id,
    requesterId: row.requesterId,
    recipientId: row.recipientId,
    title: row.title,
    iconEmoji: row.iconEmoji,
    status: row.status,
    issuedDate: row.issuedDate,
    issuedAt: row.issuedAt,
    finishedDate: row.finishedDate,
    finishedAt: row.finishedAt,
  };
}

// ---------------------------------------------------------------------------
// Category A: Daily Routines (0 stars)
// ---------------------------------------------------------------------------

export function listRoutineTemplates(
  db: Db,
  options: { assigneeId?: number; activeOnly?: boolean } = {},
): RoutineTemplate[] {
  const rows = db
    .select()
    .from(schema.routineTemplates)
    .orderBy(asc(schema.routineTemplates.sortOrder), asc(schema.routineTemplates.id))
    .all();

  return rows
    .filter((r) => {
      if (options.assigneeId !== undefined && r.assigneeId !== options.assigneeId) return false;
      if (options.activeOnly && !r.isActive) return false;
      return true;
    })
    .map(toRoutineDto);
}

export function createRoutineTemplate(
  db: Db,
  input: CreateRoutineRequest,
  createdBy: number,
  now: number = Date.now(),
): RoutineTemplate {
  getUserById(db, input.assigneeId);
  const row = db
    .insert(schema.routineTemplates)
    .values({
      assigneeId: input.assigneeId,
      title: input.title.trim(),
      iconEmoji: input.iconEmoji.trim(),
      timeWindow: input.timeWindow,
      daysOfWeekJson: JSON.stringify(input.daysOfWeek),
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
      createdBy,
      createdAt: now,
    })
    .returning()
    .get();
  return toRoutineDto(row);
}

export function updateRoutineTemplate(
  db: Db,
  routineId: number,
  input: UpdateRoutineRequest,
): RoutineTemplate {
  const existing = db
    .select()
    .from(schema.routineTemplates)
    .where(eq(schema.routineTemplates.id, routineId))
    .get();
  if (!existing) throw new DomainError('NOT_FOUND', `Routine ${routineId} not found`);

  const updated = db
    .update(schema.routineTemplates)
    .set({
      assigneeId: input.assigneeId !== undefined ? input.assigneeId : existing.assigneeId,
      title: input.title !== undefined ? input.title.trim() : existing.title,
      iconEmoji: input.iconEmoji !== undefined ? input.iconEmoji.trim() : existing.iconEmoji,
      timeWindow: input.timeWindow !== undefined ? input.timeWindow : existing.timeWindow,
      daysOfWeekJson:
        input.daysOfWeek !== undefined
          ? JSON.stringify(input.daysOfWeek)
          : existing.daysOfWeekJson,
      sortOrder: input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
    })
    .where(eq(schema.routineTemplates.id, routineId))
    .returning()
    .get();

  return toRoutineDto(updated);
}

export function completeRoutine(
  db: Db,
  routineId: number,
  actor: Actor,
  now: number = Date.now(),
): CompleteResponse {
  return db.transaction((tx) => {
    const routine = tx
      .select()
      .from(schema.routineTemplates)
      .where(eq(schema.routineTemplates.id, routineId))
      .get();
    if (!routine || !routine.isActive) {
      throw new DomainError('NOT_FOUND', 'Routine not found or inactive');
    }
    if (actor.role !== 'PARENT' && routine.assigneeId !== actor.userId) {
      throw new DomainError('FORBIDDEN', 'אין הרשאה להשלים שגרה זו');
    }

    const logicalDate = getLogicalDateString(now);
    const existingLog = tx
      .select()
      .from(schema.routineDailyLogs)
      .where(
        and(
          eq(schema.routineDailyLogs.routineId, routineId),
          eq(schema.routineDailyLogs.logicalDate, logicalDate),
        ),
      )
      .get();

    if (existingLog?.status === 'COMPLETED') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'השגרה כבר הושלמה היום');
    }

    const logRow = existingLog
      ? tx
          .update(schema.routineDailyLogs)
          .set({
            status: 'COMPLETED',
            completedAt: now,
            titleSnapshot: routine.title,
            iconEmojiSnapshot: routine.iconEmoji,
            timeWindowSnapshot: routine.timeWindow,
          })
          .where(eq(schema.routineDailyLogs.id, existingLog.id))
          .returning()
          .get()
      : tx
          .insert(schema.routineDailyLogs)
          .values({
            routineId: routine.id,
            assigneeId: routine.assigneeId,
            titleSnapshot: routine.title,
            iconEmojiSnapshot: routine.iconEmoji,
            timeWindowSnapshot: routine.timeWindow,
            logicalDate,
            status: 'COMPLETED',
            completedAt: now,
          })
          .returning()
          .get();

    return {
      item: { kind: 'ROUTINE', log: toRoutineLogDto(logRow) },
      starsAwarded: 0,
    };
  });
}

/** `logId` is a `routine_daily_logs.id` (what `completedToday` / history expose), never a routine id. */
export function revertRoutineCompletion(
  db: Db,
  logId: number,
  actor: Actor,
  now: number = Date.now(),
): RevertResponse {
  return db.transaction((tx) => {
    const today = getLogicalDateString(now);
    const log = tx
      .select()
      .from(schema.routineDailyLogs)
      .where(eq(schema.routineDailyLogs.id, logId))
      .get();

    if (!log || log.status !== 'COMPLETED') {
      throw new DomainError('REVERT_NOT_ALLOWED', 'לא נמצאה השלמה לביטול');
    }

    const isSameDayOwner = log.assigneeId === actor.userId && log.logicalDate === today;
    if (actor.role !== 'PARENT' && !isSameDayOwner) {
      throw new DomainError('REVERT_NOT_ALLOWED', 'אין הרשאה לבטל השלמה זו');
    }

    tx.delete(schema.routineDailyLogs).where(eq(schema.routineDailyLogs.id, log.id)).run();
    return { starsDelta: 0 };
  });
}

// ---------------------------------------------------------------------------
// Category B: One-Off Assigned Tasks (0..N stars)
// ---------------------------------------------------------------------------

export function listOneOffTasks(
  db: Db,
  options: { assigneeId?: number; pendingOnly?: boolean } = {},
): OneOffTask[] {
  const rows = db
    .select()
    .from(schema.oneOffTasks)
    .orderBy(asc(schema.oneOffTasks.id))
    .all();

  return rows
    .filter((t) => {
      if (options.assigneeId !== undefined && t.assigneeId !== options.assigneeId) return false;
      if (options.pendingOnly && t.status !== 'PENDING') return false;
      return true;
    })
    .map(toOneOffDto);
}

export function createOneOffTask(
  db: Db,
  input: CreateOneOffRequest,
  creator: Actor,
  now: number = Date.now(),
): OneOffTask {
  if (creator.role !== 'PARENT') {
    throw new DomainError('FORBIDDEN', 'רק הורה יכול ליצור משימה מיוחדת');
  }
  getUserById(db, input.assigneeId);

  const row = db
    .insert(schema.oneOffTasks)
    .values({
      assigneeId: input.assigneeId,
      createdById: creator.userId,
      title: input.title.trim(),
      iconEmoji: input.iconEmoji.trim(),
      stars: input.stars ?? 0,
      status: 'PENDING',
      issuedDate: getLogicalDateString(now),
      issuedAt: now,
      finishedDate: null,
      finishedAt: null,
    })
    .returning()
    .get();

  return toOneOffDto(row);
}

export function updateOneOffTask(
  db: Db,
  taskId: number,
  input: UpdateOneOffRequest,
): OneOffTask {
  const existing = db
    .select()
    .from(schema.oneOffTasks)
    .where(eq(schema.oneOffTasks.id, taskId))
    .get();
  if (!existing) throw new DomainError('NOT_FOUND', `One-off task ${taskId} not found`);
  if (existing.status !== 'PENDING') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'ניתן לערוך רק משימות פתוחות');
  }

  const updated = db
    .update(schema.oneOffTasks)
    .set({
      assigneeId: input.assigneeId !== undefined ? input.assigneeId : existing.assigneeId,
      title: input.title !== undefined ? input.title.trim() : existing.title,
      iconEmoji: input.iconEmoji !== undefined ? input.iconEmoji.trim() : existing.iconEmoji,
      stars: input.stars !== undefined ? input.stars : existing.stars,
    })
    .where(eq(schema.oneOffTasks.id, taskId))
    .returning()
    .get();

  return toOneOffDto(updated);
}

export function cancelOneOffTask(
  db: Db,
  taskId: number,
  actor: Actor,
  now: number = Date.now(),
): OneOffTask {
  if (actor.role !== 'PARENT') {
    throw new DomainError('FORBIDDEN', 'רק הורה יכול לבטל משימה מיוחדת');
  }
  const existing = db
    .select()
    .from(schema.oneOffTasks)
    .where(eq(schema.oneOffTasks.id, taskId))
    .get();
  if (!existing) throw new DomainError('NOT_FOUND', `One-off task ${taskId} not found`);
  if (existing.status !== 'PENDING') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'המשימה אינה במצב ממתין');
  }

  const updated = db
    .update(schema.oneOffTasks)
    .set({
      status: 'CANCELED',
      finishedDate: getLogicalDateString(now),
      finishedAt: now,
    })
    .where(eq(schema.oneOffTasks.id, taskId))
    .returning()
    .get();

  return toOneOffDto(updated);
}

export function completeOneOffTask(
  db: Db,
  taskId: number,
  actor: Actor,
  now: number = Date.now(),
): CompleteResponse {
  return db.transaction((tx) => {
    const task = tx
      .select()
      .from(schema.oneOffTasks)
      .where(eq(schema.oneOffTasks.id, taskId))
      .get();
    if (!task) throw new DomainError('NOT_FOUND', `One-off task ${taskId} not found`);
    if (task.status !== 'PENDING') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'המשימה אינה פתוחה');
    }
    if (actor.role !== 'PARENT' && task.assigneeId !== actor.userId) {
      throw new DomainError('FORBIDDEN', 'אין הרשאה להשלים משימה זו');
    }

    const logicalDate = getLogicalDateString(now);
    const updated = tx
      .update(schema.oneOffTasks)
      .set({
        status: 'COMPLETED',
        finishedDate: logicalDate,
        finishedAt: now,
      })
      .where(eq(schema.oneOffTasks.id, taskId))
      .returning()
      .get();

    if (task.stars > 0) {
      tx.insert(schema.starTransactions)
        .values({
          userId: task.assigneeId,
          sourceType: 'ONE_OFF',
          sourceId: task.id,
          starsDelta: task.stars,
          description: task.title,
          logicalDate,
          createdAt: now,
        })
        .run();
    }

    return {
      item: { kind: 'ONE_OFF', task: toOneOffDto(updated) },
      starsAwarded: task.stars,
    };
  });
}

export function revertOneOffTask(
  db: Db,
  taskId: number,
  actor: Actor,
  now: number = Date.now(),
): RevertResponse {
  return db.transaction((tx) => {
    const task = tx
      .select()
      .from(schema.oneOffTasks)
      .where(eq(schema.oneOffTasks.id, taskId))
      .get();
    if (!task) throw new DomainError('NOT_FOUND', `One-off task ${taskId} not found`);
    if (task.status !== 'COMPLETED') {
      throw new DomainError('REVERT_NOT_ALLOWED', 'ניתן לבטל השלמה רק למשימה שבוצעה');
    }

    const today = getLogicalDateString(now);
    const isSameDayOwner = task.assigneeId === actor.userId && task.finishedDate === today;
    if (actor.role !== 'PARENT' && !isSameDayOwner) {
      throw new DomainError('REVERT_NOT_ALLOWED', 'אין הרשאה לבטל השלמה זו');
    }

    tx.update(schema.oneOffTasks)
      .set({
        status: 'PENDING',
        finishedDate: null,
        finishedAt: null,
      })
      .where(eq(schema.oneOffTasks.id, taskId))
      .run();

    let starsDelta = 0;
    if (task.stars > 0) {
      starsDelta = -task.stars;
      tx.insert(schema.starTransactions)
        .values({
          userId: task.assigneeId,
          sourceType: 'REVERT',
          sourceId: task.id,
          starsDelta,
          description: task.title,
          logicalDate: today,
          createdAt: now,
        })
        .run();
    }

    return { starsDelta };
  });
}

// ---------------------------------------------------------------------------
// Category D: Peer-to-Peer Help Requests (0 stars)
// ---------------------------------------------------------------------------

export function listPeerRequests(
  db: Db,
  options: { recipientId?: number; pendingOnly?: boolean } = {},
): PeerRequest[] {
  const rows = db
    .select()
    .from(schema.peerRequests)
    .orderBy(asc(schema.peerRequests.id))
    .all();

  return rows
    .filter((r) => {
      if (options.recipientId !== undefined && r.recipientId !== options.recipientId) return false;
      if (options.pendingOnly && r.status !== 'PENDING') return false;
      return true;
    })
    .map(toPeerRequestDto);
}

export function createPeerRequest(
  db: Db,
  input: CreatePeerRequest,
  requesterId: number,
  now: number = Date.now(),
): PeerRequest {
  if (requesterId === input.recipientId) {
    throw new DomainValidationError('לא ניתן לשלוח בקשת עזרה לעצמך');
  }
  getUserById(db, input.recipientId);

  const row = db
    .insert(schema.peerRequests)
    .values({
      requesterId,
      recipientId: input.recipientId,
      title: input.title.trim(),
      iconEmoji: input.iconEmoji?.trim() || DEFAULT_PEER_REQUEST_EMOJI,
      status: 'PENDING',
      issuedDate: getLogicalDateString(now),
      issuedAt: now,
      finishedDate: null,
      finishedAt: null,
    })
    .returning()
    .get();

  return toPeerRequestDto(row);
}

export function completePeerRequest(
  db: Db,
  requestId: number,
  actor: Actor,
  now: number = Date.now(),
): PeerRequest {
  const req = db
    .select()
    .from(schema.peerRequests)
    .where(eq(schema.peerRequests.id, requestId))
    .get();
  if (!req) throw new DomainError('NOT_FOUND', `Peer request ${requestId} not found`);
  if (req.status !== 'PENDING') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'הבקשה כבר אינה ממתינה');
  }
  if (actor.role !== 'PARENT' && req.recipientId !== actor.userId) {
    throw new DomainError('FORBIDDEN', 'רק מקבל הבקשה או הורה יכול לסמן אותה כבוצעה');
  }

  const updated = db
    .update(schema.peerRequests)
    .set({
      status: 'COMPLETED',
      finishedDate: getLogicalDateString(now),
      finishedAt: now,
    })
    .where(eq(schema.peerRequests.id, requestId))
    .returning()
    .get();

  return toPeerRequestDto(updated);
}

export function declinePeerRequest(
  db: Db,
  requestId: number,
  actor: Actor,
  now: number = Date.now(),
): PeerRequest {
  const req = db
    .select()
    .from(schema.peerRequests)
    .where(eq(schema.peerRequests.id, requestId))
    .get();
  if (!req) throw new DomainError('NOT_FOUND', `Peer request ${requestId} not found`);
  if (req.status !== 'PENDING') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'הבקשה כבר אינה ממתינה');
  }
  if (actor.role !== 'PARENT' && req.recipientId !== actor.userId) {
    throw new DomainError('FORBIDDEN', 'רק מקבל הבקשה או הורה יכול לדחות אותה');
  }

  const updated = db
    .update(schema.peerRequests)
    .set({
      status: 'DECLINED',
      finishedDate: getLogicalDateString(now),
      finishedAt: now,
    })
    .where(eq(schema.peerRequests.id, requestId))
    .returning()
    .get();

  return toPeerRequestDto(updated);
}

export function cancelPeerRequest(
  db: Db,
  requestId: number,
  actor: Actor,
  now: number = Date.now(),
): PeerRequest {
  const req = db
    .select()
    .from(schema.peerRequests)
    .where(eq(schema.peerRequests.id, requestId))
    .get();
  if (!req) throw new DomainError('NOT_FOUND', `Peer request ${requestId} not found`);
  if (req.status !== 'PENDING') {
    throw new DomainError('INVALID_STATE_TRANSITION', 'הבקשה כבר אינה ממתינה');
  }
  if (actor.role !== 'PARENT' && req.requesterId !== actor.userId) {
    throw new DomainError('FORBIDDEN', 'רק שולח הבקשה או הורה יכול לבטל אותה');
  }

  const updated = db
    .update(schema.peerRequests)
    .set({
      status: 'CANCELED',
      finishedDate: getLogicalDateString(now),
      finishedAt: now,
    })
    .where(eq(schema.peerRequests.id, requestId))
    .returning()
    .get();

  return toPeerRequestDto(updated);
}

export function revertPeerRequest(
  db: Db,
  requestId: number,
  actor: Actor,
  now: number = Date.now(),
): RevertResponse {
  const req = db
    .select()
    .from(schema.peerRequests)
    .where(eq(schema.peerRequests.id, requestId))
    .get();
  if (!req) throw new DomainError('NOT_FOUND', `Peer request ${requestId} not found`);
  if (req.status !== 'COMPLETED') {
    throw new DomainError('REVERT_NOT_ALLOWED', 'ניתן לבטל רק בקשה שבוצעה');
  }

  const today = getLogicalDateString(now);
  const isSameDayOwner = req.recipientId === actor.userId && req.finishedDate === today;
  if (actor.role !== 'PARENT' && !isSameDayOwner) {
    throw new DomainError('REVERT_NOT_ALLOWED', 'אין הרשאה לבטל השלמה זו');
  }

  db.update(schema.peerRequests)
    .set({
      status: 'PENDING',
      finishedDate: null,
      finishedAt: null,
    })
    .where(eq(schema.peerRequests.id, requestId))
    .run();

  return { starsDelta: 0 };
}

// ---------------------------------------------------------------------------
// Dashboard (`היום שלי`) & Daily History (`היסטוריה`)
// ---------------------------------------------------------------------------

export function getUserDashboard(
  db: Db,
  userId: number,
  now: number = Date.now(),
): DashboardResponse {
  const user = getUserById(db, userId);
  const serverTime = getServerTime(now);
  const starSummary = getStarSummaryForUser(db, userId, serverTime.logicalDate);
  const activeClaim = getUserActivePoolClaim(db, userId, now);

  const oneOffTasks = listOneOffTasks(db, { assigneeId: userId, pendingOnly: true });

  const allUserRoutines = listRoutineTemplates(db, { assigneeId: userId, activeOnly: true });
  const todayRoutineLogs = db
    .select()
    .from(schema.routineDailyLogs)
    .where(
      and(
        eq(schema.routineDailyLogs.assigneeId, userId),
        eq(schema.routineDailyLogs.logicalDate, serverTime.logicalDate),
        eq(schema.routineDailyLogs.status, 'COMPLETED'),
      ),
    )
    .all();
  const completedRoutineIds = new Set(todayRoutineLogs.map((l) => l.routineId));

  const routines: DashboardResponse['routines'] = {
    MORNING: [],
    AFTERNOON: [],
    EVENING: [],
    ALL_DAY: [],
  };

  for (const r of allUserRoutines) {
    if (!r.daysOfWeek.includes(serverTime.dayOfWeek)) continue;
    if (completedRoutineIds.has(r.id)) continue;
    routines[r.timeWindow].push(r);
  }

  const peerRequests = listPeerRequests(db, { recipientId: userId, pendingOnly: true });

  // Section 5: Completed Today (`בוצעו היום`)
  const completedToday: CompletedItem[] = [];

  for (const log of todayRoutineLogs) {
    completedToday.push({ kind: 'ROUTINE', log: toRoutineLogDto(log) });
  }

  const completedOneOffsToday = db
    .select()
    .from(schema.oneOffTasks)
    .where(
      and(
        eq(schema.oneOffTasks.assigneeId, userId),
        eq(schema.oneOffTasks.status, 'COMPLETED'),
        eq(schema.oneOffTasks.finishedDate, serverTime.logicalDate),
      ),
    )
    .all();
  for (const t of completedOneOffsToday) {
    completedToday.push({ kind: 'ONE_OFF', task: toOneOffDto(t) });
  }

  const poolExecsToday = db
    .select()
    .from(schema.poolTaskExecutions)
    .where(
      and(
        eq(schema.poolTaskExecutions.userId, userId),
        eq(schema.poolTaskExecutions.logicalDate, serverTime.logicalDate),
        isNull(schema.poolTaskExecutions.revertedAt),
      ),
    )
    .all();
  for (const e of poolExecsToday) {
    completedToday.push({ kind: 'POOL', execution: toPoolExecutionDto(e) });
  }

  const peerReqsToday = db
    .select()
    .from(schema.peerRequests)
    .where(
      and(
        eq(schema.peerRequests.recipientId, userId),
        eq(schema.peerRequests.status, 'COMPLETED'),
        eq(schema.peerRequests.finishedDate, serverTime.logicalDate),
      ),
    )
    .all();
  for (const p of peerReqsToday) {
    completedToday.push({ kind: 'PEER_REQUEST', request: toPeerRequestDto(p) });
  }

  return {
    serverTime,
    user,
    totalStars: starSummary.total,
    activeClaim,
    oneOffTasks,
    routines,
    peerRequests,
    completedToday,
  };
}

export function getDailyHistory(db: Db, date: LogicalDate): HistoryResponse {
  const users = listUsers(db, { activeOnly: true });

  const routineLogs = db
    .select()
    .from(schema.routineDailyLogs)
    .where(eq(schema.routineDailyLogs.logicalDate, date))
    .all()
    .map(toRoutineLogDto);

  const oneOffs = db
    .select()
    .from(schema.oneOffTasks)
    .where(
      and(
        eq(schema.oneOffTasks.status, 'COMPLETED'),
        eq(schema.oneOffTasks.finishedDate, date),
      ),
    )
    .all()
    .map(toOneOffDto);

  const poolExecs = db
    .select()
    .from(schema.poolTaskExecutions)
    .where(
      and(
        eq(schema.poolTaskExecutions.logicalDate, date),
        isNull(schema.poolTaskExecutions.revertedAt),
      ),
    )
    .all()
    .map(toPoolExecutionDto);

  const peerReqs = db
    .select()
    .from(schema.peerRequests)
    .where(eq(schema.peerRequests.finishedDate, date))
    .all()
    .map(toPeerRequestDto);

  return {
    date,
    users: users.map((user) => ({
      user,
      routinesCompleted: routineLogs.filter(
        (l) => l.assigneeId === user.id && l.status === 'COMPLETED',
      ),
      routinesMissed: routineLogs.filter(
        (l) => l.assigneeId === user.id && l.status === 'MISSED',
      ),
      oneOffsCompleted: oneOffs.filter((t) => t.assigneeId === user.id),
      poolExecutions: poolExecs.filter((e) => e.userId === user.id),
      peerRequests: peerReqs.filter((p) => p.recipientId === user.id),
      starsEarned: getStarSummaryForUser(db, user.id, date),
    })),
  };
}

import { and, asc, eq, lte } from 'drizzle-orm';
import {
  POOL_CLAIM_DURATION_MS,
  type CreatePoolTaskRequest,
  type PoolCompleteResponse,
  type PoolTask,
  type PoolTaskExecution,
  type RevertResponse,
  type UpdatePoolTaskRequest,
  type UserRole,
} from '@habait/shared';
import type { Db } from '../db/connection.js';
import * as schema from '../db/schema.js';
import { DomainError } from '../errors.js';
import { getLogicalDateString } from './date.service.js';

type PoolTaskRow = typeof schema.poolTasks.$inferSelect;
type PoolExecRow = typeof schema.poolTaskExecutions.$inferSelect;

export type Actor = { userId: number; role: UserRole };

export function toPoolTaskDto(row: PoolTaskRow): PoolTask {
  const base = {
    id: row.id,
    title: row.title,
    iconEmoji: row.iconEmoji,
    stars: row.stars,
    resetMode: row.resetMode,
    cooldownMinutes: row.cooldownMinutes,
    isActive: row.isActive,
    lastCompletedAt: row.lastCompletedAt,
    createdById: row.createdById,
  };

  if (
    row.state === 'CLAIMED' &&
    row.claimedByUserId !== null &&
    row.claimedAt !== null &&
    row.claimExpiresAt !== null
  ) {
    return {
      ...base,
      state: 'CLAIMED',
      claimedByUserId: row.claimedByUserId,
      claimedAt: row.claimedAt,
      claimExpiresAt: row.claimExpiresAt,
    };
  }

  if (row.state === 'COOLDOWN' && row.cooldownEndsAt !== null) {
    return {
      ...base,
      state: 'COOLDOWN',
      cooldownEndsAt: row.cooldownEndsAt,
    };
  }

  return { ...base, state: 'AVAILABLE' };
}

export function toPoolExecutionDto(row: PoolExecRow): PoolTaskExecution {
  return {
    id: row.id,
    poolTaskId: row.poolTaskId,
    userId: row.userId,
    titleSnapshot: row.titleSnapshot,
    iconEmojiSnapshot: row.iconEmojiSnapshot,
    starsAwarded: row.starsAwarded,
    claimedAt: row.claimedAt,
    completedAt: row.completedAt,
    logicalDate: row.logicalDate,
    revertedAt: row.revertedAt,
  };
}

/**
 * Transitions expired claims (`now >= claimExpiresAt`) and finished cooldowns (`now >= cooldownEndsAt`)
 * back to `AVAILABLE`. Safe to call on every read and from the 60s background scheduler.
 */
export function sweepPoolExpiries(db: Db, now: number = Date.now()): void {
  db.update(schema.poolTasks)
    .set({
      state: 'AVAILABLE',
      claimedByUserId: null,
      claimedAt: null,
      claimExpiresAt: null,
    })
    .where(and(eq(schema.poolTasks.state, 'CLAIMED'), lte(schema.poolTasks.claimExpiresAt, now)))
    .run();

  db.update(schema.poolTasks)
    .set({
      state: 'AVAILABLE',
      cooldownEndsAt: null,
    })
    .where(and(eq(schema.poolTasks.state, 'COOLDOWN'), lte(schema.poolTasks.cooldownEndsAt, now)))
    .run();
}

export function listPoolTasks(
  db: Db,
  options: { includeInactive?: boolean } = {},
  now: number = Date.now(),
): PoolTask[] {
  sweepPoolExpiries(db, now);
  const rows = options.includeInactive
    ? db.select().from(schema.poolTasks).orderBy(asc(schema.poolTasks.id)).all()
    : db
        .select()
        .from(schema.poolTasks)
        .where(eq(schema.poolTasks.isActive, true))
        .orderBy(asc(schema.poolTasks.id))
        .all();
  return rows.map(toPoolTaskDto);
}

export function getUserActivePoolClaim(
  db: Db,
  userId: number,
  now: number = Date.now(),
): PoolTask | null {
  sweepPoolExpiries(db, now);
  const row = db
    .select()
    .from(schema.poolTasks)
    .where(
      and(
        eq(schema.poolTasks.isActive, true),
        eq(schema.poolTasks.state, 'CLAIMED'),
        eq(schema.poolTasks.claimedByUserId, userId),
      ),
    )
    .get();
  return row ? toPoolTaskDto(row) : null;
}

export function createPoolTask(
  db: Db,
  input: CreatePoolTaskRequest,
  createdById: number,
): PoolTask {
  const row = db
    .insert(schema.poolTasks)
    .values({
      title: input.title.trim(),
      iconEmoji: input.iconEmoji.trim(),
      stars: input.stars,
      resetMode: input.resetMode,
      cooldownMinutes: input.cooldownMinutes ?? 60,
      isActive: input.isActive ?? true,
      state: 'AVAILABLE',
      createdById,
    })
    .returning()
    .get();
  return toPoolTaskDto(row);
}

export function updatePoolTask(
  db: Db,
  taskId: number,
  input: UpdatePoolTaskRequest,
  now: number = Date.now(),
): PoolTask {
  sweepPoolExpiries(db, now);
  const existing = db.select().from(schema.poolTasks).where(eq(schema.poolTasks.id, taskId)).get();
  if (!existing) throw new DomainError('NOT_FOUND', `Pool task ${taskId} not found`);

  const updated = db
    .update(schema.poolTasks)
    .set({
      title: input.title !== undefined ? input.title.trim() : existing.title,
      iconEmoji: input.iconEmoji !== undefined ? input.iconEmoji.trim() : existing.iconEmoji,
      stars: input.stars !== undefined ? input.stars : existing.stars,
      resetMode: input.resetMode !== undefined ? input.resetMode : existing.resetMode,
      cooldownMinutes:
        input.cooldownMinutes !== undefined ? input.cooldownMinutes : existing.cooldownMinutes,
      isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
    })
    .where(eq(schema.poolTasks.id, taskId))
    .returning()
    .get();

  return toPoolTaskDto(updated);
}

export function togglePoolTaskActive(
  db: Db,
  taskId: number,
  now: number = Date.now(),
): PoolTask {
  sweepPoolExpiries(db, now);
  const existing = db.select().from(schema.poolTasks).where(eq(schema.poolTasks.id, taskId)).get();
  if (!existing) throw new DomainError('NOT_FOUND', `Pool task ${taskId} not found`);

  const updated = db
    .update(schema.poolTasks)
    .set({ isActive: !existing.isActive })
    .where(eq(schema.poolTasks.id, taskId))
    .returning()
    .get();

  return toPoolTaskDto(updated);
}

export function claimPoolTask(
  db: Db,
  taskId: number,
  userId: number,
  now: number = Date.now(),
): PoolTask {
  return db.transaction((tx) => {
    sweepPoolExpiries(tx as unknown as Db, now);

    const task = tx.select().from(schema.poolTasks).where(eq(schema.poolTasks.id, taskId)).get();
    if (!task) throw new DomainError('NOT_FOUND', `Pool task ${taskId} not found`);
    if (!task.isActive || task.state !== 'AVAILABLE') {
      throw new DomainError('POOL_TASK_NOT_AVAILABLE', 'משימה זו אינה זמינה כעת');
    }

    const existingClaim = tx
      .select({ id: schema.poolTasks.id })
      .from(schema.poolTasks)
      .where(
        and(eq(schema.poolTasks.state, 'CLAIMED'), eq(schema.poolTasks.claimedByUserId, userId)),
      )
      .get();
    if (existingClaim) {
      throw new DomainError(
        'POOL_WIP_LIMIT_REACHED',
        'כבר לקחת משימה אחת — סיים אותה קודם!',
      );
    }

    const updated = tx
      .update(schema.poolTasks)
      .set({
        state: 'CLAIMED',
        claimedByUserId: userId,
        claimedAt: now,
        claimExpiresAt: now + POOL_CLAIM_DURATION_MS,
        cooldownEndsAt: null,
      })
      .where(eq(schema.poolTasks.id, taskId))
      .returning()
      .get();

    return toPoolTaskDto(updated);
  });
}

export function unclaimPoolTask(
  db: Db,
  taskId: number,
  actor: Actor,
  now: number = Date.now(),
): PoolTask {
  return db.transaction((tx) => {
    sweepPoolExpiries(tx as unknown as Db, now);

    const task = tx.select().from(schema.poolTasks).where(eq(schema.poolTasks.id, taskId)).get();
    if (!task) throw new DomainError('NOT_FOUND', `Pool task ${taskId} not found`);
    if (task.state !== 'CLAIMED') {
      throw new DomainError('INVALID_STATE_TRANSITION', 'המשימה אינה משויכת כרגע');
    }
    if (actor.role !== 'PARENT' && task.claimedByUserId !== actor.userId) {
      throw new DomainError('POOL_NOT_CLAIMER', 'רק מי שלקח את המשימה או הורה יכול להחזיר אותה');
    }

    const updated = tx
      .update(schema.poolTasks)
      .set({
        state: 'AVAILABLE',
        claimedByUserId: null,
        claimedAt: null,
        claimExpiresAt: null,
      })
      .where(eq(schema.poolTasks.id, taskId))
      .returning()
      .get();

    return toPoolTaskDto(updated);
  });
}

export function completePoolTask(
  db: Db,
  taskId: number,
  userId: number,
  now: number = Date.now(),
): PoolCompleteResponse {
  const outcome = db.transaction((tx): { expired: true } | { expired: false; response: PoolCompleteResponse } => {
    const task = tx.select().from(schema.poolTasks).where(eq(schema.poolTasks.id, taskId)).get();
    if (!task) throw new DomainError('NOT_FOUND', `Pool task ${taskId} not found`);
    if (task.state !== 'CLAIMED' || task.claimedByUserId !== userId || task.claimedAt === null) {
      throw new DomainError('POOL_NOT_CLAIMER', 'המשימה אינה משויכת אליך');
    }
    if (task.claimExpiresAt !== null && now >= task.claimExpiresAt) {
      tx.update(schema.poolTasks)
        .set({
          state: 'AVAILABLE',
          claimedByUserId: null,
          claimedAt: null,
          claimExpiresAt: null,
        })
        .where(eq(schema.poolTasks.id, taskId))
        .run();
      return { expired: true };
    }

    const logicalDate = getLogicalDateString(now);
    const execRow = tx
      .insert(schema.poolTaskExecutions)
      .values({
        poolTaskId: task.id,
        userId,
        titleSnapshot: task.title,
        iconEmojiSnapshot: task.iconEmoji,
        starsAwarded: task.stars,
        claimedAt: task.claimedAt,
        completedAt: now,
        logicalDate,
        revertedAt: null,
      })
      .returning()
      .get();

    if (task.stars > 0) {
      tx.insert(schema.starTransactions)
        .values({
          userId,
          sourceType: 'POOL',
          sourceId: execRow.id,
          starsDelta: task.stars,
          description: task.title,
          logicalDate,
          createdAt: now,
        })
        .run();
    }

    const nextFields =
      task.resetMode === 'COOLDOWN'
        ? {
            isActive: task.isActive,
            state: 'COOLDOWN' as const,
            claimedByUserId: null,
            claimedAt: null,
            claimExpiresAt: null,
            cooldownEndsAt: now + task.cooldownMinutes * 60_000,
            lastCompletedAt: now,
          }
        : {
            isActive: false,
            state: 'AVAILABLE' as const,
            claimedByUserId: null,
            claimedAt: null,
            claimExpiresAt: null,
            cooldownEndsAt: null,
            lastCompletedAt: now,
          };

    const updatedTask = tx
      .update(schema.poolTasks)
      .set(nextFields)
      .where(eq(schema.poolTasks.id, task.id))
      .returning()
      .get();

    const execution = toPoolExecutionDto(execRow);
    return {
      expired: false,
      response: {
        item: { kind: 'POOL', execution },
        starsAwarded: task.stars,
        task: toPoolTaskDto(updatedTask),
        execution,
      },
    };
  });

  if (outcome.expired) {
    throw new DomainError('POOL_CLAIM_EXPIRED', 'פג תוקף השיוך למשימה זו');
  }
  return outcome.response;
}

export function revertPoolExecution(
  db: Db,
  execId: number,
  actor: Actor,
  now: number = Date.now(),
): RevertResponse {
  return db.transaction((tx) => {
    sweepPoolExpiries(tx as unknown as Db, now);

    const exec = tx
      .select()
      .from(schema.poolTaskExecutions)
      .where(eq(schema.poolTaskExecutions.id, execId))
      .get();
    if (!exec) throw new DomainError('NOT_FOUND', `Pool execution ${execId} not found`);
    if (exec.revertedAt !== null) {
      throw new DomainError('REVERT_NOT_ALLOWED', 'ביצוע זה כבר בוטל');
    }

    const today = getLogicalDateString(now);
    const isSameDayOwner = exec.userId === actor.userId && exec.logicalDate === today;
    if (actor.role !== 'PARENT' && !isSameDayOwner) {
      throw new DomainError('REVERT_NOT_ALLOWED', 'אין הרשאה לבטל השלמה זו');
    }

    tx.update(schema.poolTaskExecutions)
      .set({ revertedAt: now })
      .where(eq(schema.poolTaskExecutions.id, execId))
      .run();

    let starsDelta = 0;
    if (exec.starsAwarded > 0) {
      starsDelta = -exec.starsAwarded;
      tx.insert(schema.starTransactions)
        .values({
          userId: exec.userId,
          sourceType: 'REVERT',
          sourceId: exec.id,
          starsDelta,
          description: exec.titleSnapshot,
          logicalDate: today,
          createdAt: now,
        })
        .run();
    }

    const poolTask = tx
      .select()
      .from(schema.poolTasks)
      .where(eq(schema.poolTasks.id, exec.poolTaskId))
      .get();
    if (poolTask) {
      if (poolTask.resetMode === 'AUTO_DISABLE') {
        tx.update(schema.poolTasks)
          .set(
            poolTask.state === 'CLAIMED'
              ? { isActive: true }
              : { isActive: true, state: 'AVAILABLE', cooldownEndsAt: null },
          )
          .where(eq(schema.poolTasks.id, poolTask.id))
          .run();
      } else if (poolTask.state === 'COOLDOWN') {
        tx.update(schema.poolTasks)
          .set({ state: 'AVAILABLE', cooldownEndsAt: null })
          .where(eq(schema.poolTasks.id, poolTask.id))
          .run();
      }
    }

    return { starsDelta };
  });
}

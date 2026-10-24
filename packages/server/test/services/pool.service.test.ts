import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DbHandle } from '../../src/db/connection.js';
import * as schema from '../../src/db/schema.js';
import { createUser } from '../../src/services/user.service.js';
import {
  claimPoolTask,
  completePoolTask,
  createPoolTask,
  listPoolTasks,
  revertPoolExecution,
  sweepPoolExpiries,
  togglePoolTaskActive,
  unclaimPoolTask,
} from '../../src/services/pool.service.js';

let handle: DbHandle;
const NOW = Date.parse('2026-10-25T10:00:00+02:00');

beforeEach(() => {
  handle = createDb(':memory:');
  migrateDb(handle);
});

function seedActors() {
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
  return { parent, child1, child2 };
}

describe('pool.service — claiming & strict 1-WIP limit', () => {
  it('claims an AVAILABLE task with a 60-minute expiry', () => {
    const { parent, child1 } = seedActors();
    const task = createPoolTask(
      handle.db,
      {
        title: 'סידור סלון',
        iconEmoji: '🛋️',
        stars: 3,
        resetMode: 'COOLDOWN',
        cooldownMinutes: 60,
        isActive: true,
      },
      parent.id,
    );

    const claimed = claimPoolTask(handle.db, task.id, child1.id, NOW);
    expect(claimed.state).toBe('CLAIMED');
    if (claimed.state === 'CLAIMED') {
      expect(claimed.claimedByUserId).toBe(child1.id);
      expect(claimed.claimedAt).toBe(NOW);
      expect(claimed.claimExpiresAt).toBe(NOW + 3_600_000);
    }
  });

  it('rejects a second claim by the same user with 409 POOL_WIP_LIMIT_REACHED', () => {
    const { parent, child1 } = seedActors();
    const t1 = createPoolTask(
      handle.db,
      { title: 'משימה 1', iconEmoji: '🧹', stars: 2, resetMode: 'COOLDOWN', cooldownMinutes: 30, isActive: true },
      parent.id,
    );
    const t2 = createPoolTask(
      handle.db,
      { title: 'משימה 2', iconEmoji: '🧺', stars: 2, resetMode: 'COOLDOWN', cooldownMinutes: 30, isActive: true },
      parent.id,
    );

    claimPoolTask(handle.db, t1.id, child1.id, NOW);
    expect(() => claimPoolTask(handle.db, t2.id, child1.id, NOW)).toThrowError(
      expect.objectContaining({ code: 'POOL_WIP_LIMIT_REACHED', statusCode: 409 }),
    );
  });

  it('rejects claiming an inactive, already claimed, or cooling-down task', () => {
    const { parent, child1, child2 } = seedActors();
    const inactive = createPoolTask(
      handle.db,
      { title: 'כבוי', iconEmoji: '🍽️', stars: 2, resetMode: 'AUTO_DISABLE', cooldownMinutes: 60, isActive: false },
      parent.id,
    );
    expect(() => claimPoolTask(handle.db, inactive.id, child1.id, NOW)).toThrowError(
      expect.objectContaining({ code: 'POOL_TASK_NOT_AVAILABLE', statusCode: 409 }),
    );

    const active = createPoolTask(
      handle.db,
      { title: 'פעיל', iconEmoji: '🍽️', stars: 2, resetMode: 'COOLDOWN', cooldownMinutes: 60, isActive: true },
      parent.id,
    );
    claimPoolTask(handle.db, active.id, child1.id, NOW);
    expect(() => claimPoolTask(handle.db, active.id, child2.id, NOW)).toThrowError(
      expect.objectContaining({ code: 'POOL_TASK_NOT_AVAILABLE', statusCode: 409 }),
    );
  });
});

describe('pool.service — unclaiming & 60-minute expiry sweep', () => {
  it('allows the claiming child or a parent to unclaim, but forbids another child', () => {
    const { parent, child1, child2 } = seedActors();
    const task = createPoolTask(
      handle.db,
      { title: 'זבל', iconEmoji: '🗑️', stars: 2, resetMode: 'COOLDOWN', cooldownMinutes: 60, isActive: true },
      parent.id,
    );
    claimPoolTask(handle.db, task.id, child1.id, NOW);

    expect(() =>
      unclaimPoolTask(handle.db, task.id, { userId: child2.id, role: 'CHILD' }, NOW),
    ).toThrowError(expect.objectContaining({ code: 'POOL_NOT_CLAIMER', statusCode: 403 }));

    const returned = unclaimPoolTask(handle.db, task.id, { userId: child1.id, role: 'CHILD' }, NOW);
    expect(returned.state).toBe('AVAILABLE');

    // Re-claim and let parent unclaim
    claimPoolTask(handle.db, task.id, child1.id, NOW);
    const parentReturned = unclaimPoolTask(
      handle.db,
      task.id,
      { userId: parent.id, role: 'PARENT' },
      NOW,
    );
    expect(parentReturned.state).toBe('AVAILABLE');
  });

  it('automatically expires claims after 60 minutes on sweep or lazy read', () => {
    const { parent, child1 } = seedActors();
    const task = createPoolTask(
      handle.db,
      { title: 'זבל', iconEmoji: '🗑️', stars: 2, resetMode: 'COOLDOWN', cooldownMinutes: 60, isActive: true },
      parent.id,
    );
    claimPoolTask(handle.db, task.id, child1.id, NOW);

    // At +59m, still CLAIMED
    expect(listPoolTasks(handle.db, {}, NOW + 59 * 60_000)[0]?.state).toBe('CLAIMED');

    // At +60m, lazy read expires it back to AVAILABLE
    expect(listPoolTasks(handle.db, {}, NOW + 60 * 60_000)[0]?.state).toBe('AVAILABLE');
  });
});

describe('pool.service — completion (COOLDOWN vs AUTO_DISABLE), stars & revert', () => {
  it('completes a COOLDOWN task, awards stars, enters cooldown, and returns to AVAILABLE after cooldownEndsAt', () => {
    const { parent, child1 } = seedActors();
    const task = createPoolTask(
      handle.db,
      { title: 'סידור סלון', iconEmoji: '🛋️', stars: 4, resetMode: 'COOLDOWN', cooldownMinutes: 30, isActive: true },
      parent.id,
    );
    claimPoolTask(handle.db, task.id, child1.id, NOW);

    const completeTime = NOW + 10 * 60_000;
    const res = completePoolTask(handle.db, task.id, child1.id, completeTime);
    expect(res.starsAwarded).toBe(4);
    expect(res.task.state).toBe('COOLDOWN');
    if (res.task.state === 'COOLDOWN') {
      expect(res.task.cooldownEndsAt).toBe(completeTime + 30 * 60_000);
    }

    // Ledger has +4 stars
    const txs = handle.db.select().from(schema.starTransactions).all();
    expect(txs).toHaveLength(1);
    expect(txs[0]?.starsDelta).toBe(4);
    expect(txs[0]?.sourceType).toBe('POOL');

    // After 30 minutes of cooldown, sweep transitions to AVAILABLE
    sweepPoolExpiries(handle.db, completeTime + 30 * 60_000);
    const refreshed = listPoolTasks(handle.db, {}, completeTime + 30 * 60_000);
    expect(refreshed[0]?.state).toBe('AVAILABLE');
  });

  it('completes an AUTO_DISABLE task by setting isActive=false and state=AVAILABLE, and re-enables on revert or toggle', () => {
    const { parent, child1 } = seedActors();
    const dishwasher = createPoolTask(
      handle.db,
      { title: 'פינוי מדיח', iconEmoji: '🍽️', stars: 3, resetMode: 'AUTO_DISABLE', cooldownMinutes: 60, isActive: true },
      parent.id,
    );
    claimPoolTask(handle.db, dishwasher.id, child1.id, NOW);

    const completed = completePoolTask(handle.db, dishwasher.id, child1.id, NOW + 5_000);
    expect(completed.task.isActive).toBe(false);
    expect(completed.task.state).toBe('AVAILABLE');

    // Hidden from public active list, visible in admin list
    expect(listPoolTasks(handle.db, { includeInactive: false }, NOW + 5_000)).toHaveLength(0);
    expect(listPoolTasks(handle.db, { includeInactive: true }, NOW + 5_000)).toHaveLength(1);

    // Reverting the execution deducts stars and re-enables the AUTO_DISABLE task
    const revertRes = revertPoolExecution(
      handle.db,
      completed.execution.id,
      { userId: child1.id, role: 'CHILD' },
      NOW + 10_000,
    );
    expect(revertRes.starsDelta).toBe(-3);
    const activePool = listPoolTasks(handle.db, { includeInactive: false }, NOW + 10_000);
    expect(activePool).toHaveLength(1);
    expect(activePool[0]?.isActive).toBe(true);
    expect(activePool[0]?.state).toBe('AVAILABLE');

    // Parent can also toggle active/inactive in one tap
    const toggledOff = togglePoolTaskActive(handle.db, dishwasher.id, NOW + 20_000);
    expect(toggledOff.isActive).toBe(false);
    const toggledOn = togglePoolTaskActive(handle.db, dishwasher.id, NOW + 21_000);
    expect(toggledOn.isActive).toBe(true);
  });

  it('rejects completing an expired claim with POOL_CLAIM_EXPIRED and persists state=AVAILABLE in DB', () => {
    const { parent, child1 } = seedActors();
    const task = createPoolTask(
      handle.db,
      { title: 'כביסה', iconEmoji: '🧺', stars: 3, resetMode: 'COOLDOWN', cooldownMinutes: 60, isActive: true },
      parent.id,
    );
    claimPoolTask(handle.db, task.id, child1.id, NOW);

    const expiredAt = NOW + 60 * 60_000;
    expect(() => completePoolTask(handle.db, task.id, child1.id, expiredAt)).toThrowError(
      expect.objectContaining({ code: 'POOL_CLAIM_EXPIRED', statusCode: 409 }),
    );

    // Verify the expired claim cleanup was committed (not rolled back by the thrown error)
    const rawRow = handle.db.select().from(schema.poolTasks).all()[0];
    expect(rawRow?.state).toBe('AVAILABLE');
    expect(rawRow?.claimedByUserId).toBeNull();
  });

  it('does not crash or clobber a subsequent active claim when reverting an older AUTO_DISABLE execution', () => {
    const { parent, child1, child2 } = seedActors();
    const dishwasher = createPoolTask(
      handle.db,
      { title: 'פינוי מדיח', iconEmoji: '🍽️', stars: 3, resetMode: 'AUTO_DISABLE', cooldownMinutes: 60, isActive: true },
      parent.id,
    );

    // Child 1 claims and completes -> task auto-disables
    claimPoolTask(handle.db, dishwasher.id, child1.id, NOW);
    const exec1 = completePoolTask(handle.db, dishwasher.id, child1.id, NOW + 1_000);

    // Parent re-enables and Child 2 claims it
    togglePoolTaskActive(handle.db, dishwasher.id, NOW + 2_000);
    claimPoolTask(handle.db, dishwasher.id, child2.id, NOW + 3_000);

    // Child 1 reverts their earlier execution while Child 2 holds the active claim
    const revertRes = revertPoolExecution(
      handle.db,
      exec1.execution.id,
      { userId: child1.id, role: 'CHILD' },
      NOW + 4_000,
    );
    expect(revertRes.starsDelta).toBe(-3);

    const current = listPoolTasks(handle.db, {}, NOW + 4_000)[0];
    expect(current?.state).toBe('CLAIMED');
    if (current?.state === 'CLAIMED') {
      expect(current.claimedByUserId).toBe(child2.id);
    }
  });
});

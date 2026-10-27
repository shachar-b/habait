import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DbHandle } from '../../src/db/connection.js';
import { DomainValidationError } from '../../src/errors.js';
import {
  claimPoolTask,
  completePoolTask,
  createPoolTask,
} from '../../src/services/pool.service.js';
import { getStarSummaryForUser, getStarsSummaryAllUsers } from '../../src/services/star.service.js';
import {
  cancelOneOffTask,
  cancelPeerRequest,
  completeOneOffTask,
  completePeerRequest,
  completeRoutine,
  createOneOffTask,
  createPeerRequest,
  createRoutineTemplate,
  declinePeerRequest,
  getDailyHistory,
  getUserDashboard,
  revertOneOffTask,
  revertPeerRequest,
  revertRoutineCompletion,
} from '../../src/services/task.service.js';
import { createUser } from '../../src/services/user.service.js';

let handle: DbHandle;
// Sunday 2026-10-25 08:30 Asia/Jerusalem (MORNING, dayOfWeek = 0)
const NOW = Date.parse('2026-10-25T08:30:00+02:00');

beforeEach(() => {
  handle = createDb(':memory:');
  migrateDb(handle);
});

function seedFamily() {
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

describe('task.service — Routines (0 stars) & Revert', () => {
  it('creates, completes (0 stars), and reverts a daily routine', () => {
    const { parent, child1 } = seedFamily();
    const routine = createRoutineTemplate(
      handle.db,
      {
        assigneeId: child1.id,
        title: 'צחצוח שיניים',
        iconEmoji: '🪥',
        timeWindow: 'MORNING',
        daysOfWeek: [0, 1, 2, 3, 4, 5],
      },
      parent.id,
      NOW,
    );

    const res = completeRoutine(
      handle.db,
      routine.id,
      { userId: child1.id, role: 'CHILD' },
      NOW,
    );
    expect(res.starsAwarded).toBe(0);
    expect(res.item.kind).toBe('ROUTINE');

    // Dashboard shows routine in completedToday and no longer in open MORNING list
    let dash = getUserDashboard(handle.db, child1.id, NOW);
    expect(dash.routines.MORNING).toHaveLength(0);
    expect(dash.completedToday).toHaveLength(1);
    expect(dash.totalStars).toBe(0);

    // Revert restores the routine to open MORNING list
    if (res.item.kind !== 'ROUTINE') throw new Error('expected routine item');
    const rev = revertRoutineCompletion(
      handle.db,
      res.item.log.id,
      { userId: child1.id, role: 'CHILD' },
      NOW,
    );
    expect(rev.starsDelta).toBe(0);
    dash = getUserDashboard(handle.db, child1.id, NOW);
    expect(dash.routines.MORNING).toHaveLength(1);
    expect(dash.completedToday).toHaveLength(0);
  });

  it('reverts exactly the log whose id is given, even when it collides with another routine id', () => {
    const { parent, child1 } = seedFamily();
    const input = { assigneeId: child1.id, iconEmoji: '🪥', timeWindow: 'MORNING' as const, daysOfWeek: [0] };
    const routineA = createRoutineTemplate(handle.db, { ...input, title: 'A' }, parent.id, NOW);
    const routineB = createRoutineTemplate(handle.db, { ...input, title: 'B' }, parent.id, NOW);
    const actor = { userId: child1.id, role: 'CHILD' } as const;

    // Complete B first so B's log id === routineA.id (the web sends log ids from `completedToday`).
    const logB = completeRoutine(handle.db, routineB.id, actor, NOW).item;
    completeRoutine(handle.db, routineA.id, actor, NOW);
    if (logB.kind !== 'ROUTINE') throw new Error('expected routine item');
    expect(logB.log.id).toBe(routineA.id);

    revertRoutineCompletion(handle.db, logB.log.id, actor, NOW);

    const dash = getUserDashboard(handle.db, child1.id, NOW);
    expect(dash.routines.MORNING.map((r) => r.id)).toEqual([routineB.id]);
  });
});

describe('task.service — One-Off Tasks (0..N stars) & Revert', () => {
  it('completes a one-off task, awards stars, and deducts stars on revert', () => {
    const { parent, child1 } = seedFamily();
    const task = createOneOffTask(
      handle.db,
      {
        assigneeId: child1.id,
        title: 'ניקוי אופניים',
        iconEmoji: '🚲',
        stars: 5,
      },
      { userId: parent.id, role: 'PARENT' },
      NOW,
    );
    expect(task.status).toBe('PENDING');

    const comp = completeOneOffTask(
      handle.db,
      task.id,
      { userId: child1.id, role: 'CHILD' },
      NOW + 1_000,
    );
    expect(comp.starsAwarded).toBe(5);
    expect(getStarSummaryForUser(handle.db, child1.id, NOW + 1_000).total).toBe(5);

    // Reverting restores PENDING status and writes -5 star transaction
    const rev = revertOneOffTask(
      handle.db,
      task.id,
      { userId: child1.id, role: 'CHILD' },
      NOW + 2_000,
    );
    expect(rev.starsDelta).toBe(-5);
    expect(getStarSummaryForUser(handle.db, child1.id, NOW + 2_000).total).toBe(0);

    const dash = getUserDashboard(handle.db, child1.id, NOW + 2_000);
    expect(dash.oneOffTasks).toHaveLength(1);
    expect(dash.oneOffTasks[0]?.status).toBe('PENDING');

    // Parent can cancel the one-off task
    const canceled = cancelOneOffTask(
      handle.db,
      task.id,
      { userId: parent.id, role: 'PARENT' },
      NOW + 3_000,
    );
    expect(canceled.status).toBe('CANCELED');
  });
});

describe('task.service — Peer Help Requests (0 stars)', () => {
  it('supports complete, decline, requester/parent cancel, and forbids self-requests', () => {
    const { parent, child1, child2 } = seedFamily();

    expect(() =>
      createPeerRequest(
        handle.db,
        { recipientId: child1.id, title: 'לעצמי', iconEmoji: '🤝' },
        child1.id,
        NOW,
      ),
    ).toThrow(DomainValidationError);

    const req1 = createPeerRequest(
      handle.db,
      { recipientId: child2.id, title: 'עזרה בלגו', iconEmoji: '🧱' },
      child1.id,
      NOW,
    );
    // Only recipient (or parent) can complete/decline
    expect(() =>
      completePeerRequest(handle.db, req1.id, { userId: child1.id, role: 'CHILD' }, NOW),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));

    const completed = completePeerRequest(
      handle.db,
      req1.id,
      { userId: child2.id, role: 'CHILD' },
      NOW,
    );
    expect(completed.status).toBe('COMPLETED');
    expect(getStarSummaryForUser(handle.db, child2.id, NOW).total).toBe(0);

    // Revert peer request back to PENDING
    revertPeerRequest(handle.db, req1.id, { userId: child2.id, role: 'CHILD' }, NOW);
    const declined = declinePeerRequest(
      handle.db,
      req1.id,
      { userId: child2.id, role: 'CHILD' },
      NOW,
    );
    expect(declined.status).toBe('DECLINED');

    // Requester or parent can cancel a pending request
    const req2 = createPeerRequest(
      handle.db,
      { recipientId: child2.id, title: 'להביא מים', iconEmoji: '🥤' },
      child1.id,
      NOW,
    );
    const canceled = cancelPeerRequest(
      handle.db,
      req2.id,
      { userId: child1.id, role: 'CHILD' },
      NOW,
    );
    expect(canceled.status).toBe('CANCELED');
  });
});

describe('star.service & history — Daily, Weekly (Sun–Sat), Monthly, Yearly & All-Time', () => {
  it('aggregates stars accurately across Israeli calendar periods and builds daily history', () => {
    const { parent, child1 } = seedFamily();

    // 1. Complete a one-off on 2025-12-31 (+10 stars -> counts only in Total)
    const oldYear = Date.parse('2025-12-31T10:00:00+02:00');
    const tOld = createOneOffTask(
      handle.db,
      { assigneeId: child1.id, title: 'שנה שעברה', iconEmoji: '⭐', stars: 10 },
      { userId: parent.id, role: 'PARENT' },
      oldYear,
    );
    completeOneOffTask(handle.db, tOld.id, { userId: child1.id, role: 'CHILD' }, oldYear);

    // 2. Complete a one-off on 2026-09-10 (+7 stars -> counts in Yearly + Total)
    const prevMonth = Date.parse('2026-09-10T10:00:00+03:00');
    const tMonth = createOneOffTask(
      handle.db,
      { assigneeId: child1.id, title: 'חודש שעבר', iconEmoji: '⭐', stars: 7 },
      { userId: parent.id, role: 'PARENT' },
      prevMonth,
    );
    completeOneOffTask(handle.db, tMonth.id, { userId: child1.id, role: 'CHILD' }, prevMonth);

    // 3. Complete a one-off on Saturday 2026-10-24 (+4 stars -> previous week, same month)
    const prevWeekSameMonth = Date.parse('2026-10-24T10:00:00+03:00');
    const tPrevWeek = createOneOffTask(
      handle.db,
      { assigneeId: child1.id, title: 'שבוע שעבר', iconEmoji: '⭐', stars: 4 },
      { userId: parent.id, role: 'PARENT' },
      prevWeekSameMonth,
    );
    completeOneOffTask(
      handle.db,
      tPrevWeek.id,
      { userId: child1.id, role: 'CHILD' },
      prevWeekSameMonth,
    );

    // 4. Complete a pool task on Sunday 2026-10-25 (+3 stars -> Daily, Weekly, Monthly, Yearly, Total)
    const pool = createPoolTask(
      handle.db,
      { title: 'פינוי מדיח', iconEmoji: '🍽️', stars: 3, resetMode: 'COOLDOWN', cooldownMinutes: 60, isActive: true },
      parent.id,
    );
    claimPoolTask(handle.db, pool.id, child1.id, NOW);
    completePoolTask(handle.db, pool.id, child1.id, NOW);

    // 5. Query on Monday 2026-10-26 (same Israeli week as Sunday 2026-10-25!)
    const monday = Date.parse('2026-10-26T10:00:00+02:00');
    const summaryMonday = getStarSummaryForUser(handle.db, child1.id, monday);
    expect(summaryMonday).toEqual({
      userId: child1.id,
      daily: 0,
      weekly: 3,
      monthly: 7, // 4 + 3
      yearly: 14, // 7 + 4 + 3
      total: 24, // 10 + 7 + 4 + 3
    });

    const allSummary = getStarsSummaryAllUsers(handle.db, NOW);
    const c1Sun = allSummary.users.find((u) => u.userId === child1.id)!;
    expect(c1Sun.daily).toBe(3);
    expect(c1Sun.weekly).toBe(3);

    const history = getDailyHistory(handle.db, '2026-10-25');
    const c1Hist = history.users.find((u) => u.user.id === child1.id)!;
    expect(c1Hist.poolExecutions).toHaveLength(1);
    expect(c1Hist.starsEarned.daily).toBe(3);
  });
});

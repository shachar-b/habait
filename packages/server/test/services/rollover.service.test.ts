import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, migrateDb, type DbHandle } from '../../src/db/connection.js';
import {
  completeRoutine,
  createOneOffTask,
  createPeerRequest,
  createRoutineTemplate,
  getDailyHistory,
  getUserDashboard,
} from '../../src/services/task.service.js';
import {
  runDailyRollover,
  runRolloverCatchUp,
} from '../../src/services/rollover.service.js';
import { createUser } from '../../src/services/user.service.js';

let handle: DbHandle;
// Sunday 2026-10-25 09:00 Asia/Jerusalem (dayOfWeek = 0)
const SUN_MORNING = Date.parse('2026-10-25T09:00:00+02:00');
// Monday 2026-10-26 00:05 Asia/Jerusalem (dayOfWeek = 1)
const MON_MIDNIGHT = Date.parse('2026-10-26T00:05:00+02:00');

beforeEach(() => {
  handle = createDb(':memory:');
  migrateDb(handle);
});

describe('rollover.service — Midnight Daily Rollover & Boot Catch-Up', () => {
  it('marks uncompleted scheduled routines as MISSED while preserving COMPLETED routines and rolling over PENDING one-offs and peer requests', () => {
    const parent = createUser(
      handle.db,
      { name: 'אמא', avatarEmoji: '🦸‍♀️', avatarBgColor: 'bg-emerald-200', role: 'PARENT', pin: '1234' },
      SUN_MORNING,
    );
    const child = createUser(
      handle.db,
      { name: 'נועה', avatarEmoji: '🦄', avatarBgColor: 'bg-pink-200', role: 'CHILD' },
      SUN_MORNING,
    );

    // 1. Morning routine (scheduled Sun & Mon) -> child completes on Sunday
    const rMorning = createRoutineTemplate(
      handle.db,
      {
        assigneeId: child.id,
        title: 'צחצוח שיניים בוקר',
        iconEmoji: '🪥',
        timeWindow: 'MORNING',
        daysOfWeek: [0, 1],
      },
      parent.id,
      SUN_MORNING,
    );
    completeRoutine(handle.db, rMorning.id, { userId: child.id, role: 'CHILD' }, SUN_MORNING);

    // 2. Evening routine (scheduled Sun & Mon) -> left UNCOMPLETED on Sunday
    createRoutineTemplate(
      handle.db,
      {
        assigneeId: child.id,
        title: 'סידור תיק לבית ספר',
        iconEmoji: '🎒',
        timeWindow: 'EVENING',
        daysOfWeek: [0, 1],
      },
      parent.id,
      SUN_MORNING,
    );

    // 3. Tuesday-only routine (dayOfWeek = 2) -> NOT scheduled on Sunday
    createRoutineTemplate(
      handle.db,
      {
        assigneeId: child.id,
        title: 'חוג שחייה',
        iconEmoji: '🏊',
        timeWindow: 'AFTERNOON',
        daysOfWeek: [2],
      },
      parent.id,
      SUN_MORNING,
    );

    // 4. Pending one-off task & pending peer request created on Sunday
    createOneOffTask(
      handle.db,
      { assigneeId: child.id, title: 'סידור מדף ספרים', iconEmoji: '📚', stars: 3 },
      { userId: parent.id, role: 'PARENT' },
      SUN_MORNING,
    );
    createPeerRequest(
      handle.db,
      { recipientId: child.id, title: 'לעזור עם הכביסה', iconEmoji: '🧺' },
      parent.id,
      SUN_MORNING,
    );

    // Run midnight rollover for Sunday (2026-10-25), twice to prove idempotency
    const firstRun = runDailyRollover(handle.db, '2026-10-25');
    expect(firstRun.missedInserted).toBe(1);
    const secondRun = runDailyRollover(handle.db, '2026-10-25');
    expect(secondRun.missedInserted).toBe(0);

    // Sunday history shows 1 COMPLETED routine and 1 MISSED routine (Tuesday routine ignored)
    const sundayHistory = getDailyHistory(handle.db, '2026-10-25');
    const childSunday = sundayHistory.users.find((u) => u.user.id === child.id)!;
    expect(childSunday.routinesCompleted).toHaveLength(1);
    expect(childSunday.routinesCompleted[0]?.titleSnapshot).toBe('צחצוח שיניים בוקר');
    expect(childSunday.routinesMissed).toHaveLength(1);
    expect(childSunday.routinesMissed[0]?.titleSnapshot).toBe('סידור תיק לבית ספר');

    // Monday dashboard starts with a clean slate for both routines AND keeps pending one-off + peer request
    const mondayDash = getUserDashboard(handle.db, child.id, MON_MIDNIGHT);
    expect(mondayDash.routines.MORNING).toHaveLength(1);
    expect(mondayDash.routines.EVENING).toHaveLength(1);
    expect(mondayDash.oneOffTasks).toHaveLength(1);
    expect(mondayDash.peerRequests).toHaveLength(1);
    expect(mondayDash.completedToday).toHaveLength(0);
  });

  it('catches up missed days on server boot if container was offline across midnight', () => {
    const parent = createUser(
      handle.db,
      { name: 'אמא', avatarEmoji: '🦸‍♀️', avatarBgColor: 'bg-emerald-200', role: 'PARENT', pin: '1234' },
      SUN_MORNING,
    );
    const child = createUser(
      handle.db,
      { name: 'נועה', avatarEmoji: '🦄', avatarBgColor: 'bg-pink-200', role: 'CHILD' },
      SUN_MORNING,
    );

    createRoutineTemplate(
      handle.db,
      {
        assigneeId: child.id,
        title: 'קריאת ספר',
        iconEmoji: '📖',
        timeWindow: 'EVENING',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      },
      parent.id,
      SUN_MORNING,
    );

    // Booting on Tuesday 2026-10-27 08:00 -> should settle Sunday (2026-10-25) and Monday (2026-10-26)
    const tueMorning = Date.parse('2026-10-27T08:00:00+02:00');
    const catchUp = runRolloverCatchUp(handle.db, tueMorning);
    expect(catchUp.datesProcessed).toEqual(['2026-10-25', '2026-10-26']);
    expect(catchUp.totalMissedInserted).toBe(2);

    expect(
      getDailyHistory(handle.db, '2026-10-25').users.find((u) => u.user.id === child.id)!
        .routinesMissed,
    ).toHaveLength(1);
    expect(
      getDailyHistory(handle.db, '2026-10-26').users.find((u) => u.user.id === child.id)!
        .routinesMissed,
    ).toHaveLength(1);
  });
});

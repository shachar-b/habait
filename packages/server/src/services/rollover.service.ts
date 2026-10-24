import { eq } from 'drizzle-orm';
import {
  getDayOfWeekFromLogicalDate,
  getLogicalDateString,
  shiftLogicalDate,
  type LogicalDate,
} from '@habait/shared';
import type { Db } from '../db/connection.js';
import * as schema from '../db/schema.js';

export type RolloverResult = {
  targetDate: LogicalDate;
  missedInserted: number;
};

export type RolloverCatchUpResult = {
  datesProcessed: LogicalDate[];
  totalMissedInserted: number;
};

/**
 * Idempotently closes out `targetDate` (YYYY-MM-DD in Asia/Jerusalem) by inserting `MISSED`
 * rows into `routine_daily_logs` for any active routine scheduled on that day-of-week that
 * does not yet have a log entry for `targetDate`.
 * Pending `one_off_tasks` and `peer_requests` are left untouched so they roll over.
 */
export function runDailyRollover(db: Db, targetDate: LogicalDate): RolloverResult {
  return db.transaction((tx) => {
    const dow = getDayOfWeekFromLogicalDate(targetDate);
    const activeRoutines = tx
      .select()
      .from(schema.routineTemplates)
      .where(eq(schema.routineTemplates.isActive, true))
      .all();

    const existingLogs = tx
      .select({ routineId: schema.routineDailyLogs.routineId })
      .from(schema.routineDailyLogs)
      .where(eq(schema.routineDailyLogs.logicalDate, targetDate))
      .all();
    const settledIds = new Set(existingLogs.map((l) => l.routineId));

    let missedInserted = 0;

    for (const r of activeRoutines) {
      if (settledIds.has(r.id)) continue;
      const createdDate = getLogicalDateString(r.createdAt);
      if (createdDate > targetDate) continue;

      const days = JSON.parse(r.daysOfWeekJson) as number[];
      if (!days.includes(dow)) continue;

      const res = tx
        .insert(schema.routineDailyLogs)
        .values({
          routineId: r.id,
          assigneeId: r.assigneeId,
          titleSnapshot: r.title,
          iconEmojiSnapshot: r.iconEmoji,
          timeWindowSnapshot: r.timeWindow,
          logicalDate: targetDate,
          status: 'MISSED',
          completedAt: null,
        })
        .onConflictDoNothing()
        .run();

      if (res.changes > 0) {
        missedInserted += 1;
      }
    }

    return { targetDate, missedInserted };
  });
}

/**
 * Settles any past calendar days up through yesterday (`Asia/Jerusalem`) in case the server
 * or LXC container was powered off across midnight.
 */
export function runRolloverCatchUp(
  db: Db,
  now: number = Date.now(),
): RolloverCatchUpResult {
  const today = getLogicalDateString(now);
  const yesterday = shiftLogicalDate(today, -1);

  const activeRoutines = db
    .select({ createdAt: schema.routineTemplates.createdAt })
    .from(schema.routineTemplates)
    .where(eq(schema.routineTemplates.isActive, true))
    .all();

  if (activeRoutines.length === 0) {
    return { datesProcessed: [], totalMissedInserted: 0 };
  }

  let earliest = yesterday;
  for (const r of activeRoutines) {
    const d = getLogicalDateString(r.createdAt);
    if (d < earliest) earliest = d;
  }

  const minLookback = shiftLogicalDate(yesterday, -30);
  let cursor = earliest < minLookback ? minLookback : earliest;

  const datesProcessed: LogicalDate[] = [];
  let totalMissedInserted = 0;

  while (cursor <= yesterday) {
    const res = runDailyRollover(db, cursor);
    datesProcessed.push(cursor);
    totalMissedInserted += res.missedInserted;
    cursor = shiftLogicalDate(cursor, 1);
  }

  return { datesProcessed, totalMissedInserted };
}

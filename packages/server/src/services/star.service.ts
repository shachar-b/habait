import { eq } from 'drizzle-orm';
import {
  getIsraeliWeekBounds,
  getLogicalDateString,
  type LogicalDate,
  type StarSummary,
  type StarsSummaryResponse,
} from '@habait/shared';
import type { Db } from '../db/connection.js';
import * as schema from '../db/schema.js';
import { listUsers } from './user.service.js';

function resolveLogicalDate(nowOrDate: number | Date | LogicalDate): LogicalDate {
  return typeof nowOrDate === 'string' ? nowOrDate : getLogicalDateString(nowOrDate);
}

export function getStarSummaryForUser(
  db: Db,
  userId: number,
  nowOrDate: number | Date | LogicalDate = Date.now(),
): StarSummary {
  const asOfDate = resolveLogicalDate(nowOrDate);
  const { startDate, endDate } = getIsraeliWeekBounds(asOfDate);
  const monthPrefix = `${asOfDate.slice(0, 7)}-`;
  const yearPrefix = `${asOfDate.slice(0, 4)}-`;

  const rows = db
    .select({
      starsDelta: schema.starTransactions.starsDelta,
      logicalDate: schema.starTransactions.logicalDate,
    })
    .from(schema.starTransactions)
    .where(eq(schema.starTransactions.userId, userId))
    .all();

  let daily = 0;
  let weekly = 0;
  let monthly = 0;
  let yearly = 0;
  let total = 0;

  for (const r of rows) {
    total += r.starsDelta;
    if (r.logicalDate === asOfDate) daily += r.starsDelta;
    if (r.logicalDate >= startDate && r.logicalDate <= endDate) weekly += r.starsDelta;
    if (r.logicalDate.startsWith(monthPrefix)) monthly += r.starsDelta;
    if (r.logicalDate.startsWith(yearPrefix)) yearly += r.starsDelta;
  }

  return { userId, daily, weekly, monthly, yearly, total };
}

export function getStarsSummaryAllUsers(
  db: Db,
  nowOrDate: number | Date | LogicalDate = Date.now(),
): StarsSummaryResponse {
  const asOfDate = resolveLogicalDate(nowOrDate);
  const activeUsers = listUsers(db, { activeOnly: true });
  return {
    asOfDate,
    users: activeUsers.map((u) => getStarSummaryForUser(db, u.id, asOfDate)),
  };
}

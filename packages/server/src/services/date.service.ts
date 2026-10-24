import {
  getCurrentTimeWindow,
  getDayOfWeekFromLogicalDate,
  getIsraeliDayOfWeek,
  getIsraeliWeekBounds,
  getLogicalDateString,
  shiftLogicalDate,
  type LogicalDate,
  type ServerTime,
  type WeekBounds,
} from '@habait/shared';

export {
  getCurrentTimeWindow,
  getDayOfWeekFromLogicalDate,
  getIsraeliDayOfWeek,
  getIsraeliWeekBounds,
  getLogicalDateString,
  shiftLogicalDate,
  type LogicalDate,
  type WeekBounds,
};

/** Builds the canonical `ServerTime` snapshot for `now` (Unix ms or Date). */
export function getServerTime(now: Date | number = Date.now()): ServerTime {
  const ms = typeof now === 'number' ? now : now.getTime();
  const logicalDate = getLogicalDateString(ms);
  return {
    now: ms,
    logicalDate,
    dayOfWeek: getDayOfWeekFromLogicalDate(logicalDate),
    timeWindow: getCurrentTimeWindow(ms),
  };
}

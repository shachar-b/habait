import { TIME_ZONE, type ClockTimeWindow, type DayOfWeek } from './enums.js';

/** `YYYY-MM-DD` calendar date in Asia/Jerusalem. */
export type LogicalDate = string;

export type WeekBounds = {
  /** Sunday, `YYYY-MM-DD`. */
  startDate: LogicalDate;
  /** Saturday, `YYYY-MM-DD`. */
  endDate: LogicalDate;
};

const dtf = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

function extractParts(instant: Date | number): { date: LogicalDate; hour: number } {
  const d = typeof instant === 'number' ? new Date(instant) : instant;
  let year = '';
  let month = '';
  let day = '';
  let hour = '0';
  for (const part of dtf.formatToParts(d)) {
    if (part.type === 'year') year = part.value;
    else if (part.type === 'month') month = part.value;
    else if (part.type === 'day') day = part.value;
    else if (part.type === 'hour') hour = part.value;
  }
  return { date: `${year}-${month}-${day}`, hour: Number(hour) % 24 };
}

function logicalDateToUtcNoonMs(logicalDate: LogicalDate): number {
  const [y, m, d] = logicalDate.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid logicalDate: ${logicalDate}`);
  return Date.UTC(y, m - 1, d, 12, 0, 0);
}

/** Shifts a `YYYY-MM-DD` calendar date by `daysDelta` days (DST-safe). */
export function shiftLogicalDate(logicalDate: LogicalDate, daysDelta: number): LogicalDate {
  const ms = logicalDateToUtcNoonMs(logicalDate) + daysDelta * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Israeli day of week for a `YYYY-MM-DD` calendar date: 0 = Sunday … 6 = Saturday. */
export function getDayOfWeekFromLogicalDate(logicalDate: LogicalDate): DayOfWeek {
  return new Date(logicalDateToUtcNoonMs(logicalDate)).getUTCDay() as DayOfWeek;
}

/** Logical `YYYY-MM-DD` of an instant in Asia/Jerusalem. */
export function getLogicalDateString(instant: Date | number): LogicalDate {
  return extractParts(instant).date;
}

/** Israeli day of week for an instant: 0 = Sunday … 6 = Saturday. */
export function getIsraeliDayOfWeek(instant: Date | number): DayOfWeek {
  return getDayOfWeekFromLogicalDate(getLogicalDateString(instant));
}

/**
 * Auto-focus window: MORNING 05:00–11:59, AFTERNOON 12:00–16:59, EVENING 17:00–23:59.
 * Spec gap: 00:00–04:59 is undefined; we resolve it to EVENING (still "last window of the day").
 */
export function getCurrentTimeWindow(instant: Date | number): ClockTimeWindow {
  const { hour } = extractParts(instant);
  if (hour >= 5 && hour <= 11) return 'MORNING';
  if (hour >= 12 && hour <= 16) return 'AFTERNOON';
  return 'EVENING';
}

/** Sunday–Saturday logical-date bounds of the Israeli week containing the instant or logicalDate. */
export function getIsraeliWeekBounds(instant: Date | number | LogicalDate): WeekBounds {
  const date = typeof instant === 'string' ? instant : getLogicalDateString(instant);
  const dow = getDayOfWeekFromLogicalDate(date);
  return {
    startDate: shiftLogicalDate(date, -dow),
    endDate: shiftLogicalDate(date, 6 - dow),
  };
}

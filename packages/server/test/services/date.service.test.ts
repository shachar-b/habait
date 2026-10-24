import { describe, expect, it } from 'vitest';
import {
  getCurrentTimeWindow,
  getDayOfWeekFromLogicalDate,
  getIsraeliDayOfWeek,
  getIsraeliWeekBounds,
  getLogicalDateString,
  getServerTime,
  shiftLogicalDate,
} from '../../src/services/date.service.js';

describe('date.service (Asia/Jerusalem)', () => {
  it('resolves YYYY-MM-DD across midnight in winter (UTC+2) and summer (UTC+3)', () => {
    // Winter (IST, UTC+2): 2026-01-15T00:00:00+02:00 === 2026-01-14T22:00:00Z
    expect(getLogicalDateString(Date.parse('2026-01-14T21:59:59Z'))).toBe('2026-01-14');
    expect(getLogicalDateString(Date.parse('2026-01-14T22:00:00Z'))).toBe('2026-01-15');

    // Summer (IDT, UTC+3): 2026-07-15T00:00:00+03:00 === 2026-07-14T21:00:00Z
    expect(getLogicalDateString(Date.parse('2026-07-14T20:59:59Z'))).toBe('2026-07-14');
    expect(getLogicalDateString(Date.parse('2026-07-14T21:00:00Z'))).toBe('2026-07-15');
  });

  it('handles DST spring-forward (2026-03-27) and 25-hour fall-back day (2026-10-25)', () => {
    // 2026-10-25 starts at 2026-10-24T21:00:00Z (IDT UTC+3) and ends at 2026-10-25T22:00:00Z (IST UTC+2)
    expect(getLogicalDateString(Date.parse('2026-10-24T20:59:59Z'))).toBe('2026-10-24');
    expect(getLogicalDateString(Date.parse('2026-10-24T21:00:00Z'))).toBe('2026-10-25');
    expect(getLogicalDateString(Date.parse('2026-10-25T21:30:00Z'))).toBe('2026-10-25');
    expect(getLogicalDateString(Date.parse('2026-10-25T22:00:00Z'))).toBe('2026-10-26');
  });

  it('computes Israeli day of week (0=Sunday .. 6=Saturday)', () => {
    // 2026-10-25 is Sunday (0), 2026-10-30 is Friday (5), 2026-10-31 is Saturday (6)
    expect(getIsraeliDayOfWeek(Date.parse('2026-10-25T10:00:00+02:00'))).toBe(0);
    expect(getIsraeliDayOfWeek(Date.parse('2026-10-30T10:00:00+02:00'))).toBe(5);
    expect(getIsraeliDayOfWeek(Date.parse('2026-10-31T10:00:00+02:00'))).toBe(6);
    expect(getDayOfWeekFromLogicalDate('2026-10-25')).toBe(0);
    expect(getDayOfWeekFromLogicalDate('2026-10-31')).toBe(6);
  });

  it('computes Sunday–Saturday Israeli week bounds across DST and month boundaries', () => {
    const sun = Date.parse('2026-10-25T00:05:00+03:00');
    const wed = Date.parse('2026-10-28T12:00:00+02:00');
    const sat = Date.parse('2026-10-31T23:55:00+02:00');
    expect(getIsraeliWeekBounds(sun)).toEqual({ startDate: '2026-10-25', endDate: '2026-10-31' });
    expect(getIsraeliWeekBounds(wed)).toEqual({ startDate: '2026-10-25', endDate: '2026-10-31' });
    expect(getIsraeliWeekBounds(sat)).toEqual({ startDate: '2026-10-25', endDate: '2026-10-31' });

    // Spring DST transition week (Friday 2026-03-27)
    const friDst = Date.parse('2026-03-27T12:00:00+03:00');
    expect(getIsraeliWeekBounds(friDst)).toEqual({ startDate: '2026-03-22', endDate: '2026-03-28' });
  });

  it('resolves MORNING (05:00–11:59), AFTERNOON (12:00–16:59), and EVENING (17:00–04:59)', () => {
    expect(getCurrentTimeWindow(Date.parse('2026-10-25T04:59:59+02:00'))).toBe('EVENING');
    expect(getCurrentTimeWindow(Date.parse('2026-10-25T05:00:00+02:00'))).toBe('MORNING');
    expect(getCurrentTimeWindow(Date.parse('2026-10-25T11:59:59+02:00'))).toBe('MORNING');
    expect(getCurrentTimeWindow(Date.parse('2026-10-25T12:00:00+02:00'))).toBe('AFTERNOON');
    expect(getCurrentTimeWindow(Date.parse('2026-10-25T16:59:59+02:00'))).toBe('AFTERNOON');
    expect(getCurrentTimeWindow(Date.parse('2026-10-25T17:00:00+02:00'))).toBe('EVENING');
    expect(getCurrentTimeWindow(Date.parse('2026-10-25T23:59:59+02:00'))).toBe('EVENING');
  });

  it('shifts calendar dates accurately and builds ServerTime DTO', () => {
    expect(shiftLogicalDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftLogicalDate('2026-10-25', 6)).toBe('2026-10-31');

    const instant = Date.parse('2026-10-25T08:30:00+02:00');
    expect(getServerTime(instant)).toEqual({
      now: instant,
      logicalDate: '2026-10-25',
      dayOfWeek: 0,
      timeWindow: 'MORNING',
    });
  });
});

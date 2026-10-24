import { Cron } from 'croner';
import { getLogicalDateString, shiftLogicalDate, TIME_ZONE } from '@habait/shared';
import type { Db } from './db/connection.js';
import { sweepPoolExpiries } from './services/pool.service.js';
import { runDailyRollover, runRolloverCatchUp } from './services/rollover.service.js';

export type SchedulerHandle = {
  stop: () => void;
};

export function startScheduler(
  db: Db,
  now: () => number = () => Date.now(),
): SchedulerHandle {
  // Catch up missed rollovers and expired claims immediately on boot
  runRolloverCatchUp(db, now());
  sweepPoolExpiries(db, now());

  // 1. Midnight Daily Rollover (`0 0 * * *` in Asia/Jerusalem)
  const midnightJob = new Cron(
    '0 0 * * *',
    { timezone: TIME_ZONE },
    () => {
      const today = getLogicalDateString(now());
      const yesterday = shiftLogicalDate(today, -1);
      runDailyRollover(db, yesterday);
    },
  );

  // 2. Pool Claim Expiry & Cooldown Sweep (every 60 seconds)
  const sweepJob = new Cron(
    '* * * * *',
    { timezone: TIME_ZONE },
    () => {
      sweepPoolExpiries(db, now());
    },
  );

  return {
    stop: () => {
      midnightJob.stop();
      sweepJob.stop();
    },
  };
}

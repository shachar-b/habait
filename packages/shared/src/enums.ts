import { z } from 'zod';

/** Domain enums: single source of truth for Drizzle columns, Zod schemas and TS unions. */

export const USER_ROLES = ['PARENT', 'CHILD'] as const;
export const UserRoleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const TIME_WINDOWS = ['MORNING', 'AFTERNOON', 'EVENING', 'ALL_DAY'] as const;
export const TimeWindowSchema = z.enum(TIME_WINDOWS);
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

/** Windows that can be "current" by clock; ALL_DAY is never the active window. */
export const CLOCK_TIME_WINDOWS = ['MORNING', 'AFTERNOON', 'EVENING'] as const;
export type ClockTimeWindow = (typeof CLOCK_TIME_WINDOWS)[number];

export const ROUTINE_LOG_STATUSES = ['COMPLETED', 'MISSED'] as const;
export const RoutineLogStatusSchema = z.enum(ROUTINE_LOG_STATUSES);
export type RoutineLogStatus = z.infer<typeof RoutineLogStatusSchema>;

export const ONE_OFF_STATUSES = ['PENDING', 'COMPLETED', 'CANCELED'] as const;
export const OneOffStatusSchema = z.enum(ONE_OFF_STATUSES);
export type OneOffStatus = z.infer<typeof OneOffStatusSchema>;

export const POOL_RESET_MODES = ['COOLDOWN', 'AUTO_DISABLE'] as const;
export const PoolResetModeSchema = z.enum(POOL_RESET_MODES);
export type PoolResetMode = z.infer<typeof PoolResetModeSchema>;

export const POOL_STATES = ['AVAILABLE', 'CLAIMED', 'COOLDOWN'] as const;
export const PoolStateSchema = z.enum(POOL_STATES);
export type PoolState = z.infer<typeof PoolStateSchema>;

export const PEER_REQUEST_STATUSES = ['PENDING', 'COMPLETED', 'DECLINED', 'CANCELED'] as const;
export const PeerRequestStatusSchema = z.enum(PEER_REQUEST_STATUSES);
export type PeerRequestStatus = z.infer<typeof PeerRequestStatusSchema>;

export const STAR_SOURCE_TYPES = ['ONE_OFF', 'POOL', 'REVERT', 'PARENT_ADJUSTMENT'] as const;
export const StarSourceTypeSchema = z.enum(STAR_SOURCE_TYPES);
export type StarSourceType = z.infer<typeof StarSourceTypeSchema>;

/** Discriminator for any item a user can complete today (and undo). */
export const TASK_KINDS = ['ROUTINE', 'ONE_OFF', 'POOL', 'PEER_REQUEST'] as const;
export const TaskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof TaskKindSchema>;

/** Israeli week: 0 = Sunday (יום א׳) … 6 = Saturday (שבת). */
export const DayOfWeekSchema = z.number().int().min(0).max(6);
export type DayOfWeek = z.infer<typeof DayOfWeekSchema>;

/** Business constants shared by server rules and UI countdowns. */
export const POOL_CLAIM_DURATION_MS = 3_600_000;
export const DEFAULT_COOLDOWN_MINUTES = 60;
export const DEFAULT_APP_TITLE = 'הבית שלנו';
export const DEFAULT_PEER_REQUEST_EMOJI = '🤝';
export const TIME_ZONE = 'Asia/Jerusalem';

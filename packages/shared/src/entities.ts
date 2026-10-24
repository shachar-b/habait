import { z } from 'zod';
import {
  DayOfWeekSchema,
  OneOffStatusSchema,
  PeerRequestStatusSchema,
  PoolResetModeSchema,
  RoutineLogStatusSchema,
  StarSourceTypeSchema,
  TimeWindowSchema,
  UserRoleSchema,
} from './enums.js';

/** Primitive building blocks reused by every contract. */

export const IdSchema = z.number().int().positive();
export type Id = z.infer<typeof IdSchema>;

/** Route params arrive as strings. */
export const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });

/** Unix timestamp in milliseconds. */
export const TimestampSchema = z.number().int().nonnegative();

/** `YYYY-MM-DD`, must be a real calendar date. */
export const LogicalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'Invalid calendar date');

/** 4-digit numeric PIN (plain text only on the wire; stored hashed). */
export const PinSchema = z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits');

export const TitleSchema = z.string().trim().min(1).max(120);
export const EmojiSchema = z.string().trim().min(1).max(16);
export const StarsSchema = z.number().int().min(0).max(1000);
export const DaysOfWeekSchema = z
  .array(DayOfWeekSchema)
  .min(1)
  .refine((d) => new Set(d).size === d.length, 'Duplicate days');

// ---------------------------------------------------------------------------
// Entity DTOs (what leaves the server; never contains pinHash)
// ---------------------------------------------------------------------------

export const AppSettingsSchema = z.object({
  appTitle: z.string(),
  announcementText: z.string().nullable(),
  announcementEmoji: z.string().nullable(),
  announcementUpdatedBy: IdSchema.nullable(),
  updatedAt: TimestampSchema,
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const UserSchema = z.object({
  id: IdSchema,
  name: z.string(),
  avatarEmoji: z.string(),
  avatarBgColor: z.string(),
  role: UserRoleSchema,
  hasPin: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: TimestampSchema,
});
export type User = z.infer<typeof UserSchema>;

export const RoutineTemplateSchema = z.object({
  id: IdSchema,
  assigneeId: IdSchema,
  title: z.string(),
  iconEmoji: z.string(),
  timeWindow: TimeWindowSchema,
  daysOfWeek: DaysOfWeekSchema,
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdBy: IdSchema,
  createdAt: TimestampSchema,
});
export type RoutineTemplate = z.infer<typeof RoutineTemplateSchema>;

export const RoutineDailyLogSchema = z.object({
  id: IdSchema,
  routineId: IdSchema,
  assigneeId: IdSchema,
  titleSnapshot: z.string(),
  iconEmojiSnapshot: z.string(),
  timeWindowSnapshot: TimeWindowSchema,
  logicalDate: LogicalDateSchema,
  status: RoutineLogStatusSchema,
  completedAt: TimestampSchema.nullable(),
});
export type RoutineDailyLog = z.infer<typeof RoutineDailyLogSchema>;

export const OneOffTaskSchema = z.object({
  id: IdSchema,
  assigneeId: IdSchema,
  createdById: IdSchema,
  title: z.string(),
  iconEmoji: z.string(),
  stars: StarsSchema,
  status: OneOffStatusSchema,
  issuedDate: LogicalDateSchema,
  issuedAt: TimestampSchema,
  finishedDate: LogicalDateSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
});
export type OneOffTask = z.infer<typeof OneOffTaskSchema>;

const PoolTaskBaseSchema = z.object({
  id: IdSchema,
  title: z.string(),
  iconEmoji: z.string(),
  stars: StarsSchema,
  resetMode: PoolResetModeSchema,
  cooldownMinutes: z.number().int().positive(),
  isActive: z.boolean(),
  lastCompletedAt: TimestampSchema.nullable(),
  createdById: IdSchema,
});

/**
 * Pool task as seen by clients, discriminated on `state` so illegal combinations
 * (e.g. AVAILABLE with a claimer, CLAIMED without an expiry) are unrepresentable.
 */
export const PoolTaskSchema = z.discriminatedUnion('state', [
  PoolTaskBaseSchema.extend({ state: z.literal('AVAILABLE') }),
  PoolTaskBaseSchema.extend({
    state: z.literal('CLAIMED'),
    claimedByUserId: IdSchema,
    claimedAt: TimestampSchema,
    claimExpiresAt: TimestampSchema,
  }),
  PoolTaskBaseSchema.extend({
    state: z.literal('COOLDOWN'),
    cooldownEndsAt: TimestampSchema,
  }),
]);
export type PoolTask = z.infer<typeof PoolTaskSchema>;

export const PoolTaskExecutionSchema = z.object({
  id: IdSchema,
  poolTaskId: IdSchema,
  userId: IdSchema,
  titleSnapshot: z.string(),
  iconEmojiSnapshot: z.string(),
  starsAwarded: StarsSchema,
  claimedAt: TimestampSchema,
  completedAt: TimestampSchema,
  logicalDate: LogicalDateSchema,
  revertedAt: TimestampSchema.nullable(),
});
export type PoolTaskExecution = z.infer<typeof PoolTaskExecutionSchema>;

export const PeerRequestSchema = z.object({
  id: IdSchema,
  requesterId: IdSchema,
  recipientId: IdSchema,
  title: z.string(),
  iconEmoji: z.string(),
  status: PeerRequestStatusSchema,
  issuedDate: LogicalDateSchema,
  issuedAt: TimestampSchema,
  finishedDate: LogicalDateSchema.nullable(),
  finishedAt: TimestampSchema.nullable(),
});
export type PeerRequest = z.infer<typeof PeerRequestSchema>;

export const StarTransactionSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  sourceType: StarSourceTypeSchema,
  sourceId: IdSchema.nullable(),
  starsDelta: z.number().int(),
  description: z.string(),
  logicalDate: LogicalDateSchema,
  createdAt: TimestampSchema,
});
export type StarTransaction = z.infer<typeof StarTransactionSchema>;

/**
 * A completed item shown under `בוצעו היום` / history, discriminated on `kind`.
 * `sourceId` is the routine_daily_logs / one_off_tasks / pool_task_executions / peer_requests id.
 */
export const CompletedItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ROUTINE'), log: RoutineDailyLogSchema }),
  z.object({ kind: z.literal('ONE_OFF'), task: OneOffTaskSchema }),
  z.object({ kind: z.literal('POOL'), execution: PoolTaskExecutionSchema }),
  z.object({ kind: z.literal('PEER_REQUEST'), request: PeerRequestSchema }),
]);
export type CompletedItem = z.infer<typeof CompletedItemSchema>;

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import {
  ONE_OFF_STATUSES,
  PEER_REQUEST_STATUSES,
  POOL_RESET_MODES,
  POOL_STATES,
  ROUTINE_LOG_STATUSES,
  STAR_SOURCE_TYPES,
  TIME_WINDOWS,
  USER_ROLES,
  DEFAULT_APP_TITLE,
  DEFAULT_COOLDOWN_MINUTES,
  DEFAULT_PEER_REQUEST_EMOJI,
} from '@habait/shared';

/**
 * Design notes
 * - Timestamps: Unix ms integers. Calendar dates: `YYYY-MM-DD` text in Asia/Jerusalem.
 * - Enums are TEXT columns typed via `enum:` (TS only) and also guarded by explicit CHECK constraints.
 * - History is immutable: logs/executions/ledger keep title snapshots and are never cascaded away.
 *   Users and templates are soft-deleted via `isActive`; only routine templates cascade from users.
 * - Stars are NEVER a column on `users`; balances are SUM(star_transactions.starsDelta).
 * - Domain rules the DB can cheaply guarantee are enforced here as a last line of defence
 *   (PARENT PIN, 1-WIP pool claim, no self-requests, stars >= 0); services still own the logic.
 */

const bool = (name: string) => integer(name, { mode: 'boolean' });

const enumList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

// ---------------------------------------------------------------------------
// app_settings — singleton row (id = 1)
// ---------------------------------------------------------------------------
export const appSettings = sqliteTable(
  'app_settings',
  {
    id: integer('id').primaryKey(),
    appTitle: text('app_title').notNull().default(DEFAULT_APP_TITLE),
    announcementText: text('announcement_text'),
    announcementEmoji: text('announcement_emoji'),
    announcementUpdatedBy: integer('announcement_updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [check('app_settings_singleton', sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    nickname: text('nickname'),
    avatarEmoji: text('avatar_emoji').notNull(),
    avatarBgColor: text('avatar_bg_color').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull(),
    pinHash: text('pin_hash'),
    isActive: bool('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    check('users_role_valid', sql`${t.role} IN (${enumList(USER_ROLES)})`),
    // Parents can never exist without a PIN.
    check('users_parent_has_pin', sql`${t.role} <> 'PARENT' OR ${t.pinHash} IS NOT NULL`),
    index('users_active_sort_idx').on(t.isActive, t.sortOrder),
  ],
);

// ---------------------------------------------------------------------------
// routine_templates / routine_daily_logs
// ---------------------------------------------------------------------------
export const routineTemplates = sqliteTable(
  'routine_templates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    assigneeId: integer('assignee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    iconEmoji: text('icon_emoji').notNull(),
    timeWindow: text('time_window', { enum: TIME_WINDOWS }).notNull(),
    /** JSON array of Israeli weekdays, 0 = Sunday … 6 = Saturday. Validated by shared Zod. */
    daysOfWeekJson: text('days_of_week_json').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: bool('is_active').notNull().default(true),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    check('routine_templates_window_valid', sql`${t.timeWindow} IN (${enumList(TIME_WINDOWS)})`),
    check('routine_templates_days_json', sql`json_valid(${t.daysOfWeekJson})`),
    index('routine_templates_assignee_idx').on(t.assigneeId, t.isActive),
  ],
);

export const routineDailyLogs = sqliteTable(
  'routine_daily_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    routineId: integer('routine_id')
      .notNull()
      .references(() => routineTemplates.id),
    assigneeId: integer('assignee_id')
      .notNull()
      .references(() => users.id),
    titleSnapshot: text('title_snapshot').notNull(),
    iconEmojiSnapshot: text('icon_emoji_snapshot').notNull(),
    timeWindowSnapshot: text('time_window_snapshot', { enum: TIME_WINDOWS }).notNull(),
    logicalDate: text('logical_date').notNull(),
    status: text('status', { enum: ROUTINE_LOG_STATUSES }).notNull(),
    completedAt: integer('completed_at'),
  },
  (t) => [
    // One outcome per routine per day; also makes the midnight rollover idempotent.
    uniqueIndex('routine_daily_logs_routine_date_uq').on(t.routineId, t.logicalDate),
    index('routine_daily_logs_date_idx').on(t.logicalDate),
    index('routine_daily_logs_assignee_date_idx').on(t.assigneeId, t.logicalDate),
    check('routine_daily_logs_status_valid', sql`${t.status} IN (${enumList(ROUTINE_LOG_STATUSES)})`),
    check(
      'routine_daily_logs_completed_at',
      sql`(${t.status} = 'COMPLETED') = (${t.completedAt} IS NOT NULL)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// one_off_tasks
// ---------------------------------------------------------------------------
export const oneOffTasks = sqliteTable(
  'one_off_tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    assigneeId: integer('assignee_id')
      .notNull()
      .references(() => users.id),
    createdById: integer('created_by_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    iconEmoji: text('icon_emoji').notNull(),
    stars: integer('stars').notNull().default(0),
    status: text('status', { enum: ONE_OFF_STATUSES }).notNull(),
    issuedDate: text('issued_date').notNull(),
    issuedAt: integer('issued_at').notNull(),
    finishedDate: text('finished_date'),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    check('one_off_tasks_stars_nonneg', sql`${t.stars} >= 0`),
    check('one_off_tasks_status_valid', sql`${t.status} IN (${enumList(ONE_OFF_STATUSES)})`),
    index('one_off_tasks_assignee_status_idx').on(t.assigneeId, t.status),
    index('one_off_tasks_finished_date_idx').on(t.finishedDate),
  ],
);

// ---------------------------------------------------------------------------
// pool_tasks / pool_task_executions
// ---------------------------------------------------------------------------
export const poolTasks = sqliteTable(
  'pool_tasks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    iconEmoji: text('icon_emoji').notNull(),
    stars: integer('stars').notNull(),
    resetMode: text('reset_mode', { enum: POOL_RESET_MODES }).notNull(),
    cooldownMinutes: integer('cooldown_minutes').notNull().default(DEFAULT_COOLDOWN_MINUTES),
    isActive: bool('is_active').notNull().default(true),
    state: text('state', { enum: POOL_STATES }).notNull().default('AVAILABLE'),
    claimedByUserId: integer('claimed_by_user_id').references(() => users.id),
    claimedAt: integer('claimed_at'),
    claimExpiresAt: integer('claim_expires_at'),
    cooldownEndsAt: integer('cooldown_ends_at'),
    lastCompletedAt: integer('last_completed_at'),
    createdById: integer('created_by_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    check('pool_tasks_stars_nonneg', sql`${t.stars} >= 0`),
    check('pool_tasks_cooldown_positive', sql`${t.cooldownMinutes} > 0`),
    check('pool_tasks_state_valid', sql`${t.state} IN (${enumList(POOL_STATES)})`),
    check('pool_tasks_reset_mode_valid', sql`${t.resetMode} IN (${enumList(POOL_RESET_MODES)})`),
    // State <-> columns consistency: a claim exists iff state = CLAIMED, a cooldown iff COOLDOWN.
    check(
      'pool_tasks_claim_consistent',
      sql`(${t.state} = 'CLAIMED') = (${t.claimedByUserId} IS NOT NULL AND ${t.claimedAt} IS NOT NULL AND ${t.claimExpiresAt} IS NOT NULL)`,
    ),
    check(
      'pool_tasks_cooldown_consistent',
      sql`(${t.state} = 'COOLDOWN') = (${t.cooldownEndsAt} IS NOT NULL)`,
    ),
    // Strict 1-WIP: a user can hold at most one CLAIMED pool task (service raises POOL_WIP_LIMIT_REACHED first).
    uniqueIndex('pool_tasks_one_claim_per_user_uq')
      .on(t.claimedByUserId)
      .where(sql`${t.state} = 'CLAIMED'`),
    index('pool_tasks_active_state_idx').on(t.isActive, t.state),
  ],
);

export const poolTaskExecutions = sqliteTable(
  'pool_task_executions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    poolTaskId: integer('pool_task_id')
      .notNull()
      .references(() => poolTasks.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    titleSnapshot: text('title_snapshot').notNull(),
    iconEmojiSnapshot: text('icon_emoji_snapshot').notNull(),
    starsAwarded: integer('stars_awarded').notNull(),
    claimedAt: integer('claimed_at').notNull(),
    completedAt: integer('completed_at').notNull(),
    logicalDate: text('logical_date').notNull(),
    revertedAt: integer('reverted_at'),
  },
  (t) => [
    check('pool_task_executions_stars_nonneg', sql`${t.starsAwarded} >= 0`),
    index('pool_task_executions_date_idx').on(t.logicalDate),
    index('pool_task_executions_user_date_idx').on(t.userId, t.logicalDate),
    index('pool_task_executions_task_idx').on(t.poolTaskId),
  ],
);

// ---------------------------------------------------------------------------
// peer_requests
// ---------------------------------------------------------------------------
export const peerRequests = sqliteTable(
  'peer_requests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requesterId: integer('requester_id')
      .notNull()
      .references(() => users.id),
    recipientId: integer('recipient_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    iconEmoji: text('icon_emoji').notNull().default(DEFAULT_PEER_REQUEST_EMOJI),
    status: text('status', { enum: PEER_REQUEST_STATUSES }).notNull(),
    issuedDate: text('issued_date').notNull(),
    issuedAt: integer('issued_at').notNull(),
    finishedDate: text('finished_date'),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    check('peer_requests_not_self', sql`${t.requesterId} <> ${t.recipientId}`),
    check('peer_requests_status_valid', sql`${t.status} IN (${enumList(PEER_REQUEST_STATUSES)})`),
    index('peer_requests_recipient_status_idx').on(t.recipientId, t.status),
    index('peer_requests_finished_date_idx').on(t.finishedDate),
  ],
);

// ---------------------------------------------------------------------------
// star_transactions — immutable, append-only ledger
// ---------------------------------------------------------------------------
export const starTransactions = sqliteTable(
  'star_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    sourceType: text('source_type', { enum: STAR_SOURCE_TYPES }).notNull(),
    sourceId: integer('source_id'),
    starsDelta: integer('stars_delta').notNull(),
    description: text('description').notNull(),
    logicalDate: text('logical_date').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    check('star_transactions_source_valid', sql`${t.sourceType} IN (${enumList(STAR_SOURCE_TYPES)})`),
    check('star_transactions_delta_nonzero', sql`${t.starsDelta} <> 0`),
    index('star_transactions_user_idx').on(t.userId),
    index('star_transactions_user_date_idx').on(t.userId, t.logicalDate),
    index('star_transactions_date_idx').on(t.logicalDate),
    index('star_transactions_created_at_idx').on(t.createdAt),
  ],
);

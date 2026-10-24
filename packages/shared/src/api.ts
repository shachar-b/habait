import { z } from 'zod';
import {
  CompletedItemSchema,
  AppSettingsSchema,
  DaysOfWeekSchema,
  EmojiSchema,
  IdSchema,
  LogicalDateSchema,
  OneOffTaskSchema,
  PeerRequestSchema,
  PinSchema,
  PoolTaskExecutionSchema,
  PoolTaskSchema,
  RoutineDailyLogSchema,
  RoutineTemplateSchema,
  StarsSchema,
  TimestampSchema,
  TitleSchema,
  UserSchema,
} from './entities.js';
import {
  DayOfWeekSchema,
  PoolResetModeSchema,
  TimeWindowSchema,
  UserRoleSchema,
  DEFAULT_PEER_REQUEST_EMOJI,
} from './enums.js';

/**
 * Request/response contracts for `/api/v1`. Conventions:
 * - Actor identity comes from the signed session cookie, never from the body.
 * - Actions are POST sub-resources of the noun they change (`/pool/:id/claim`).
 * - Errors are always `ApiErrorSchema`; statuses come from `ERROR_HTTP_STATUS`.
 * - Complete/revert endpoints return the affected item + the star delta.
 */

// ---------------------------------------------------------------------------
// GET /lobby
// ---------------------------------------------------------------------------

export const LobbyProfileSchema = z.object({
  id: IdSchema,
  name: z.string(),
  avatarEmoji: z.string(),
  avatarBgColor: z.string(),
  role: UserRoleSchema,
  hasPin: z.boolean(),
  /** Boolean only — the lobby must never leak open-task counts. */
  hasOpenTasks: z.boolean(),
  totalStars: z.number().int(),
});
export type LobbyProfile = z.infer<typeof LobbyProfileSchema>;

export const ServerTimeSchema = z.object({
  /** Unix ms. */
  now: TimestampSchema,
  logicalDate: LogicalDateSchema,
  dayOfWeek: DayOfWeekSchema,
  timeWindow: TimeWindowSchema.exclude(['ALL_DAY']),
});
export type ServerTime = z.infer<typeof ServerTimeSchema>;

export const LobbyResponseSchema = z.object({
  appSettings: AppSettingsSchema,
  serverTime: ServerTimeSchema,
  profiles: z.array(LobbyProfileSchema),
});
export type LobbyResponse = z.infer<typeof LobbyResponseSchema>;

// ---------------------------------------------------------------------------
// POST /auth/login  (sets HTTP-only signed session cookie)
// ---------------------------------------------------------------------------

export const LoginRequestSchema = z.object({
  userId: IdSchema,
  /** Required when the profile has a PIN (always for PARENT). */
  pin: PinSchema.optional(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({ user: UserSchema });
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// ---------------------------------------------------------------------------
// GET /users/:id/dashboard   (`היום שלי`)
// ---------------------------------------------------------------------------

export const DashboardResponseSchema = z.object({
  serverTime: ServerTimeSchema,
  user: UserSchema,
  totalStars: z.number().int(),
  /** Section 1: the user's single claimed pool task, if any. */
  activeClaim: PoolTaskSchema.nullable(),
  /** Section 2 */
  oneOffTasks: z.array(OneOffTaskSchema),
  /** Section 3: today's open scheduled routines per window. */
  routines: z.object({
    MORNING: z.array(RoutineTemplateSchema),
    AFTERNOON: z.array(RoutineTemplateSchema),
    EVENING: z.array(RoutineTemplateSchema),
    ALL_DAY: z.array(RoutineTemplateSchema),
  }),
  /** Section 4: pending requests addressed to this user. */
  peerRequests: z.array(PeerRequestSchema),
  /** Section 5 */
  completedToday: z.array(CompletedItemSchema),
});
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;

// ---------------------------------------------------------------------------
// Complete / revert (routines, one-offs, pool, peer requests)
// ---------------------------------------------------------------------------

/** POST /routines/:id/complete | /one-offs/:id/complete | /pool/:id/complete */
export const CompleteResponseSchema = z.object({
  item: CompletedItemSchema,
  starsAwarded: z.number().int().nonnegative(),
});
export type CompleteResponse = z.infer<typeof CompleteResponseSchema>;

/** POST /routines/:id/revert | /one-offs/:id/revert | /pool/executions/:execId/revert */
export const RevertResponseSchema = z.object({
  /** Negative compensating delta written to the ledger (0 if nothing was awarded). */
  starsDelta: z.number().int().nonpositive(),
});
export type RevertResponse = z.infer<typeof RevertResponseSchema>;

export const ExecIdParamSchema = z.object({ execId: z.coerce.number().int().positive() });

// ---------------------------------------------------------------------------
// Pool  (`קופת המשימות`)
// ---------------------------------------------------------------------------

/** GET /pool — active tasks, after lazy expiry evaluation. */
export const PoolListResponseSchema = z.object({ tasks: z.array(PoolTaskSchema) });
export type PoolListResponse = z.infer<typeof PoolListResponseSchema>;

/** POST /pool/:id/claim | /pool/:id/unclaim */
export const PoolTaskResponseSchema = z.object({ task: PoolTaskSchema });
export type PoolTaskResponse = z.infer<typeof PoolTaskResponseSchema>;

/** POST /pool/:id/complete additionally reports the execution (for undo). */
export const PoolCompleteResponseSchema = CompleteResponseSchema.extend({
  task: PoolTaskSchema,
  execution: PoolTaskExecutionSchema,
});
export type PoolCompleteResponse = z.infer<typeof PoolCompleteResponseSchema>;

// ---------------------------------------------------------------------------
// Peer requests  (`בקשות עזרה`)
// ---------------------------------------------------------------------------

/** POST /peer-requests — requester is the session user; recipient must differ. */
export const CreatePeerRequestSchema = z.object({
  recipientId: IdSchema,
  title: TitleSchema,
  iconEmoji: EmojiSchema.default(DEFAULT_PEER_REQUEST_EMOJI),
});
export type CreatePeerRequest = z.infer<typeof CreatePeerRequestSchema>;

/** POST /peer-requests (201) and /:id/complete | /decline | /cancel (200) */
export const PeerRequestResponseSchema = z.object({ request: PeerRequestSchema });
export type PeerRequestResponse = z.infer<typeof PeerRequestResponseSchema>;

// ---------------------------------------------------------------------------
// GET /stars/summary
// ---------------------------------------------------------------------------

export const StarSummarySchema = z.object({
  userId: IdSchema,
  daily: z.number().int(),
  weekly: z.number().int(),
  monthly: z.number().int(),
  yearly: z.number().int(),
  total: z.number().int(),
});
export type StarSummary = z.infer<typeof StarSummarySchema>;

export const StarsSummaryResponseSchema = z.object({
  asOfDate: LogicalDateSchema,
  users: z.array(StarSummarySchema),
});
export type StarsSummaryResponse = z.infer<typeof StarsSummaryResponseSchema>;

// ---------------------------------------------------------------------------
// GET /history?date=YYYY-MM-DD
// ---------------------------------------------------------------------------

export const HistoryQuerySchema = z.object({ date: LogicalDateSchema });
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

export const UserHistorySchema = z.object({
  user: UserSchema,
  routinesCompleted: z.array(RoutineDailyLogSchema),
  routinesMissed: z.array(RoutineDailyLogSchema),
  oneOffsCompleted: z.array(OneOffTaskSchema),
  poolExecutions: z.array(PoolTaskExecutionSchema),
  peerRequests: z.array(PeerRequestSchema),
  starsEarned: StarSummarySchema,
});
export type UserHistory = z.infer<typeof UserHistorySchema>;

export const HistoryResponseSchema = z.object({
  date: LogicalDateSchema,
  users: z.array(UserHistorySchema),
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

// ---------------------------------------------------------------------------
// Admin  (/admin/* — parent session guard)
// ---------------------------------------------------------------------------

/** PATCH /admin/settings — `null` clears the announcement. */
export const UpdateSettingsRequestSchema = z
  .object({
    appTitle: TitleSchema,
    announcementText: z.string().trim().max(280).nullable(),
    announcementEmoji: EmojiSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;

export const SettingsResponseSchema = z.object({ settings: AppSettingsSchema });
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;

const UserFieldsSchema = z.object({
  name: TitleSchema,
  avatarEmoji: EmojiSchema,
  avatarBgColor: z.string().trim().min(1).max(40),
  sortOrder: z.number().int().optional(),
});

/**
 * POST /admin/users — PIN is mandatory for PARENT, optional for CHILD.
 * `null`/omitted `pin` on a CHILD means "no PIN".
 */
export const CreateUserRequestSchema = z.discriminatedUnion('role', [
  UserFieldsSchema.extend({ role: z.literal('PARENT'), pin: PinSchema }),
  UserFieldsSchema.extend({ role: z.literal('CHILD'), pin: PinSchema.nullish() }),
]);
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

/**
 * PATCH /admin/users/:id — `pin: null` removes a PIN. The "PARENT PIN can never be removed"
 * rule needs the stored role, so the user service (not this schema) enforces it.
 */
export const UpdateUserRequestSchema = UserFieldsSchema.extend({
  role: UserRoleSchema,
  pin: PinSchema.nullable(),
  isActive: z.boolean(),
})
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const UserResponseSchema = z.object({ user: UserSchema });
export type UserResponse = z.infer<typeof UserResponseSchema>;
export const UserListResponseSchema = z.object({ users: z.array(UserSchema) });
export type UserListResponse = z.infer<typeof UserListResponseSchema>;

const RoutineFieldsSchema = z.object({
  assigneeId: IdSchema,
  title: TitleSchema,
  iconEmoji: EmojiSchema,
  timeWindow: TimeWindowSchema,
  daysOfWeek: DaysOfWeekSchema,
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

/** POST /admin/routines */
export const CreateRoutineRequestSchema = RoutineFieldsSchema;
export type CreateRoutineRequest = z.infer<typeof CreateRoutineRequestSchema>;
/** PATCH /admin/routines/:id */
export const UpdateRoutineRequestSchema = RoutineFieldsSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'At least one field is required',
);
export type UpdateRoutineRequest = z.infer<typeof UpdateRoutineRequestSchema>;
export const RoutineResponseSchema = z.object({ routine: RoutineTemplateSchema });
export type RoutineResponse = z.infer<typeof RoutineResponseSchema>;
export const RoutineListResponseSchema = z.object({ routines: z.array(RoutineTemplateSchema) });
export type RoutineListResponse = z.infer<typeof RoutineListResponseSchema>;

const OneOffFieldsSchema = z.object({
  assigneeId: IdSchema,
  title: TitleSchema,
  iconEmoji: EmojiSchema,
  stars: StarsSchema.default(0),
});

/** POST /admin/one-offs (creator = session parent) */
export const CreateOneOffRequestSchema = OneOffFieldsSchema;
export type CreateOneOffRequest = z.infer<typeof CreateOneOffRequestSchema>;
/** PATCH /admin/one-offs/:id (PENDING tasks only) */
export const UpdateOneOffRequestSchema = OneOffFieldsSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'At least one field is required',
);
export type UpdateOneOffRequest = z.infer<typeof UpdateOneOffRequestSchema>;
/** POST /admin/one-offs/:id/cancel and POST /admin/peer-requests/:id/cancel use no body. */
export const OneOffResponseSchema = z.object({ task: OneOffTaskSchema });
export type OneOffResponse = z.infer<typeof OneOffResponseSchema>;

const PoolFieldsSchema = z.object({
  title: TitleSchema,
  iconEmoji: EmojiSchema,
  stars: StarsSchema,
  resetMode: PoolResetModeSchema,
  cooldownMinutes: z.number().int().positive().max(10_080).default(60),
  isActive: z.boolean().default(true),
});

/** POST /admin/pool */
export const CreatePoolTaskRequestSchema = PoolFieldsSchema;
export type CreatePoolTaskRequest = z.infer<typeof CreatePoolTaskRequestSchema>;
/** PATCH /admin/pool/:id */
export const UpdatePoolTaskRequestSchema = PoolFieldsSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'At least one field is required',
);
export type UpdatePoolTaskRequest = z.infer<typeof UpdatePoolTaskRequestSchema>;

/** GET /admin/pool. (PATCH /admin/pool/:id/toggle-active is a one-tap switch with no body, returns `PoolTaskResponse`.) */
export const AdminPoolListResponseSchema = z.object({
  /** Includes inactive tasks, unlike the public GET /pool. */
  tasks: z.array(PoolTaskSchema),
});
export type AdminPoolListResponse = z.infer<typeof AdminPoolListResponseSchema>;

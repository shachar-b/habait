import { z } from 'zod';

/** Stable machine-readable error codes returned by the API. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'INVALID_PIN',
  'TOO_MANY_ATTEMPTS',
  'FORBIDDEN',
  'NOT_FOUND',
  'POOL_WIP_LIMIT_REACHED',
  'POOL_TASK_NOT_AVAILABLE',
  'POOL_NOT_CLAIMER',
  'POOL_CLAIM_EXPIRED',
  'INVALID_STATE_TRANSITION',
  'REVERT_NOT_ALLOWED',
  'INTERNAL_ERROR',
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** HTTP status each error code maps to; routes must not invent their own. */
export const ERROR_HTTP_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  INVALID_PIN: 401,
  TOO_MANY_ATTEMPTS: 429,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  POOL_WIP_LIMIT_REACHED: 409,
  POOL_TASK_NOT_AVAILABLE: 409,
  POOL_NOT_CLAIMER: 403,
  POOL_CLAIM_EXPIRED: 409,
  INVALID_STATE_TRANSITION: 409,
  REVERT_NOT_ALLOWED: 403,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorCode, number>;

/** Uniform error body for every non-2xx response. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

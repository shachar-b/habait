import { ERROR_HTTP_STATUS, type ErrorCode } from '@habait/shared';

/** Base typed domain error mapped directly to HTTP status codes by routes. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.statusCode = ERROR_HTTP_STATUS[code];
    this.details = details;
  }
}

/** Thrown when a domain validation invariant is violated (e.g. PARENT without PIN). */
export class DomainValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, details);
    this.name = 'DomainValidationError';
  }
}

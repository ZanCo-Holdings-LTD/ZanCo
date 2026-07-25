/**
 * Typed application errors.
 *
 * Every error carries an HTTP status and a stable machine code so the web app
 * and the worker return the same shape and the client never has to string-match
 * a message.
 */

export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation_failed'
  | 'export_blocked'
  | 'quota_exceeded'
  | 'upstream_failed'
  | 'grounding_failed'
  | 'internal';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation_failed: 422,
  export_blocked: 422,
  quota_exceeded: 402,
  upstream_failed: 502,
  grounding_failed: 422,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  /** Whether a caller may usefully retry. Drives the job queue's backoff path. */
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = options.details;
    this.retryable = options.retryable ?? code === 'upstream_failed';
  }

  toJSON(): { error: { code: ErrorCode; message: string; details?: Record<string, unknown> } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const unauthorized = (message = 'Not signed in') => new AppError('unauthorized', message);
export const forbidden = (message = 'Not permitted') => new AppError('forbidden', message);
export const notFound = (what = 'Resource') => new AppError('not_found', `${what} not found`);

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Normalise anything thrown into an AppError so handlers stay small. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return new AppError('internal', message, { cause: error });
}

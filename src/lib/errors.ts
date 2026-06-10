/**
 * Typed errors for LabelHub.
 *
 * Server Actions throw these; clients catch via try/catch (or Form error
 * binding) and switch on `code`. Route Handlers convert `.status` to HTTP.
 *
 * Per the security model: NEVER log full user/request objects. Just throw
 * these typed errors and let the framework surface them.
 *
 * ---------------------------------------------------------------------------
 * Error-envelope contract (how these typed errors flow across each boundary):
 *
 *   - Server Actions THROW these typed `AppError` subclasses on failure. They
 *     do NOT return `{ ok: false, error }` envelopes. Clients await the action
 *     inside try/catch and read `.message` for display (and MAY `switch` on
 *     `.code` for branching). Use `getErrorMessage` from
 *     `@/lib/errors/client-utils` in the catch handler — it is client-safe
 *     (no 'server-only') and unwraps the thrown value to a string.
 *
 *   - Route Handlers map `.status` onto the HTTP response (e.g. a
 *     `ValidationError` becomes a 400, a `ForbiddenError` a 403). They catch
 *     the typed error, surface `.message`/`.code` where safe, and log full
 *     detail server-side only.
 *
 *   - Fire-and-forget helpers (those invoked from `after()` or otherwise run
 *     in the background, where there is no caller awaiting a result) SWALLOW
 *     failures: they `.catch()` and `console.warn` rather than throwing, since
 *     a throw in that context has nowhere to surface.
 *
 * Some legacy actions still return `{ ok: false, error }` envelopes where a
 * caller reads that failure shape off the resolved value (rather than relying
 * on catch); those are migrated case-by-case to avoid breaking such callers.
 * ---------------------------------------------------------------------------
 */
export class AppError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.status = status
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in required.') {
    super('UNAUTHORIZED', message, 401)
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource.') {
    super('FORBIDDEN', message, 403)
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'Resource') {
    super('NOT_FOUND', `${what} not found.`, 404)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400)
  }
}

export class QuotaExceededError extends AppError {
  constructor(message = 'Daily quota exceeded. Try again tomorrow.') {
    super('QUOTA_EXCEEDED', message, 429)
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource is in a conflicting state.') {
    super('CONFLICT', message, 409)
  }
}

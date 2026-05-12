/**
 * Typed errors for LabelHub.
 *
 * Server Actions throw these; clients catch via try/catch (or Form error
 * binding) and switch on `code`. Route Handlers convert `.status` to HTTP.
 *
 * Per the security model: NEVER log full user/request objects. Just throw
 * these typed errors and let the framework surface them.
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

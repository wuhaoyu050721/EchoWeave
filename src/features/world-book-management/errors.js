export class WorldBookValidationError extends Error {
  constructor(issues = []) {
    const normalizedIssues = Array.isArray(issues) ? issues : []
    super(normalizedIssues[0]?.message || '世界书内容无效')
    this.name = 'WorldBookValidationError'
    this.code = 'world_book_validation_failed'
    this.issues = normalizedIssues
  }
}

export class WorldBookManagementError extends Error {
  constructor(code, message, {
    cause = null,
    stage = 'unknown',
    details = {},
    rollbackErrors = []
  } = {}) {
    super(message)
    this.name = 'WorldBookManagementError'
    this.code = code
    this.stage = stage
    this.details = details
    this.rollbackErrors = rollbackErrors
    this.rollbackSucceeded = rollbackErrors.length === 0
    if (cause) this.cause = cause
  }
}

export function worldBookManagementError(code, message, options) {
  return new WorldBookManagementError(code, message, options)
}

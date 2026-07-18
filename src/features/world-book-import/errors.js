export class WorldBookImportError extends Error {
  constructor(code, message, { stage = 'inspect', details = null, cause = null } = {}) {
    super(message)
    this.name = 'WorldBookImportError'
    this.code = code
    this.stage = stage
    this.details = details
    if (cause) this.cause = cause
  }
}

export function worldBookImportError(code, message, options) {
  return new WorldBookImportError(code, message, options)
}

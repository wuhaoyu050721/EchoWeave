export class CharacterImportError extends Error {
  constructor(code, message, { stage = 'inspect', details = null, cause = null } = {}) {
    super(message)
    this.name = 'CharacterImportError'
    this.code = code
    this.stage = stage
    this.details = details
    if (cause) this.cause = cause
  }
}

export function importError(code, message, options) {
  return new CharacterImportError(code, message, options)
}

export function asCharacterImportError(error, fallback = {}) {
  if (error instanceof CharacterImportError) return error
  return new CharacterImportError(
    fallback.code || 'character_import_failed',
    fallback.message || error?.message || '角色卡导入失败',
    { stage: fallback.stage, details: fallback.details, cause: error }
  )
}

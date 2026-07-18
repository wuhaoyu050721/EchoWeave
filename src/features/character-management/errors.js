export class CharacterManagementError extends Error {
  constructor(code, message, { cause = null, details = null } = {}) {
    super(message)
    this.name = 'CharacterManagementError'
    this.code = code
    if (cause) this.cause = cause
    if (details) this.details = details
  }
}

export function characterManagementError(code, message, options = {}) {
  return new CharacterManagementError(code, message, options)
}

export function asCharacterManagementError(error, {
  code = 'character_management_failed',
  message = '角色管理操作失败',
  details = null
} = {}) {
  if (error instanceof CharacterManagementError) return error
  return characterManagementError(code, error?.message || message, { cause: error, details })
}

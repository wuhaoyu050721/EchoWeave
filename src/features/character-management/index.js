import { applyCharacterAvatar, createCharacterWithAvatar, softDeleteCharacter } from './manageCharacter.js'
import { exportCharacterCardJson, exportCharacterCardPng } from './exportCharacterCard.js'

export const CHARACTER_MANAGEMENT_EVENTS = Object.freeze({
  requestAvatarChange: 'request-avatar-change',
  exportJson: 'export-json',
  exportPng: 'export-png',
  deleteCharacter: 'delete-character'
})

export {
  CHARACTER_AVATAR_LIMITS,
  DEFAULT_CHARACTER_AVATAR_DATA_URL,
  ensurePngCharacterAvatar,
  imageExtensionForMimeType,
  validateCharacterAvatar
} from './avatar.js'
export {
  CharacterManagementError,
  asCharacterManagementError,
  characterManagementError
} from './errors.js'
export { createCharacterCardV3, exportCharacterCardJson, exportCharacterCardPng } from './exportCharacterCard.js'
export { applyCharacterAvatar, createCharacterWithAvatar, softDeleteCharacter } from './manageCharacter.js'

export function createCharacterManager({
  repository,
  idFactory,
  now,
  convertAvatarToPng = null
} = {}) {
  return {
    applyAvatar(characterId, avatar, options = {}) {
      return applyCharacterAvatar({ repository, characterId, avatar, idFactory, now, ...options })
    },
    createCharacter(character, options = {}) {
      return createCharacterWithAvatar({ repository, character, idFactory, now, ...options })
    },
    deleteCharacter(characterId, options = {}) {
      return softDeleteCharacter({ repository, characterId, now, ...options })
    },
    exportJson(character, options = {}) {
      return exportCharacterCardJson(character, { repository, ...options })
    },
    exportPng(character, options = {}) {
      return exportCharacterCardPng(character, {
        repository,
        convertAvatarToPng,
        ...options
      })
    }
  }
}

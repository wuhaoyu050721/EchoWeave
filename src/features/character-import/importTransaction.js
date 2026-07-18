import { createRuntimeId } from '../../core/runtime-id.js'
import { asCharacterImportError, importError } from './errors.js'
import { mapCharacterToDomain } from './mapCharacterToDomain.js'
import { normalizeCharacterCard } from './normalizeCharacterCard.js'

export async function commitCharacterImport(preview, {
  repository,
  idFactory = createRuntimeId,
  now = () => new Date().toISOString(),
  allowSensitiveExtensions = false
} = {}) {
  if (!repository?.importCharacterBundle) {
    throw importError('character_repository_unavailable', '当前存储层不支持角色导入', { stage: 'commit' })
  }
  if (preview?.requiresSensitiveExtensionConfirmation && !allowSensitiveExtensions) {
    throw importError('sensitive_extension_confirmation_required', '请确认卡片中的高级扩展将保持禁用', { stage: 'commit' })
  }
  try {
    const normalized = normalizeCharacterCard(preview?.cardV3)
    const safePreview = { ...preview, cardV3: normalized.card }
    const duplicates = repository.findCharactersBySourceHash
      ? await repository.findCharactersBySourceHash(preview.source.hash)
      : []
    const bundle = mapCharacterToDomain(safePreview, { idFactory, now })
    await repository.importCharacterBundle(bundle)
    return {
      character: bundle.character,
      worldBooks: bundle.worldBooks,
      assets: bundle.characterAssets,
      duplicateOfCharacterIds: duplicates.map(character => character.id)
    }
  } catch (error) {
    throw asCharacterImportError(error, {
      code: 'character_import_commit_failed',
      message: '角色及其资源保存失败，未写入任何数据',
      stage: 'commit'
    })
  }
}

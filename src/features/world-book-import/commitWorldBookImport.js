import { createRuntimeId } from '../../core/runtime-id.js'
import { worldBookImportError } from './errors.js'

function timestampValue(now) {
  const value = typeof now === 'function' ? now() : now
  return value instanceof Date ? value.toISOString() : String(value || new Date().toISOString())
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(id => String(id || '').trim()).filter(Boolean))]
}

function bindCharacter(character, worldBookId, timestamp) {
  return {
    ...cloneJson(character),
    worldBookIds: uniqueIds([...(character.worldBookIds || []), worldBookId]),
    updatedAt: timestamp
  }
}

async function persistImport({ repository, worldBook, beforeCharacters, characters, timestamp }) {
  if (typeof repository.saveWorldBookBundle === 'function') {
    try {
      await repository.saveWorldBookBundle({ worldBook: cloneJson(worldBook), characters: cloneJson(characters) })
      return
    } catch (cause) {
      throw worldBookImportError('world_book_import_commit_failed', '世界书保存失败，本地事务已回滚', {
        stage: 'commit',
        cause,
        details: { worldBookId: worldBook.id, atomic: true }
      })
    }
  }

  const attemptedCharacters = []
  let bookAttempted = false
  try {
    bookAttempted = true
    await repository.saveWorldBook(cloneJson(worldBook))
    for (const character of characters) {
      attemptedCharacters.push(character.id)
      await repository.saveCharacter(cloneJson(character))
    }
  } catch (cause) {
    const rollbackErrors = []
    const beforeById = new Map(beforeCharacters.map(character => [character.id, character]))
    for (const characterId of [...attemptedCharacters].reverse()) {
      try {
        await repository.saveCharacter(cloneJson(beforeById.get(characterId)))
      } catch (error) {
        rollbackErrors.push({ entity: 'character', id: characterId, message: error?.message || String(error) })
      }
    }
    if (bookAttempted) {
      try {
        await repository.saveWorldBook({
          ...cloneJson(worldBook),
          updatedAt: timestamp,
          deletedAt: timestamp,
          deletionReason: 'world-book-import-rollback'
        })
      } catch (error) {
        rollbackErrors.push({ entity: 'worldBook', id: worldBook.id, message: error?.message || String(error) })
      }
    }
    throw worldBookImportError('world_book_import_commit_failed', '世界书保存失败，已尽力恢复原数据', {
      stage: 'commit',
      cause,
      details: { worldBookId: worldBook.id, rollbackErrors }
    })
  }
}

export async function commitWorldBookImport(preview, {
  repository,
  characterIds = [],
  allowSensitiveExtensions = false,
  idFactory = createRuntimeId,
  now = () => new Date().toISOString()
} = {}) {
  if (!preview?.commitData?.data || preview.previewVersion !== 1) {
    throw worldBookImportError('invalid_world_book_preview', '世界书预览数据无效', { stage: 'commit' })
  }
  if (preview.requiresSensitiveExtensionConfirmation && !allowSensitiveExtensions) {
    throw worldBookImportError('sensitive_extension_confirmation_required', '请确认世界书中的高级扩展将保持禁用', { stage: 'commit' })
  }
  const supportsAtomicWrite = typeof repository?.saveWorldBookBundle === 'function'
  const supportsFallbackWrite = typeof repository?.saveWorldBook === 'function' && typeof repository?.saveCharacter === 'function'
  if (!repository?.getCharacter || !repository?.getWorldBook || (!supportsAtomicWrite && !supportsFallbackWrite)) {
    throw worldBookImportError('world_book_repository_unavailable', '世界书存储服务不可用', { stage: 'commit' })
  }
  if (typeof idFactory !== 'function') {
    throw worldBookImportError('missing_id_factory', '世界书导入缺少 ID 生成器', { stage: 'commit' })
  }

  const uniqueCharacterIds = uniqueIds(characterIds)
  const selectedCharacters = []
  if (uniqueCharacterIds.length) {
    for (const characterId of uniqueCharacterIds) {
      const character = await repository.getCharacter(characterId)
      if (!character || character.deletedAt) {
        throw worldBookImportError('missing_world_book_character', '世界书绑定了不存在的角色', {
          stage: 'commit',
          details: { characterId }
        })
      }
      selectedCharacters.push(cloneJson(character))
    }
  } else {
    if (typeof repository.listCharacters !== 'function') {
      throw worldBookImportError('world_book_repository_unavailable', '世界书存储服务无法读取全局角色列表', { stage: 'commit' })
    }
    const characters = await repository.listCharacters()
    selectedCharacters.push(...(Array.isArray(characters) ? characters : [])
      .filter(character => character?.id && !character.deletedAt)
      .map(cloneJson))
  }

  const timestamp = timestampValue(now)
  const worldBookId = String(idFactory() || '').trim()
  if (!worldBookId) throw worldBookImportError('invalid_world_book_id', '世界书 ID 无效', { stage: 'commit' })
  if (await repository.getWorldBook(worldBookId)) {
    throw worldBookImportError('duplicate_world_book_id', '世界书 ID 已存在', {
      stage: 'commit',
      details: { worldBookId }
    })
  }

  const worldBook = {
    id: worldBookId,
    characterId: null,
    characterIds: uniqueCharacterIds,
    scope: 'global',
    source: 'world-book-json',
    sourceFormat: preview.source.format,
    sourceFileName: preview.source.name,
    sourceHash: preview.source.hash,
    name: preview.worldBook.name,
    data: cloneJson(preview.commitData.data),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null
  }
  const characters = selectedCharacters.map(character => bindCharacter(character, worldBookId, timestamp))
  await persistImport({ repository, worldBook, beforeCharacters: selectedCharacters, characters, timestamp })
  return { worldBook, characters }
}

import { createRuntimeId } from '../../core/runtime-id.js'
import { isGroupConversation } from '../../core/group-chat.js'
import { validateCharacterAvatar } from './avatar.js'
import { asCharacterManagementError, characterManagementError } from './errors.js'

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function timestampValue(now) {
  const value = typeof now === 'function' ? now() : now
  return value instanceof Date ? value.toISOString() : String(value || new Date().toISOString())
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))]
}

function persistedCharacter(character) {
  const copy = cloneJson(character)
  delete copy.avatarDataUrl
  return copy
}

function normalizedApplyOptions(options, characterId, dataUrl) {
  if (options?.getCharacter && typeof options.getCharacter === 'function') {
    return { repository: options, characterId, avatar: dataUrl }
  }
  return options || {}
}

function normalizedDeleteOptions(options, characterId) {
  if (options?.getCharacter && typeof options.getCharacter === 'function') {
    return { repository: options, characterId }
  }
  return options || {}
}

function requireRepository(repository) {
  if (typeof repository?.getCharacter !== 'function' || typeof repository?.saveCharacter !== 'function') {
    throw characterManagementError('character_repository_unavailable', '当前存储层不支持角色管理')
  }
}

async function persistCharacterBundle(repository, character, {
  characterAssets = [],
  worldBooks = [],
  conversations = []
} = {}) {
  if (typeof repository.importCharacterBundle === 'function') {
    await repository.importCharacterBundle({ character, worldBooks, characterAssets, conversations })
    return
  }
  if (worldBooks.length) {
    if (typeof repository.saveWorldBook !== 'function') {
      throw characterManagementError('world_book_repository_unavailable', '当前存储层不支持更新角色关联世界书')
    }
    for (const worldBook of worldBooks) await repository.saveWorldBook(worldBook)
  }
  if (!characterAssets.length) {
    await repository.saveCharacter(character)
  } else if (typeof repository.saveCharacterAssets === 'function') {
    await repository.saveCharacterAssets(characterAssets)
    await repository.saveCharacter(character)
  } else if (typeof repository.saveCharacterAsset === 'function') {
    for (const asset of characterAssets) await repository.saveCharacterAsset(asset)
    await repository.saveCharacter(character)
  } else {
    throw characterManagementError('character_asset_repository_unavailable', '当前存储层不支持保存角色头像资产')
  }
}

async function rollbackConversations(repository, originals) {
  const failures = []
  for (const conversation of [...originals].reverse()) {
    try {
      await repository.saveConversation(conversation)
    } catch (error) {
      failures.push({ conversationId: conversation.id, message: error?.message || String(error) })
    }
  }
  return failures
}

async function persistWithConversationChanges(repository, changes, persist, { code, message }) {
  if (!changes.length) return persist()
  if (typeof repository.saveConversation !== 'function') {
    throw characterManagementError('conversation_repository_unavailable', '当前存储层不支持更新关联会话')
  }

  const savedOriginals = []
  try {
    for (const change of changes) {
      await repository.saveConversation(change.updated)
      savedOriginals.push(change.original)
    }
    return await persist()
  } catch (error) {
    const rollbackFailures = await rollbackConversations(repository, savedOriginals)
    throw characterManagementError(code, error?.message || message, {
      cause: error,
      details: rollbackFailures.length ? { rollbackFailures } : null
    })
  }
}

async function persistManagedCharacterBundle(repository, conversationChanges, character, bundle, errorInfo) {
  if (typeof repository.importCharacterBundle === 'function') {
    await persistCharacterBundle(repository, character, {
      ...bundle,
      conversations: conversationChanges.map(change => change.updated)
    })
    return
  }
  await persistWithConversationChanges(
    repository,
    conversationChanges,
    () => persistCharacterBundle(repository, character, bundle),
    errorInfo
  )
}

async function linkedConversations(repository, characterId) {
  if (typeof repository.listConversations !== 'function') return []
  const conversations = await repository.listConversations()
  return conversations.filter(conversation => (
    conversation?.characterId === characterId ||
    (
      isGroupConversation(conversation) &&
      Array.isArray(conversation.participants) &&
      conversation.participants.some(participant => participant?.characterId === characterId)
    )
  ))
}

function refreshConversationAvatar(conversation, character, assetId, timestamp) {
  if (!isGroupConversation(conversation)) {
    return {
      ...cloneJson(conversation),
      characterAvatarAssetId: assetId,
      updatedAt: timestamp
    }
  }
  return {
    ...cloneJson(conversation),
    participants: conversation.participants.map(participant => (
      participant?.characterId === character.id
        ? {
            ...cloneJson(participant),
            nameSnapshot: character.name || participant.nameSnapshot,
            avatarAssetId: assetId
          }
        : cloneJson(participant)
    )),
    updatedAt: timestamp
  }
}

function detachCharacterConversation(conversation, character, timestamp) {
  if (!isGroupConversation(conversation)) {
    return {
      ...cloneJson(conversation),
      characterId: null,
      characterAvatarAssetId: null,
      characterNameSnapshot: conversation.characterNameSnapshot || character.name,
      deletedCharacterId: character.id,
      characterDeletedAt: timestamp,
      updatedAt: timestamp
    }
  }
  return {
    ...cloneJson(conversation),
    participants: conversation.participants.map(participant => (
      participant?.characterId === character.id
        ? {
            ...cloneJson(participant),
            nameSnapshot: participant.nameSnapshot || character.name,
            avatarAssetId: participant.avatarAssetId || character.avatarAssetId || null,
            enabled: false,
            characterDeletedAt: timestamp
          }
        : cloneJson(participant)
    )),
    updatedAt: timestamp
  }
}

function createAvatarAsset(existingAsset, avatar, {
  assetId,
  characterId,
  sourceName,
  timestamp
}) {
  const asset = existingAsset ? cloneJson(existingAsset) : {}
  delete asset.chunkKey
  delete asset.sourceUrl
  delete asset.unreferenced
  delete asset.unresolved
  return {
    ...asset,
    id: assetId,
    characterId,
    type: 'icon',
    name: 'main',
    ext: avatar.extension,
    uri: 'ccdefault:',
    source: 'avatar-replacement',
    sourceName: sourceName || avatar.sourceName || asset.sourceName || '',
    mimeType: avatar.mimeType,
    byteSize: avatar.byteSize,
    width: avatar.width,
    height: avatar.height,
    dataUrl: avatar.dataUrl,
    createdAt: asset.createdAt || timestamp,
    updatedAt: timestamp,
    deletedAt: null
  }
}

export async function applyCharacterAvatar(options = {}, positionalCharacterId, positionalDataUrl) {
  const {
    repository,
    characterId,
    avatar: avatarInput,
    dataUrl,
    sourceName = '',
    idFactory = createRuntimeId,
    now = () => new Date().toISOString(),
    limits = {}
  } = normalizedApplyOptions(options, positionalCharacterId, positionalDataUrl)

  requireRepository(repository)
  const id = String(characterId || '').trim()
  if (!id) throw characterManagementError('missing_character_id', '缺少要更换头像的角色 ID')
  if (typeof idFactory !== 'function') throw characterManagementError('missing_id_factory', '更换头像缺少 ID 生成器')

  try {
    const character = await repository.getCharacter(id)
    if (!character || character.deletedAt) throw characterManagementError('character_not_found', '要更换头像的角色不存在')
    const input = avatarInput || (dataUrl ? { dataUrl, name: sourceName } : null)
    const avatar = validateCharacterAvatar(input, { limits })
    const timestamp = timestampValue(now)
    const previousAvatarAssetId = String(character.avatarAssetId || '').trim()
    const previousAsset = previousAvatarAssetId && typeof repository.getCharacterAsset === 'function'
      ? await repository.getCharacterAsset(previousAvatarAssetId)
      : null
    const canReuseAsset = previousAsset?.characterId === character.id
    const assetId = canReuseAsset ? previousAsset.id : String(idFactory() || '').trim()
    if (!assetId) throw characterManagementError('invalid_avatar_asset_id', '生成的头像资产 ID 无效')

    const asset = createAvatarAsset(canReuseAsset ? previousAsset : null, avatar, {
      assetId,
      characterId: character.id,
      sourceName,
      timestamp
    })
    const currentAssetIds = uniqueIds(character.assetIds).filter(assetRecordId => (
      assetRecordId !== previousAvatarAssetId || assetRecordId === assetId
    ))
    if (!currentAssetIds.includes(assetId)) currentAssetIds.push(assetId)
    const updatedCharacter = {
      ...persistedCharacter(character),
      avatarAssetId: assetId,
      assetIds: currentAssetIds,
      updatedAt: timestamp,
      deletedAt: null
    }
    if (Array.isArray(updatedCharacter.deletedAssetIds)) {
      updatedCharacter.deletedAssetIds = updatedCharacter.deletedAssetIds.filter(deletedId => deletedId !== assetId)
    }

    const conversations = previousAvatarAssetId === assetId
      ? []
      : await linkedConversations(repository, character.id)
    const conversationChanges = conversations.map(conversation => ({
      original: cloneJson(conversation),
      updated: refreshConversationAvatar(conversation, character, assetId, timestamp)
    }))
    await persistManagedCharacterBundle(
      repository,
      conversationChanges,
      updatedCharacter,
      { characterAssets: [asset] },
      { code: 'apply_character_avatar_failed', message: '角色头像保存失败' }
    )

    return {
      character: updatedCharacter,
      asset,
      conversations: conversationChanges.map(change => change.updated),
      previewCharacter: { ...updatedCharacter, avatarDataUrl: avatar.dataUrl }
    }
  } catch (error) {
    throw asCharacterManagementError(error, {
      code: 'apply_character_avatar_failed',
      message: '角色头像保存失败'
    })
  }
}

export async function createCharacterWithAvatar({
  repository,
  character,
  avatar: avatarInput = null,
  sourceName = '',
  idFactory = createRuntimeId,
  now = () => new Date().toISOString(),
  limits = {}
} = {}) {
  requireRepository(repository)
  const id = String(character?.id || '').trim()
  if (!id) throw characterManagementError('missing_character_id', '缺少要创建的角色 ID')
  if (typeof idFactory !== 'function') {
    throw characterManagementError('missing_id_factory', '新建角色缺少 ID 生成器')
  }

  try {
    if (await repository.getCharacter(id)) {
      throw characterManagementError('character_already_exists', '角色已经存在')
    }
    const timestamp = timestampValue(now)
    let createdCharacter = {
      ...persistedCharacter(character),
      updatedAt: timestamp,
      deletedAt: null
    }
    let asset = null
    if (avatarInput) {
      const avatar = validateCharacterAvatar(avatarInput, { limits })
      const assetId = String(idFactory() || '').trim()
      if (!assetId) {
        throw characterManagementError('invalid_avatar_asset_id', '生成的头像资源 ID 无效')
      }
      asset = createAvatarAsset(null, avatar, {
        assetId,
        characterId: id,
        sourceName,
        timestamp
      })
      createdCharacter = {
        ...createdCharacter,
        avatarAssetId: assetId,
        assetIds: uniqueIds([...(createdCharacter.assetIds || []), assetId])
      }
    }
    await persistCharacterBundle(repository, createdCharacter, {
      characterAssets: asset ? [asset] : []
    })
    return {
      character: createdCharacter,
      asset,
      previewCharacter: asset ? { ...createdCharacter, avatarDataUrl: asset.dataUrl } : createdCharacter
    }
  } catch (error) {
    throw asCharacterManagementError(error, {
      code: 'create_character_failed',
      message: '角色创建失败'
    })
  }
}

async function assetsForCharacter(repository, character) {
  if (typeof repository.listCharacterAssets === 'function') {
    return repository.listCharacterAssets(character.id)
  }
  if (typeof repository.getCharacterAsset !== 'function') return []
  const assets = await Promise.all(uniqueIds(character.assetIds).map(id => repository.getCharacterAsset(id)))
  return assets.filter(asset => asset?.characterId === character.id && !asset.deletedAt)
}

async function worldBooksForCharacter(repository, characterId) {
  if (typeof repository.listAllWorldBooks !== 'function') return []
  const books = await repository.listAllWorldBooks()
  return books.filter(book => (
    !book?.deletedAt && (
      book.characterId === characterId ||
      uniqueIds(book.characterIds).includes(characterId)
    )
  ))
}

function detachCharacterFromWorldBook(worldBook, characterId, timestamp) {
  const remainingCharacterIds = uniqueIds(worldBook.characterIds).filter(id => id !== characterId)
  const hadExplicitBinding = worldBook.characterId === characterId || uniqueIds(worldBook.characterIds).includes(characterId)
  if (!hadExplicitBinding) return cloneJson(worldBook)
  if (remainingCharacterIds.length) {
    return {
      ...cloneJson(worldBook),
      scope: 'global',
      characterId: null,
      characterIds: remainingCharacterIds,
      updatedAt: timestamp
    }
  }
  return {
    ...cloneJson(worldBook),
    characterId: null,
    characterIds: [],
    updatedAt: timestamp,
    deletedAt: timestamp,
    deletionReason: 'character-deleted-last-binding'
  }
}

export async function softDeleteCharacter(options = {}, positionalCharacterId) {
  const {
    repository,
    characterId,
    now = () => new Date().toISOString()
  } = normalizedDeleteOptions(options, positionalCharacterId)

  requireRepository(repository)
  const id = String(characterId || '').trim()
  if (!id) throw characterManagementError('missing_character_id', '缺少要删除的角色 ID')

  try {
    const character = await repository.getCharacter(id)
    if (!character) throw characterManagementError('character_not_found', '要删除的角色不存在')
    if (character.deletedAt) {
      return { character: cloneJson(character), assets: [], conversations: [], worldBooks: [], alreadyDeleted: true }
    }

    const timestamp = timestampValue(now)
    const [assets, conversations, linkedWorldBooks] = await Promise.all([
      assetsForCharacter(repository, character),
      linkedConversations(repository, character.id),
      worldBooksForCharacter(repository, character.id)
    ])
    const deletedAssets = assets.map(asset => ({
      ...cloneJson(asset),
      updatedAt: timestamp,
      deletedAt: timestamp,
      deletionReason: 'character-deleted'
    }))
    const deletedAssetIds = uniqueIds([
      ...uniqueIds(character.assetIds),
      ...deletedAssets.map(asset => asset.id)
    ])
    const deletedCharacter = {
      ...persistedCharacter(character),
      avatarAssetId: null,
      assetIds: [],
      worldBookIds: [],
      deletedAvatarAssetId: character.avatarAssetId || null,
      deletedAssetIds,
      deletedWorldBookIds: uniqueIds(character.worldBookIds),
      updatedAt: timestamp,
      deletedAt: timestamp
    }
    const updatedWorldBooks = linkedWorldBooks.map(worldBook => (
      detachCharacterFromWorldBook(worldBook, character.id, timestamp)
    ))
    const conversationChanges = conversations.map(conversation => ({
      original: cloneJson(conversation),
      updated: detachCharacterConversation(conversation, character, timestamp)
    }))
    await persistManagedCharacterBundle(
      repository,
      conversationChanges,
      deletedCharacter,
      {
        characterAssets: deletedAssets,
        worldBooks: updatedWorldBooks
      },
      { code: 'soft_delete_character_failed', message: '角色删除失败' }
    )

    return {
      character: deletedCharacter,
      assets: deletedAssets,
      conversations: conversationChanges.map(change => change.updated),
      worldBooks: updatedWorldBooks,
      alreadyDeleted: false
    }
  } catch (error) {
    throw asCharacterManagementError(error, {
      code: 'soft_delete_character_failed',
      message: '角色删除失败'
    })
  }
}

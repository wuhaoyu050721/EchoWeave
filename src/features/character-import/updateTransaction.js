import { createRuntimeId } from '../../core/runtime-id.js'
import { asCharacterImportError, importError } from './errors.js'
import { mapCharacterToDomain } from './mapCharacterToDomain.js'
import { normalizeCharacterCard } from './normalizeCharacterCard.js'

function ownedCardBook(book, characterId) {
  return !book.deletedAt && book.source === 'character-card' &&
    book.characterId === characterId && ['character', 'story'].includes(book.scope) &&
    !book.conversationId && !(book.characterIds || []).some(id => id !== characterId)
}

/** 更新指定角色的卡片内容；会话和消息不参与写入，历史身份及资源引用保持有效。 */
export async function commitCharacterUpdate(preview, {
  repository,
  characterId,
  expectedCharacter,
  allowSensitiveExtensions = false,
  idFactory = createRuntimeId,
  now = () => new Date().toISOString()
} = {}) {
  if (!repository?.getCharacter || !repository?.listWorldBooks || !repository?.importRecordsIfUnchanged) {
    throw importError('character_repository_unavailable', '当前存储层不支持安全更新角色卡', { stage: 'commit' })
  }
  if (preview?.requiresSensitiveExtensionConfirmation && !allowSensitiveExtensions) {
    throw importError('sensitive_extension_confirmation_required', '请确认卡片中的高级扩展将保持禁用', { stage: 'commit' })
  }
  try {
    const previous = await repository.getCharacter(characterId)
    if (!characterId || !previous || previous.deletedAt) {
      throw importError('character_not_found', '要更新的角色不存在或已删除，请重新选择角色', { stage: 'commit' })
    }
    if (expectedCharacter && JSON.stringify(previous) !== JSON.stringify(expectedCharacter)) {
      throw importError('character_update_conflict', '角色在预览期间已发生变化，请关闭预览后重新选择新版卡片', { stage: 'commit' })
    }
    const normalized = normalizeCharacterCard(preview?.cardV3)
    // 剧情记忆属于本地对话进度，不能被外部卡片的同名扩展覆盖。
    const extensions = normalized.card.data.extensions
    delete extensions.echoWeaveStoryPatches
    if (Object.prototype.hasOwnProperty.call(previous.card?.data?.extensions || {}, 'echoWeaveStoryPatches')) {
      extensions.echoWeaveStoryPatches = JSON.parse(JSON.stringify(previous.card.data.extensions.echoWeaveStoryPatches))
    }
    const bundle = mapCharacterToDomain({ ...preview, cardV3: normalized.card }, {
      idFactory, now,
      characterScope: previous.storyScope,
      worldBookOverrides: previous.storyScope === 'story' ? { scope: 'story', conversationId: null } : {}
    })
    const timestamp = bundle.character.updatedAt
    const books = await repository.listWorldBooks({ characterId, includeGlobal: false })
    const replacedBooks = books.filter(book => ownedCardBook(book, characterId))
    const replacedIds = new Set(replacedBooks.map(book => book.id))
    // 沿用内嵌世界书 ID，保留故事中显式选择的世界书关联及用户的启用设置。
    bundle.worldBooks = bundle.worldBooks.map(book => {
      const oldBook = replacedBooks.find(item => item.id === previous.worldBookIds?.[0]) || replacedBooks[0]
      return oldBook
        ? { ...oldBook, name: book.name, data: book.data, sourceHash: book.sourceHash, updatedAt: timestamp, deletedAt: null }
        : { ...book, characterId }
    })
    const activeBookIds = new Set(bundle.worldBooks.map(book => book.id))
    // 旧故事可能显式引用这本书。解除角色默认绑定而不删除记录，既不继续注入普通聊天，
    // 又能保留故事的显式选择和备份恢复需要的引用完整性。
    const retiredBooks = replacedBooks.filter(book => !activeBookIds.has(book.id))
      .map(book => ({ ...book, characterId: null, characterIds: [], scope: 'story', conversationId: null, updatedAt: timestamp }))
    bundle.characterAssets = bundle.characterAssets.map(asset => ({ ...asset, characterId }))
    const incoming = bundle.character
    // 白名单替换卡片字段，保留来源范围、云备份偏好、创建时间和未来新增的本地状态。
    const character = { ...previous }
    for (const key of [
      'name', 'nickname', 'description', 'tags', 'creator', 'characterVersion', 'card',
      'sourceVersion', 'sourceFileName', 'sourceHash', 'avatarAssetId', 'assetIds', 'updatedAt'
    ]) character[key] = incoming[key]
    character.worldBookIds = [...new Set([
      ...(previous.worldBookIds || []).filter(id => !replacedIds.has(id)),
      ...bundle.worldBooks.map(book => book.id)
    ])]
    delete character.avatarDataUrl
    const applied = await repository.importRecordsIfUnchanged({
      entityType: 'characters', entityId: characterId,
      expectedSnapshot: { exists: true, value: previous },
      additionalSnapshots: replacedBooks.map(book => ({
        entityType: 'worldBooks', entityId: book.id,
        expectedSnapshot: { exists: true, value: book }
      })),
      records: {
        characters: [character], worldBooks: [...bundle.worldBooks, ...retiredBooks],
        // 保留旧资源供历史消息、旧头像快照及备份读取，当前卡片仅引用新资源。
        characterAssets: bundle.characterAssets
      }
    })
    if (!applied) {
      throw importError('character_update_conflict', '角色已被其他操作修改，本次更新未保存，请重新选择新版卡片', { stage: 'commit' })
    }
    return { character, worldBooks: bundle.worldBooks, assets: bundle.characterAssets }
  } catch (error) {
    throw asCharacterImportError(error, {
      code: 'character_update_commit_failed',
      message: '角色卡更新失败，原角色和对话已保留', stage: 'commit'
    })
  }
}

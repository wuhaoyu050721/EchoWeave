import { createRuntimeId } from './runtime-id.js'
import { groupParticipantKey, groupParticipantKind } from './group-chat.js'
import { hasValidImageAttachmentSource } from './image-output.js'

const SENSITIVE_KEYS = new Set([
  'apiKey',
  'apiKeyCipher',
  'encryptedApiKey',
  'systemPrompt',
  'systemPromptCipher',
  'encryptedSystemPrompt',
  'globalSystemPrompt',
  'encryptedGlobalSystemPrompt'
])

function stripSensitive(value) {
  if (Array.isArray(value)) {
    return value.map(stripSensitive)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEYS.has(key))
      .map(([key, item]) => [key, stripSensitive(item)])
  )
}

function requireArray(payload, key, required = false) {
  const value = payload[key]
  if (value === undefined && !required) return []
  if (!Array.isArray(value)) {
    throw new Error(`${key} 必须是数组`)
  }
  return value
}

function validateId(entity, label) {
  if (!entity || typeof entity !== 'object' || !String(entity.id ?? '').trim()) {
    throw new Error(`${label}缺少有效 ID`)
  }
}

function validateUniqueIds(entities, label) {
  const ids = new Set()
  for (const entity of entities) {
    validateId(entity, label)
    if (ids.has(entity.id)) throw new Error(`${label} ID ${entity.id} 重复`)
    ids.add(entity.id)
  }
  return ids
}

function validateReferenceList(value, validIds, label) {
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  for (const id of value) {
    if (!validIds.has(id)) throw new Error(`${label}引用了不存在的 ID ${id}`)
  }
}

function validateCharacterData({ providers, conversations, messages, characters, worldBooks, characterAssets }) {
  const providerIds = new Set(providers.map(provider => provider.id))
  const characterIds = validateUniqueIds(characters, '角色')
  const worldBookIds = validateUniqueIds(worldBooks, '世界书')
  const characterAssetIds = validateUniqueIds(characterAssets, '角色资源')
  const assetById = new Map(characterAssets.map(asset => [asset.id, asset]))

  for (const conversation of conversations) {
    if (conversation.characterId && !characterIds.has(conversation.characterId)) {
      throw new Error(`会话 ${conversation.id} 引用了不存在的角色`)
    }
    if (conversation.conversationKind !== 'group') continue
    if (!Array.isArray(conversation.participants) || conversation.participants.length > 8) {
      throw new Error(`群聊 ${conversation.id} 的成员列表无效`)
    }
    const participantIds = new Set()
    for (const participant of conversation.participants) {
      const participantKey = groupParticipantKey(participant)
      if (!participantKey || participantIds.has(participantKey)) throw new Error(`群聊 ${conversation.id} 的成员无效`)
      participantIds.add(participantKey)
      if (groupParticipantKind(participant) === 'provider') {
        const providerProfileId = String(participant?.providerProfileId ?? '').trim()
        if (participant.enabled !== false && !providerIds.has(providerProfileId)) {
          throw new Error(`群聊 ${conversation.id} 引用了不存在的接口`)
        }
        continue
      }
      const characterId = String(participant?.characterId ?? '').trim()
      if (participant.enabled !== false && !characterIds.has(characterId)) {
        throw new Error(`群聊 ${conversation.id} 引用了不存在的角色`)
      }
      if (participant.avatarAssetId && characterIds.has(characterId)) {
        const avatar = assetById.get(participant.avatarAssetId)
        if (!avatar || avatar.characterId !== characterId) throw new Error(`群聊 ${conversation.id} 引用了无效头像资源`)
      }
    }
  }
  for (const message of messages) {
    if (message.speakerProviderProfileId && !providerIds.has(message.speakerProviderProfileId) && !String(message.speakerNameSnapshot ?? '').trim()) {
      throw new Error(`消息 ${message.id} 引用了不存在的发言接口`)
    }
    if (message.speakerCharacterId && !characterIds.has(message.speakerCharacterId) && !String(message.speakerNameSnapshot ?? '').trim()) {
      throw new Error(`消息 ${message.id} 引用了不存在的发言角色`)
    }
    if (message.speakerAvatarAssetId && characterIds.has(message.speakerCharacterId)) {
      const avatar = assetById.get(message.speakerAvatarAssetId)
      if (!avatar || avatar.characterId !== message.speakerCharacterId) {
        throw new Error(`消息 ${message.id} 引用了无效发言头像`)
      }
    }
  }
  for (const character of characters) {
    validateReferenceList(character.worldBookIds, worldBookIds, `角色 ${character.id} 的世界书列表`)
    validateReferenceList(character.assetIds, characterAssetIds, `角色 ${character.id} 的资源列表`)
    if (character.avatarAssetId) {
      const avatar = assetById.get(character.avatarAssetId)
      if (!avatar || avatar.characterId !== character.id) {
        throw new Error(`角色 ${character.id} 引用了无效头像资源`)
      }
    }
  }
  for (const worldBook of worldBooks) {
    if (!['character', 'global'].includes(worldBook.scope)) throw new Error(`世界书 ${worldBook.id} 作用域无效`)
    if (worldBook.scope === 'character' && !characterIds.has(worldBook.characterId)) {
      throw new Error(`世界书 ${worldBook.id} 引用了不存在的角色`)
    }
    validateReferenceList(worldBook.characterIds, characterIds, `世界书 ${worldBook.id} 的角色绑定`)
    if (!worldBook.data || typeof worldBook.data !== 'object' || !Array.isArray(worldBook.data.entries)) {
      throw new Error(`世界书 ${worldBook.id} 内容无效`)
    }
  }
  for (const asset of characterAssets) {
    if (!characterIds.has(asset.characterId)) throw new Error(`角色资源 ${asset.id} 引用了不存在的角色`)
    const hasInlineData = typeof asset.dataUrl === 'string' && /^data:[^,]+,/i.test(asset.dataUrl)
    const hasRemoteData = typeof asset.sourceUrl === 'string' && /^https?:\/\//i.test(asset.sourceUrl)
    if (!hasInlineData && !hasRemoteData) throw new Error(`角色资源 ${asset.id} 数据无效`)
  }
}

export function createBackup(data = {}, now = new Date()) {
  return {
    formatVersion: 5,
    exportedAt: now.toISOString(),
    providers: stripSensitive(data.providers ?? []),
    conversations: stripSensitive(data.conversations ?? []),
    messages: stripSensitive(data.messages ?? []),
    attachments: stripSensitive(data.attachments ?? []),
    characters: stripSensitive(data.characters ?? []),
    worldBooks: stripSensitive(data.worldBooks ?? []),
    characterAssets: stripSensitive(data.characterAssets ?? []),
    settings: stripSensitive(data.settings ?? {})
  }
}

export function prepareImport(payload, idFactory = createRuntimeId) {
  if (!payload || ![1, 2, 3, 4, 5].includes(payload.formatVersion)) {
    throw new Error('不支持的备份格式版本')
  }

  const providers = requireArray(payload, 'providers')
  const conversations = requireArray(payload, 'conversations')
  const messages = requireArray(payload, 'messages')
  const attachments = payload.formatVersion === 1 ? [] : requireArray(payload, 'attachments')
  const characters = payload.formatVersion < 3 ? [] : requireArray(payload, 'characters', true)
  const worldBooks = payload.formatVersion < 3 ? [] : requireArray(payload, 'worldBooks', true)
  const characterAssets = payload.formatVersion < 3 ? [] : requireArray(payload, 'characterAssets', true)
  if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) {
    throw new Error('settings 必须是对象')
  }

  validateUniqueIds(providers, '接口')
  validateUniqueIds(conversations, '会话')
  validateUniqueIds(messages, '消息')
  validateUniqueIds(attachments, '附件')

  const conversationIdSet = new Set(conversations.map(entity => entity.id))
  const messageIdSet = new Set(messages.map(entity => entity.id))
  const attachmentById = new Map(attachments.map(entity => [entity.id, entity]))
  for (const message of messages) {
    if (!conversationIdSet.has(message.conversationId)) throw new Error(`消息 ${message.id} 引用了不存在的会话`)
    for (const attachmentId of message.attachmentIds ?? []) {
      const attachment = attachmentById.get(attachmentId)
      if (!attachment || attachment.messageId !== message.id) throw new Error(`消息 ${message.id} 引用了无效附件`)
    }
  }
  for (const attachment of attachments) {
    if (!conversationIdSet.has(attachment.conversationId) || !messageIdSet.has(attachment.messageId)) {
      throw new Error(`附件 ${attachment.id} 引用了不存在的消息或会话`)
    }
    if (!['image', 'text'].includes(attachment.kind)) throw new Error(`附件 ${attachment.id} 类型无效`)
    if (attachment.kind === 'image' && !hasValidImageAttachmentSource(attachment)) throw new Error(`附件 ${attachment.id} 图片数据无效`)
    if (attachment.kind === 'text' && typeof attachment.textContent !== 'string') throw new Error(`附件 ${attachment.id} 文本数据无效`)
  }
  validateCharacterData({ providers, conversations, messages, characters, worldBooks, characterAssets })

  const providerIds = new Map(providers.map((entity) => [entity.id, idFactory()]))
  const conversationIds = new Map(conversations.map((entity) => [entity.id, idFactory()]))
  const messageIds = new Map(messages.map((entity) => [entity.id, idFactory()]))
  const attachmentIds = new Map(attachments.map((entity) => [entity.id, idFactory()]))
  const characterIds = new Map(characters.map((entity) => [entity.id, idFactory()]))
  const worldBookIds = new Map(worldBooks.map((entity) => [entity.id, idFactory()]))
  const characterAssetIds = new Map(characterAssets.map((entity) => [entity.id, idFactory()]))

  const remappedProviders = providers.map((entity) => ({
    ...stripSensitive(entity),
    id: providerIds.get(entity.id)
  }))
  const remappedConversations = conversations.map((entity) => ({
    ...stripSensitive(entity),
    id: conversationIds.get(entity.id),
    providerProfileId: providerIds.get(entity.providerProfileId) ?? null,
    characterId: characterIds.get(entity.characterId) ?? null,
    characterAvatarAssetId: characterAssetIds.get(entity.characterAvatarAssetId) ?? null,
    participants: Array.isArray(entity.participants)
      ? entity.participants.map(participant => (
          groupParticipantKind(participant) === 'provider'
            ? {
                ...stripSensitive(participant),
                providerProfileId: providerIds.get(participant.providerProfileId) ?? null
              }
            : {
                ...stripSensitive(participant),
                characterId: characterIds.get(participant.characterId) ?? null,
                avatarAssetId: characterAssetIds.get(participant.avatarAssetId) ?? null
              }
        ))
      : entity.participants
  }))
  const remappedMessages = messages.map((entity) => {
    return {
      ...stripSensitive(entity),
      id: messageIds.get(entity.id),
      conversationId: conversationIds.get(entity.conversationId),
      attachmentIds: (entity.attachmentIds ?? []).map(id => attachmentIds.get(id)),
      retryOfMessageId: messageIds.get(entity.retryOfMessageId) ?? null,
      speakerProviderProfileId: providerIds.get(entity.speakerProviderProfileId) ?? null,
      speakerCharacterId: characterIds.get(entity.speakerCharacterId) ?? null,
      speakerAvatarAssetId: characterAssetIds.get(entity.speakerAvatarAssetId) ?? null
    }
  })
  const remappedAttachments = attachments.map(entity => ({
    ...stripSensitive(entity),
    id: attachmentIds.get(entity.id),
    conversationId: conversationIds.get(entity.conversationId),
    messageId: messageIds.get(entity.messageId)
  }))
  const remappedCharacters = characters.map(entity => ({
    ...stripSensitive(entity),
    id: characterIds.get(entity.id),
    avatarAssetId: characterAssetIds.get(entity.avatarAssetId) ?? null,
    worldBookIds: (entity.worldBookIds ?? []).map(id => worldBookIds.get(id)),
    assetIds: (entity.assetIds ?? []).map(id => characterAssetIds.get(id))
  }))
  const remappedWorldBooks = worldBooks.map(entity => ({
    ...stripSensitive(entity),
    id: worldBookIds.get(entity.id),
    characterId: characterIds.get(entity.characterId) ?? null,
    characterIds: (entity.characterIds ?? []).map(id => characterIds.get(id))
  }))
  const remappedCharacterAssets = characterAssets.map(entity => ({
    ...stripSensitive(entity),
    id: characterAssetIds.get(entity.id),
    characterId: characterIds.get(entity.characterId)
  }))

  return {
    providers: remappedProviders,
    conversations: remappedConversations,
    messages: remappedMessages,
    attachments: remappedAttachments,
    characters: remappedCharacters,
    worldBooks: remappedWorldBooks,
    characterAssets: remappedCharacterAssets,
    settings: stripSensitive(payload.settings)
  }
}

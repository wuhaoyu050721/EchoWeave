import { createRuntimeId } from './runtime-id.js'
import { groupParticipantKey, groupParticipantKind } from './group-chat.js'
import { hasValidImageAttachmentSource } from './image-output.js'

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function requireEntityArrays(payload) {
  for (const key of ['providers', 'conversations', 'messages', 'attachments', 'characters', 'worldBooks', 'characterAssets']) {
    if (!Array.isArray(payload?.[key])) throw new Error(`云端备份格式无效: ${key}`)
  }
  if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) {
    throw new Error('云端备份格式无效: settings')
  }
}

function validateEntities(payload) {
  requireEntityArrays(payload)
  const conversationIds = new Set()
  const messageIds = new Set()
  const providerIds = new Set()
  const characterIds = new Set()
  const worldBookIds = new Set()
  const characterAssetIds = new Set()
  for (const [label, entities] of [
    ['接口', payload.providers], ['会话', payload.conversations], ['消息', payload.messages], ['附件', payload.attachments],
    ['角色', payload.characters], ['世界书', payload.worldBooks], ['角色资源', payload.characterAssets]
  ]) {
    const typeIds = new Set()
    for (const entity of entities) {
      if (!entity || typeof entity !== 'object' || !String(entity.id ?? '').trim()) {
        throw new Error(`${label}缺少有效 ID`)
      }
      if (typeIds.has(entity.id)) throw new Error(`${label} ID ${entity.id} 重复`)
      typeIds.add(entity.id)
      if (label === '会话') conversationIds.add(entity.id)
      if (label === '消息') messageIds.add(entity.id)
      if (label === '接口') providerIds.add(entity.id)
      if (label === '角色') characterIds.add(entity.id)
      if (label === '世界书') worldBookIds.add(entity.id)
      if (label === '角色资源') characterAssetIds.add(entity.id)
    }
  }
  for (const message of payload.messages) {
    if (!conversationIds.has(message.conversationId)) {
      throw new Error(`消息 ${message.id} 引用了不存在的会话`)
    }
  }
  const attachmentById = new Map(payload.attachments.map(attachment => [attachment.id, attachment]))
  for (const message of payload.messages) {
    for (const attachmentId of message.attachmentIds ?? []) {
      const attachment = attachmentById.get(attachmentId)
      if (!attachment || attachment.messageId !== message.id) throw new Error(`消息 ${message.id} 引用了无效附件`)
    }
  }
  for (const attachment of payload.attachments) {
    if (!conversationIds.has(attachment.conversationId) || !messageIds.has(attachment.messageId)) {
      throw new Error(`附件 ${attachment.id} 引用了不存在的消息或会话`)
    }
    if (!['image', 'text'].includes(attachment.kind)) throw new Error(`附件 ${attachment.id} 类型无效`)
    if (attachment.kind === 'image' && !hasValidImageAttachmentSource(attachment)) throw new Error(`附件 ${attachment.id} 图片数据无效`)
    if (attachment.kind === 'text' && typeof attachment.textContent !== 'string') throw new Error(`附件 ${attachment.id} 文本数据无效`)
  }
  const assetById = new Map(payload.characterAssets.map(asset => [asset.id, asset]))
  for (const conversation of payload.conversations) {
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
  for (const message of payload.messages) {
    if (message.speakerProviderProfileId && !providerIds.has(message.speakerProviderProfileId) && !String(message.speakerNameSnapshot ?? '').trim()) {
      throw new Error(`消息 ${message.id} 引用了不存在的发言接口`)
    }
    if (message.speakerCharacterId && !characterIds.has(message.speakerCharacterId) && !String(message.speakerNameSnapshot ?? '').trim()) {
      throw new Error(`消息 ${message.id} 引用了不存在的发言角色`)
    }
    if (message.speakerAvatarAssetId && characterIds.has(message.speakerCharacterId)) {
      const avatar = assetById.get(message.speakerAvatarAssetId)
      if (!avatar || avatar.characterId !== message.speakerCharacterId) throw new Error(`消息 ${message.id} 引用了无效发言头像`)
    }
  }
  for (const character of payload.characters) {
    validateReferenceList(character.worldBookIds, worldBookIds, `角色 ${character.id} 的世界书列表`)
    validateReferenceList(character.assetIds, characterAssetIds, `角色 ${character.id} 的资源列表`)
    if (character.avatarAssetId) {
      const avatar = assetById.get(character.avatarAssetId)
      if (!avatar || avatar.characterId !== character.id) throw new Error(`角色 ${character.id} 引用了无效头像资源`)
    }
  }
  for (const worldBook of payload.worldBooks) {
    if (!['character', 'global'].includes(worldBook.scope)) throw new Error(`世界书 ${worldBook.id} 作用域无效`)
    if (worldBook.scope === 'character' && !characterIds.has(worldBook.characterId)) {
      throw new Error(`世界书 ${worldBook.id} 引用了不存在的角色`)
    }
    validateReferenceList(worldBook.characterIds, characterIds, `世界书 ${worldBook.id} 的角色绑定`)
    if (!worldBook.data || typeof worldBook.data !== 'object' || !Array.isArray(worldBook.data.entries)) {
      throw new Error(`世界书 ${worldBook.id} 内容无效`)
    }
  }
  for (const asset of payload.characterAssets) {
    if (!characterIds.has(asset.characterId)) throw new Error(`角色资源 ${asset.id} 引用了不存在的角色`)
    const hasInlineData = typeof asset.dataUrl === 'string' && /^data:[^,]+,/i.test(asset.dataUrl)
    const hasRemoteData = typeof asset.sourceUrl === 'string' && /^https?:\/\//i.test(asset.sourceUrl)
    if (!hasInlineData && !hasRemoteData) throw new Error(`角色资源 ${asset.id} 数据无效`)
  }
}

function validateReferenceList(value, validIds, label) {
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`)
  for (const id of value) {
    if (!validIds.has(id)) throw new Error(`${label}引用了不存在的 ID ${id}`)
  }
}

function without(object, ...keys) {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)))
}

export async function createCloudBackupPayload(data, vault, now = new Date()) {
  const normalized = {
    ...data,
    attachments: data.attachments ?? [],
    characters: data.characters ?? [],
    worldBooks: data.worldBooks ?? [],
    characterAssets: data.characterAssets ?? []
  }
  validateEntities(normalized)
  const providers = []
  for (const provider of normalized.providers) {
    providers.push({
      ...without(provider, 'encryptedApiKey'),
      apiKey: provider.encryptedApiKey ? await vault.decryptString(provider.encryptedApiKey) : ''
    })
  }

  const conversations = []
  for (const conversation of normalized.conversations) {
    conversations.push({
      ...without(conversation, 'encryptedSystemPrompt'),
      systemPrompt: conversation.encryptedSystemPrompt
        ? await vault.decryptString(conversation.encryptedSystemPrompt)
        : ''
    })
  }

  const settings = cloneJson(normalized.settings)
  if (settings.systemPrompt) {
    const encryptedValue = settings.systemPrompt.encryptedValue
    settings.systemPrompt = {
      ...without(settings.systemPrompt, 'encryptedValue'),
      value: encryptedValue ? await vault.decryptString(encryptedValue) : ''
    }
  }

  return {
    cloudFormatVersion: 5,
    exportedAt: now.toISOString(),
    providers,
    conversations,
    messages: cloneJson(normalized.messages),
    attachments: cloneJson(normalized.attachments),
    characters: cloneJson(normalized.characters),
    worldBooks: cloneJson(normalized.worldBooks),
    characterAssets: cloneJson(normalized.characterAssets),
    settings
  }
}

export async function prepareCloudRestore(payload, {
  vault,
  idFactory = createRuntimeId
} = {}) {
  if (![1, 2, 3, 4, 5].includes(payload?.cloudFormatVersion)) throw new Error('不支持的云端备份格式版本')
  const normalized = {
    ...payload,
    attachments: payload.cloudFormatVersion === 1 ? [] : payload.attachments,
    characters: payload.cloudFormatVersion < 3 ? [] : payload.characters,
    worldBooks: payload.cloudFormatVersion < 3 ? [] : payload.worldBooks,
    characterAssets: payload.cloudFormatVersion < 3 ? [] : payload.characterAssets
  }
  validateEntities(normalized)

  const providerIds = new Map(normalized.providers.map(provider => [provider.id, idFactory()]))
  const conversationIds = new Map(normalized.conversations.map(conversation => [conversation.id, idFactory()]))
  const messageIds = new Map(normalized.messages.map(message => [message.id, idFactory()]))
  const attachmentIds = new Map(normalized.attachments.map(attachment => [attachment.id, idFactory()]))
  const characterIds = new Map(normalized.characters.map(character => [character.id, idFactory()]))
  const worldBookIds = new Map(normalized.worldBooks.map(worldBook => [worldBook.id, idFactory()]))
  const characterAssetIds = new Map(normalized.characterAssets.map(asset => [asset.id, idFactory()]))
  const providers = []
  for (const provider of normalized.providers) {
    providers.push({
      ...without(provider, 'apiKey'),
      id: providerIds.get(provider.id),
      encryptedApiKey: provider.apiKey ? await vault.encryptString(provider.apiKey) : null
    })
  }

  const conversations = []
  for (const conversation of normalized.conversations) {
    conversations.push({
      ...without(conversation, 'systemPrompt'),
      id: conversationIds.get(conversation.id),
      providerProfileId: providerIds.get(conversation.providerProfileId) ?? null,
      characterId: characterIds.get(conversation.characterId) ?? null,
      characterAvatarAssetId: characterAssetIds.get(conversation.characterAvatarAssetId) ?? null,
      participants: Array.isArray(conversation.participants)
        ? conversation.participants.map(participant => (
            groupParticipantKind(participant) === 'provider'
              ? {
                  ...participant,
                  providerProfileId: providerIds.get(participant.providerProfileId) ?? null
                }
              : {
                  ...participant,
                  characterId: characterIds.get(participant.characterId) ?? null,
                  avatarAssetId: characterAssetIds.get(participant.avatarAssetId) ?? null
                }
          ))
        : conversation.participants,
      encryptedSystemPrompt: conversation.systemPrompt
        ? await vault.encryptString(conversation.systemPrompt)
        : null
    })
  }

  const messages = normalized.messages.map(message => ({
    ...message,
    id: messageIds.get(message.id),
    conversationId: conversationIds.get(message.conversationId),
    attachmentIds: (message.attachmentIds ?? []).map(id => attachmentIds.get(id)),
    retryOfMessageId: messageIds.get(message.retryOfMessageId) ?? null,
    speakerProviderProfileId: providerIds.get(message.speakerProviderProfileId) ?? null,
    speakerCharacterId: characterIds.get(message.speakerCharacterId) ?? null,
    speakerAvatarAssetId: characterAssetIds.get(message.speakerAvatarAssetId) ?? null
  }))
  const attachments = normalized.attachments.map(attachment => ({
    ...attachment,
    id: attachmentIds.get(attachment.id),
    conversationId: conversationIds.get(attachment.conversationId),
    messageId: messageIds.get(attachment.messageId)
  }))
  const characters = normalized.characters.map(character => ({
    ...character,
    id: characterIds.get(character.id),
    avatarAssetId: characterAssetIds.get(character.avatarAssetId) ?? null,
    worldBookIds: (character.worldBookIds ?? []).map(id => worldBookIds.get(id)),
    assetIds: (character.assetIds ?? []).map(id => characterAssetIds.get(id))
  }))
  const worldBooks = normalized.worldBooks.map(worldBook => ({
    ...worldBook,
    id: worldBookIds.get(worldBook.id),
    characterId: characterIds.get(worldBook.characterId) ?? null,
    characterIds: (worldBook.characterIds ?? []).map(id => characterIds.get(id))
  }))
  const characterAssets = normalized.characterAssets.map(asset => ({
    ...asset,
    id: characterAssetIds.get(asset.id),
    characterId: characterIds.get(asset.characterId)
  }))
  const settings = cloneJson(normalized.settings)
  if (settings.systemPrompt) {
    const value = settings.systemPrompt.value
    settings.systemPrompt = {
      ...without(settings.systemPrompt, 'value'),
      encryptedValue: value ? await vault.encryptString(value) : null
    }
  }

  return { providers, conversations, messages, attachments, characters, worldBooks, characterAssets, settings }
}

import { buildChatContext } from '../core/chat-context.js'
import { createAbortController, createAbortError } from '../core/abort-controller-polyfill.js'
import { extractAssistantStatus } from '../core/assistant-status.js'
import {
  GROUP_MEMBER_LIMIT,
  GROUP_REPLY_CHAIN_LIMIT,
  createGroupParticipant,
  createGroupProviderParticipant,
  groupParticipantKey,
  groupParticipantKind,
  groupVisibleMessages,
  isGroupConversation,
  mentionedGroupParticipantIds,
  normalizeGroupParticipants,
  normalizeGroupReplyPolicy,
  selectGroupResponders
} from '../core/group-chat.js'
import { normalizeImageOutput } from '../core/image-output.js'
import { resolveProviderAvatarSource } from '../core/provider-avatar.js'
import { renderCharacterTemplate } from '../core/character-prompt.js'
import { createRuntimeId } from '../core/runtime-id.js'

function isAbortError(error, signal) {
  return signal?.aborted || error?.name === 'AbortError'
}

function createTitle(content) {
  const normalized = String(content).replace(/\s+/g, ' ').trim()
  return normalized.slice(0, 24) || '新对话'
}

function textTail(value, maximumLength = 1200) {
  const text = String(value ?? '')
  return text.slice(-Math.max(0, Number(maximumLength) || 0))
}

const CONTINUE_RESPONSE_PROMPT = [
  '[应用内部续写指令]',
  '请紧接上一条助手回复继续写下去，不要复述、总结、道歉或重新开场。',
  '保持原有语言、角色、叙事视角、语气和格式，直接输出续写正文。'
].join('\n')

const CHAT_CONTEXT_CANDIDATE_LIMIT = 80

async function readMessagePage(repository, conversationId, {
  beforeSequence = null,
  limit = CHAT_CONTEXT_CANDIDATE_LIMIT
} = {}) {
  if (typeof repository.listMessagePage === 'function') {
    return repository.listMessagePage(conversationId, { beforeSequence, limit })
  }
  const messages = await repository.listMessages(conversationId)
  const before = Number(beforeSequence)
  const hasBefore = beforeSequence !== null && beforeSequence !== undefined && Number.isFinite(before)
  const eligible = messages.filter(message => !hasBefore || (Number(message.sequence) || 0) < before)
  return {
    messages: eligible.slice(-limit),
    hasMore: eligible.length > limit
  }
}

async function loadContextAttachments(repository, conversationId, messages) {
  const attachmentIds = [...new Set(
    messages.flatMap(message => Array.isArray(message?.attachmentIds) ? message.attachmentIds : [])
  )]
  if (!attachmentIds.length) return []
  if (typeof repository.getAttachment === 'function') {
    const attachments = await Promise.all(attachmentIds.map(id => repository.getAttachment(id)))
    return attachments.filter(attachment => attachment && !attachment.deletedAt)
  }
  const attachments = typeof repository.listConversationAttachments === 'function'
    ? await repository.listConversationAttachments(conversationId)
    : []
  const selectedIds = new Set(attachmentIds)
  return attachments.filter(attachment => selectedIds.has(attachment.id) && !attachment.deletedAt)
}

function groupTitle(participants) {
  const names = participants
    .slice(0, 3)
    .map(participant => String(participant.nameSnapshot ?? '').trim())
    .filter(Boolean)
  return names.length ? names.join('、') : '角色群聊'
}

function groupParticipantInputs(values) {
  const participants = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const participant = typeof value === 'string' ? { characterId: value } : value
    const key = groupParticipantKey(participant)
    if (!key || seen.has(key)) continue
    seen.add(key)
    participants.push(participant)
    if (participants.length >= GROUP_MEMBER_LIMIT) break
  }
  return participants
}

function speakerFromMessage(message) {
  if (message?.speakerProviderProfileId) {
    return {
      memberKind: 'provider',
      providerProfileId: message.speakerProviderProfileId,
      modelName: message.speakerModelName,
      nameSnapshot: message.speakerNameSnapshot,
      avatarSource: message.speakerAvatarSource
    }
  }
  if (!message?.speakerCharacterId) return null
  return {
    memberKind: 'character',
    characterId: message.speakerCharacterId,
    nameSnapshot: message.speakerNameSnapshot,
    avatarAssetId: message.speakerAvatarAssetId
  }
}

function assistantMessageFor({
  idFactory,
  conversationId,
  sequence,
  timestamp,
  generationMode = 'chat',
  speaker = null,
  replyBatchId = null,
  retryOfMessageId = null
}) {
  return {
    id: idFactory(),
    conversationId,
    sequence,
    role: 'assistant',
    content: '',
    attachmentIds: [],
    generationMode,
    status: 'generating',
    requestId: idFactory(),
    finishReason: null,
    errorCode: null,
    errorMessage: '',
    retryOfMessageId,
    replyBatchId,
    speakerCharacterId: speaker?.characterId || null,
    speakerProviderProfileId: speaker?.providerProfileId || null,
    speakerModelName: speaker?.providerProfileId ? speaker?.modelName || null : null,
    speakerNameSnapshot: speaker?.nameSnapshot || null,
    speakerAvatarAssetId: speaker?.avatarAssetId || null,
    speakerAvatarSource: speaker?.avatarSource || null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null
  }
}

export class ChatService {
  constructor({
    repository,
    providerService,
    provider,
    getSystemPrompt = async () => '',
    getUserName = async () => '用户',
    getStreamingEnabled = async () => true,
    replyNotificationService = null,
    diagnosticLogStore = null,
    idFactory = createRuntimeId,
    now = () => new Date().toISOString(),
    setIntervalFn = globalThis.setInterval?.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval?.bind(globalThis)
  } = {}) {
    this.repository = repository
    this.providerService = providerService
    this.provider = provider
    this.getSystemPrompt = getSystemPrompt
    this.getUserName = getUserName
    this.getStreamingEnabled = getStreamingEnabled
    this.replyNotificationService = replyNotificationService
    this.diagnosticLogStore = diagnosticLogStore
    this.idFactory = idFactory
    this.now = now
    this.setIntervalFn = setIntervalFn
    this.clearIntervalFn = clearIntervalFn
    this.activeRequest = null
  }

  async createConversation({ providerProfileId, providerNameSnapshot, modelName } = {}) {
    const timestamp = this.now()
    const conversation = {
      id: this.idFactory(),
      title: '新对话',
      providerProfileId,
      providerNameSnapshot,
      modelName,
      systemPromptMode: 'inherit',
      lastMessageAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    }
    await this.repository.saveConversation(conversation)
    return conversation
  }

  async createCharacterConversation({
    characterId,
    providerProfileId,
    providerNameSnapshot,
    modelName,
    greetingIndex = 0
  } = {}) {
    const character = await this.repository.getCharacter?.(characterId)
    if (!character || character.deletedAt) throw new Error('角色不存在')
    const timestamp = this.now()
    const greetings = [character.card?.data?.first_mes, ...(character.card?.data?.alternate_greetings || [])]
    const greeting = String(greetings[Math.max(0, Number(greetingIndex) || 0)] ?? greetings[0] ?? '').trim()
    const userName = await this.getUserName()
    const conversation = {
      id: this.idFactory(),
      title: character.name,
      providerProfileId,
      providerNameSnapshot,
      modelName,
      characterId: character.id,
      characterNameSnapshot: character.name,
      characterAvatarAssetId: character.avatarAssetId,
      systemPromptMode: 'inherit',
      lastMessageAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    }
    const greetingMessage = greeting ? {
      id: this.idFactory(),
      conversationId: conversation.id,
      sequence: 1,
      role: 'assistant',
      content: renderCharacterTemplate(greeting, { characterName: character.name, userName }),
      attachmentIds: [],
      generationMode: 'chat',
      status: 'completed',
      isGreeting: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    } : null
    if (this.repository.createConversationWithInitialMessage) {
      await this.repository.createConversationWithInitialMessage(conversation, greetingMessage)
    } else {
      await this.repository.saveConversation(conversation)
      if (greetingMessage) await this.repository.saveMessage(greetingMessage)
    }
    return conversation
  }

  async #resolveGroupParticipants(values, timestamp, previousParticipants = []) {
    const requested = groupParticipantInputs(values)
    if (requested.length < 2) throw new Error('群聊至少需要选择两个成员')
    const previousById = new Map(normalizeGroupParticipants(previousParticipants)
      .map(participant => [groupParticipantKey(participant), participant]))
    const requestedById = new Map(requested
      .filter(value => value && typeof value === 'object')
      .map(value => [groupParticipantKey(value), value]))
    const requestedProviderIds = new Set(requested
      .filter(value => groupParticipantKind(value) === 'provider')
      .map(value => String(value?.providerProfileId ?? '').trim())
      .filter(Boolean))
    const providers = requestedProviderIds.size
      ? await this.providerService.listProviders()
      : []
    const providerById = new Map(providers.map(provider => [String(provider.id), provider]))
    const participants = []
    for (const requestedParticipant of requested) {
      const key = groupParticipantKey(requestedParticipant)
      const previous = previousById.get(key)
      const requestedValue = requestedById.get(key)
      if (groupParticipantKind(requestedParticipant) === 'provider') {
        const providerProfileId = String(requestedParticipant?.providerProfileId ?? '').trim()
        const provider = providerById.get(providerProfileId)
        if (!provider || provider.deletedAt) throw new Error('群聊包含不存在或已删除的接口')
        participants.push(createGroupProviderParticipant(provider, {
          enabled: requestedValue?.enabled ?? previous?.enabled ?? true,
          joinedAt: previous?.joinedAt || timestamp,
          modelName: requestedValue?.modelName || previous?.modelName || provider.defaultModel,
          avatarSource: resolveProviderAvatarSource(provider)
        }))
        continue
      }
      const characterId = String(requestedParticipant?.characterId ?? requestedParticipant ?? '').trim()
      const character = await this.repository.getCharacter?.(characterId)
      if (!character || character.deletedAt) throw new Error('群聊包含不存在或已删除的角色')
      participants.push(createGroupParticipant(character, {
        enabled: requestedValue?.enabled ?? previous?.enabled ?? true,
        joinedAt: previous?.joinedAt || timestamp
      }))
    }
    if (!participants.some(participant => participant.enabled)) {
      throw new Error('群聊至少需要启用一个成员')
    }
    return participants
  }

  async createGroupConversation({
    participants = [],
    participantCharacterIds = [],
    title = '',
    replyPolicy = {},
    providerProfileId,
    providerNameSnapshot,
    modelName
  } = {}) {
    const timestamp = this.now()
    const requested = participants.length ? participants : participantCharacterIds
    const resolvedParticipants = await this.#resolveGroupParticipants(requested, timestamp)
    const conversation = {
      id: this.idFactory(),
      title: String(title ?? '').trim() || groupTitle(resolvedParticipants),
      conversationKind: 'group',
      participants: resolvedParticipants,
      replyPolicy: normalizeGroupReplyPolicy(
        replyPolicy,
        resolvedParticipants.filter(participant => participant.enabled).length
      ),
      providerProfileId,
      providerNameSnapshot,
      modelName,
      systemPromptMode: 'inherit',
      lastMessageAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    }
    await this.repository.saveConversation(conversation)
    return conversation
  }

  async updateGroupConversation(id, {
    participants,
    title,
    replyPolicy
  } = {}) {
    const conversation = await this.repository.getConversation(id)
    if (!conversation || !isGroupConversation(conversation)) throw new Error('群聊不存在')
    const timestamp = this.now()
    const requested = participants ?? conversation.participants
    const resolvedParticipants = await this.#resolveGroupParticipants(
      requested,
      timestamp,
      conversation.participants
    )
    const updated = {
      ...conversation,
      title: String(title ?? conversation.title).trim() || groupTitle(resolvedParticipants),
      participants: resolvedParticipants,
      replyPolicy: normalizeGroupReplyPolicy(
        replyPolicy ?? conversation.replyPolicy,
        resolvedParticipants.filter(participant => participant.enabled).length
      ),
      updatedAt: timestamp
    }
    await this.repository.saveConversation(updated)
    return updated
  }

  async renameConversation(id, title) {
    const conversation = await this.repository.getConversation(id)
    if (!conversation) throw new Error('会话不存在')
    const updated = { ...conversation, title: createTitle(title), updatedAt: this.now() }
    await this.repository.saveConversation(updated)
    return updated
  }

  deleteConversation(id) {
    return this.repository.deleteConversation(id)
  }

  #startRequest({ requestId, assistantMessageId, onState, run }) {
    const controller = createAbortController()
    const activeRequest = {
      controller,
      requestId,
      assistantMessageId,
      completion: null
    }
    this.activeRequest = activeRequest
    onState?.({ generating: true, requestId })
    const completion = (async () => {
      try {
        return await run(controller, activeRequest)
      } finally {
        if (this.activeRequest === activeRequest) this.activeRequest = null
        onState?.({ generating: false, requestId })
      }
    })()
    activeRequest.completion = completion
    return completion
  }

  async send({ conversationId, providerProfileId = null, content, attachments = [], mode = 'chat', imageOptions = {}, onMessage, onConversation, onState } = {}) {
    if (this.activeRequest) throw new Error('当前回答仍在生成，请先停止生成')
    const text = String(content ?? '').trim()
    const preparedAttachments = Array.isArray(attachments) ? attachments : []
    const generationMode = mode === 'image' ? 'image' : 'chat'
    if (!text && !preparedAttachments.length) throw new Error('消息不能为空')
    if (generationMode === 'image' && preparedAttachments.length) throw new Error('生图模式暂不支持输入附件')
    const conversation = await this.repository.getConversation(conversationId)
    if (!conversation) throw new Error('会话不存在')
    const { messages: existingMessages } = await readMessagePage(this.repository, conversationId)
    const groupSpeakers = isGroupConversation(conversation) && generationMode === 'chat'
      ? selectGroupResponders({ conversation, messages: existingMessages, content: text })
      : []
    if (isGroupConversation(conversation) && generationMode === 'chat' && !groupSpeakers.length) {
      throw new Error('当前群聊仅响应被 @ 的成员，请先选择群成员')
    }
    const sequence = existingMessages.reduce((maximum, message) => Math.max(maximum, message.sequence ?? 0), 0)
    const timestamp = this.now()
    const userMessageId = this.idFactory()
    const replyBatchId = groupSpeakers.length ? this.idFactory() : null
    const persistedAttachments = preparedAttachments.map(attachment => ({
      ...attachment,
      id: this.idFactory(),
      conversationId,
      messageId: userMessageId,
      createdAt: timestamp,
      deletedAt: null
    }))
    const userMessage = {
      id: userMessageId, conversationId, sequence: sequence + 1, role: 'user', content: text,
      attachmentIds: persistedAttachments.map(attachment => attachment.id),
      status: 'completed', createdAt: timestamp, updatedAt: timestamp, deletedAt: null
    }
    const assistantMessage = assistantMessageFor({
      idFactory: this.idFactory,
      conversationId,
      sequence: sequence + 2,
      timestamp,
      generationMode,
      speaker: groupSpeakers[0] || null,
      replyBatchId
    })
    await this.repository.createMessagePair(userMessage, assistantMessage, persistedAttachments)
    const updatedConversation = {
      ...conversation,
      title: conversation.title === '新对话' ? createTitle(text || persistedAttachments[0]?.name) : conversation.title,
      lastMessageAt: timestamp,
      updatedAt: timestamp
    }
    await this.repository.saveConversation(updatedConversation)
    onMessage?.({ ...userMessage, attachments: persistedAttachments })
    onMessage?.({ ...assistantMessage })
    onConversation?.({ ...updatedConversation })

    if (groupSpeakers.length) {
      return this.#startRequest({
        requestId: replyBatchId,
        assistantMessageId: assistantMessage.id,
        onState,
        run: (controller, activeRequest) => this.#runGroupGeneration({
          conversation: updatedConversation,
          userMessage,
          firstAssistantMessage: assistantMessage,
          existingMessages,
          speakers: groupSpeakers,
          baseSequence: sequence,
          replyBatchId,
          providerProfileId,
          onMessage,
          onConversation,
          controller,
          activeRequest
        })
      })
    }

    return this.#startRequest({
      requestId: assistantMessage.requestId,
      assistantMessageId: assistantMessage.id,
      onState,
      run: controller => this.#runGeneration({
        conversation: updatedConversation,
        userMessage,
        assistantMessage,
        contextMessages: [...existingMessages, userMessage],
        generationMode,
        providerProfileId,
        imageOptions,
        onMessage,
        controller
      })
    })
  }

  async retry(messageId, { providerProfileId = null, onMessage, onState } = {}) {
    if (this.activeRequest) throw new Error('当前回答仍在生成，请先停止生成')
    const previous = await this.repository.getMessage(messageId)
    if (!previous || previous.role !== 'assistant') throw new Error('只能重试助手消息')
    if (previous.isGreeting) throw new Error('角色问候语不能重试，请从联系人新建会话')
    const conversation = await this.repository.getConversation(previous.conversationId)
    const [{ messages }, { messages: latestMessages }] = await Promise.all([
      readMessagePage(this.repository, previous.conversationId, {
        beforeSequence: (Number(previous.sequence) || 0) + 1
      }),
      readMessagePage(this.repository, previous.conversationId, { limit: 1 })
    ])
    const userMessages = messages
      .filter((message) => message.role === 'user' && message.sequence < previous.sequence)
    const userMessage = userMessages[userMessages.length - 1]
    if (!conversation || !userMessage) throw new Error('找不到对应的用户消息')
    const timestamp = this.now()
    const assistantMessage = assistantMessageFor({
      idFactory: this.idFactory,
      conversationId: conversation.id,
      sequence: (Number(latestMessages[latestMessages.length - 1]?.sequence) || 0) + 1,
      timestamp,
      generationMode: previous.generationMode === 'image' ? 'image' : 'chat',
      speaker: speakerFromMessage(previous),
      replyBatchId: isGroupConversation(conversation) ? this.idFactory() : null,
      retryOfMessageId: previous.id
    })
    await this.repository.saveMessage(assistantMessage)
    onMessage?.({ ...assistantMessage })
    return this.#startRequest({
      requestId: assistantMessage.requestId,
      assistantMessageId: assistantMessage.id,
      onState,
      run: controller => this.#runGeneration({
        conversation,
        userMessage,
        assistantMessage,
        contextMessages: messages,
        generationMode: assistantMessage.generationMode,
        providerProfileId,
        imageOptions: {},
        onMessage,
        controller
      })
    })
  }

  async continueResponse(messageId, { providerProfileId = null, onMessage, onConversation, onState } = {}) {
    if (this.activeRequest) throw new Error('当前回答仍在生成，请先停止生成')
    const previous = await this.repository.getMessage(messageId)
    if (!previous || previous.role !== 'assistant') throw new Error('只能续写助手消息')
    if (!['completed', 'interrupted'].includes(previous.status) || !String(previous.content ?? '').trim()) {
      throw new Error('只能续写已完成或已中断的文字回复')
    }
    if (previous.generationMode === 'image') throw new Error('图片回复不能续写')

    const conversation = await this.repository.getConversation(previous.conversationId)
    const { messages } = await readMessagePage(this.repository, previous.conversationId)
    const latestMessage = messages[messages.length - 1] || null
    const lastSequence = Number(latestMessage?.sequence) || 0
    if (!conversation) throw new Error('会话不存在')
    if (latestMessage?.id !== previous.id) throw new Error('只能从最新一条回复继续续写')

    const timestamp = this.now()
    const assistantMessage = assistantMessageFor({
      idFactory: this.idFactory,
      conversationId: conversation.id,
      sequence: lastSequence + 1,
      timestamp,
      generationMode: 'chat',
      speaker: speakerFromMessage(previous),
      replyBatchId: isGroupConversation(conversation) ? this.idFactory() : null
    })
    const requestOnlyUserMessage = {
      id: `${assistantMessage.requestId}-continue`,
      conversationId: conversation.id,
      sequence: lastSequence + 1,
      role: 'user',
      content: CONTINUE_RESPONSE_PROMPT,
      attachmentIds: [],
      status: 'completed',
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    }
    const updatedConversation = {
      ...conversation,
      lastMessageAt: timestamp,
      updatedAt: timestamp
    }

    await this.repository.saveMessage(assistantMessage)
    await this.repository.saveConversation(updatedConversation)
    onMessage?.({ ...assistantMessage })
    onConversation?.({ ...updatedConversation })

    return this.#startRequest({
      requestId: assistantMessage.requestId,
      assistantMessageId: assistantMessage.id,
      onState,
      run: controller => this.#runGeneration({
        conversation: updatedConversation,
        userMessage: requestOnlyUserMessage,
        assistantMessage,
        contextMessages: [...messages, requestOnlyUserMessage],
        generationMode: 'chat',
        providerProfileId,
        imageOptions: {},
        onMessage,
        controller
      })
    })
  }

  stop() {
    if (!this.activeRequest) return false
    this.activeRequest.controller.abort()
    return true
  }

  async stopAndWait() {
    const activeRequest = this.activeRequest
    if (!activeRequest) return false
    activeRequest.controller.abort()
    try {
      await activeRequest.completion
    } catch (_) {}
    return true
  }

  async #runGroupGeneration({
    conversation,
    userMessage,
    firstAssistantMessage,
    existingMessages,
    speakers,
    baseSequence,
    replyBatchId,
    providerProfileId,
    onMessage,
    onConversation,
    controller,
    activeRequest
  }) {
    const contextMessages = [...existingMessages, userMessage]
    const participants = normalizeGroupParticipants(conversation.participants)
      .filter(participant => participant.enabled !== false)
    const replyPolicy = normalizeGroupReplyPolicy(conversation.replyPolicy, participants.length)
    const pendingSpeakers = [...speakers]
    const pendingSpeakerKeys = new Set(pendingSpeakers.map(groupParticipantKey).filter(Boolean))
    const responses = []
    let autoHandoffCount = 0
    let autoHandoffLimitReached = false
    while (pendingSpeakers.length && responses.length < GROUP_REPLY_CHAIN_LIMIT) {
      if (controller.signal.aborted) break
      const speaker = pendingSpeakers.shift()
      const speakerKey = groupParticipantKey(speaker)
      pendingSpeakerKeys.delete(speakerKey)
      const responseIndex = responses.length
      const assistantMessage = responseIndex === 0
        ? firstAssistantMessage
        : assistantMessageFor({
            idFactory: this.idFactory,
            conversationId: conversation.id,
            sequence: baseSequence + 2 + responseIndex,
            timestamp: this.now(),
            generationMode: 'chat',
            speaker,
            replyBatchId
          })
      if (responseIndex > 0) {
        await this.repository.saveMessage(assistantMessage)
        onMessage?.({ ...assistantMessage })
      }
      activeRequest.assistantMessageId = assistantMessage.id
      const response = await this.#runGeneration({
        conversation,
        userMessage,
        assistantMessage,
        contextMessages,
        generationMode: 'chat',
        providerProfileId,
        imageOptions: {},
        onMessage,
        controller
      })
      responses.push(response)
      contextMessages.push(response)
      if (response.status === 'failed' || response.status === 'cancelled') break
      if (!replyPolicy.autoHandoff || response.status !== 'completed') continue

      const visibleResponse = extractAssistantStatus(response.content, { hideIncomplete: true }).content
      const mentionedKeys = new Set(mentionedGroupParticipantIds(visibleResponse, participants))
      for (const participant of participants) {
        const participantKey = groupParticipantKey(participant)
        if (
          !mentionedKeys.has(participantKey) ||
          participantKey === speakerKey ||
          pendingSpeakerKeys.has(participantKey)
        ) {
          continue
        }
        if (responses.length + pendingSpeakers.length >= GROUP_REPLY_CHAIN_LIMIT) {
          autoHandoffLimitReached = true
          continue
        }
        pendingSpeakers.push(participant)
        pendingSpeakerKeys.add(participantKey)
        autoHandoffCount += 1
      }
    }
    if (pendingSpeakers.length && responses.length >= GROUP_REPLY_CHAIN_LIMIT) {
      autoHandoffLimitReached = true
    }

    const latest = responses[responses.length - 1] || firstAssistantMessage
    const updatedConversation = {
      ...conversation,
      lastMessageAt: latest.updatedAt || conversation.lastMessageAt,
      updatedAt: latest.updatedAt || conversation.updatedAt
    }
    await this.repository.saveConversation(updatedConversation)
    onConversation?.({ ...updatedConversation })
    return {
      ...latest,
      batchMessages: responses.map(response => ({ ...response })),
      autoHandoffCount,
      autoHandoffLimitReached
    }
  }

  async #runGeneration({ conversation, userMessage, assistantMessage, contextMessages, generationMode = 'chat', providerProfileId = null, imageOptions = {}, onMessage, controller }) {
    let dirtyCharacters = 0
    let dirty = false
    let persistence = Promise.resolve()
    const queuePersistence = (force = false) => {
      if (!dirty && !force) return persistence
      dirty = false
      dirtyCharacters = 0
      const snapshot = { ...assistantMessage }
      delete snapshot.attachments
      persistence = persistence.then(() => this.repository.saveMessage(snapshot))
      return persistence
    }
    const interval = this.setIntervalFn(() => {
      if (dirty) queuePersistence()
    }, 500)
    interval?.unref?.()

    try {
      const requestProviderProfileId = assistantMessage.speakerProviderProfileId ||
        providerProfileId ||
        conversation.providerProfileId
      const profile = await this.providerService.getRequestProfile(requestProviderProfileId)
      const requestModel = assistantMessage.speakerProviderProfileId
        ? assistantMessage.speakerModelName || profile.defaultModel
        : conversation.modelName || profile.defaultModel
      if (controller.signal.aborted) {
        throw createAbortError()
      }
      let result
      let callbackImageCount = 0
      let callbackImagePersistence = Promise.resolve()
      const markGeneratedImageDirty = () => {
        dirty = true
        dirtyCharacters = 200
      }
      const persistImageCallback = (image) => {
        callbackImagePersistence = callbackImagePersistence.then(async () => {
          callbackImageCount += await this.#persistGeneratedImages(
            [image], conversation, assistantMessage, onMessage, markGeneratedImageDirty
          )
        })
      }
      try {
        if (generationMode === 'image') {
          if (typeof this.provider.generateImage !== 'function') throw new Error('当前接口不支持生图协议')
          result = await this.provider.generateImage(profile, {
            model: requestModel,
            prompt: userMessage.content,
            signal: controller.signal,
            ...imageOptions
          }, { onImage: persistImageCallback })
        } else {
          const instructions = await this.getSystemPrompt(conversation, {
            messages: contextMessages,
            speakerCharacterId: assistantMessage.speakerCharacterId,
            speakerProviderProfileId: assistantMessage.speakerProviderProfileId
          })
          const systemPrompt = typeof instructions === 'string' ? instructions : instructions?.systemPrompt
          const postHistoryPrompt = typeof instructions === 'string' ? '' : instructions?.postHistoryPrompt
          const userTurnPrompt = typeof instructions === 'string' ? '' : instructions?.userTurnPrompt
          const attachments = await loadContextAttachments(this.repository, conversation.id, contextMessages)
          const visibleMessages = isGroupConversation(conversation)
            ? groupVisibleMessages(contextMessages, { userName: await this.getUserName() })
            : contextMessages
          const requestMessages = buildChatContext({
            messages: visibleMessages,
            attachments,
            systemPrompt,
            postHistoryPrompt,
            userTurnPrompt
          })
          const statusCharacterId = assistantMessage.speakerCharacterId || conversation.characterId
          if (statusCharacterId) {
            const systemMessages = requestMessages.filter(message => message.role === 'system')
            const firstSystem = systemMessages[0]?.content || ''
            const lastSystem = systemMessages.length ? systemMessages[systemMessages.length - 1].content : ''
            let latestUser = ''
            for (let index = requestMessages.length - 1; index >= 0; index -= 1) {
              if (requestMessages[index].role === 'user') {
                latestUser = String(requestMessages[index].content ?? '')
                break
              }
            }
            this.#addDiagnosticLog('chat_status_request', {
              conversationId: conversation.id,
              requestId: assistantMessage.requestId,
              speakerCharacterId: statusCharacterId,
              profileId: profile.id || '',
              protocolType: profile.protocolType || '',
              model: requestModel || '',
              messageRoles: requestMessages.map(message => message.role).join(','),
              messageCount: requestMessages.length,
              systemMessageCount: systemMessages.length,
              statusProtocolInFirstSystem: firstSystem.includes('[统一状态栏输出协议：每轮强制]') && firstSystem.includes('<sumo_monitor>'),
              statusProtocolInAnySystem: systemMessages.some(message => String(message.content).includes('<sumo_monitor>')),
              finalReminderInLastSystem: String(lastSystem).includes('[状态栏最终提醒]'),
              statusProtocolInLatestUser: latestUser.includes('[应用内部状态输出要求]') && latestUser.includes('<sumo_monitor>'),
              systemPromptLength: String(systemPrompt ?? '').length,
              postHistoryPromptLength: String(postHistoryPrompt ?? '').length,
              userTurnPromptLength: String(userTurnPrompt ?? '').length,
              firstSystemTail: textTail(firstSystem, 1000),
              lastSystemTail: textTail(lastSystem, 500),
              latestUserTail: textTail(latestUser, 1000)
            })
          }
          const streamingEnabled = await this.getStreamingEnabled()
          result = await this.provider.streamChat(profile, {
            model: requestModel,
            messages: requestMessages,
            signal: controller.signal,
            stream: streamingEnabled !== false
          }, {
            onDelta: (delta) => {
              if (controller.signal.aborted) return
              assistantMessage.content += delta
              assistantMessage.updatedAt = this.now()
              dirty = true
              dirtyCharacters += delta.length
              onMessage?.({ ...assistantMessage, attachments: assistantMessage.attachments || [] })
              if (dirtyCharacters >= 200) queuePersistence()
            },
            onImage: persistImageCallback
          })
        }
      } finally {
        await callbackImagePersistence
      }
      const returnedImageCount = await this.#persistGeneratedImages(
        result?.images || [],
        conversation,
        assistantMessage,
        onMessage,
        markGeneratedImageDirty
      )
      const generatedImageCount = callbackImageCount + returnedImageCount
      if (generationMode === 'image' && generatedImageCount === 0) throw new Error('生图接口没有返回图片')
      assistantMessage.status = 'completed'
      assistantMessage.finishReason = result?.finishReason ?? null
      } catch (error) {
        if (isAbortError(error, controller.signal)) {
          assistantMessage.status = 'cancelled'
        } else {
          assistantMessage.status = assistantMessage.content ? 'interrupted' : 'failed'
          assistantMessage.errorCode = error?.code || 'request_failed'
          assistantMessage.errorMessage = error?.message || '请求失败'
        }
      } finally {
      this.clearIntervalFn(interval)
      assistantMessage.updatedAt = this.now()
      await queuePersistence(true)
      const statusCharacterId = assistantMessage.speakerCharacterId || conversation.characterId
      if (generationMode === 'chat' && statusCharacterId) {
        const response = String(assistantMessage.content ?? '')
        const extracted = extractAssistantStatus(response)
        this.#addDiagnosticLog('chat_status_response', {
          conversationId: conversation.id,
          requestId: assistantMessage.requestId,
          messageId: assistantMessage.id,
          speakerCharacterId: statusCharacterId,
          messageStatus: assistantMessage.status,
          finishReason: assistantMessage.finishReason || '',
          errorCode: assistantMessage.errorCode || '',
          responseLength: response.length,
          responseTail: textTail(response),
          canonicalOpenCount: (response.match(/<\s*sumo_monitor\b/gi) || []).length,
          canonicalCloseCount: (response.match(/<\s*\/\s*sumo_monitor\s*>/gi) || []).length,
          statusParsed: Boolean(extracted.status),
          statusPending: Boolean(extracted.pending),
          parsedRootTag: extracted.status?.rootTag || '',
          parsedSections: extracted.status?.sections?.map(section => section.tag).join(',') || ''
        })
      }
      if (assistantMessage.status === 'completed') {
        try {
          await this.replyNotificationService?.notifyReply({
            conversation,
            message: { ...assistantMessage }
          })
        } catch (_) {}
      }
      onMessage?.({ ...assistantMessage })
    }
    return { ...assistantMessage }
  }

  async #persistGeneratedImages(images, conversation, assistantMessage, onMessage, markDirty) {
    const currentAttachments = Array.isArray(assistantMessage.attachments) ? assistantMessage.attachments : []
    const existingSources = new Set(currentAttachments.map(attachment => attachment.dataUrl || attachment.sourceUrl).filter(Boolean))
    const timestamp = this.now()
    const generated = []
    for (const output of images) {
      const normalized = normalizeImageOutput(output, currentAttachments.length + generated.length, { assumeImage: true })
      if (!normalized) continue
      const source = normalized.dataUrl || normalized.sourceUrl
      if (!source || existingSources.has(source)) continue
      existingSources.add(source)
      generated.push({
        ...normalized,
        id: this.idFactory(),
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        createdAt: timestamp,
        deletedAt: null
      })
    }
    if (!generated.length) return 0
    await this.repository.saveAttachments(generated)
    assistantMessage.attachmentIds = [...(assistantMessage.attachmentIds || []), ...generated.map(attachment => attachment.id)]
    assistantMessage.attachments = [...currentAttachments, ...generated]
    assistantMessage.updatedAt = this.now()
    markDirty()
    onMessage?.({ ...assistantMessage, attachments: assistantMessage.attachments })
    return generated.length
  }

  #addDiagnosticLog(type, detail) {
    try {
      this.diagnosticLogStore?.add?.(type, detail)
    } catch (_) {}
  }
}

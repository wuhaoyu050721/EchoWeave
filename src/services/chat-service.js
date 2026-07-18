import { buildChatContext } from '../core/chat-context.js'
import { createAbortController, createAbortError } from '../core/abort-controller-polyfill.js'
import { normalizeImageOutput } from '../core/image-output.js'
import { renderCharacterTemplate } from '../core/character-prompt.js'
import { createRuntimeId } from '../core/runtime-id.js'

function isAbortError(error, signal) {
  return signal?.aborted || error?.name === 'AbortError'
}

function createTitle(content) {
  const normalized = String(content).replace(/\s+/g, ' ').trim()
  return normalized.slice(0, 24) || '新对话'
}

export class ChatService {
  constructor({
    repository,
    providerService,
    provider,
    getSystemPrompt = async () => '',
    getUserName = async () => '用户',
    replyNotificationService = null,
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
    this.replyNotificationService = replyNotificationService
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

  async send({ conversationId, providerProfileId = null, content, attachments = [], mode = 'chat', imageOptions = {}, onMessage, onConversation, onState } = {}) {
    if (this.activeRequest) throw new Error('当前回答仍在生成，请先停止生成')
    const text = String(content ?? '').trim()
    const preparedAttachments = Array.isArray(attachments) ? attachments : []
    const generationMode = mode === 'image' ? 'image' : 'chat'
    if (!text && !preparedAttachments.length) throw new Error('消息不能为空')
    if (generationMode === 'image' && preparedAttachments.length) throw new Error('生图模式暂不支持输入附件')
    const conversation = await this.repository.getConversation(conversationId)
    if (!conversation) throw new Error('会话不存在')
    const existingMessages = await this.repository.listMessages(conversationId)
    const sequence = existingMessages.reduce((maximum, message) => Math.max(maximum, message.sequence ?? 0), 0)
    const timestamp = this.now()
    const userMessageId = this.idFactory()
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
    const assistantMessage = {
      id: this.idFactory(), conversationId, sequence: sequence + 2, role: 'assistant', content: '',
      attachmentIds: [], generationMode, status: 'generating', requestId: this.idFactory(), finishReason: null, errorCode: null, errorMessage: '',
      retryOfMessageId: null, createdAt: timestamp, updatedAt: timestamp, deletedAt: null
    }
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

    const completion = this.#runGeneration({
      conversation: updatedConversation,
      userMessage,
      assistantMessage,
      contextMessages: [...existingMessages, userMessage],
      generationMode,
      providerProfileId,
      imageOptions,
      onMessage,
      onState
    })
    this.activeRequest.completion = completion
    return completion
  }

  async retry(messageId, { providerProfileId = null, onMessage, onState } = {}) {
    if (this.activeRequest) throw new Error('当前回答仍在生成，请先停止生成')
    const previous = await this.repository.getMessage(messageId)
    if (!previous || previous.role !== 'assistant') throw new Error('只能重试助手消息')
    if (previous.isGreeting) throw new Error('角色问候语不能重试，请从联系人新建会话')
    const conversation = await this.repository.getConversation(previous.conversationId)
    const messages = await this.repository.listMessages(previous.conversationId)
    const userMessages = messages
      .filter((message) => message.role === 'user' && message.sequence < previous.sequence)
    const userMessage = userMessages[userMessages.length - 1]
    if (!conversation || !userMessage) throw new Error('找不到对应的用户消息')
    const timestamp = this.now()
    const assistantMessage = {
      id: this.idFactory(),
      conversationId: conversation.id,
      sequence: messages.reduce((maximum, message) => Math.max(maximum, message.sequence ?? 0), 0) + 1,
      role: 'assistant',
      content: '',
      attachmentIds: [],
      generationMode: previous.generationMode === 'image' ? 'image' : 'chat',
      status: 'generating',
      requestId: this.idFactory(),
      finishReason: null,
      errorCode: null,
      errorMessage: '',
      retryOfMessageId: previous.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    }
    await this.repository.saveMessage(assistantMessage)
    onMessage?.({ ...assistantMessage })
    const completion = this.#runGeneration({
      conversation,
      userMessage,
      assistantMessage,
      contextMessages: messages,
      generationMode: assistantMessage.generationMode,
      providerProfileId,
      imageOptions: {},
      onMessage,
      onState
    })
    this.activeRequest.completion = completion
    return completion
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

  async #runGeneration({ conversation, userMessage, assistantMessage, contextMessages, generationMode = 'chat', providerProfileId = null, imageOptions = {}, onMessage, onState }) {
    const controller = createAbortController()
    this.activeRequest = { controller, assistantMessageId: assistantMessage.id }
    onState?.({ generating: true, requestId: assistantMessage.requestId })
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
      const profile = await this.providerService.getRequestProfile(providerProfileId || conversation.providerProfileId)
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
            model: conversation.modelName || profile.defaultModel,
            prompt: userMessage.content,
            signal: controller.signal,
            ...imageOptions
          }, { onImage: persistImageCallback })
        } else {
          const instructions = await this.getSystemPrompt(conversation, { messages: contextMessages })
          const systemPrompt = typeof instructions === 'string' ? instructions : instructions?.systemPrompt
          const postHistoryPrompt = typeof instructions === 'string' ? '' : instructions?.postHistoryPrompt
          const attachments = this.repository.listConversationAttachments
            ? await this.repository.listConversationAttachments(conversation.id)
            : []
          const requestMessages = buildChatContext({ messages: contextMessages, attachments, systemPrompt, postHistoryPrompt })
          result = await this.provider.streamChat(profile, {
            model: conversation.modelName || profile.defaultModel,
            messages: requestMessages,
            signal: controller.signal
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
      if (assistantMessage.status === 'completed') {
        try {
          await this.replyNotificationService?.notifyReply({
            conversation,
            message: { ...assistantMessage }
          })
        } catch (_) {}
      }
      this.activeRequest = null
      onMessage?.({ ...assistantMessage })
      onState?.({ generating: false, requestId: assistantMessage.requestId })
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
}

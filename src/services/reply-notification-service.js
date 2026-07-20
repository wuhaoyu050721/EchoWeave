import { extractAssistantStatus } from '../core/assistant-status.js'

export const REPLY_NOTIFICATION_SETTING_KEY = 'replyNotificationsEnabled'

const DEFAULT_PREVIEW_LENGTH = 120

function trimmedText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function createReplyNotificationContent(message = {}, maximumLength = DEFAULT_PREVIEW_LENGTH) {
  const presentation = extractAssistantStatus(message.content)
  const content = trimmedText(presentation.content)
  const limit = Math.max(16, Number(maximumLength) || DEFAULT_PREVIEW_LENGTH)
  if (content) return content.length > limit ? `${content.slice(0, limit - 3)}...` : content

  if (presentation.status) return '角色状态已更新'

  const attachments = Array.isArray(message.attachments) ? message.attachments : []
  const imageCount = attachments.filter(attachment => attachment?.kind === 'image').length
  if (imageCount > 1) return `发来了 ${imageCount} 张图片`
  if (imageCount === 1 || message.generationMode === 'image') return '发来了一张图片'
  return '回复已完成'
}

export function createReplyNotificationTitle(conversation = {}) {
  return trimmedText(
    conversation.characterNameSnapshot ||
    conversation.title ||
    conversation.providerNameSnapshot ||
    'AI 助手'
  )
}

export function replyConversationIdFromEvent(event) {
  const seen = new Set()

  function visit(value, depth = 0) {
    if (depth > 5 || value == null) return null
    if (typeof value === 'string') {
      const normalized = value.trim()
      if (!normalized || (!normalized.startsWith('{') && !normalized.startsWith('['))) return null
      try { return visit(JSON.parse(normalized), depth + 1) }
      catch (_) { return null }
    }
    if (typeof value !== 'object' || seen.has(value)) return null
    seen.add(value)

    const conversationId = trimmedText(value.conversationId)
    if (conversationId) return conversationId
    return visit(value.payload, depth + 1) || visit(value.data, depth + 1)
  }

  return visit(event)
}

export class ReplyNotificationService {
  constructor({ adapter = null, isAppVisible = null } = {}) {
    this.adapter = adapter
    this.supported = Boolean(adapter?.supported)
    this.isAppVisible = typeof isAppVisible === 'function' ? isAppVisible : null
    this.enabled = true
    this.authorized = false
    this.appVisible = true
    this.activeConversationId = null
    this.pendingConversationId = null
    this.openConversationHandler = null
    this.initialized = false
  }

  async initialize({ enabled = true, onOpenConversation = null } = {}) {
    this.enabled = Boolean(enabled)
    this.openConversationHandler = typeof onOpenConversation === 'function' ? onOpenConversation : null
    if (!this.supported) return { supported: false, authorized: false }

    try {
      if (!this.initialized) {
        await this.adapter.initialize(event => this.openNotification(event))
        this.initialized = true
      }
      this.authorized = this.enabled
        ? await this.adapter.requestPermission()
        : await this.adapter.isAuthorized()
    } catch (_) {
      this.authorized = false
    }
    return { supported: true, authorized: this.authorized }
  }

  async setEnabled(enabled) {
    this.enabled = Boolean(enabled)
    if (!this.supported) return false
    try {
      this.authorized = this.enabled
        ? await this.adapter.requestPermission()
        : await this.adapter.isAuthorized()
    } catch (_) {
      this.authorized = false
    }
    return this.authorized
  }

  async refreshPermission() {
    if (!this.supported) return false
    try { this.authorized = await this.adapter.isAuthorized() }
    catch (_) { this.authorized = false }
    return this.authorized
  }

  openSettings() {
    return this.adapter?.openSettings?.() ?? Promise.resolve(false)
  }

  setAppVisible(visible) {
    this.appVisible = Boolean(visible)
  }

  setActiveConversationId(conversationId) {
    this.activeConversationId = trimmedText(conversationId) || null
  }

  async notifyReply({ conversation, message } = {}) {
    if (!this.supported || !this.enabled || !this.authorized) return false
    const conversationId = trimmedText(conversation?.id || message?.conversationId)
    if (!conversationId || message?.status !== 'completed') return false

    const visible = this.isAppVisible ? Boolean(this.isAppVisible()) : this.appVisible
    if (visible && this.activeConversationId === conversationId) return false

    await this.adapter.showReplyNotification({
      title: createReplyNotificationTitle(conversation),
      content: createReplyNotificationContent(message),
      payload: {
        type: 'ai-reply',
        conversationId,
        messageId: trimmedText(message?.id)
      }
    })
    return true
  }

  async openNotification(event) {
    const conversationId = replyConversationIdFromEvent(event)
    if (!conversationId) return false
    this.pendingConversationId = conversationId
    if (!this.openConversationHandler) return true

    try {
      const handled = await this.openConversationHandler(conversationId)
      if (handled !== false && this.pendingConversationId === conversationId) this.pendingConversationId = null
      return handled !== false
    } catch (_) {
      return false
    }
  }

  takePendingConversationId() {
    const conversationId = this.pendingConversationId
    this.pendingConversationId = null
    return conversationId
  }

  dispose() {
    this.adapter?.dispose?.()
    this.initialized = false
    this.openConversationHandler = null
  }
}

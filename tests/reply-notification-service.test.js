import assert from 'node:assert/strict'
import test from 'node:test'
import { UniPushNotificationAdapter, REPLY_NOTIFICATION_CHANNEL_ID } from '../src/platform/app/uni-push-notification-adapter.js'
import {
  ReplyNotificationService,
  createReplyNotificationContent,
  createReplyNotificationTitle,
  replyConversationIdFromEvent
} from '../src/services/reply-notification-service.js'

function createAdapter({ authorized = true } = {}) {
  const notifications = []
  let clickHandler = null
  return {
    supported: true,
    notifications,
    async initialize(handler) { clickHandler = handler },
    async requestPermission() { return authorized },
    async isAuthorized() { return authorized },
    async showReplyNotification(notification) { notifications.push(notification) },
    click(event) { return clickHandler?.(event) }
  }
}

test('builds compact reply notification titles and previews', () => {
  assert.equal(createReplyNotificationTitle({ characterNameSnapshot: '苏墨', title: '会话' }), '苏墨')
  assert.equal(createReplyNotificationTitle({ title: ' 普通会话 ' }), '普通会话')
  assert.equal(createReplyNotificationContent({ content: ' 第一行\n 第二行 ' }), '第一行 第二行')
  assert.equal(createReplyNotificationContent({ generationMode: 'image', content: '' }), '发来了一张图片')
  assert.equal(createReplyNotificationContent({ attachments: [{ kind: 'image' }, { kind: 'image' }] }), '发来了 2 张图片')
  assert.equal(createReplyNotificationContent({ content: 'x'.repeat(40) }, 20), `${'x'.repeat(17)}...`)
  assert.equal(
    createReplyNotificationContent({ content: '她回来了。\n<status>[位置|门口]</status>' }),
    '她回来了。'
  )
  assert.equal(createReplyNotificationContent({ content: '<status>[位置|门口]</status>' }), '角色状态已更新')
})

test('shows completed replies outside the visible conversation and skips the active chat', async () => {
  const adapter = createAdapter()
  const service = new ReplyNotificationService({ adapter })
  await service.initialize({ enabled: true })
  service.setActiveConversationId('conversation-1')

  const input = {
    conversation: { id: 'conversation-1', characterNameSnapshot: '苏墨' },
    message: { id: 'message-1', conversationId: 'conversation-1', status: 'completed', content: '回复内容' }
  }
  assert.equal(await service.notifyReply(input), false)
  assert.equal(adapter.notifications.length, 0)

  service.setAppVisible(false)
  assert.equal(await service.notifyReply(input), true)
  assert.deepEqual(adapter.notifications[0], {
    title: '苏墨',
    content: '回复内容',
    payload: { type: 'ai-reply', conversationId: 'conversation-1', messageId: 'message-1' }
  })
})

test('does not show disabled, unauthorized, or failed reply notifications', async () => {
  const adapter = createAdapter({ authorized: false })
  const service = new ReplyNotificationService({ adapter })
  const state = await service.initialize({ enabled: true })
  assert.equal(state.authorized, false)
  assert.equal(await service.notifyReply({
    conversation: { id: 'conversation-1' },
    message: { status: 'completed', content: 'hidden' }
  }), false)
  assert.equal(adapter.notifications.length, 0)
})

test('keeps notification initialization failures isolated from app startup', async () => {
  const service = new ReplyNotificationService({
    adapter: {
      supported: true,
      async initialize() { throw new Error('push module unavailable') }
    }
  })

  assert.deepEqual(await service.initialize({ enabled: true }), { supported: true, authorized: false })
})

test('opens the conversation encoded in uni-push and 5+ payload shapes', async () => {
  assert.equal(replyConversationIdFromEvent({ type: 'click', data: { payload: { conversationId: 'c1' } } }), 'c1')
  assert.equal(replyConversationIdFromEvent({ payload: JSON.stringify({ type: 'ai-reply', conversationId: 'c2' }) }), 'c2')

  const adapter = createAdapter()
  const opened = []
  const service = new ReplyNotificationService({ adapter })
  await service.initialize({ enabled: true, onOpenConversation: async id => { opened.push(id); return true } })
  await adapter.click({ type: 'click', data: { payload: { type: 'ai-reply', conversationId: 'c3' } } })

  assert.deepEqual(opened, ['c3'])
  assert.equal(service.takePendingConversationId(), null)
})

test('configures a high-priority IM channel and creates a local uni-push message', async () => {
  let channelOptions
  let pushOptions
  let pushListener
  const uniApi = {
    getAppAuthorizeSetting: () => ({ notificationAuthorized: 'authorized' }),
    getPushChannelManager: () => ({ setPushChannel: options => { channelOptions = options } }),
    onPushMessage: listener => { pushListener = listener },
    offPushMessage() {},
    createPushMessage(options) { pushOptions = options; options.success({}) }
  }
  const adapter = new UniPushNotificationAdapter({ uniApi, plusApi: { os: { name: 'Android', version: '16' } } })
  let clicked = 0
  await adapter.initialize(() => { clicked += 1 })
  await adapter.showReplyNotification({ title: '苏墨', content: '你好', payload: { conversationId: 'c1' } })
  pushListener({ type: 'receive' })
  pushListener({ type: 'click' })

  assert.equal(channelOptions.channelId, REPLY_NOTIFICATION_CHANNEL_ID)
  assert.equal(channelOptions.importance, 4)
  assert.equal(channelOptions.enableVibration, true)
  assert.equal(pushOptions.channelId, REPLY_NOTIFICATION_CHANNEL_ID)
  assert.equal(pushOptions.category, 'IM')
  assert.equal(pushOptions.sound, 'system')
  assert.deepEqual(pushOptions.payload, { conversationId: 'c1' })
  assert.equal(clicked, 1)
})

test('requests POST_NOTIFICATIONS on Android 13 and newer', async () => {
  let requested
  const uniApi = {
    createPushMessage() {},
    getAppAuthorizeSetting: () => ({ notificationAuthorized: 'denied' })
  }
  const plusApi = {
    os: { name: 'Android', version: '16' },
    android: {
      requestPermissions(permissions, success) {
        requested = permissions
        success({ granted: permissions })
      }
    }
  }
  const adapter = new UniPushNotificationAdapter({ uniApi, plusApi })

  assert.equal(await adapter.requestPermission(), true)
  assert.deepEqual(requested, ['android.permission.POST_NOTIFICATIONS'])
})

test('settings UI exposes a persistent Android reply notification switch', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'))
  const manifest = await import('node:fs/promises').then(fs => fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'))

  assert.match(source, /data-testid="reply-notifications"/)
  assert.match(source, /REPLY_NOTIFICATION_SETTING_KEY/)
  assert.match(source, /toggleReplyNotifications/)
  assert.match(source, /openReplyNotificationConversation/)
  assert.match(manifest, /"Push"\s*:\s*\{\}/)
})

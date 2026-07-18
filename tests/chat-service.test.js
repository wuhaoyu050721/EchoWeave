import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'
import { ChatService } from '../src/services/chat-service.js'

async function setup(streamChat, providerOverrides = {}, conversationOverrides = {}) {
  const repository = new IndexedDbRepository({ indexedDB: new IDBFactory(), databaseName: `chat-${crypto.randomUUID()}` })
  await repository.init()
  await repository.saveConversation({
    id: 'conversation-1',
    title: '新对话',
    providerProfileId: 'provider-1',
    providerNameSnapshot: 'OpenAI',
    modelName: 'test-model',
    lastMessageAt: '2026-07-13T00:00:00.000Z',
    ...conversationOverrides
  })
  let id = 0
  const service = new ChatService({
    repository,
    providerService: { getRequestProfile: async () => ({ id: 'provider-1', baseUrl: 'https://example.com/v1', apiKey: 'secret', defaultModel: 'test-model' }) },
    provider: { streamChat, ...providerOverrides },
    getSystemPrompt: async () => '回答简洁',
    idFactory: () => `message-${++id}`,
    now: () => '2026-07-13T01:00:00.000Z'
  })
  return { repository, service }
}

test('creates a message pair, streams content, completes, and titles the conversation', async () => {
  const states = []
  const { repository, service } = await setup(async (profile, request, handlers) => {
    assert.equal(request.messages[0].role, 'system')
    handlers.onDelta('Hello')
    handlers.onDelta(' world')
    return { finishReason: 'stop' }
  })

  const result = await service.send({
    conversationId: 'conversation-1',
    content: '请解释量子计算的实际用途',
    onState: (state) => states.push(state.generating)
  })
  const messages = await repository.listMessages('conversation-1')
  const conversation = await repository.getConversation('conversation-1')

  assert.equal(result.status, 'completed')
  assert.equal(result.content, 'Hello world')
  assert.deepEqual(messages.map((item) => item.role), ['user', 'assistant'])
  assert.equal(conversation.title, '请解释量子计算的实际用途')
  assert.deepEqual(states, [true, false])
})

test('notifies only after a completed assistant reply is persisted', async () => {
  const notifications = []
  const { repository, service } = await setup(async (profile, request, handlers) => {
    handlers.onDelta('后台回复')
    return { finishReason: 'stop' }
  }, {}, { characterNameSnapshot: '苏墨' })
  service.replyNotificationService = {
    async notifyReply(payload) {
      const persisted = await repository.getMessage(payload.message.id)
      notifications.push({ payload, persisted })
    }
  }

  const result = await service.send({ conversationId: 'conversation-1', content: '测试通知' })

  assert.equal(result.status, 'completed')
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].payload.conversation.characterNameSnapshot, '苏墨')
  assert.equal(notifications[0].payload.message.content, '后台回复')
  assert.equal(notifications[0].persisted.status, 'completed')
})

test('notification failures do not turn a successful reply into a failed message', async () => {
  const { service } = await setup(async (profile, request, handlers) => {
    handlers.onDelta('正常回复')
    return { finishReason: 'stop' }
  })
  service.replyNotificationService = { notifyReply: async () => { throw new Error('notification unavailable') } }

  const result = await service.send({ conversationId: 'conversation-1', content: '继续' })

  assert.equal(result.status, 'completed')
  assert.equal(result.content, '正常回复')
})

test('creates a fresh character conversation with a rendered greeting', async () => {
  const repository = new IndexedDbRepository({ indexedDB: new IDBFactory(), databaseName: `character-chat-${crypto.randomUUID()}` })
  await repository.init()
  await repository.importCharacterBundle({
    character: {
      id: 'char-1', name: '苏墨', avatarAssetId: 'asset-1', sourceHash: 'hash',
      card: { data: { first_mes: '{{char}} 向 {{user}} 问好', alternate_greetings: ['备用'] } }
    },
    characterAssets: [{ id: 'asset-1', characterId: 'char-1', type: 'icon', dataUrl: 'data:image/png;base64,AA==' }]
  })
  let nextId = 0
  const service = new ChatService({
    repository,
    idFactory: () => `id-${++nextId}`,
    now: () => '2026-07-16T00:00:00.000Z',
    getUserName: async () => '小明'
  })

  const conversation = await service.createCharacterConversation({
    characterId: 'char-1', providerProfileId: 'provider-1', providerNameSnapshot: 'OpenAI', modelName: 'model'
  })
  const greeting = (await repository.listMessages(conversation.id))[0]

  assert.equal(conversation.characterId, 'char-1')
  assert.equal(conversation.title, '苏墨')
  assert.equal(greeting.content, '苏墨 向 小明 问好')
  assert.equal(greeting.isGreeting, true)
  await assert.rejects(service.retry(greeting.id), /问候语不能重试/)
})

test('stops an active generation and persists partial content as cancelled', async () => {
  let markFirstDeltaReceived
  const firstDeltaReceived = new Promise((resolve) => { markFirstDeltaReceived = resolve })
  const { repository, service } = await setup((profile, request, handlers) => new Promise((resolve, reject) => {
    handlers.onDelta('partial')
    markFirstDeltaReceived()
    request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }))

  const sending = service.send({ conversationId: 'conversation-1', content: 'Stop me' })
  await firstDeltaReceived
  assert.equal(service.stop(), true)
  const result = await sending

  assert.equal(result.status, 'cancelled')
  assert.equal(result.content, 'partial')
  assert.equal((await repository.listMessages('conversation-1'))[1].status, 'cancelled')
})

test('marks empty network failures as failed and rejects a concurrent send', async () => {
  let release
  const { service } = await setup(() => new Promise((resolve, reject) => { release = reject }))
  const first = service.send({ conversationId: 'conversation-1', content: 'First' })
  while (typeof release !== 'function') {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  await assert.rejects(service.send({ conversationId: 'conversation-1', content: 'Second' }), /生成/)
  release(new Error('offline'))
  const result = await first
  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'request_failed')
  assert.equal(result.errorMessage, 'offline')
})

test('uses an explicit providerProfileId when the conversation record is missing one', async () => {
  const requests = []
  const { service } = await setup(async (profile, request) => {
    requests.push({ profile, request })
    return { finishReason: 'stop' }
  }, {}, { providerProfileId: null })

  const result = await service.send({
    conversationId: 'conversation-1',
    providerProfileId: 'provider-1',
    content: 'Hello'
  })

  assert.equal(result.status, 'completed')
  assert.equal(requests[0].profile.id, 'provider-1')
})

test('retries an assistant response without duplicating the user message', async () => {
  let call = 0
  const { repository, service } = await setup(async (profile, request, handlers) => {
    call += 1
    if (call === 1) throw new Error('first failed')
    handlers.onDelta('retry success')
    return { finishReason: 'stop' }
  })
  const failed = await service.send({ conversationId: 'conversation-1', content: 'Try once' })
  const retried = await service.retry(failed.id)
  const messages = await repository.listMessages('conversation-1')

  assert.equal(messages.filter((item) => item.role === 'user').length, 1)
  assert.equal(retried.status, 'completed')
  assert.equal(retried.retryOfMessageId, failed.id)
})

test('persists and sends an attachment-only user message', async () => {
  let requestMessages
  const { repository, service } = await setup(async (profile, request) => {
    requestMessages = request.messages
    return { finishReason: 'stop' }
  })

  await service.send({
    conversationId: 'conversation-1',
    content: '',
    attachments: [{
      kind: 'image', name: 'photo.jpg', mimeType: 'image/jpeg', byteSize: 1,
      dataUrl: 'data:image/jpeg;base64,AA==', textContent: null, width: 1, height: 1
    }]
  })

  const messages = await repository.listMessages('conversation-1')
  const saved = await repository.listMessageAttachments(messages[0].id)
  const conversation = await repository.getConversation('conversation-1')
  assert.equal(messages[0].content, '')
  assert.equal(messages[0].attachmentIds.length, 1)
  assert.equal(saved[0].messageId, messages[0].id)
  assert.equal(requestMessages.at(-1).attachments[0].id, saved[0].id)
  assert.equal(conversation.title, 'photo.jpg')
})

test('reuses persisted attachments when retrying without duplicating records', async () => {
  const requests = []
  let call = 0
  const { repository, service } = await setup(async (profile, request) => {
    requests.push(request.messages)
    call += 1
    if (call === 1) throw new Error('first failed')
    return { finishReason: 'stop' }
  })

  const failed = await service.send({
    conversationId: 'conversation-1',
    content: 'Inspect',
    attachments: [{ kind: 'text', name: 'notes.txt', mimeType: 'text/plain', byteSize: 5, textContent: 'hello' }]
  })
  await service.retry(failed.id)

  const attachments = await repository.listAllAttachments()
  assert.equal(attachments.length, 1)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].at(-1).attachments[0].id, attachments[0].id)
  assert.equal(requests[1].find(message => message.role === 'user').attachments[0].id, attachments[0].id)
})

test('preserves the global receiver required by browser timer functions', async () => {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const timerHandle = {}
  globalThis.setInterval = function () {
    assert.equal(this, globalThis)
    return timerHandle
  }
  globalThis.clearInterval = function (handle) {
    assert.equal(this, globalThis)
    assert.equal(handle, timerHandle)
  }

  try {
    const { service } = await setup(async (profile, request, handlers) => {
      handlers.onDelta('receiver safe')
      return { finishReason: 'stop' }
    })
    const result = await service.send({ conversationId: 'conversation-1', content: 'Timer receiver' })
    assert.equal(result.status, 'completed')
  } finally {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
  }
})

test('persists generated images on assistant messages', async () => {
  let imageRequest
  const seen = []
  const { repository, service } = await setup(
    async () => assert.fail('chat streaming should not run in image mode'),
    {
      async generateImage(profile, request) {
        imageRequest = request
        return { images: [{ b64_json: 'AA==', revised_prompt: 'revised prompt' }] }
      }
    }
  )

  const result = await service.send({
    conversationId: 'conversation-1',
    content: '生成一张蓝色海报',
    mode: 'image',
    onMessage: message => seen.push(message)
  })
  const messages = await repository.listMessages('conversation-1')
  const assistant = messages.find(message => message.role === 'assistant')
  const attachments = await repository.listMessageAttachments(assistant.id)

  assert.equal(imageRequest.model, 'test-model')
  assert.equal(imageRequest.prompt, '生成一张蓝色海报')
  assert.equal(result.status, 'completed')
  assert.equal(assistant.generationMode, 'image')
  assert.deepEqual(assistant.attachmentIds, [attachments[0].id])
  assert.equal(attachments[0].dataUrl, 'data:image/png;base64,AA==')
  assert.equal(attachments[0].messageId, assistant.id)
  assert.equal(seen.some(message => message.role === 'assistant' && message.attachments?.length === 1), true)
})

test('persists image callbacks before the provider request settles', { timeout: 2000 }, async () => {
  let finishProvider
  const providerGate = new Promise(resolve => { finishProvider = resolve })
  let showImage
  const imageVisible = new Promise(resolve => { showImage = resolve })
  const { repository, service } = await setup(
    async () => assert.fail('chat streaming should not run in image mode'),
    {
      async generateImage(profile, request, handlers) {
        handlers.onImage({ b64_json: 'AA==' })
        await providerGate
        return { images: [] }
      }
    }
  )

  const pending = service.send({
    conversationId: 'conversation-1',
    content: '生成回调图片',
    mode: 'image',
    onMessage: message => {
      if (message.role === 'assistant' && message.attachments?.length) showImage(message)
    }
  })

  const callbackMessage = await imageVisible
  assert.equal(callbackMessage.status, 'generating')
  assert.equal((await repository.listMessageAttachments(callbackMessage.id)).length, 1)

  finishProvider()
  assert.equal((await pending).status, 'completed')
})

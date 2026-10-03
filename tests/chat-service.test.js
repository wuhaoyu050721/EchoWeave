import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createDiagnosticLogStore } from '../src/core/diagnostic-log.js'
import { buildChatContext } from '../src/core/chat-context.js'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'
import { ChatService } from '../src/services/chat-service.js'

async function setup(streamChat, providerOverrides = {}, conversationOverrides = {}, serviceOverrides = {}) {
  const repository = new IndexedDbRepository({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange, databaseName: `chat-${crypto.randomUUID()}` })
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
    now: () => '2026-07-13T01:00:00.000Z',
    ...serviceOverrides
  })
  return { repository, service }
}

test('creates a message pair, streams content, completes, and titles the conversation', async () => {
  const states = []
  const { repository, service } = await setup(async (profile, request, handlers) => {
    assert.equal(request.messages[0].role, 'system')
    assert.equal(request.stream, true)
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

test('persists a complete response when streaming is disabled', async () => {
  let requestedStream
  const { repository, service } = await setup(async (profile, request, handlers) => {
    requestedStream = request.stream
    handlers.onDelta('complete response')
    return { finishReason: 'stop' }
  }, {}, {}, {
    getStreamingEnabled: async () => false,
    getStreamingSegmentedDisplayEnabled: async () => true
  })

  const result = await service.send({ conversationId: 'conversation-1', content: 'Wait for it' })
  const assistant = (await repository.listMessages('conversation-1')).find(message => message.role === 'assistant')

  assert.equal(requestedStream, false)
  assert.equal(result.status, 'completed')
  assert.equal(result.content, 'complete response')
  assert.equal(assistant.content, 'complete response')
  assert.equal(assistant.finishReason, 'stop')
  assert.equal(assistant.responseDisplayMode, 'continuous')
})

test('marks streamed replies for queued segmented presentation when enabled', async () => {
  const updates = []
  const { repository, service } = await setup(async (profile, request, handlers) => {
    assert.equal(request.stream, true)
    handlers.onDelta('第一段。\n\n')
    handlers.onDelta('第二段。')
    return { finishReason: 'stop' }
  }, {}, {}, {
    getStreamingEnabled: async () => true,
    getStreamingSegmentedDisplayEnabled: async () => true
  })

  const result = await service.send({
    conversationId: 'conversation-1',
    content: '分段回答',
    onMessage: message => updates.push(message)
  })
  const assistant = (await repository.listMessages('conversation-1'))
    .find(message => message.role === 'assistant')

  assert.equal(result.responseDisplayMode, 'segmented')
  assert.equal(assistant.responseDisplayMode, 'segmented')
  assert.equal(assistant.content, '第一段。\n\n第二段。')
  assert.ok(updates.some(message => message.role === 'assistant' &&
    message.status === 'generating' &&
    message.responseDisplayMode === 'segmented'))
})

test('large conversations use bounded context pages and only load referenced attachments', async () => {
  let requestedMessages = []
  const { repository, service } = await setup(async (profile, request, handlers) => {
    requestedMessages = request.messages
    handlers.onDelta('bounded response')
    return { finishReason: 'stop' }
  })
  const history = Array.from({ length: 120 }, (_, index) => ({
    id: `history-${index + 1}`,
    conversationId: 'conversation-1',
    sequence: index + 1,
    role: index % 2 ? 'assistant' : 'user',
    content: `history ${index + 1}`,
    attachmentIds: index === 118 ? ['recent-attachment'] : [],
    status: 'completed',
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    deletedAt: null
  }))
  await repository.saveMessages(history)
  await repository.saveAttachments([{
    id: 'recent-attachment',
    conversationId: 'conversation-1',
    messageId: 'history-119',
    kind: 'text',
    name: 'recent.txt',
    textContent: 'recent attachment',
    byteSize: 17,
    createdAt: '2026-07-13T00:00:00.000Z',
    deletedAt: null
  }])
  repository.listMessages = async () => { throw new Error('unbounded message read') }
  repository.listConversationAttachments = async () => { throw new Error('unbounded attachment read') }

  const result = await service.send({ conversationId: 'conversation-1', content: 'new turn' })

  assert.equal(result.sequence, 122)
  assert.ok(requestedMessages.length <= 41)
  assert.equal(requestedMessages.some(message => message.attachments?.some(attachment => attachment.id === 'recent-attachment')), true)
  assert.equal((await repository.getMessage(result.id)).content, 'bounded response')
})

test('logs whether the character status protocol was sent and what the model returned', async () => {
  const logStore = createDiagnosticLogStore({ now: () => 1000, maxDetailLength: 1600 })
  const { service } = await setup(async (profile, request, handlers) => {
    handlers.onDelta('正文回复，但没有状态块。')
    return { finishReason: 'stop' }
  }, {}, { characterId: 'char-1' }, {
    diagnosticLogStore: logStore,
    getSystemPrompt: async () => ({
      systemPrompt: '[统一状态栏输出协议：每轮强制]\n<sumo_monitor>固定格式</sumo_monitor>',
      postHistoryPrompt: '[状态栏最终提醒]\n必须返回状态',
      userTurnPrompt: '[应用内部状态输出要求]\n<sumo_monitor>固定格式</sumo_monitor>'
    })
  })

  await service.send({ conversationId: 'conversation-1', content: '继续' })

  const requestLog = logStore.entries().find(entry => entry.type === 'chat_status_request')
  const responseLog = logStore.entries().find(entry => entry.type === 'chat_status_response')
  assert.equal(requestLog.statusProtocolInFirstSystem, true)
  assert.equal(requestLog.finalReminderInLastSystem, true)
  assert.equal(requestLog.statusProtocolInLatestUser, true)
  assert.equal(requestLog.messageRoles, 'system,user,system')
  assert.equal(responseLog.finishReason, 'stop')
  assert.equal(responseLog.canonicalOpenCount, 0)
  assert.equal(responseLog.statusParsed, false)
  assert.equal(responseLog.responseLength, '正文回复，但没有状态块。'.length)
  assert.equal(requestLog.latestUserLength > 0, true)
  assert.doesNotMatch(JSON.stringify(logStore.exportData()), /secret|正文回复|固定格式|必须返回状态|本轮问题/)
  assert.equal('responseTail' in responseLog, false)
  assert.equal('firstSystemTail' in requestLog, false)
  assert.equal('latestUserTail' in requestLog, false)
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

test('creates a fresh story conversation with isolated story config and greeting', async () => {
  const repository = new IndexedDbRepository({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange, databaseName: `story-chat-${crypto.randomUUID()}` })
  await repository.init()
  await repository.importCharacterBundle({
    character: {
      id: 'char-story',
      name: 'Lyra',
      avatarAssetId: 'asset-story',
      sourceHash: 'story-hash',
      card: { data: { first_mes: '{{char}} meets {{user}}.', alternate_greetings: ['Alternate opening.'] } }
    },
    characterAssets: [{ id: 'asset-story', characterId: 'char-story', type: 'icon', dataUrl: 'data:image/png;base64,AA==' }]
  })
  let nextId = 0
  const service = new ChatService({
    repository,
    idFactory: () => `story-id-${++nextId}`,
    now: () => '2026-07-20T00:00:00.000Z',
    getUserName: async () => 'Reader'
  })

  const conversation = await service.createStoryConversation({
    characterId: 'char-story',
    providerProfileId: 'provider-1',
    providerNameSnapshot: 'OpenAI',
    modelName: 'story-model',
    title: 'Midnight Road'
  })
  const greeting = (await repository.listMessages(conversation.id))[0]

  assert.equal(conversation.conversationKind, 'story')
  assert.equal(conversation.title, 'Midnight Road')
  assert.equal(conversation.characterId, 'char-story')
  assert.deepEqual(conversation.storyConfig.characterIds, ['char-story'])
  assert.equal(conversation.storyConfig.memoryMode, 'auto')
  assert.equal(conversation.storyConfig.allowCharacterPatches, true)
  assert.deepEqual(conversation.storyConfig.worldBookIds, [])
  assert.equal(conversation.storyConfig.memoryWorldBookId, null)
  assert.equal(greeting.role, 'assistant')
  assert.equal(greeting.generationMode, 'story')
  assert.equal(greeting.content, 'Lyra meets Reader.')
  assert.equal(greeting.isGreeting, true)
})

test('applies returned story memory to a story world book and character patch list', async () => {
  const returnedMemory = {
    sceneSummary: 'The gate opened and Lyra kept the silver key.',
    characterPatches: [{
      characterId: 'char-story',
      field: 'relationship_memory',
      content: 'Lyra now trusts the silver key.',
      confidence: 0.9
    }],
    worldBookEntries: [{
      name: 'Silver Gate',
      keys: ['gate', 'silver key'],
      content: 'The silver gate opens only after midnight.',
      constant: true,
      confidence: 0.8
    }]
  }
  const { repository, service } = await setup(async (profile, request, handlers) => {
    handlers.onDelta(`Story body.\n<echo_story_memory>${JSON.stringify(returnedMemory)}</echo_story_memory>`)
    return { finishReason: 'stop' }
  }, {}, {
    title: 'Midnight Road',
    conversationKind: 'story',
    characterId: 'char-story',
    storyConfig: {
      characterIds: ['char-story'],
      memoryMode: 'auto',
      allowCharacterPatches: true,
      worldBookIds: [],
      memoryWorldBookId: null
    }
  }, {
    getSystemPrompt: async () => ({
      systemPrompt: 'story system',
      postHistoryPrompt: '<echo_story_memory>protocol</echo_story_memory>',
      userTurnPrompt: 'return <echo_story_memory>'
    })
  })
  await repository.saveCharacter({
    id: 'char-story',
    name: 'Lyra',
    card: { data: { name: 'Lyra', extensions: {} } },
    storyMemoryPatches: [],
    deletedAt: null
  })

  const result = await service.send({ conversationId: 'conversation-1', content: 'Continue.' })
  const assistant = await repository.getMessage(result.id)
  const updatedConversation = await repository.getConversation('conversation-1')
  const savedCharacter = await repository.getCharacter('char-story')
  const worldBooks = await repository.listAllWorldBooks()
  const worldBook = worldBooks[0]
  const entryContents = worldBook.data.entries.map(entry => entry.content)

  assert.equal(result.status, 'completed')
  assert.equal(result.generationMode, 'story')
  assert.equal(assistant.storyMemoryApplied.worldBookId, worldBook.id)
  assert.equal(assistant.storyMemoryApplied.characterPatchCount, 1)
  assert.equal(worldBook.scope, 'story')
  assert.equal(worldBook.conversationId, 'conversation-1')
  assert.deepEqual(worldBook.characterIds, ['char-story'])
  assert.equal(updatedConversation.storyConfig.memoryWorldBookId, worldBook.id)
  assert.deepEqual(updatedConversation.storyConfig.worldBookIds, [worldBook.id])
  assert.equal(entryContents.some(content => content.includes(returnedMemory.sceneSummary)), true)
  assert.equal(entryContents.some(content => content.includes('Lyra now trusts the silver key.')), true)
  assert.equal(entryContents.some(content => content.includes('The silver gate opens only after midnight.')), true)
  assert.equal(savedCharacter.storyMemoryPatches.length, 1)
  assert.equal(savedCharacter.storyMemoryPatches[0].content, 'Lyra now trusts the silver key.')
  assert.deepEqual(savedCharacter.card.data.extensions.echoWeaveStoryPatches, savedCharacter.storyMemoryPatches)

  await service.send({ conversationId: 'conversation-1', content: 'Continue again.' })
  const characterAfterDuplicate = await repository.getCharacter('char-story')
  assert.equal(characterAfterDuplicate.storyMemoryPatches.length, 1)
})

test('deleting a story conversation also retires only its owned memory books', async () => {
  const { repository, service } = await setup(async () => ({ finishReason: 'stop' }), {}, {
    conversationKind: 'story',
    characterId: 'char-story',
    storyConfig: {
      characterIds: ['char-story'],
      worldBookIds: ['book-imported', 'book-memory'],
      memoryWorldBookId: 'book-memory'
    }
  })
  await repository.saveWorldBook({
    id: 'book-imported',
    scope: 'story',
    characterId: 'char-story',
    conversationId: null,
    data: { entries: [] },
    deletedAt: null
  })
  await repository.saveWorldBook({
    id: 'book-memory',
    scope: 'story',
    characterIds: ['char-story'],
    conversationId: 'conversation-1',
    data: { entries: [] },
    deletedAt: null
  })

  await service.deleteConversation('conversation-1')

  assert.equal(await repository.getConversation('conversation-1'), undefined)
  assert.equal((await repository.getWorldBook('book-memory')).deletedAt, '2026-07-13T01:00:00.000Z')
  assert.equal((await repository.getWorldBook('book-imported')).deletedAt, null)
  assert.deepEqual((await repository.listAllWorldBooks()).map(book => book.id), ['book-imported'])
})

test('creates and updates a bounded group conversation without inserting single-chat greetings', async () => {
  const repository = new IndexedDbRepository({ indexedDB: new IDBFactory(), databaseName: `group-chat-${crypto.randomUUID()}` })
  await repository.init()
  for (const [id, name] of [['char-a', '苏墨'], ['char-b', '林夏'], ['char-c', '小障']]) {
    await repository.saveCharacter({
      id,
      name,
      avatarAssetId: `avatar-${id}`,
      card: { data: { first_mes: `${name}的单聊开场白` } }
    })
  }
  let nextId = 0
  const service = new ChatService({
    repository,
    idFactory: () => `group-${++nextId}`,
    now: () => '2026-07-23T00:00:00.000Z'
  })

  const conversation = await service.createGroupConversation({
    participantCharacterIds: ['char-a', 'char-b', 'char-c'],
    providerProfileId: 'provider-1',
    providerNameSnapshot: 'OpenAI',
    modelName: 'model',
    replyPolicy: { mode: 'round-robin', respondersPerTurn: 2 }
  })
  assert.equal(conversation.conversationKind, 'group')
  assert.equal(conversation.title, '苏墨、林夏、小障')
  assert.deepEqual(conversation.participants.map(item => item.characterId), ['char-a', 'char-b', 'char-c'])
  assert.equal((await repository.listMessages(conversation.id)).length, 0)

  const updated = await service.updateGroupConversation(conversation.id, {
    title: '避难所',
    participants: [
      { characterId: 'char-c', enabled: true },
      { characterId: 'char-a', enabled: false }
    ],
    replyPolicy: { mode: 'all' }
  })
  assert.equal(updated.title, '避难所')
  assert.deepEqual(updated.participants.map(item => [item.characterId, item.enabled]), [
    ['char-c', true],
    ['char-a', false]
  ])
  assert.deepEqual(updated.replyPolicy, { mode: 'all', respondersPerTurn: 1, autoHandoff: true })
  await assert.rejects(
    service.createGroupConversation({ participantCharacterIds: ['char-a'] }),
    /至少需要选择两个成员/
  )
})

test('creates an AI interface member and sends its turn through its own default model without character state', async () => {
  const requests = []
  const promptSpeakers = []
  const providerService = {
    listProviders: async () => [{
      id: 'provider-2',
      name: '独立接口',
      defaultModel: 'provider-two-default',
      avatarPreset: 'deepseek'
    }],
    getRequestProfile: async id => ({
      id,
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
      defaultModel: id === 'provider-2' ? 'provider-two-default' : 'common-default'
    })
  }
  const { repository, service } = await setup(async (profile, request, handlers) => {
    requests.push({ profileId: profile.id, model: request.model })
    handlers.onDelta('接口成员回复')
    return { finishReason: 'stop' }
  }, {}, {
    conversationKind: 'group',
    title: '混合群聊',
    modelName: 'common-conversation-model',
    participants: [
      { memberKind: 'provider', providerProfileId: 'provider-2', modelName: 'provider-two-default', nameSnapshot: '独立接口', enabled: true },
      { memberKind: 'character', characterId: 'char-a', nameSnapshot: '苏墨', enabled: true }
    ],
    replyPolicy: { mode: 'mention' }
  }, {
    providerService,
    getSystemPrompt: async (conversation, options) => {
      promptSpeakers.push(options)
      return options.speakerProviderProfileId
        ? '接口成员不使用角色卡、世界书或 <sumo_monitor>'
        : ''
    }
  })

  const result = await service.send({
    conversationId: 'conversation-1',
    content: '@独立接口 请回答'
  })
  const assistant = (await repository.listMessages('conversation-1')).find(message => message.role === 'assistant')

  assert.deepEqual(requests, [{ profileId: 'provider-2', model: 'provider-two-default' }])
  assert.equal(result.speakerProviderProfileId, 'provider-2')
  assert.equal(result.speakerCharacterId, null)
  assert.equal(assistant.speakerProviderProfileId, 'provider-2')
  assert.equal(promptSpeakers[0].speakerProviderProfileId, 'provider-2')
  assert.equal(promptSpeakers[0].speakerCharacterId, null)
})

function groupConversationOverrides(replyPolicy = { mode: 'round-robin', respondersPerTurn: 2 }) {
  return {
    title: '避难所',
    conversationKind: 'group',
    participants: [
      { characterId: 'char-a', nameSnapshot: '苏墨', avatarAssetId: 'avatar-a', enabled: true },
      { characterId: 'char-b', nameSnapshot: '林夏', avatarAssetId: 'avatar-b', enabled: true },
      { characterId: 'char-c', nameSnapshot: '小障', avatarAssetId: 'avatar-c', enabled: true }
    ],
    replyPolicy
  }
}

test('generates group replies serially and hides another character status from shared history', async () => {
  const requests = []
  const instructionCalls = []
  let call = 0
  const { repository, service } = await setup(async (profile, request, handlers) => {
    call += 1
    requests.push(request.messages)
    handlers.onDelta(call === 1
      ? '第一段正文<sumo_monitor><status>[好感度|61]</status></sumo_monitor>'
      : '第二段正文<sumo_monitor><status>[好感度|22]</status></sumo_monitor>')
    return { finishReason: 'stop' }
  }, {}, groupConversationOverrides(), {
    getUserName: async () => '小明',
    getSystemPrompt: async (conversation, options) => {
      instructionCalls.push(options)
      return `只扮演 ${options.speakerCharacterId}`
    }
  })

  const result = await service.send({ conversationId: 'conversation-1', content: '继续' })
  const messages = await repository.listMessages('conversation-1')

  assert.deepEqual(result.batchMessages.map(message => message.speakerCharacterId), ['char-a', 'char-b'])
  assert.deepEqual(messages.map(message => message.speakerCharacterId || null), [null, 'char-a', 'char-b'])
  assert.deepEqual(instructionCalls.map(call => call.speakerCharacterId), ['char-a', 'char-b'])
  assert.equal(instructionCalls[1].messages.at(-1).content.includes('<sumo_monitor>'), true)
  assert.equal(requests[1].some(message => message.content.includes('苏墨：第一段正文')), true)
  assert.equal(requests[1].some(message => message.content.includes('好感度|61')), false)
  assert.equal(requests[1].some(message => message.content.includes('小明：继续')), true)
})

test('group mentions override rotation and all mode runs every enabled character', async () => {
  const mentionedSpeakers = []
  const mentioned = await setup(async (profile, request, handlers) => {
    handlers.onDelta('收到')
    return { finishReason: 'stop' }
  }, {}, groupConversationOverrides(), {
    getSystemPrompt: async (conversation, options) => {
      mentionedSpeakers.push(options.speakerCharacterId)
      return ''
    }
  })

  const mentionResult = await mentioned.service.send({
    conversationId: 'conversation-1',
    content: '@林夏 你怎么看'
  })
  assert.deepEqual(mentionedSpeakers, ['char-b'])
  assert.deepEqual(mentionResult.batchMessages.map(message => message.speakerCharacterId), ['char-b'])

  const allSpeakers = []
  const all = await setup(async (profile, request, handlers) => {
    handlers.onDelta('收到')
    return { finishReason: 'stop' }
  }, {}, groupConversationOverrides({ mode: 'all' }), {
    getSystemPrompt: async (conversation, options) => {
      allSpeakers.push(options.speakerCharacterId)
      return ''
    }
  })
  const allResult = await all.service.send({ conversationId: 'conversation-1', content: '大家继续' })

  assert.deepEqual(allSpeakers, ['char-a', 'char-b', 'char-c'])
  assert.deepEqual(allResult.batchMessages.map(message => message.speakerCharacterId), ['char-a', 'char-b', 'char-c'])
})

test('group members can hand off to each other with exact mentions', async () => {
  const requests = []
  const replies = [
    '我先说。@林夏',
    '我接着回答。＠苏墨',
    '这轮先聊到这里。'
  ]
  let call = 0
  const { repository, service } = await setup(async (profile, request, handlers) => {
    requests.push(request.messages)
    handlers.onDelta(replies[call])
    call += 1
    return { finishReason: 'stop' }
  }, {}, groupConversationOverrides({
    mode: 'mention',
    respondersPerTurn: 1,
    autoHandoff: true
  }), {
    getSystemPrompt: async () => ''
  })

  const result = await service.send({
    conversationId: 'conversation-1',
    content: '@苏墨 你先开始'
  })
  const assistants = (await repository.listMessages('conversation-1'))
    .filter(message => message.role === 'assistant')

  assert.deepEqual(
    result.batchMessages.map(message => message.speakerCharacterId),
    ['char-a', 'char-b', 'char-a']
  )
  assert.equal(result.autoHandoffCount, 2)
  assert.equal(result.autoHandoffLimitReached, false)
  assert.deepEqual(assistants.map(message => message.sequence), [2, 3, 4])
  assert.equal(requests[1].some(message => message.content.includes('苏墨：我先说。@林夏')), true)
  assert.equal(requests[2].some(message => message.content.includes('林夏：我接着回答。＠苏墨')), true)
})

test('interface members keep their own providers and models during automatic handoff', async () => {
  const requests = []
  let call = 0
  const providerService = {
    listProviders: async () => [],
    getRequestProfile: async id => ({
      id,
      baseUrl: `https://${id}.example.com/v1`,
      apiKey: `${id}-secret`,
      defaultModel: `${id}-default`
    })
  }
  const { service } = await setup(async (profile, request, handlers) => {
    requests.push({ profileId: profile.id, model: request.model })
    handlers.onDelta(call === 0 ? '交给你了。@接口乙' : '我来回答。')
    call += 1
    return { finishReason: 'stop' }
  }, {}, {
    conversationKind: 'group',
    participants: [
      {
        memberKind: 'provider',
        providerProfileId: 'provider-a',
        modelName: 'model-a',
        nameSnapshot: '接口甲',
        enabled: true
      },
      {
        memberKind: 'provider',
        providerProfileId: 'provider-b',
        modelName: 'model-b',
        nameSnapshot: '接口乙',
        enabled: true
      }
    ],
    replyPolicy: { mode: 'mention', respondersPerTurn: 1, autoHandoff: true }
  }, {
    providerService,
    getSystemPrompt: async () => ''
  })

  const result = await service.send({
    conversationId: 'conversation-1',
    content: '@接口甲 开始'
  })

  assert.deepEqual(requests, [
    { profileId: 'provider-a', model: 'model-a' },
    { profileId: 'provider-b', model: 'model-b' }
  ])
  assert.deepEqual(
    result.batchMessages.map(message => message.speakerProviderProfileId),
    ['provider-a', 'provider-b']
  )
})

test('automatic group handoff ignores status metadata and can be disabled', async () => {
  const statusOnly = await setup(async (profile, request, handlers) => {
    handlers.onDelta('正文没有点名<sumo_monitor><status>[小障锐评|@林夏 接话]')
    return { finishReason: 'stop' }
  }, {}, groupConversationOverrides({
    mode: 'mention',
    respondersPerTurn: 1,
    autoHandoff: true
  }))
  const statusResult = await statusOnly.service.send({
    conversationId: 'conversation-1',
    content: '@苏墨 回答'
  })
  assert.deepEqual(statusResult.batchMessages.map(message => message.speakerCharacterId), ['char-a'])
  assert.equal(statusResult.autoHandoffCount, 0)

  const disabled = await setup(async (profile, request, handlers) => {
    handlers.onDelta('我点名了 @林夏')
    return { finishReason: 'stop' }
  }, {}, groupConversationOverrides({
    mode: 'mention',
    respondersPerTurn: 1,
    autoHandoff: false
  }))
  const disabledResult = await disabled.service.send({
    conversationId: 'conversation-1',
    content: '@苏墨 回答'
  })
  assert.deepEqual(disabledResult.batchMessages.map(message => message.speakerCharacterId), ['char-a'])
  assert.equal(disabledResult.autoHandoffCount, 0)
})

test('automatic group handoff stops after eight assistant replies', async () => {
  let call = 0
  const { repository, service } = await setup(async (profile, request, handlers) => {
    const speakerIsA = call % 2 === 0
    handlers.onDelta(speakerIsA ? '@林夏 继续' : '@苏墨 继续')
    call += 1
    return { finishReason: 'stop' }
  }, {}, groupConversationOverrides({
    mode: 'mention',
    respondersPerTurn: 1,
    autoHandoff: true
  }))

  const result = await service.send({
    conversationId: 'conversation-1',
    content: '@苏墨 开始'
  })
  const assistants = (await repository.listMessages('conversation-1'))
    .filter(message => message.role === 'assistant')

  assert.equal(call, 8)
  assert.equal(assistants.length, 8)
  assert.equal(result.batchMessages.length, 8)
  assert.equal(result.autoHandoffCount, 7)
  assert.equal(result.autoHandoffLimitReached, true)
  assert.deepEqual(
    result.batchMessages.map(message => message.speakerCharacterId),
    ['char-a', 'char-b', 'char-a', 'char-b', 'char-a', 'char-b', 'char-a', 'char-b']
  )
})

test('stopping a group reply cancels the current character and skips the remaining queue', async () => {
  let firstDelta
  const deltaReceived = new Promise(resolve => { firstDelta = resolve })
  let providerCalls = 0
  const { repository, service } = await setup((profile, request, handlers) => new Promise((resolve, reject) => {
    providerCalls += 1
    handlers.onDelta('生成了一部分')
    firstDelta()
    request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
  }), {}, groupConversationOverrides())

  const sending = service.send({ conversationId: 'conversation-1', content: '开始' })
  await deltaReceived
  assert.equal(service.stop(), true)
  const result = await sending
  const assistants = (await repository.listMessages('conversation-1')).filter(message => message.role === 'assistant')

  assert.equal(providerCalls, 1)
  assert.equal(result.status, 'cancelled')
  assert.equal(assistants.length, 1)
  assert.equal(assistants[0].speakerCharacterId, 'char-a')
})

test('group retry and continuation preserve the original speaker identity', async () => {
  const speakers = []
  let call = 0
  const { repository, service } = await setup(async (profile, request, handlers) => {
    call += 1
    if (call === 1) throw new Error('first failed')
    handlers.onDelta(call === 2 ? '重试完成' : '继续完成')
    return { finishReason: 'stop' }
  }, {}, groupConversationOverrides({ mode: 'mention' }), {
    getSystemPrompt: async (conversation, options) => {
      speakers.push(options.speakerCharacterId)
      return ''
    }
  })

  const failed = await service.send({ conversationId: 'conversation-1', content: '@林夏 回答' })
  const retried = await service.retry(failed.id)
  const continued = await service.continueResponse(retried.id)
  const assistants = (await repository.listMessages('conversation-1')).filter(message => message.role === 'assistant')

  assert.deepEqual(speakers, ['char-b', 'char-b', 'char-b'])
  assert.equal(retried.speakerCharacterId, 'char-b')
  assert.equal(continued.speakerCharacterId, 'char-b')
  assert.equal(assistants.every(message => message.speakerCharacterId === 'char-b'), true)
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
  const { service } = await setup(async (profile, request, handlers) => {
    requests.push({ profile, request })
    handlers.onDelta('response from explicit provider')
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
  let streamingEnabled = false
  const requestedStreams = []
  const { repository, service } = await setup(async (profile, request, handlers) => {
    call += 1
    requestedStreams.push(request.stream)
    if (call === 1) throw new Error('first failed')
    handlers.onDelta('retry success')
    return { finishReason: 'stop' }
  }, {}, {}, {
    getStreamingEnabled: async () => streamingEnabled
  })
  const failed = await service.send({ conversationId: 'conversation-1', content: 'Try once' })
  streamingEnabled = true
  const retried = await service.retry(failed.id)
  const messages = await repository.listMessages('conversation-1')

  assert.equal(messages.filter((item) => item.role === 'user').length, 1)
  assert.equal(retried.status, 'completed')
  assert.equal(retried.retryOfMessageId, failed.id)
  assert.deepEqual(requestedStreams, [false, true])
})

test('keeps story generation mode when retrying a failed story response', async () => {
  let call = 0
  const { service } = await setup(async (profile, request, handlers) => {
    call += 1
    if (call === 1) throw new Error('first failed')
    handlers.onDelta('Story retry success')
    return { finishReason: 'stop' }
  }, {}, {
    conversationKind: 'story',
    characterId: 'char-story',
    storyConfig: { characterIds: ['char-story'], worldBookIds: [] }
  })

  const failed = await service.send({ conversationId: 'conversation-1', content: 'Try once', mode: 'image' })
  const retried = await service.retry(failed.id)

  assert.equal(failed.generationMode, 'story')
  assert.equal(retried.generationMode, 'story')
})

test('continues the latest assistant response without persisting the internal user instruction', async () => {
  const requests = []
  let call = 0
  const { repository, service } = await setup(async (profile, request, handlers) => {
    requests.push(request.messages)
    call += 1
    handlers.onDelta(call === 1 ? 'First part.' : 'Second part.')
    return { finishReason: 'stop' }
  })

  const first = await service.send({ conversationId: 'conversation-1', content: 'Start the story' })
  const continued = await service.continueResponse(first.id)
  const messages = await repository.listMessages('conversation-1')
  const continuationRequest = requests[1]

  assert.equal(continued.status, 'completed')
  assert.equal(continued.content, 'Second part.')
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant', 'assistant'])
  assert.equal(messages.some(message => String(message.content).includes('[应用内部续写指令]')), false)
  assert.equal(continuationRequest[continuationRequest.length - 1].role, 'user')
  assert.match(continuationRequest[continuationRequest.length - 1].content, /紧接上一条助手回复继续写下去/)
  assert.equal(continuationRequest.some(message => message.role === 'assistant' && message.content === 'First part.'), true)
  await assert.rejects(service.continueResponse(first.id), /最新一条回复/)
})

test('continues a partial interrupted response without persisting the internal user instruction', async () => {
  const requests = []
  let call = 0
  const { repository, service } = await setup(async (profile, request, handlers) => {
    requests.push(request.messages)
    call += 1
    if (call === 1) {
      handlers.onDelta('Partial response.')
      const error = new Error('模型流式连接超过 60 秒没有新内容，已保留当前回复，可直接续写')
      error.code = 'stream_idle_timeout'
      throw error
    }
    handlers.onDelta('Continued response.')
    return { finishReason: 'stop' }
  })

  const interrupted = await service.send({ conversationId: 'conversation-1', content: 'Start the story' })
  const continued = await service.continueResponse(interrupted.id)
  const messages = await repository.listMessages('conversation-1')
  const continuationRequest = requests[1]

  assert.equal(interrupted.status, 'interrupted')
  assert.equal(interrupted.content, 'Partial response.')
  assert.equal(interrupted.errorCode, 'stream_idle_timeout')
  assert.equal(continued.status, 'completed')
  assert.equal(continued.content, 'Continued response.')
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant', 'assistant'])
  assert.equal(messages.some(message => String(message.content).includes('[应用内部续写指令]')), false)
  assert.equal(continuationRequest.some(message => message.role === 'assistant' && message.content === 'Partial response.'), true)
})

test('group continuation from an interrupted response preserves the original interface member', async () => {
  const requestedProfiles = []
  let call = 0
  const providerService = {
    listProviders: async () => [],
    getRequestProfile: async id => ({
      id,
      baseUrl: 'https://example.com/v1',
      apiKey: 'secret',
      defaultModel: id === 'provider-2' ? 'provider-two-default' : 'test-model'
    })
  }
  const { repository, service } = await setup(async (profile, request, handlers) => {
    requestedProfiles.push({ profileId: profile.id, model: request.model })
    call += 1
    handlers.onDelta(call === 1 ? '接口成员的半段回复' : '接口成员续写')
    if (call === 1) {
      const error = new Error('stream idle')
      error.code = 'stream_idle_timeout'
      throw error
    }
    return { finishReason: 'stop' }
  }, {}, {
    conversationKind: 'group',
    participants: [{
      memberKind: 'provider',
      providerProfileId: 'provider-2',
      modelName: 'provider-two-default',
      nameSnapshot: '独立接口',
      enabled: true
    }],
    replyPolicy: { mode: 'mention' }
  }, {
    providerService,
    getSystemPrompt: async () => ''
  })

  const interrupted = await service.send({ conversationId: 'conversation-1', content: '@独立接口 请继续' })
  const continued = await service.continueResponse(interrupted.id)
  const messages = (await repository.listMessages('conversation-1')).filter(message => message.role === 'assistant')

  assert.equal(interrupted.status, 'interrupted')
  assert.equal(continued.status, 'completed')
  assert.equal(continued.speakerProviderProfileId, 'provider-2')
  assert.deepEqual(requestedProfiles, [
    { profileId: 'provider-2', model: 'provider-two-default' },
    { profileId: 'provider-2', model: 'provider-two-default' }
  ])
  assert.equal(messages.every(message => message.speakerProviderProfileId === 'provider-2'), true)
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

test('a rejected streaming snapshot does not poison later snapshots or the final save', async () => {
  const writes = []
  let firstAttempt
  const firstWritten = new Promise(resolve => { firstAttempt = resolve })
  let nextAttempt
  const nextWritten = new Promise(resolve => { nextAttempt = resolve })
  const { repository, service } = await setup(async (profile, request, handlers) => {
    handlers.onDelta('a'.repeat(200))
    await firstWritten
    await new Promise(resolve => setImmediate(resolve))
    handlers.onDelta('b'.repeat(200))
    await nextWritten
    handlers.onDelta(' final')
    return { finishReason: 'stop' }
  })
  const saveMessage = repository.saveMessage.bind(repository)
  repository.saveMessage = async message => {
    writes.push({ ...message })
    if (writes.length === 1) {
      firstAttempt()
      throw new Error('temporary storage failure')
    }
    const result = await saveMessage(message)
    nextAttempt()
    return result
  }

  const result = await service.send({ conversationId: 'conversation-1', content: 'recover' })

  assert.equal(writes.length, 3)
  assert.equal(writes[1].status, 'generating')
  assert.equal(writes[1].content, 'a'.repeat(200) + 'b'.repeat(200))
  assert.equal(writes[2].status, 'completed')
  assert.equal((await repository.getMessage(result.id)).content, result.content)
  assert.equal(result.errorCode, null)
})

test('timer snapshots retry after a failure even without a new delta and cancellation saves the partial reply', async () => {
  let tick
  let attempts = 0
  const { repository, service } = await setup(async (profile, request, handlers) => {
    handlers.onDelta('partial')
    tick()
    await new Promise(resolve => setImmediate(resolve))
    tick()
    await new Promise(resolve => setImmediate(resolve))
    service.stop()
    throw new DOMException('Aborted', 'AbortError')
  }, {}, {}, {
    setIntervalFn: callback => { tick = callback; return 1 },
    clearIntervalFn: () => {}
  })
  const saveMessage = repository.saveMessage.bind(repository)
  repository.saveMessage = async message => {
    attempts += 1
    if (attempts === 1) throw new Error('temporary timer save failure')
    return saveMessage(message)
  }

  const result = await service.send({ conversationId: 'conversation-1', content: 'cancel after recovery' })

  assert.equal(attempts, 3)
  assert.equal(result.status, 'cancelled')
  assert.equal((await repository.getMessage(result.id)).status, 'cancelled')
  assert.equal((await repository.getMessage(result.id)).content, 'partial')
  assert.equal(service.activeRequest, null)
})

test('persistent final save failures retain the visible content, report unsaved state, and skip completion notifications', async () => {
  const updates = []
  const states = []
  let notifications = 0
  let writes = 0
  const { repository, service } = await setup(async (profile, request, handlers) => {
    handlers.onDelta('a'.repeat(200))
    await new Promise(resolve => setImmediate(resolve))
    handlers.onDelta(' complete')
    return { finishReason: 'stop' }
  }, {}, {}, {
    replyNotificationService: { notifyReply: async () => { notifications += 1 } }
  })
  repository.saveMessage = async () => {
    writes += 1
    throw new Error('quota exceeded')
  }

  await assert.rejects(service.send({
    conversationId: 'conversation-1',
    content: 'keep my reply',
    onMessage: message => updates.push(message),
    onState: state => states.push(state.generating)
  }), error => {
    assert.equal(error.code, 'message_save_failed')
    assert.match(error.message, /未能保存/)
    assert.equal(error.messageSnapshot.content, 'a'.repeat(200) + ' complete')
    return true
  })

  assert.equal(writes, 2)
  assert.equal(updates.at(-1).status, 'interrupted')
  assert.equal(updates.at(-1).errorCode, 'message_save_failed')
  assert.equal(updates.at(-1).content, 'a'.repeat(200) + ' complete')
  assert.equal(notifications, 0)
  assert.deepEqual(states, [true, false])
  assert.equal(service.activeRequest, null)
})

test('same-tick sends reserve the request before preparation and cannot insert duplicate pairs', async () => {
  let calls = 0
  const { repository, service } = await setup(async (profile, request, handlers) => {
    calls += 1
    handlers.onDelta('one reply')
    return { finishReason: 'stop' }
  })

  const first = service.send({ conversationId: 'conversation-1', content: 'first' })
  await assert.rejects(service.send({ conversationId: 'conversation-1', content: 'second' }), /仍在生成/)
  await assert.rejects(service.retry('unknown'), /仍在生成/)
  await first

  assert.equal(calls, 1)
  assert.deepEqual((await repository.listMessages('conversation-1')).map(message => message.role), ['user', 'assistant'])
})

test('preparation errors release the request and retries and continuations reserve before reads', async () => {
  const { service } = await setup(async (profile, request, handlers) => {
    handlers.onDelta('reply')
    return { finishReason: 'stop' }
  })
  await assert.rejects(service.send({ conversationId: 'missing', content: 'first' }), /会话不存在/)
  assert.equal(service.activeRequest, null)
  const first = await service.send({ conversationId: 'conversation-1', content: 'valid' })
  const retry = service.retry(first.id)
  await assert.rejects(service.continueResponse(first.id), /仍在生成/)
  const retried = await retry
  const continued = service.continueResponse(retried.id)
  await assert.rejects(service.retry(retried.id), /仍在生成/)
  assert.equal((await continued).status, 'completed')
})

test('stopAndWait during preparation prevents provider calls and message creation', async () => {
  const { repository, service } = await setup(async () => assert.fail('provider must not run'))
  let releaseRead
  const readGate = new Promise(resolve => { releaseRead = resolve })
  let startedRead
  const readStarted = new Promise(resolve => { startedRead = resolve })
  const getConversation = repository.getConversation.bind(repository)
  repository.getConversation = async id => {
    startedRead()
    await readGate
    return getConversation(id)
  }
  const sending = service.send({ conversationId: 'conversation-1', content: 'cancel before persistence' })
  const rejected = assert.rejects(sending, error => error.name === 'AbortError')
  await readStarted
  const stopped = service.stopAndWait()
  releaseRead()

  assert.equal(await stopped, true)
  await rejected
  assert.deepEqual(await repository.listMessages('conversation-1'), [])
  assert.equal(service.activeRequest, null)
})

test('image-heavy context batches only its recent budget and preserves the exact model request', async () => {
  let requestedMessages
  const { repository, service } = await setup(async (profile, request) => {
    requestedMessages = request.messages
    return { finishReason: 'stop' }
  })
  const history = Array.from({ length: 120 }, (_, index) => ({
    id: `history-image-${index}`,
    conversationId: 'conversation-1', sequence: index + 1,
    role: index % 2 ? 'assistant' : 'user', content: `history ${index}`,
    status: 'completed', attachmentIds: index % 2 ? [] : [`image-${index}`]
  }))
  const attachments = history.filter(message => message.attachmentIds.length).map(message => ({
    id: message.attachmentIds[0], conversationId: 'conversation-1', messageId: message.id,
    kind: 'image', dataUrl: 'data:image/png;base64,AA=='
  }))
  await repository.saveMessages(history)
  await repository.saveAttachments(attachments)
  const batches = []
  const getAttachments = repository.getAttachments.bind(repository)
  repository.getAttachments = async ids => {
    batches.push([...ids])
    return getAttachments(ids)
  }
  repository.getAttachment = async () => assert.fail('prefer batch reads')
  repository.listConversationAttachments = async () => assert.fail('avoid unbounded reads')

  await service.send({ conversationId: 'conversation-1', content: 'latest turn' })
  const expected = buildChatContext({
    messages: [...history.slice(-80), { id: 'latest', sequence: 121, role: 'user', content: 'latest turn' }],
    attachments, systemPrompt: '回答简洁'
  })
  const selectedImages = expected.flatMap(message => message.attachments || [])

  assert.deepEqual(requestedMessages, expected)
  assert.equal(selectedImages.length, 14)
  assert.ok(batches.flat().length <= 16, `read ${batches.flat().length} image records`)
  assert.equal(new Set(batches.flat()).size, batches.flat().length)
  assert.ok(batches.length > 1)
})

test('attachment fallback bounds concurrency and respects missing, deleted, ordered and text costs', async () => {
  let requestedMessages
  const { repository, service } = await setup(async (profile, request) => {
    requestedMessages = request.messages
    return { finishReason: 'stop' }
  })
  const records = [
    { id: 'old-image', kind: 'image', dataUrl: 'data:image/png;base64,AA==' },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `text-${index}`, kind: 'text', textContent: String(index).repeat(3000) })),
    { id: 'deleted', kind: 'text', textContent: 'x'.repeat(100000), deletedAt: '2026-01-01' }
  ].map(attachment => ({ ...attachment, conversationId: 'conversation-1' }))
  const history = [
    { id: 'old', sequence: 1, role: 'user', content: 'old image', attachmentIds: ['old-image'] },
    { id: 'hidden', sequence: 2, role: 'assistant', content: 'failed', status: 'failed', attachmentIds: ['never-read'] },
    { id: 'newer', sequence: 3, role: 'user', content: '', attachmentIds: ['missing', 'deleted', ...records.filter(item => item.id.startsWith('text-')).map(item => item.id).reverse()] }
  ].map(message => ({ status: 'completed', ...message, conversationId: 'conversation-1' }))
  await repository.saveMessages(history)
  await repository.saveAttachments(records)
  const getAttachment = repository.getAttachment.bind(repository)
  let active = 0
  let maximum = 0
  const reads = []
  repository.getAttachments = undefined
  repository.getAttachment = async id => {
    reads.push(id)
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise(resolve => setImmediate(resolve))
    const attachment = await getAttachment(id)
    active -= 1
    return attachment
  }
  await service.send({ conversationId: 'conversation-1', content: 'next' })

  assert.deepEqual(requestedMessages, buildChatContext({
    messages: [...history, { id: 'latest', sequence: 4, role: 'user', content: 'next' }],
    attachments: records.filter(record => !record.deletedAt), systemPrompt: '回答简洁'
  }))
  assert.equal(maximum, 4)
  assert.equal(reads.includes('never-read'), false)
  assert.equal(requestedMessages.flatMap(message => message.attachments || []).some(item => item.deletedAt), false)
})

test('an exhausted system-prompt budget reads no history attachments', async () => {
  const { repository, service } = await setup(async (profile, request) => {
    assert.equal(request.messages.length, 1)
    assert.equal(request.messages[0].role, 'system')
    return { finishReason: 'stop' }
  }, {}, {}, { getSystemPrompt: async () => 'S'.repeat(60001) })
  repository.getAttachments = async () => assert.fail('no attachment can enter this context')
  await service.send({ conversationId: 'conversation-1', content: '', attachments: [
    { kind: 'image', dataUrl: 'data:image/png;base64,AA==' }
  ] })
})

test('attachment preselection preserves status-only history and the exact message-count boundary', async () => {
  let requestedMessages
  const { repository, service } = await setup(async (profile, request) => {
    requestedMessages = request.messages
    return { finishReason: 'stop' }
  })
  const history = Array.from({ length: 80 }, (_, index) => ({
    id: `history-${index}`, conversationId: 'conversation-1', sequence: index + 1,
    role: 'assistant', status: 'completed',
    content: index % 3 ? `visible ${index}` : '<sumo_monitor><status>[位置|房间]</status></sumo_monitor>',
    attachmentIds: []
  }))
  await repository.saveMessages(history)

  await service.send({ conversationId: 'conversation-1', content: 'new turn' })

  assert.deepEqual(requestedMessages, buildChatContext({
    messages: [...history, { id: 'latest', sequence: 81, role: 'user', content: 'new turn' }],
    systemPrompt: '回答简洁'
  }))
  assert.equal(requestedMessages.length, 41)
  assert.ok(requestedMessages.some(message => message.role === 'assistant' && message.content === ''))
})

test('cancellation after the group pair is saved finalizes its placeholder without invoking a provider', async () => {
  const { repository, service } = await setup(async () => assert.fail('cancelled group must not call provider'), {}, groupConversationOverrides())
  const result = await service.send({
    conversationId: 'conversation-1', content: 'stop early',
    onMessage: message => {
      if (message.role === 'user') service.stop()
    }
  })

  assert.equal(result.status, 'cancelled')
  const assistant = (await repository.listMessages('conversation-1')).find(message => message.role === 'assistant')
  assert.equal(assistant.status, 'cancelled')
})

test('a rejected image callback write is handled while the provider is active and does not block later images', async () => {
  const { repository, service } = await setup(async () => assert.fail('chat should not run'), {
    generateImage: async (profile, request, handlers) => {
      handlers.onImage({ b64_json: 'AA==' })
      await new Promise(resolve => setImmediate(resolve))
      handlers.onImage({ b64_json: 'BB==' })
      await new Promise(resolve => setImmediate(resolve))
      return { images: [] }
    }
  })
  const saveAttachments = repository.saveAttachments.bind(repository)
  let attempts = 0
  repository.saveAttachments = async attachments => {
    attempts += 1
    if (attempts === 1) throw new Error('image storage unavailable')
    return saveAttachments(attachments)
  }
  const result = await service.send({ conversationId: 'conversation-1', content: 'two images', mode: 'image' })

  assert.equal(attempts, 2)
  assert.equal(result.status, 'interrupted')
  assert.equal(result.errorMessage, 'image storage unavailable')
  assert.equal((await repository.listMessageAttachments(result.id))[0].dataUrl, 'data:image/png;base64,BB==')
  assert.equal(service.activeRequest, null)
})

test('an exactly exhausted prompt budget preserves older zero-cost messages after skipping costly attachments', async () => {
  let requestedMessages
  const systemPrompt = 'S'.repeat(60000)
  const { repository, service } = await setup(async (profile, request) => {
    requestedMessages = request.messages
    return { finishReason: 'stop' }
  }, {}, {}, { getSystemPrompt: async () => systemPrompt })
  const history = [
    { id: 'old', sequence: 1, content: '<sumo_monitor><status>[位置|房间]</status></sumo_monitor>', attachmentIds: null },
    { id: 'middle', sequence: 2, content: 'visible text', attachmentIds: [] },
    { id: 'new', sequence: 3, content: '<sumo_monitor><status>[位置|门口]</status></sumo_monitor>', attachmentIds: ['image'] }
  ].map(message => ({ ...message, conversationId: 'conversation-1', role: 'assistant', status: 'completed' }))
  const attachments = [{ id: 'image', kind: 'image', dataUrl: 'data:image/png;base64,AA==' }]
  await repository.saveMessages(history)
  await repository.saveAttachments(attachments)

  await service.send({ conversationId: 'conversation-1', content: 'continue' })

  assert.deepEqual(requestedMessages, [
    { role: 'system', content: systemPrompt },
    { role: 'assistant', content: '' }
  ])
})

test('stopping remains cancelled when a provider resolves gracefully after abort', async () => {
  let notifications = 0
  const { repository, service } = await setup(async (profile, request, handlers) => {
    handlers.onDelta('partial text')
    service.stop()
    return { finishReason: 'stop' }
  }, {}, {}, { replyNotificationService: { notifyReply: async () => { notifications += 1 } } })

  const result = await service.send({ conversationId: 'conversation-1', content: 'stop gracefully' })

  assert.equal(result.status, 'cancelled')
  assert.equal((await repository.getMessage(result.id)).status, 'cancelled')
  assert.equal(result.content, 'partial text')
  assert.equal(notifications, 0)
})

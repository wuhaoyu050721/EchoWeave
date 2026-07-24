import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createChatInstructionResolver,
  createUserNameResolver,
  saveLocalProfileName,
  syncProfileNameFromCloudSession
} from '../src/app/create-character-instructions.js'

test('persists a custom local username for display and user placeholders', async () => {
  const settings = new Map()
  const repository = {
    setSetting: async (key, value) => settings.set(key, value),
    getSetting: async (key, fallback) => settings.has(key) ? settings.get(key) : fallback
  }

  assert.equal(await saveLocalProfileName(repository, '  本地用户小雨  '), '本地用户小雨')
  assert.equal(await createUserNameResolver(repository)(), '本地用户小雨')
  await assert.rejects(saveLocalProfileName(repository, '   '), /不能为空/)
  await assert.rejects(saveLocalProfileName(repository, 'a'.repeat(33)), /32 个字符/)
})

test('persists the cloud username for character user placeholders', async () => {
  const settings = new Map()
  const repository = {
    setSetting: async (key, value) => settings.set(key, value),
    getSetting: async (key, fallback) => settings.has(key) ? settings.get(key) : fallback
  }

  assert.equal(await syncProfileNameFromCloudSession(repository, { user: { username: '小明' } }), '小明')
  assert.equal(await createUserNameResolver(repository)(), '小明')
})

test('does not overwrite the local placeholder name with an empty cloud username', async () => {
  let writes = 0
  const repository = { setSetting: async () => { writes += 1 } }

  assert.equal(await syncProfileNameFromCloudSession(repository, { user: { username: '  ' } }), '')
  assert.equal(writes, 0)
})

test('rebuilds the character status protocol from current history on every request', async () => {
  const character = {
    id: 'char-1',
    name: '苏墨',
    card: { data: { system_prompt: '每次回答需要带上状态' } }
  }
  const repository = {
    getSetting: async (key, fallback) => fallback,
    getCharacter: async () => character,
    listWorldBooks: async () => []
  }
  const resolveInstructions = createChatInstructionResolver({
    repository,
    vault: { decryptString: async value => value },
    getUserName: async () => '小明'
  })
  const conversation = { characterId: character.id, systemPromptMode: 'inherit' }

  const firstRequest = await resolveInstructions(conversation, { messages: [] })
  const secondRequest = await resolveInstructions(conversation, {
    messages: [{
      role: 'assistant',
      status: 'completed',
      sequence: 1,
      content: '正文\n<status>\n[当前状态|开心]\n[当前位置|客厅]\n</status>'
    }]
  })

  assert.match(firstRequest.systemPrompt, /每次回答需要带上状态/)
  assert.match(firstRequest.systemPrompt, /本轮固定输出格式/)
  assert.match(firstRequest.systemPrompt, /<sumo_monitor>/)
  assert.match(firstRequest.postHistoryPrompt, /状态栏最终提醒/)
  assert.match(firstRequest.userTurnPrompt, /应用内部状态输出要求[\s\S]*<sumo_monitor>/)
  assert.match(secondRequest.systemPrompt, /上一轮状态参考：仅用于延续状态值/)
  assert.match(secondRequest.systemPrompt, /\[当前状态\|开心\]/)
  assert.match(secondRequest.systemPrompt, /本轮固定输出格式/)
  assert.match(secondRequest.userTurnPrompt, /上一轮状态参考[\s\S]*\[当前位置\|客厅\]/)
})

test('builds an isolated group prompt for the requested speaker', async () => {
  const characters = new Map([
    ['char-a', {
      id: 'char-a',
      name: '苏墨',
      card: { data: { description: '安静而敏锐', system_prompt: '保持克制' } }
    }],
    ['char-b', {
      id: 'char-b',
      name: '林夏',
      card: { data: { description: '热情直接', system_prompt: '语气开朗' } }
    }]
  ])
  const repository = {
    getSetting: async (key, fallback) => fallback,
    getCharacter: async id => characters.get(id),
    listWorldBooks: async () => []
  }
  const resolveInstructions = createChatInstructionResolver({
    repository,
    vault: { decryptString: async value => value },
    getUserName: async () => '小明'
  })
  const conversation = {
    conversationKind: 'group',
    title: '避难所',
    participants: [
      { characterId: 'char-a', nameSnapshot: '苏墨' },
      { characterId: 'char-b', nameSnapshot: '林夏' }
    ]
  }
  const instructions = await resolveInstructions(conversation, {
    speakerCharacterId: 'char-a',
    messages: [
      {
        role: 'assistant',
        speakerCharacterId: 'char-b',
        speakerNameSnapshot: '林夏',
        status: 'completed',
        sequence: 1,
        content: '先走吧\n<status>\n[当前状态|兴奋]\n[当前位置|门外]\n</status>'
      },
      {
        role: 'assistant',
        speakerCharacterId: 'char-a',
        speakerNameSnapshot: '苏墨',
        status: 'completed',
        sequence: 2,
        content: '等等\n<status>\n[当前状态|警觉]\n[当前位置|门边]\n</status>'
      }
    ]
  })

  assert.match(instructions.systemPrompt, /当前唯一允许发言的角色是：苏墨/)
  assert.match(instructions.systemPrompt, /群成员：[\s\S]*苏墨：安静而敏锐[\s\S]*林夏：热情直接/)
  assert.match(instructions.systemPrompt, /只以苏墨的身份输出本轮言行/)
  assert.match(instructions.systemPrompt, /完整名称并使用 @ 点名/)
  assert.match(instructions.systemPrompt, /最多产生 8 条群成员回复/)
  assert.match(instructions.systemPrompt, /\[当前状态\|警觉\]/)
  assert.doesNotMatch(instructions.systemPrompt, /\[当前状态\|兴奋\]/)
  assert.match(instructions.systemPrompt, /保持克制/)
  assert.doesNotMatch(instructions.systemPrompt, /语气开朗/)
})

test('builds an interface-member prompt without loading character cards or world books', async () => {
  let worldBookReads = 0
  const repository = {
    getSetting: async () => ({ enabled: true, encryptedValue: 'global prompt' }),
    getCharacter: async id => id === 'char-a'
      ? { id: 'char-a', name: '苏墨', card: { data: { description: '安静而敏锐' } } }
      : null,
    listWorldBooks: async () => {
      worldBookReads += 1
      return [{ id: 'book-1', data: { entries: [{ content: '不应加载' }] } }]
    }
  }
  const resolveInstructions = createChatInstructionResolver({
    repository,
    vault: { decryptString: async value => value },
    getUserName: async () => '小明'
  })
  const instructions = await resolveInstructions({
    conversationKind: 'group',
    title: '混合群聊',
    systemPromptMode: 'inherit',
    participants: [
      { memberKind: 'character', characterId: 'char-a', nameSnapshot: '苏墨' },
      { memberKind: 'provider', providerProfileId: 'provider-2', modelName: 'deepseek-chat', nameSnapshot: '独立接口' }
    ]
  }, {
    speakerProviderProfileId: 'provider-2',
    messages: []
  })

  assert.match(instructions, /独立 AI 接口成员“独立接口”/)
  assert.match(instructions, /模型为“deepseek-chat”/)
  assert.match(instructions, /不加载任何角色世界书/)
  assert.match(instructions, /不要输出 <sumo_monitor>/)
  assert.match(instructions, /完整名称并使用 @ 点名/)
  assert.doesNotMatch(instructions, /不应加载/)
  assert.equal(worldBookReads, 0)
})

test('omits the automatic handoff instruction when the group setting is disabled', async () => {
  const repository = {
    getSetting: async (key, fallback) => fallback,
    getCharacter: async id => ({
      id,
      name: id === 'char-a' ? '苏墨' : '林夏',
      card: { data: {} }
    }),
    listWorldBooks: async () => []
  }
  const resolveInstructions = createChatInstructionResolver({
    repository,
    vault: { decryptString: async value => value },
    getUserName: async () => '小明'
  })
  const instructions = await resolveInstructions({
    conversationKind: 'group',
    title: '安静群聊',
    participants: [
      { characterId: 'char-a', nameSnapshot: '苏墨' },
      { characterId: 'char-b', nameSnapshot: '林夏' }
    ],
    replyPolicy: { mode: 'round-robin', autoHandoff: false }
  }, {
    speakerCharacterId: 'char-a',
    messages: []
  })

  assert.doesNotMatch(instructions.systemPrompt, /完整名称并使用 @ 点名/)
})

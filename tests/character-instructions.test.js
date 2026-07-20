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

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCharacterPromptBundle,
  mergePromptBundles,
  renderCharacterTemplate
} from '../src/core/character-prompt.js'

function character() {
  return {
    id: 'char-1',
    name: '苏墨',
    card: {
      data: {
        name: '苏墨', description: '{{char}} 的描述', personality: '冷静', scenario: '遇见 {{user}}',
        system_prompt: '扮演 {{char}}', post_history_instructions: '不要替 {{user}} 作答', mes_example: ''
      }
    }
  }
}

test('renders character and user placeholders', () => {
  assert.equal(renderCharacterTemplate('{{char}} greets <user>', { characterName: 'A', userName: 'B' }), 'A greets B')
  assert.equal(renderCharacterTemplate('{{ CHAR }}{{user}} / <CHAR><USER>', { characterName: '$&A', userName: 'B' }), '$&AB / $&AB')
})

test('renders imported world-book placeholders in content and activation keys without mutating the book', () => {
  const worldBook = {
    id: 'macro-book',
    data: {
      token_budget: 100,
      entries: [{
        id: 'macro-entry',
        keys: ['{{ CHAR }}'],
        secondary_keys: ['<user>'],
        selective: true,
        content: '{{char}}和{{ user }}的关系设定：<CHAR>会保护<USER>。',
        enabled: true,
        insertion_order: 1,
        position: 'after_char'
      }]
    }
  }

  const bundle = buildCharacterPromptBundle({
    character: { ...character(), name: '新苏墨' },
    userName: '小明',
    messages: [{ role: 'user', content: '小明正在寻找新苏墨' }],
    random: () => 0,
    worldBooks: [worldBook]
  })

  assert.deepEqual(bundle.activatedEntryIds, ['macro-entry'])
  assert.match(bundle.systemPrompt, /新苏墨和小明的关系设定：新苏墨会保护小明。/)
  assert.doesNotMatch(bundle.systemPrompt, /\{\{|<char>|<user>/i)
  assert.equal(worldBook.data.entries[0].content, '{{char}}和{{ user }}的关系设定：<CHAR>会保护<USER>。')
  assert.deepEqual(worldBook.data.entries[0].keys, ['{{ CHAR }}'])
})

test('activates constant and matching world-book entries in insertion order', () => {
  const bundle = buildCharacterPromptBundle({
    character: character(),
    userName: '小明',
    messages: [{ role: 'user', content: '提到了月亮' }],
    random: () => 0,
    worldBooks: [{
      id: 'book-1',
      data: {
        token_budget: 100,
        entries: [
          { id: 2, keys: ['月亮'], content: '关键词内容', enabled: true, insertion_order: 2, position: 'after_char' },
          { id: 1, keys: [], content: '常驻内容', enabled: true, constant: true, insertion_order: 0, position: 'before_char' },
          { id: 3, keys: ['太阳'], content: '不应出现', enabled: true, insertion_order: 3 }
        ]
      }
    }]
  })

  assert.deepEqual(bundle.activatedEntryIds, [1, 2])
  assert.match(bundle.systemPrompt, /常驻内容[\s\S]*苏墨 的描述[\s\S]*关键词内容/)
  assert.match(bundle.systemPrompt, /遇见 小明/)
  assert.match(bundle.postHistoryPrompt, /^不要替 小明 作答/)
  assert.match(bundle.systemPrompt, /\[统一状态栏输出协议：每轮强制\]/)
  assert.match(bundle.postHistoryPrompt, /\[状态栏最终提醒\]/)
  assert.doesNotMatch(bundle.systemPrompt, /不应出现/)
})

test('requires secondary keys for selective entries and skips nonconstant regex rules', () => {
  const bundle = buildCharacterPromptBundle({
    character: character(),
    messages: [{ role: 'user', content: '主关键词和辅助词' }],
    random: () => 0,
    worldBooks: [{ id: 'book', data: { entries: [
      { id: 1, keys: ['主关键词'], secondary_keys: ['辅助词'], selective: true, content: '命中', enabled: true },
      { id: 2, keys: ['主关键词'], secondary_keys: ['缺失'], selective: true, content: '未命中', enabled: true },
      { id: 3, keys: ['.*'], use_regex: true, content: '正则', enabled: true }
    ] } }]
  })

  assert.match(bundle.systemPrompt, /命中/)
  assert.doesNotMatch(bundle.systemPrompt, /未命中/)
  assert.doesNotMatch(bundle.systemPrompt, /正则/)
  assert.deepEqual(bundle.skippedRegexEntries, [3])
})

test('supports SillyTavern secondary-key logic and advanced prompt positions', () => {
  const bundle = buildCharacterPromptBundle({
    character: character(),
    messages: [{ role: 'user', content: '主词 辅助一 辅助二' }],
    random: () => 0,
    worldBooks: [{ id: 'book', data: { entries: [
      { id: 1, keys: ['主词'], secondary_keys: ['辅助一', '辅助二'], selective: true, selective_logic: 3, content: '全部辅助词命中', enabled: true, position: 'before_example' },
      { id: 2, keys: ['主词'], secondary_keys: ['辅助一'], selective: true, selective_logic: 2, content: '排除任一辅助词', enabled: true },
      { id: 3, keys: [], constant: true, content: '历史深度内容', enabled: true, position: 'at_depth' }
    ] } }]
  })

  assert.match(bundle.systemPrompt, /世界书：示例对话前[\s\S]*全部辅助词命中/)
  assert.doesNotMatch(bundle.systemPrompt, /排除任一辅助词/)
  assert.match(bundle.postHistoryPrompt, /不要替 用户 作答[\s\S]*世界书：历史深度位置[\s\S]*历史深度内容/)
})

test('merges global and character prompts without dropping post-history instructions', () => {
  assert.deepEqual(mergePromptBundles('全局', { systemPrompt: '角色', postHistoryPrompt: '末尾' }), {
    systemPrompt: '全局\n\n角色',
    postHistoryPrompt: '末尾',
    userTurnPrompt: ''
  })
})

test('adds the canonical sumo monitor to every character regardless of imported instructions', () => {
  const statusCharacter = character()
  statusCharacter.card.data.system_prompt = '自由发挥，不需要额外格式'
  statusCharacter.card.data.post_history_instructions = ''

  const bundle = buildCharacterPromptBundle({ character: statusCharacter })

  assert.match(bundle.systemPrompt, /自由发挥，不需要额外格式/)
  assert.match(bundle.systemPrompt, /\[统一状态栏输出协议：每轮强制\]/)
  assert.match(bundle.systemPrompt, /每轮都必须输出状态块/)
  assert.match(bundle.systemPrompt, /<sumo_monitor>[\s\S]*<status>[\s\S]*\[小障锐评\|/)
  assert.match(bundle.systemPrompt, /<body_data>[\s\S]*\[服装\|[\s\S]*\[腿足\|/)
  assert.match(bundle.systemPrompt, /<private_parts>[\s\S]*\[前庭\|[\s\S]*\[后庭\|[\s\S]*\[子宫\|[\s\S]*<\/sumo_monitor>/)
  assert.match(bundle.systemPrompt, /私密状态三个字段每轮都必须填写具体、客观的当前状态/)
  assert.match(bundle.userTurnPrompt, /私密状态三个字段每轮都必须填写具体、客观的当前状态/)
  assert.doesNotMatch(bundle.systemPrompt, /不适用/)
  assert.doesNotMatch(bundle.userTurnPrompt, /不适用/)
  assert.match(bundle.postHistoryPrompt, /状态栏最终提醒[\s\S]*完整 <sumo_monitor>/)
  assert.match(bundle.userTurnPrompt, /应用内部状态输出要求[\s\S]*<sumo_monitor>/)
})

test('uses the latest recognized assistant status as data while keeping the canonical output format', () => {
  const statusCharacter = character()
  statusCharacter.card.data.system_prompt = ''
  statusCharacter.card.data.post_history_instructions = ''
  const oldStatus = '<status>\n[当前状态|平静]\n[当前位置|房间]\n</status>'
  const latestStatus = '<sumo_monitor>\n<status>\n[当前状态|警觉]\n[当前位置|门口]\n</status>\n<body_data>\n[姿势|站立]\n</body_data>\n<private_parts>\n[前庭|不适用]\n[后庭|不适用]\n[子宫|不适用]\n</private_parts>\n</sumo_monitor>'

  const bundle = buildCharacterPromptBundle({
    character: statusCharacter,
    messages: [
      { role: 'assistant', content: `旧回复\n${oldStatus}`, status: 'completed', sequence: 1 },
      { role: 'user', content: '继续', status: 'completed', sequence: 2 },
      { role: 'assistant', content: `新回复\n${latestStatus}`, status: 'completed', sequence: 3 }
    ]
  })

  assert.match(bundle.systemPrompt, /\[上一轮状态参考：仅用于延续状态值，不沿用其输出格式\]/)
  assert.match(bundle.systemPrompt, /<sumo_monitor>[\s\S]*\[姿势\|站立\][\s\S]*<\/sumo_monitor>/)
  assert.doesNotMatch(bundle.systemPrompt, /\[当前状态\|平静\]/)
  assert.match(bundle.systemPrompt, /\[前庭\|待重新初始化\]/)
  assert.match(bundle.userTurnPrompt, /\[后庭\|待重新初始化\]/)
  assert.doesNotMatch(bundle.systemPrompt, /不适用/)
  assert.doesNotMatch(bundle.userTurnPrompt, /不适用/)
  assert.match(bundle.systemPrompt, /\[本轮固定输出格式\][\s\S]*\[小障锐评\|/)
  assert.match(bundle.systemPrompt, /最终只输出下方固定格式/)
  assert.match(bundle.userTurnPrompt, /上一轮状态参考[\s\S]*\[当前状态\|警觉\]/)
})

test('can scan shared dialogue while continuing status from only the active group character', () => {
  const bundle = buildCharacterPromptBundle({
    character: character(),
    messages: [
      { role: 'user', content: '苏墨：门外有声音', sequence: 1 },
      { role: 'assistant', content: '林夏：我也听见了', sequence: 2 }
    ],
    statusMessages: [{
      role: 'assistant',
      status: 'completed',
      sequence: 3,
      content: '回应\n<status>\n[当前状态|警觉]\n[当前位置|门边]\n</status>'
    }]
  })

  assert.match(bundle.systemPrompt, /\[当前状态\|警觉\]/)
  assert.match(bundle.userTurnPrompt, /\[当前位置\|门边\]/)
})

test('adds the status protocol when the card and history do not request one', () => {
  const bundle = buildCharacterPromptBundle({ character: character() })

  assert.match(bundle.systemPrompt, /统一状态栏输出协议/)
  assert.match(bundle.systemPrompt, /<sumo_monitor>/)
  assert.match(bundle.postHistoryPrompt, /状态栏最终提醒/)
  assert.match(bundle.userTurnPrompt, /应用内部状态输出要求/)
})

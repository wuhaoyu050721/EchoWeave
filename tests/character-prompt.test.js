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
  assert.equal(bundle.postHistoryPrompt, '不要替 小明 作答')
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
    postHistoryPrompt: '末尾'
  })
})

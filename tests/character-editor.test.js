import test from 'node:test'
import assert from 'node:assert/strict'

import { applyCharacterEdits, createCharacterEditForm, createCustomCharacter } from '../src/features/character-editor.js'

function characterFixture() {
  return {
    id: 'character-1',
    name: '旧名称',
    nickname: '旧昵称',
    creator: '原作者',
    description: '旧描述',
    tags: ['旧标签'],
    avatarDataUrl: 'data:image/png;base64,preview-only',
    sourceHash: 'source-hash',
    avatarAssetId: 'asset-avatar',
    worldBookIds: ['book-1'],
    assetIds: ['asset-avatar', 'asset-2'],
    untouchedTopLevel: { enabled: true },
    card: {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: '旧名称',
        nickname: '旧昵称',
        creator: '原作者',
        description: '旧描述',
        tags: ['旧标签'],
        personality: '旧性格',
        scenario: '旧场景',
        first_mes: '旧问候',
        alternate_greetings: ['备用一'],
        mes_example: '旧示例',
        system_prompt: '旧系统提示词',
        post_history_instructions: '旧历史后提示词',
        creator_notes: '旧备注',
        extensions: { custom: { keep: true } },
        character_book: { name: '世界书', entries: [{ id: 1 }] },
        assets: [{ type: 'emotion', uri: 'embeded://smile' }],
        unknown_v3_field: { keep: true }
      }
    }
  }
}

test('creates an editable form from character and V3 card fields', () => {
  const form = createCharacterEditForm(characterFixture())

  assert.equal(form.name, '旧名称')
  assert.equal(form.personality, '旧性格')
  assert.equal(form.firstMessage, '旧问候')
  assert.deepEqual(form.alternateGreetings, ['备用一'])
  assert.equal(form.tagsText, '旧标签')
})

test('creates a local V3 character draft that can be edited and backed up', () => {
  const draft = createCustomCharacter({
    idFactory: () => 'custom-character-1',
    now: new Date('2026-07-17T10:00:00.000Z')
  })

  assert.equal(draft.id, 'custom-character-1')
  assert.equal(draft.sourceHash, 'custom:custom-character-1')
  assert.equal(draft.sourceFileName, '手动创建')
  assert.equal(draft.card.spec, 'chara_card_v3')
  assert.equal(draft.card.spec_version, '3.0')
  assert.equal(draft.card.data.character_version, '3.0')
  assert.deepEqual(draft.worldBookIds, [])
  assert.deepEqual(draft.assetIds, [])
  assert.equal(draft.cloudBackupAllowed, true)
  assert.equal(draft.createdAt, '2026-07-17T10:00:00.000Z')

  const form = createCharacterEditForm(draft)
  form.name = '自定义助手'
  form.description = '由用户手动创建'
  const saved = applyCharacterEdits(draft, form, new Date('2026-07-17T10:01:00.000Z'))

  assert.equal(saved.name, '自定义助手')
  assert.equal(saved.card.data.description, '由用户手动创建')
  assert.doesNotThrow(() => structuredClone(saved))
})

test('applies edits while preserving assets, lorebooks, extensions and unknown fields', () => {
  const original = characterFixture()
  const form = createCharacterEditForm(original)
  Object.assign(form, {
    name: '新名称',
    nickname: '新昵称',
    creator: '新作者',
    tagsText: '朋友，剧情, 朋友',
    description: '新描述',
    personality: '新性格',
    scenario: '新场景',
    firstMessage: '新问候',
    messageExample: '新示例',
    systemPrompt: '新系统提示词',
    postHistoryInstructions: '新历史后提示词',
    creatorNotes: '新备注',
    alternateGreetings: ['备用 A', '  ', '备用 B']
  })

  const updated = applyCharacterEdits(original, form, new Date('2026-07-17T08:00:00.000Z'))

  assert.equal(updated.name, '新名称')
  assert.equal(updated.card.data.name, '新名称')
  assert.equal(updated.card.data.personality, '新性格')
  assert.deepEqual(updated.tags, ['朋友', '剧情'])
  assert.deepEqual(updated.card.data.alternate_greetings, ['备用 A', '备用 B'])
  assert.deepEqual(updated.card.data.extensions, { custom: { keep: true } })
  assert.deepEqual(updated.card.data.character_book, { name: '世界书', entries: [{ id: 1 }] })
  assert.deepEqual(updated.card.data.assets, [{ type: 'emotion', uri: 'embeded://smile' }])
  assert.deepEqual(updated.card.data.unknown_v3_field, { keep: true })
  assert.deepEqual(updated.untouchedTopLevel, { enabled: true })
  assert.equal(updated.updatedAt, '2026-07-17T08:00:00.000Z')
  assert.equal('avatarDataUrl' in updated, false)
  assert.equal(original.name, '旧名称')
  assert.equal(original.card.data.name, '旧名称')
})

test('rejects an empty character name', () => {
  const original = characterFixture()
  const form = createCharacterEditForm(original)
  form.name = '   '

  assert.throws(() => applyCharacterEdits(original, form), /角色名称不能为空/)
})

test('unwraps reactive character proxies before persistence', () => {
  const original = characterFixture()
  const reactiveCharacter = new Proxy({
    ...original,
    card: new Proxy({
      ...original.card,
      data: new Proxy(original.card.data, {})
    }, {})
  }, {})
  const form = createCharacterEditForm(reactiveCharacter)

  const updated = applyCharacterEdits(reactiveCharacter, form)

  assert.doesNotThrow(() => structuredClone(updated))
  assert.deepEqual(updated.card.data.extensions, { custom: { keep: true } })
  assert.equal('avatarDataUrl' in updated, false)
})

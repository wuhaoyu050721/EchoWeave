import { createRuntimeId } from '../core/runtime-id.js'

function text(value) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function timestampValue(now) {
  const value = typeof now === 'function' ? now() : now
  return value instanceof Date ? value.toISOString() : text(value || new Date().toISOString())
}

function parseTags(value) {
  const tags = Array.isArray(value) ? value : text(value).split(/[,，\n]/)
  return [...new Set(tags.map(tag => text(tag).trim()).filter(Boolean))]
}

export function createCustomCharacter({
  idFactory = createRuntimeId,
  now = () => new Date().toISOString()
} = {}) {
  if (typeof idFactory !== 'function') throw new Error('新建角色缺少 ID 生成器')

  const id = text(idFactory()).trim()
  if (!id) throw new Error('新建角色 ID 无效')

  const timestamp = timestampValue(now)
  return {
    id,
    name: '',
    nickname: '',
    description: '',
    tags: [],
    creator: '',
    characterVersion: '3.0',
    card: {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: '',
        nickname: '',
        description: '',
        personality: '',
        scenario: '',
        first_mes: '',
        alternate_greetings: [],
        mes_example: '',
        system_prompt: '',
        post_history_instructions: '',
        creator_notes: '',
        tags: [],
        creator: '',
        character_version: '3.0',
        extensions: {}
      }
    },
    sourceVersion: 'custom-v3',
    sourceFileName: '手动创建',
    sourceHash: `custom:${id}`,
    avatarAssetId: null,
    worldBookIds: [],
    assetIds: [],
    cloudBackupAllowed: true,
    importedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null
  }
}

function snapshotCharacter(character) {
  const { avatarDataUrl: _previewAvatar, ...persistedCharacter } = character
  return JSON.parse(JSON.stringify(persistedCharacter))
}

export function createCharacterEditForm(character = {}) {
  const data = character.card?.data || {}
  return {
    name: text(character.name || data.name),
    nickname: text(character.nickname || data.nickname),
    creator: text(character.creator || data.creator),
    tagsText: (Array.isArray(character.tags) ? character.tags : data.tags || []).map(text).join('，'),
    description: text(character.description ?? data.description),
    personality: text(data.personality),
    scenario: text(data.scenario),
    firstMessage: text(data.first_mes),
    alternateGreetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings.map(text) : [],
    messageExample: text(data.mes_example),
    systemPrompt: text(data.system_prompt),
    postHistoryInstructions: text(data.post_history_instructions),
    creatorNotes: text(data.creator_notes)
  }
}

export function applyCharacterEdits(character, form, now = () => new Date().toISOString()) {
  if (!character?.id) throw new Error('缺少要编辑的角色')

  const name = text(form?.name).trim()
  if (!name) throw new Error('角色名称不能为空')

  const nickname = text(form?.nickname).trim()
  const creator = text(form?.creator).trim()
  const description = text(form?.description)
  const tags = parseTags(form?.tagsText)
  const alternateGreetings = Array.isArray(form?.alternateGreetings)
    ? form.alternateGreetings.map(text).map(value => value.trim()).filter(Boolean)
    : []
  const source = snapshotCharacter(character)
  const card = source.card && typeof source.card === 'object' ? source.card : {}
  const data = card.data && typeof card.data === 'object' ? card.data : {}

  const updated = {
    ...source,
    name,
    nickname,
    creator,
    description,
    tags,
    card: {
      ...card,
      data: {
        ...data,
        name,
        nickname,
        creator,
        description,
        tags,
        personality: text(form?.personality),
        scenario: text(form?.scenario),
        first_mes: text(form?.firstMessage),
        alternate_greetings: alternateGreetings,
        mes_example: text(form?.messageExample),
        system_prompt: text(form?.systemPrompt),
        post_history_instructions: text(form?.postHistoryInstructions),
        creator_notes: text(form?.creatorNotes)
      }
    },
    updatedAt: timestampValue(now)
  }
  return updated
}

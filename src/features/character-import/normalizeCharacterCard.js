import { CCardLib } from '@risuai/ccardlib'
import { importError } from './errors.js'
import { CHARACTER_IMPORT_LIMITS } from './types.js'

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function stringDefault(value, fallback = '') {
  return value === undefined || value === null ? fallback : value
}

function arrayDefault(value) {
  return value === undefined || value === null ? [] : value
}

function objectDefault(value) {
  return value === undefined || value === null ? {} : value
}

function explicitVersion(payload) {
  const spec = String(payload?.spec ?? '').trim().toLowerCase()
  const version = String(payload?.spec_version ?? '').trim()
  if (payload?.data && (spec === 'chara_card_v3' || /^3(?:\.0+)?$/.test(version))) return 'v3'
  if (payload?.data && (spec === 'chara_card_v2' || /^2(?:\.0+)?$/.test(version))) return 'v2'
  return null
}

function normalizeLorebook(book) {
  if (book === undefined || book === null) return undefined
  if (typeof book !== 'object' || Array.isArray(book)) throw importError('invalid_lorebook', '角色卡世界书格式无效')
  const normalized = cloneJson(book)
  normalized.extensions = objectDefault(normalized.extensions)
  normalized.entries = arrayDefault(normalized.entries).map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw importError('invalid_lorebook_entry', `世界书第 ${index + 1} 条内容格式无效`)
    }
    return {
      ...entry,
      keys: arrayDefault(entry.keys),
      secondary_keys: arrayDefault(entry.secondary_keys),
      content: stringDefault(entry.content),
      extensions: objectDefault(entry.extensions),
      enabled: entry.enabled ?? true,
      insertion_order: entry.insertion_order ?? 100,
      use_regex: entry.use_regex ?? false
    }
  })
  return normalized
}

function normalizeEnvelope(payload, version, warnings) {
  if (version === 'v1') return cloneJson(payload)
  const data = cloneJson(payload.data)
  const legacyKeys = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example']
    .filter(key => Object.prototype.hasOwnProperty.call(payload, key))
  if (legacyKeys.length) warnings.push({ code: 'hybrid_legacy_fields', message: '检测到兼容旧版的重复字段，已按显式卡片版本读取' })
  if (typeof data.character_version === 'number') {
    data.character_version = String(data.character_version)
    warnings.push({ code: 'numeric_character_version', message: '角色版本号为数字，已转换为文本' })
  }
  data.name = stringDefault(data.name)
  data.description = stringDefault(data.description)
  data.personality = stringDefault(data.personality)
  data.scenario = stringDefault(data.scenario)
  data.first_mes = stringDefault(data.first_mes)
  data.mes_example = stringDefault(data.mes_example)
  data.creator_notes = stringDefault(data.creator_notes)
  data.system_prompt = stringDefault(data.system_prompt)
  data.post_history_instructions = stringDefault(data.post_history_instructions)
  data.tags = arrayDefault(data.tags)
  data.creator = stringDefault(data.creator)
  data.character_version = stringDefault(data.character_version)
  data.alternate_greetings = arrayDefault(data.alternate_greetings)
  data.extensions = objectDefault(data.extensions)
  data.character_book = normalizeLorebook(data.character_book)
  if (version === 'v3') {
    data.group_only_greetings = arrayDefault(data.group_only_greetings)
    data.assets = arrayDefault(data.assets)
    return { spec: 'chara_card_v3', spec_version: '3.0', data }
  }
  return { spec: 'chara_card_v2', spec_version: '2.0', data }
}

function sourceCounts(card, version) {
  if (version === 'v1') return { lorebookEntries: 0, greetings: 0, assets: 0 }
  return {
    lorebookEntries: card.data?.character_book?.entries?.length ?? 0,
    greetings: card.data?.alternate_greetings?.length ?? 0,
    assets: card.data?.assets?.length ?? 0
  }
}

function validateTextLimits(card, maxCharacters) {
  const fields = [
    ['角色名称', card.data.name],
    ['角色描述', card.data.description],
    ['角色性格', card.data.personality],
    ['场景', card.data.scenario],
    ['首次问候语', card.data.first_mes],
    ['对话示例', card.data.mes_example],
    ['系统提示词', card.data.system_prompt],
    ['历史后提示词', card.data.post_history_instructions]
  ]
  for (const [label, value] of fields) {
    if (typeof value !== 'string') throw importError('invalid_character_field', `${label}必须是文本`)
    if (value.length > maxCharacters) throw importError('character_field_too_large', `${label}内容过长`)
  }
  if (!card.data.name.trim()) throw importError('missing_character_name', '角色卡缺少角色名称')
}

export function normalizeCharacterCard(payload, {
  maxTextFieldCharacters = CHARACTER_IMPORT_LIMITS.maxTextFieldCharacters
} = {}) {
  const warnings = []
  const explicit = explicitVersion(payload)
  let sourceVersion = explicit
  if (!sourceVersion) sourceVersion = CCardLib.character.check(cloneJson(payload))
  if (sourceVersion === 'unknown') throw importError('unsupported_character_card', '无法识别角色卡版本')

  const canonicalSource = normalizeEnvelope(payload, sourceVersion, warnings)
  const checkedVersion = CCardLib.character.check(cloneJson(canonicalSource))
  if (checkedVersion !== sourceVersion) {
    throw importError('invalid_character_card', `角色卡声明为 ${sourceVersion.toUpperCase()}，但字段校验未通过`)
  }

  const before = sourceCounts(canonicalSource, sourceVersion)
  let card
  try {
    card = CCardLib.character.convert(canonicalSource, { from: sourceVersion, to: 'v3' })
  } catch (error) {
    throw importError('character_conversion_failed', '角色卡无法转换为 V3', { cause: error })
  }
  card = normalizeEnvelope(card, 'v3', warnings)
  const after = sourceCounts(card, 'v3')
  if (after.lorebookEntries < before.lorebookEntries || after.greetings < before.greetings || after.assets < before.assets) {
    throw importError('character_conversion_data_loss', '角色卡转换会丢失世界书、问候语或资源，已停止导入')
  }
  if (CCardLib.character.check(cloneJson(card)) !== 'v3') {
    throw importError('invalid_character_v3', '标准化后的 V3 角色卡校验失败')
  }
  validateTextLimits(card, maxTextFieldCharacters)
  return { card, sourceVersion, warnings }
}

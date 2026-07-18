import { worldBookImportError } from './errors.js'
import { WORLD_BOOK_IMPORT_LIMITS, WORLD_BOOK_UNSAFE_KEYS } from './types.js'

const ENTRY_FIELDS = new Set([
  'uid', 'id', 'name', 'comment', 'key', 'keys', 'keysecondary', 'secondary_keys', 'content', 'constant', 'selective',
  'selectiveLogic', 'selective_logic', 'order', 'insertion_order', 'position', 'disable', 'enabled', 'probability',
  'useProbability', 'use_probability', 'caseSensitive', 'case_sensitive', 'matchWholeWords', 'match_whole_words',
  'useRegex', 'use_regex', 'depth', 'role', 'extensions'
])
const BOOK_FIELDS = new Set([
  'name', 'description', 'entries', 'scan_depth', 'scanDepth', 'token_budget', 'tokenBudget', 'recursive_scanning',
  'recursiveScanning', 'extensions'
])
const POSITION_BY_NUMBER = Object.freeze({
  0: 'before_char',
  1: 'after_char',
  2: 'before_example',
  3: 'after_example',
  4: 'before_author_note',
  5: 'after_author_note',
  6: 'at_depth'
})
const POSITION_ALIASES = Object.freeze({
  before_char: 'before_char', before_character: 'before_char', before_character_definitions: 'before_char',
  after_char: 'after_char', after_character: 'after_char', after_character_definitions: 'after_char',
  before_example: 'before_example', before_examples: 'before_example',
  after_example: 'after_example', after_examples: 'after_example',
  before_author_note: 'before_author_note', after_author_note: 'after_author_note',
  at_depth: 'at_depth', depth: 'at_depth'
})

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function optionalBoolean(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function stringArray(value) {
  if (value === undefined || value === null) return []
  const values = Array.isArray(value) ? value : [value]
  return values.map(item => String(item ?? '').trim()).filter(Boolean)
}

function preserveUnknown(source, knownFields) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !knownFields.has(key)).map(([key, value]) => [key, cloneJson(value)]))
}

function unsafePaths(value, path = [], found = []) {
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) {
    const next = [...path, key]
    if (WORLD_BOOK_UNSAFE_KEYS.includes(key.toLowerCase())) found.push(next.join('.'))
    if (child && typeof child === 'object') unsafePaths(child, next, found)
  }
  return found
}

function normalizePosition(value, warnings, entryLabel) {
  const numeric = typeof value === 'number' || /^\d+$/.test(String(value ?? '').trim())
    ? POSITION_BY_NUMBER[Number(value)]
    : null
  const normalized = numeric || POSITION_ALIASES[String(value ?? '').trim().toLowerCase()]
  if (normalized) return normalized
  if (value !== undefined && value !== null && value !== '') {
    warnings.push({ code: 'world_book_position_mapped', message: `${entryLabel} 的未知位置已映射到角色设定后` })
  }
  return 'after_char'
}

function sourceEntries(payload) {
  if (Array.isArray(payload.entries)) return payload.entries.map((entry, index) => [String(entry?.id ?? index), entry])
  if (payload.entries && typeof payload.entries === 'object') return Object.entries(payload.entries)
  throw worldBookImportError('missing_world_book_entries', '世界书缺少 entries 规则列表')
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw worldBookImportError('invalid_world_book_json', '世界书 JSON 根节点必须是对象')
  }
  if (payload.data?.character_book) return payload.data.character_book
  if (payload.character_book) return payload.character_book
  if (payload.lorebook) return payload.lorebook
  return payload
}

function normalizeEntry(entryKey, entry, index, warnings, limits) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw worldBookImportError('invalid_world_book_entry', `世界书第 ${index + 1} 条规则格式无效`)
  }
  const content = String(entry.content ?? '')
  if (content.length > limits.maxEntryCharacters) {
    throw worldBookImportError('world_book_entry_too_large', `世界书第 ${index + 1} 条规则内容过长`)
  }
  const primaryKeys = stringArray(entry.keys ?? entry.key)
  const secondaryKeys = stringArray(entry.secondary_keys ?? entry.keysecondary)
  const probabilityEnabled = optionalBoolean(entry.useProbability, entry.use_probability)
  const enabled = optionalBoolean(entry.enabled)
  const disabled = optionalBoolean(entry.disable)
  const extensions = entry.extensions && typeof entry.extensions === 'object' && !Array.isArray(entry.extensions)
    ? cloneJson(entry.extensions)
    : {}
  const importedFields = preserveUnknown(entry, ENTRY_FIELDS)
  if (Object.keys(importedFields).length) extensions.imported_fields = importedFields
  const originalPosition = entry.position
  const position = normalizePosition(originalPosition, warnings, `第 ${index + 1} 条规则`)
  if (originalPosition !== undefined) extensions.source_position = cloneJson(originalPosition)
  if (entry.depth !== undefined) extensions.depth = finiteNumber(entry.depth, 4)
  if (entry.role !== undefined) extensions.role = cloneJson(entry.role)

  return {
    id: entry.id ?? entry.uid ?? entryKey ?? index,
    name: String(entry.name ?? entry.comment ?? ''),
    comment: String(entry.comment ?? ''),
    keys: primaryKeys,
    secondary_keys: secondaryKeys,
    content,
    extensions,
    enabled: enabled ?? !(disabled ?? false),
    insertion_order: finiteNumber(entry.insertion_order ?? entry.order, 100),
    case_sensitive: optionalBoolean(entry.case_sensitive, entry.caseSensitive) ?? false,
    match_whole_words: optionalBoolean(entry.match_whole_words, entry.matchWholeWords) ?? false,
    selective: optionalBoolean(entry.selective) ?? secondaryKeys.length > 0,
    selective_logic: finiteNumber(entry.selective_logic ?? entry.selectiveLogic, 0),
    constant: optionalBoolean(entry.constant) ?? false,
    position,
    probability: probabilityEnabled === false ? 100 : Math.max(0, Math.min(100, finiteNumber(entry.probability, 100))),
    use_regex: optionalBoolean(entry.use_regex, entry.useRegex) ?? false
  }
}

export function normalizeWorldBook(payload, { fileName = 'world-book.json', limits = WORLD_BOOK_IMPORT_LIMITS } = {}) {
  const source = unwrapPayload(payload)
  const entries = sourceEntries(source)
  if (entries.length > limits.maxEntries) throw worldBookImportError('too_many_world_book_entries', `世界书规则不能超过 ${limits.maxEntries} 条`)
  const warnings = []
  const normalizedEntries = entries.map(([entryKey, entry], index) => normalizeEntry(entryKey, entry, index, warnings, limits))
  const totalContentCharacters = normalizedEntries.reduce((total, entry) => total + entry.content.length, 0)
  if (totalContentCharacters > limits.maxTotalContentCharacters) {
    throw worldBookImportError('world_book_content_too_large', '世界书规则内容总量超过限制')
  }
  const fileStem = String(fileName).replace(/\.json$/i, '').trim()
  const name = String(source.name ?? payload.name ?? fileStem).trim() || '未命名世界书'
  if (!name) throw worldBookImportError('missing_world_book_name', '世界书缺少名称')
  if (name.length > limits.maxNameCharacters) throw worldBookImportError('world_book_name_too_large', '世界书名称过长')
  const bookExtensions = source.extensions && typeof source.extensions === 'object' && !Array.isArray(source.extensions)
    ? cloneJson(source.extensions)
    : {}
  const importedFields = preserveUnknown(source, BOOK_FIELDS)
  if (Object.keys(importedFields).length) bookExtensions.imported_fields = importedFields
  const sourceFormat = Array.isArray(source.entries) ? 'character-book' : 'sillytavern'
  bookExtensions.import_source = sourceFormat
  const unsafeExtensions = unsafePaths(source)
  const regexEntryCount = normalizedEntries.filter(entry => entry.enabled && entry.use_regex && !entry.constant).length
  const advancedPositionCount = normalizedEntries.filter(entry => !['before_char', 'after_char'].includes(entry.position)).length
  if (regexEntryCount) warnings.push({ code: 'regex_entries_deferred', message: `${regexEntryCount} 条正则规则暂不自动激活` })
  if (advancedPositionCount) warnings.push({ code: 'advanced_positions_mapped', message: `${advancedPositionCount} 条高级位置规则会映射到最接近的提示词位置` })
  if (source.recursive_scanning || source.recursiveScanning) warnings.push({ code: 'recursive_scanning_deferred', message: '递归扫描设置会保留，但首版暂不执行' })
  if (unsafeExtensions.length) warnings.push({ code: 'unsafe_extensions_disabled', message: '世界书包含脚本或高级扩展，导入后保持禁用' })

  return {
    data: {
      name,
      description: String(source.description ?? ''),
      scan_depth: Math.max(1, finiteNumber(source.scan_depth ?? source.scanDepth, 4)),
      token_budget: Math.max(1, finiteNumber(source.token_budget ?? source.tokenBudget, 2048)),
      recursive_scanning: Boolean(source.recursive_scanning ?? source.recursiveScanning),
      extensions: bookExtensions,
      entries: normalizedEntries
    },
    sourceFormat,
    unsafeExtensions,
    warnings,
    totalContentCharacters
  }
}

import { WORLD_BOOK_IMPORT_LIMITS } from '../world-book-import/types.js'
import { WorldBookValidationError } from './errors.js'

export const WORLD_BOOK_POSITIONS = Object.freeze([
  'before_char',
  'after_char',
  'before_example',
  'after_example',
  'before_author_note',
  'after_author_note',
  'at_depth'
])

export const WORLD_BOOK_MANAGEMENT_LIMITS = Object.freeze({
  ...WORLD_BOOK_IMPORT_LIMITS,
  maxDescriptionCharacters: 20000,
  maxRuleNameCharacters: 200,
  maxKeywordCharacters: 500,
  maxKeywordsPerRule: 100,
  minScanDepth: 1,
  maxScanDepth: 100,
  minTokenBudget: 1,
  maxTokenBudget: 1000000,
  minOrder: -1000000,
  maxOrder: 1000000
})

function text(value) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function issue(path, code, message) {
  return { path, code, message }
}

function uniqueStrings(values) {
  const source = Array.isArray(values) ? values : []
  return [...new Set(source.map(value => text(value).trim()).filter(Boolean))]
}

function keywordsFrom(value) {
  if (Array.isArray(value)) return uniqueStrings(value)
  return uniqueStrings(text(value).split(/[，,;；\n]/))
}

function integerValue(value, fallback, path, range, issues) {
  const candidate = value === '' || value === undefined || value === null ? fallback : Number(value)
  if (!Number.isInteger(candidate) || candidate < range.min || candidate > range.max) {
    issues.push(issue(path, 'invalid_integer', `${range.label}必须是 ${range.min} 到 ${range.max} 之间的整数`))
    return fallback
  }
  return candidate
}

function normalizedBinding(input, issues) {
  const source = input?.binding && typeof input.binding === 'object' ? input.binding : input || {}
  const rawCharacterIds = source.characterIds ?? input?.characterIds
  const explicitMode = source.mode ?? input?.bindingMode
  const inferredMode = input?.scope === 'character' || uniqueStrings(rawCharacterIds).length ? 'characters' : 'global'
  const requestedMode = text(explicitMode ?? inferredMode).trim().toLowerCase()
  const bindingMode = ['character', 'characters', 'selected'].includes(requestedMode) ? 'characters' : 'global'
  const characterIds = uniqueStrings(rawCharacterIds)
  if (bindingMode === 'characters' && !characterIds.length) {
    issues.push(issue('characterIds', 'missing_character_binding', '指定角色模式至少需要选择一个角色'))
  }
  return { bindingMode, characterIds: bindingMode === 'global' ? [] : characterIds }
}

export function normalizeWorldBookBinding(input) {
  const issues = []
  const binding = normalizedBinding(input, issues)
  if (issues.length) throw new WorldBookValidationError(issues)
  return binding
}

export function normalizeWorldBookDraft(input, { limits = WORLD_BOOK_MANAGEMENT_LIMITS } = {}) {
  limits = { ...WORLD_BOOK_MANAGEMENT_LIMITS, ...limits }
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const issues = []
  const name = text(source.name).trim()
  const description = text(source.description)
  if (!name) issues.push(issue('name', 'missing_name', '世界书名称不能为空'))
  if (name.length > limits.maxNameCharacters) {
    issues.push(issue('name', 'name_too_long', `世界书名称不能超过 ${limits.maxNameCharacters} 个字符`))
  }
  if (description.length > limits.maxDescriptionCharacters) {
    issues.push(issue('description', 'description_too_long', `世界书描述不能超过 ${limits.maxDescriptionCharacters} 个字符`))
  }

  const scanDepth = integerValue(
    source.scan_depth ?? source.scanDepth,
    4,
    'scan_depth',
    { min: limits.minScanDepth, max: limits.maxScanDepth, label: '扫描深度' },
    issues
  )
  const tokenBudget = integerValue(
    source.token_budget ?? source.tokenBudget,
    2048,
    'token_budget',
    { min: limits.minTokenBudget, max: limits.maxTokenBudget, label: 'Token 预算' },
    issues
  )
  const binding = normalizedBinding(source, issues)
  const entries = Array.isArray(source.entries) ? source.entries : Array.isArray(source.rules) ? source.rules : []
  if (entries.length > limits.maxEntries) {
    issues.push(issue('entries', 'too_many_entries', `世界书规则不能超过 ${limits.maxEntries} 条`))
  }

  const seenIds = new Set()
  let totalContentCharacters = 0
  const normalizedEntries = entries.map((entryValue, index) => {
    const entry = entryValue && typeof entryValue === 'object' && !Array.isArray(entryValue) ? entryValue : {}
    const path = `entries.${index}`
    const id = entry.id === undefined || entry.id === null || entry.id === '' ? null : entry.id
    const idKey = id === null ? '' : text(id)
    if (idKey && seenIds.has(idKey)) issues.push(issue(`${path}.id`, 'duplicate_entry_id', `第 ${index + 1} 条规则 ID 重复`))
    if (idKey) seenIds.add(idKey)

    const entryName = text(entry.name ?? entry.comment).trim()
    const entryComment = text(entry.comment)
    const keywords = keywordsFrom(entry.keywords ?? entry.keys ?? entry.keywordsText)
    const content = text(entry.content)
    const constant = Boolean(entry.constant)
    const enabled = entry.enabled !== false
    const order = integerValue(
      entry.order ?? entry.insertion_order,
      100,
      `${path}.order`,
      { min: limits.minOrder, max: limits.maxOrder, label: `第 ${index + 1} 条规则顺序` },
      issues
    )
    const position = text(entry.position || 'after_char').trim()

    if (entryName.length > limits.maxRuleNameCharacters) {
      issues.push(issue(`${path}.name`, 'rule_name_too_long', `第 ${index + 1} 条规则名称不能超过 ${limits.maxRuleNameCharacters} 个字符`))
    }
    if (entryComment.length > limits.maxRuleNameCharacters) {
      issues.push(issue(`${path}.comment`, 'rule_comment_too_long', `第 ${index + 1} 条规则备注不能超过 ${limits.maxRuleNameCharacters} 个字符`))
    }
    if (!content.trim()) issues.push(issue(`${path}.content`, 'missing_rule_content', `第 ${index + 1} 条规则内容不能为空`))
    if (content.length > limits.maxEntryCharacters) {
      issues.push(issue(`${path}.content`, 'rule_content_too_long', `第 ${index + 1} 条规则内容过长`))
    }
    if (!constant && !keywords.length) {
      issues.push(issue(`${path}.keywords`, 'missing_rule_keywords', `第 ${index + 1} 条非常驻规则至少需要一个关键词`))
    }
    if (keywords.length > limits.maxKeywordsPerRule) {
      issues.push(issue(`${path}.keywords`, 'too_many_rule_keywords', `第 ${index + 1} 条规则关键词不能超过 ${limits.maxKeywordsPerRule} 个`))
    }
    if (keywords.some(keyword => keyword.length > limits.maxKeywordCharacters)) {
      issues.push(issue(`${path}.keywords`, 'rule_keyword_too_long', `第 ${index + 1} 条规则包含过长关键词`))
    }
    if (!WORLD_BOOK_POSITIONS.includes(position)) {
      issues.push(issue(`${path}.position`, 'invalid_rule_position', `第 ${index + 1} 条规则位置无效`))
    }
    totalContentCharacters += content.length

    return {
      id,
      name: entryName,
      comment: entryComment,
      keys: keywords,
      content,
      enabled,
      constant,
      insertion_order: order,
      position: WORLD_BOOK_POSITIONS.includes(position) ? position : 'after_char'
    }
  })

  if (totalContentCharacters > limits.maxTotalContentCharacters) {
    issues.push(issue('entries', 'total_content_too_long', '世界书规则内容总量超过限制'))
  }
  if (issues.length) throw new WorldBookValidationError(issues)

  return {
    name,
    description,
    scan_depth: scanDepth,
    token_budget: tokenBudget,
    bindingMode: binding.bindingMode,
    characterIds: binding.characterIds,
    entries: normalizedEntries
  }
}

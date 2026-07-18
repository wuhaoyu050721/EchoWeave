import { WORLD_BOOK_POSITIONS } from './validation.js'

function text(value) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => text(value).trim()).filter(Boolean))]
}

export function createEmptyWorldBookRule(overrides = {}) {
  return {
    id: null,
    name: '',
    comment: '',
    keywordsText: '',
    content: '',
    enabled: true,
    constant: false,
    order: 100,
    position: 'after_char',
    ...overrides
  }
}

export function createEmptyWorldBookDraft(overrides = {}) {
  return {
    name: '',
    description: '',
    scan_depth: 4,
    token_budget: 2048,
    bindingMode: 'global',
    characterIds: [],
    entries: [createEmptyWorldBookRule()],
    ...overrides
  }
}

export function worldBookBindingMode(worldBook) {
  const explicitIds = uniqueIds([
    ...(Array.isArray(worldBook?.characterIds) ? worldBook.characterIds : []),
    ...(worldBook?.characterId ? [worldBook.characterId] : [])
  ])
  return worldBook?.scope === 'global' && !explicitIds.length ? 'global' : 'characters'
}

export function createWorldBookDraft(worldBook) {
  if (!worldBook || typeof worldBook !== 'object') return createEmptyWorldBookDraft()
  const data = worldBook.data && typeof worldBook.data === 'object' ? worldBook.data : {}
  const characterIds = uniqueIds([
    ...(Array.isArray(worldBook.characterIds) ? worldBook.characterIds : []),
    ...(worldBook.characterId ? [worldBook.characterId] : [])
  ])
  const entries = Array.isArray(data.entries) ? data.entries.map(entry => createEmptyWorldBookRule({
    id: entry.id ?? entry.uid ?? null,
    name: text(entry.name ?? entry.comment),
    comment: text(entry.comment),
    keywordsText: (Array.isArray(entry.keys) ? entry.keys : []).map(text).join('，'),
    content: text(entry.content),
    enabled: entry.enabled !== false,
    constant: Boolean(entry.constant),
    order: Number.isFinite(Number(entry.insertion_order ?? entry.order)) ? Number(entry.insertion_order ?? entry.order) : 100,
    position: WORLD_BOOK_POSITIONS.includes(entry.position) ? entry.position : 'after_char'
  })) : []

  return createEmptyWorldBookDraft({
    name: text(worldBook.name ?? data.name),
    description: text(data.description ?? worldBook.description),
    scan_depth: Number.isFinite(Number(data.scan_depth)) ? Number(data.scan_depth) : 4,
    token_budget: Number.isFinite(Number(data.token_budget)) ? Number(data.token_budget) : 2048,
    bindingMode: worldBookBindingMode(worldBook),
    characterIds,
    entries
  })
}

export function worldBookBindingLabel(worldBook, characters = []) {
  if (worldBookBindingMode(worldBook) === 'global') return '全局'
  const ids = uniqueIds([
    ...(Array.isArray(worldBook?.characterIds) ? worldBook.characterIds : []),
    ...(worldBook?.characterId ? [worldBook.characterId] : [])
  ])
  const namesById = new Map(characters.map(character => [text(character?.id), text(character?.name).trim()]))
  const names = ids.map(id => namesById.get(id)).filter(Boolean)
  if (!names.length) return `${ids.length} 个角色`
  if (names.length <= 2 && names.length === ids.length) return names.join('、')
  return `${ids.length} 个角色`
}

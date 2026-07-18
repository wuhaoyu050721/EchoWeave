import { createRuntimeId } from '../../core/runtime-id.js'
import { worldBookManagementError } from './errors.js'
import { normalizeWorldBookBinding, normalizeWorldBookDraft } from './validation.js'

const REQUIRED_REPOSITORY_METHODS = Object.freeze([
  'listCharacters',
  'listAllWorldBooks',
  'getWorldBook',
  'saveWorldBook',
  'saveCharacter'
])

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function text(value) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function timestampValue(now) {
  const value = typeof now === 'function' ? now() : now
  return value instanceof Date ? value.toISOString() : text(value || new Date().toISOString())
}

function ensureRepository(repository) {
  const missing = REQUIRED_REPOSITORY_METHODS.filter(method => typeof repository?.[method] !== 'function')
  if (missing.length) {
    throw worldBookManagementError(
      'world_book_repository_unavailable',
      '世界书管理所需的本地存储服务不可用',
      { stage: 'repository', details: { missing } }
    )
  }
}

function generatedId(idFactory, label) {
  const id = text(idFactory()).trim()
  if (!id) throw worldBookManagementError('invalid_generated_id', `${label} ID 生成失败`, { stage: 'prepare' })
  return id
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => text(value).trim()).filter(Boolean))]
}

function entryDefaults() {
  return {
    comment: '',
    secondary_keys: [],
    extensions: {},
    case_sensitive: false,
    match_whole_words: false,
    selective: false,
    selective_logic: 0,
    probability: 100,
    use_regex: false
  }
}

function persistedEntries(entries, previousEntries, idFactory) {
  const previousById = new Map((Array.isArray(previousEntries) ? previousEntries : []).map(entry => [text(entry?.id), entry]))
  const explicitIds = new Set(entries
    .filter(entry => entry.id !== null && entry.id !== undefined && entry.id !== '')
    .map(entry => text(entry.id)))
  const usedIds = new Set()
  return entries.map(entry => {
    let id = entry.id
    if (id === null || id === undefined || id === '') {
      let attempts = 0
      do {
        id = generatedId(idFactory, '世界书规则')
        attempts += 1
      } while ((usedIds.has(text(id)) || explicitIds.has(text(id))) && attempts < 100)
      if (usedIds.has(text(id)) || explicitIds.has(text(id))) {
        throw worldBookManagementError('duplicate_world_book_entry_id', '无法生成唯一的世界书规则 ID', { stage: 'prepare' })
      }
    }
    const idKey = text(id)
    usedIds.add(idKey)
    const previous = previousById.get(idKey)
    return {
      ...entryDefaults(),
      ...(previous ? cloneJson(previous) : {}),
      id,
      name: entry.name,
      comment: entry.comment,
      keys: [...entry.keys],
      content: entry.content,
      enabled: entry.enabled,
      constant: entry.constant,
      insertion_order: entry.insertion_order,
      position: entry.position
    }
  })
}

function bindingFields(binding) {
  return {
    scope: 'global',
    characterId: null,
    characterIds: binding.bindingMode === 'global' ? [] : [...binding.characterIds]
  }
}

async function activeCharacters(repository) {
  const characters = await repository.listCharacters()
  return (Array.isArray(characters) ? characters : []).filter(character => character?.id && !character.deletedAt)
}

function assertBoundCharactersExist(binding, characters) {
  if (binding.bindingMode === 'global') return
  const availableIds = new Set(characters.map(character => text(character.id)))
  const missing = binding.characterIds.filter(id => !availableIds.has(id))
  if (missing.length) {
    throw worldBookManagementError(
      'missing_world_book_character',
      '世界书绑定了不存在的角色',
      { stage: 'binding', details: { characterIds: missing } }
    )
  }
}

function characterChanges(characters, worldBookId, binding, updatedAt) {
  const targetIds = new Set(binding.characterIds)
  return characters.flatMap(character => {
    const before = cloneJson(character)
    const currentIds = uniqueIds(character.worldBookIds)
    const shouldInclude = binding.bindingMode === 'global' || targetIds.has(text(character.id))
    const nextIds = shouldInclude
      ? uniqueIds([...currentIds, worldBookId])
      : currentIds.filter(id => id !== worldBookId)
    if (JSON.stringify(currentIds) === JSON.stringify(nextIds)) return []
    return [{
      before,
      after: { ...before, worldBookIds: nextIds, updatedAt }
    }]
  })
}

function rollbackBook(beforeBook, nextBook, timestamp) {
  if (beforeBook) return cloneJson(beforeBook)
  return {
    ...cloneJson(nextBook),
    updatedAt: timestamp,
    deletedAt: timestamp
  }
}

async function persistWithRollback({
  repository,
  beforeBook,
  nextBook,
  changes,
  operation,
  timestamp
}) {
  if (typeof repository.saveWorldBookBundle === 'function') {
    try {
      await repository.saveWorldBookBundle({
        worldBook: cloneJson(nextBook),
        characters: changes.map(change => cloneJson(change.after))
      })
      return
    } catch (cause) {
      throw worldBookManagementError(
        'world_book_write_failed',
        `世界书${operation}失败，本地事务已回滚`,
        {
          cause,
          stage: operation,
          details: { worldBookId: nextBook.id, atomic: true },
          rollbackErrors: []
        }
      )
    }
  }
  const attemptedCharacters = []
  let bookAttempted = false
  try {
    bookAttempted = true
    await repository.saveWorldBook(cloneJson(nextBook))
    for (const change of changes) {
      attemptedCharacters.push(change)
      await repository.saveCharacter(cloneJson(change.after))
    }
  } catch (cause) {
    const rollbackErrors = []
    for (const change of [...attemptedCharacters].reverse()) {
      try {
        await repository.saveCharacter(cloneJson(change.before))
      } catch (error) {
        rollbackErrors.push({ entity: 'character', id: change.before.id, error })
      }
    }
    if (bookAttempted) {
      try {
        await repository.saveWorldBook(rollbackBook(beforeBook, nextBook, timestamp))
      } catch (error) {
        rollbackErrors.push({ entity: 'worldBook', id: nextBook.id, error })
      }
    }
    throw worldBookManagementError(
      'world_book_write_failed',
      `世界书${operation}失败，已尽力恢复原数据`,
      { cause, stage: operation, details: { worldBookId: nextBook.id }, rollbackErrors }
    )
  }
}

async function activeWorldBook(repository, id, stage) {
  const worldBook = await repository.getWorldBook(id)
  if (!worldBook || worldBook.deletedAt) {
    throw worldBookManagementError('world_book_not_found', '世界书不存在或已删除', { stage, details: { worldBookId: id } })
  }
  return cloneJson(worldBook)
}

function updatedWorldBook(previous, normalized, idFactory, timestamp) {
  const previousData = previous.data && typeof previous.data === 'object' ? previous.data : {}
  return {
    ...cloneJson(previous),
    ...bindingFields(normalized),
    name: normalized.name,
    data: {
      ...cloneJson(previousData),
      name: normalized.name,
      description: normalized.description,
      scan_depth: normalized.scan_depth,
      token_budget: normalized.token_budget,
      entries: persistedEntries(normalized.entries, previousData.entries, idFactory)
    },
    updatedAt: timestamp,
    deletedAt: null
  }
}

export function createWorldBookManagementService({
  repository,
  idFactory = createRuntimeId,
  now = () => new Date().toISOString()
} = {}) {
  ensureRepository(repository)
  if (typeof idFactory !== 'function') {
    throw worldBookManagementError('invalid_id_factory', '世界书管理缺少 ID 生成器', { stage: 'prepare' })
  }

  async function list() {
    const books = await repository.listAllWorldBooks()
    return (Array.isArray(books) ? books : [])
      .filter(book => book && !book.deletedAt)
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
      .map(cloneJson)
  }

  async function get(id) {
    const worldBook = await repository.getWorldBook(text(id).trim())
    return worldBook && !worldBook.deletedAt ? cloneJson(worldBook) : null
  }

  async function create(input) {
    const normalized = normalizeWorldBookDraft(input)
    const characters = await activeCharacters(repository)
    assertBoundCharactersExist(normalized, characters)
    const timestamp = timestampValue(now)
    const id = generatedId(idFactory, '世界书')
    if (await repository.getWorldBook(id)) {
      throw worldBookManagementError('duplicate_world_book_id', '世界书 ID 已存在', { stage: 'prepare', details: { worldBookId: id } })
    }
    const worldBook = {
      id,
      ...bindingFields(normalized),
      source: 'manual',
      sourceFormat: 'character-book',
      name: normalized.name,
      data: {
        name: normalized.name,
        description: normalized.description,
        scan_depth: normalized.scan_depth,
        token_budget: normalized.token_budget,
        recursive_scanning: false,
        extensions: {},
        entries: persistedEntries(normalized.entries, [], idFactory)
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null
    }
    const changes = characterChanges(characters, id, normalized, timestamp)
    await persistWithRollback({ repository, beforeBook: null, nextBook: worldBook, changes, operation: '新建', timestamp })
    return { worldBook: cloneJson(worldBook), characters: changes.map(change => cloneJson(change.after)) }
  }

  async function update(id, input) {
    const worldBookId = text(id).trim()
    const normalized = normalizeWorldBookDraft(input)
    const previous = await activeWorldBook(repository, worldBookId, 'update')
    const characters = await activeCharacters(repository)
    assertBoundCharactersExist(normalized, characters)
    const timestamp = timestampValue(now)
    const worldBook = updatedWorldBook(previous, normalized, idFactory, timestamp)
    const changes = characterChanges(characters, worldBookId, normalized, timestamp)
    await persistWithRollback({ repository, beforeBook: previous, nextBook: worldBook, changes, operation: '更新', timestamp })
    return { worldBook: cloneJson(worldBook), characters: changes.map(change => cloneJson(change.after)) }
  }

  async function rebind(id, input) {
    const worldBookId = text(id).trim()
    const binding = normalizeWorldBookBinding(input)
    const previous = await activeWorldBook(repository, worldBookId, 'rebind')
    const characters = await activeCharacters(repository)
    assertBoundCharactersExist(binding, characters)
    const timestamp = timestampValue(now)
    const worldBook = {
      ...cloneJson(previous),
      ...bindingFields(binding),
      updatedAt: timestamp
    }
    const changes = characterChanges(characters, worldBookId, binding, timestamp)
    await persistWithRollback({ repository, beforeBook: previous, nextBook: worldBook, changes, operation: '重新绑定', timestamp })
    return { worldBook: cloneJson(worldBook), characters: changes.map(change => cloneJson(change.after)) }
  }

  async function remove(id) {
    const worldBookId = text(id).trim()
    const previous = await activeWorldBook(repository, worldBookId, 'delete')
    const characters = await activeCharacters(repository)
    const timestamp = timestampValue(now)
    const worldBook = { ...cloneJson(previous), updatedAt: timestamp, deletedAt: timestamp }
    const changes = characterChanges(characters, worldBookId, { bindingMode: 'characters', characterIds: [] }, timestamp)
    await persistWithRollback({ repository, beforeBook: previous, nextBook: worldBook, changes, operation: '删除', timestamp })
    return { worldBook: cloneJson(worldBook), characters: changes.map(change => cloneJson(change.after)) }
  }

  return Object.freeze({
    list,
    get,
    create,
    update,
    rebind,
    remove,
    softDelete: remove
  })
}

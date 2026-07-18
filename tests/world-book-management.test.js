import assert from 'node:assert/strict'
import test from 'node:test'
import {
  WorldBookManagementError,
  WorldBookValidationError,
  createWorldBookDraft,
  createWorldBookManagementService,
  normalizeWorldBookDraft
} from '../src/features/world-book-management/index.js'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function character(id, worldBookIds = []) {
  return {
    id,
    name: id,
    worldBookIds: [...worldBookIds],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    deletedAt: null
  }
}

function existingBook(overrides = {}) {
  return {
    id: 'book-1',
    characterId: null,
    characterIds: ['char-1'],
    scope: 'global',
    source: 'world-book-json',
    sourceFormat: 'character-book',
    name: '旧世界书',
    data: {
      name: '旧世界书',
      description: '旧描述',
      scan_depth: 4,
      token_budget: 2048,
      recursive_scanning: true,
      extensions: { imported: true },
      entries: [{
        id: 'entry-1',
        name: '旧规则',
        comment: '旧规则',
        keys: ['old'],
        secondary_keys: ['secondary'],
        content: '旧内容',
        enabled: true,
        constant: false,
        insertion_order: 50,
        position: 'after_char',
        use_regex: true,
        extensions: { preserved: true }
      }]
    },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides
  }
}

function worldBookDraft(overrides = {}) {
  return {
    name: '月港设定',
    description: '共享世界背景',
    scan_depth: 6,
    token_budget: 900,
    bindingMode: 'characters',
    characterIds: ['char-1', 'char-3'],
    entries: [
      {
        name: '港口',
        keywords: ['harbor', 'moon'],
        content: '港口在午夜关闭。',
        enabled: true,
        constant: false,
        order: 20,
        position: 'before_example'
      },
      {
        name: '货币',
        keywords: [],
        content: '城里使用银币。',
        enabled: true,
        constant: true,
        order: 10,
        position: 'before_char'
      }
    ],
    ...overrides
  }
}

function sequenceId(...ids) {
  let index = 0
  return () => ids[index++] ?? `generated-${index}`
}

function memoryRepository({ characters = [], worldBooks = [], onSave = null } = {}) {
  const characterRecords = new Map(characters.map(value => [value.id, clone(value)]))
  const worldBookRecords = new Map(worldBooks.map(value => [value.id, clone(value)]))
  const calls = []

  async function save(entity, records, value) {
    const payload = clone(value)
    calls.push({ entity, value: clone(payload) })
    await onSave?.({ entity, value: clone(payload), phase: 'before', calls })
    records.set(payload.id, payload)
    await onSave?.({ entity, value: clone(payload), phase: 'after', calls })
    return clone(payload)
  }

  return {
    calls,
    characterRecords,
    worldBookRecords,
    async listCharacters() {
      return [...characterRecords.values()].filter(value => !value.deletedAt).map(clone)
    },
    async listAllWorldBooks() {
      return [...worldBookRecords.values()].filter(value => !value.deletedAt).map(clone)
    },
    async getWorldBook(id) {
      const value = worldBookRecords.get(id)
      return value ? clone(value) : null
    },
    async saveWorldBook(value) {
      return save('worldBook', worldBookRecords, value)
    },
    async saveCharacter(value) {
      return save('character', characterRecords, value)
    }
  }
}

test('validates every editable field and normalizes keyword input', () => {
  const normalized = normalizeWorldBookDraft(worldBookDraft({
    bindingMode: 'global',
    characterIds: ['ignored'],
    entries: [{
      name: '天气',
      keywordsText: ' 雨，风, 雨 ',
      content: '总在下雨。',
      enabled: false,
      constant: false,
      order: 0,
      position: 'after_author_note'
    }]
  }))

  assert.equal(normalized.name, '月港设定')
  assert.equal(normalized.description, '共享世界背景')
  assert.equal(normalized.scan_depth, 6)
  assert.equal(normalized.token_budget, 900)
  assert.equal(normalized.bindingMode, 'global')
  assert.deepEqual(normalized.characterIds, [])
  assert.deepEqual(normalized.entries[0], {
    id: null,
    name: '天气',
    comment: '',
    keys: ['雨', '风'],
    content: '总在下雨。',
    enabled: false,
    constant: false,
    insertion_order: 0,
    position: 'after_author_note'
  })

  assert.throws(() => normalizeWorldBookDraft({
    name: '',
    scan_depth: 0,
    token_budget: 1.5,
    bindingMode: 'characters',
    characterIds: [],
    entries: [{ content: '', order: 1.2, position: 'unknown' }]
  }), error => {
    assert.ok(error instanceof WorldBookValidationError)
    const paths = new Set(error.issues.map(value => value.path))
    for (const path of ['name', 'scan_depth', 'token_budget', 'characterIds', 'entries.0.content', 'entries.0.keywords', 'entries.0.order', 'entries.0.position']) {
      assert.equal(paths.has(path), true, `missing validation issue for ${path}`)
    }
    return true
  })
})

test('creates, reads, and lists a manual world book with multi-character reverse bindings', async () => {
  const repository = memoryRepository({
    characters: [character('char-1'), character('char-2'), character('char-3')]
  })
  const service = createWorldBookManagementService({
    repository,
    idFactory: sequenceId('book-new', 'entry-harbor', 'entry-currency'),
    now: () => '2026-07-18T01:00:00.000Z'
  })

  const result = await service.create(worldBookDraft())

  assert.equal(result.worldBook.id, 'book-new')
  assert.equal(result.worldBook.scope, 'global')
  assert.equal(result.worldBook.characterId, null)
  assert.deepEqual(result.worldBook.characterIds, ['char-1', 'char-3'])
  assert.equal(result.worldBook.source, 'manual')
  assert.equal(result.worldBook.data.description, '共享世界背景')
  assert.equal(result.worldBook.data.scan_depth, 6)
  assert.equal(result.worldBook.data.token_budget, 900)
  assert.deepEqual(result.worldBook.data.entries.map(value => value.id), ['entry-harbor', 'entry-currency'])
  assert.deepEqual(repository.characterRecords.get('char-1').worldBookIds, ['book-new'])
  assert.deepEqual(repository.characterRecords.get('char-2').worldBookIds, [])
  assert.deepEqual(repository.characterRecords.get('char-3').worldBookIds, ['book-new'])
  assert.equal((await service.get('book-new')).name, '月港设定')
  assert.deepEqual((await service.list()).map(value => value.id), ['book-new'])
})

test('updates rules without dropping imported extensions and can switch binding to global', async () => {
  const book = existingBook()
  const repository = memoryRepository({
    characters: [character('char-1', ['book-1']), character('char-2')],
    worldBooks: [book]
  })
  const service = createWorldBookManagementService({
    repository,
    idFactory: sequenceId('entry-new'),
    now: () => '2026-07-18T02:00:00.000Z'
  })
  const draft = createWorldBookDraft(book)
  draft.name = '更新后的世界书'
  draft.description = '更新描述'
  draft.scan_depth = 8
  draft.token_budget = 1200
  draft.bindingMode = 'global'
  draft.entries[0] = { ...draft.entries[0], name: '更新规则', keywordsText: 'new', content: '更新内容', order: 5, position: 'at_depth' }
  draft.entries.push({ name: '新增', keywordsText: '', content: '始终生效', enabled: true, constant: true, order: 1, position: 'before_char' })

  const result = await service.update('book-1', draft)

  assert.equal(result.worldBook.name, '更新后的世界书')
  assert.equal(result.worldBook.scope, 'global')
  assert.deepEqual(result.worldBook.characterIds, [])
  assert.equal(result.worldBook.data.recursive_scanning, true)
  assert.deepEqual(result.worldBook.data.extensions, { imported: true })
  assert.deepEqual(result.worldBook.data.entries[0].extensions, { preserved: true })
  assert.deepEqual(result.worldBook.data.entries[0].secondary_keys, ['secondary'])
  assert.equal(result.worldBook.data.entries[0].comment, book.data.entries[0].comment)
  assert.equal(result.worldBook.data.entries[0].use_regex, true)
  assert.equal(result.worldBook.data.entries[0].content, '更新内容')
  assert.equal(result.worldBook.data.entries[1].id, 'entry-new')
  assert.deepEqual(repository.characterRecords.get('char-1').worldBookIds, ['book-1'])
  assert.deepEqual(repository.characterRecords.get('char-2').worldBookIds, ['book-1'])
})

test('rebind migrates legacy character scope and reconciles stale reverse references', async () => {
  const legacy = existingBook({
    scope: 'character',
    characterId: 'char-1',
    characterIds: []
  })
  const repository = memoryRepository({
    characters: [
      character('char-1', ['book-1']),
      character('char-2'),
      character('char-3', ['book-1'])
    ],
    worldBooks: [legacy]
  })
  const service = createWorldBookManagementService({ repository, now: () => '2026-07-18T03:00:00.000Z' })

  const result = await service.rebind('book-1', { bindingMode: 'characters', characterIds: ['char-1', 'char-2', 'char-2'] })

  assert.equal(result.worldBook.scope, 'global')
  assert.equal(result.worldBook.characterId, null)
  assert.deepEqual(result.worldBook.characterIds, ['char-1', 'char-2'])
  assert.deepEqual(repository.characterRecords.get('char-1').worldBookIds, ['book-1'])
  assert.deepEqual(repository.characterRecords.get('char-2').worldBookIds, ['book-1'])
  assert.deepEqual(repository.characterRecords.get('char-3').worldBookIds, [])
})

test('soft delete hides the book and removes every active reverse binding', async () => {
  const repository = memoryRepository({
    characters: [character('char-1', ['book-1']), character('char-2', ['other', 'book-1'])],
    worldBooks: [existingBook({ characterIds: [] })]
  })
  const service = createWorldBookManagementService({ repository, now: () => '2026-07-18T04:00:00.000Z' })

  const result = await service.remove('book-1')

  assert.equal(result.worldBook.deletedAt, '2026-07-18T04:00:00.000Z')
  assert.equal(await service.get('book-1'), null)
  assert.deepEqual(await service.list(), [])
  assert.deepEqual(repository.characterRecords.get('char-1').worldBookIds, [])
  assert.deepEqual(repository.characterRecords.get('char-2').worldBookIds, ['other'])
})

test('create failure rolls characters back and tombstones a possibly-written world book', async () => {
  let failed = false
  const repository = memoryRepository({
    characters: [character('char-1'), character('char-2')],
    onSave: ({ entity, value, phase }) => {
      if (!failed && entity === 'character' && value.id === 'char-2' && phase === 'before') {
        failed = true
        throw new Error('character write failed')
      }
    }
  })
  const service = createWorldBookManagementService({
    repository,
    idFactory: sequenceId('book-new', 'entry-1'),
    now: () => '2026-07-18T05:00:00.000Z'
  })

  await assert.rejects(service.create(worldBookDraft({
    characterIds: ['char-1', 'char-2'],
    entries: [{ name: '规则', keywords: ['key'], content: 'content', enabled: true, constant: false, order: 1, position: 'after_char' }]
  })), error => {
    assert.ok(error instanceof WorldBookManagementError)
    assert.equal(error.code, 'world_book_write_failed')
    assert.equal(error.rollbackSucceeded, true)
    return true
  })

  assert.deepEqual(repository.characterRecords.get('char-1').worldBookIds, [])
  assert.deepEqual(repository.characterRecords.get('char-2').worldBookIds, [])
  assert.equal(repository.worldBookRecords.get('book-new').deletedAt, '2026-07-18T05:00:00.000Z')
})

test('a write-after-error restores the previous world book snapshot', async () => {
  const original = existingBook()
  let failed = false
  const repository = memoryRepository({
    characters: [character('char-1', ['book-1'])],
    worldBooks: [original],
    onSave: ({ entity, value, phase }) => {
      if (!failed && entity === 'worldBook' && value.id === 'book-1' && value.name === '会失败的更新' && phase === 'after') {
        failed = true
        throw new Error('disk acknowledgement failed')
      }
    }
  })
  const service = createWorldBookManagementService({ repository, now: () => '2026-07-18T06:00:00.000Z' })
  const draft = createWorldBookDraft(original)
  draft.name = '会失败的更新'

  await assert.rejects(service.update('book-1', draft), error => {
    assert.ok(error instanceof WorldBookManagementError)
    assert.equal(error.rollbackSucceeded, true)
    return true
  })

  assert.deepEqual(repository.worldBookRecords.get('book-1'), original)
  assert.deepEqual(repository.characterRecords.get('char-1').worldBookIds, ['book-1'])
})

test('delete failure restores both the book and all attempted character snapshots', async () => {
  const original = existingBook({ characterIds: [] })
  let failed = false
  const repository = memoryRepository({
    characters: [character('char-1', ['book-1']), character('char-2', ['book-1'])],
    worldBooks: [original],
    onSave: ({ entity, value, phase }) => {
      if (!failed && entity === 'character' && value.id === 'char-2' && phase === 'before') {
        failed = true
        throw new Error('character delete binding failed')
      }
    }
  })
  const service = createWorldBookManagementService({ repository, now: () => '2026-07-18T07:00:00.000Z' })

  await assert.rejects(service.remove('book-1'), error => {
    assert.ok(error instanceof WorldBookManagementError)
    assert.equal(error.rollbackSucceeded, true)
    return true
  })

  assert.deepEqual(repository.worldBookRecords.get('book-1'), original)
  assert.deepEqual(repository.characterRecords.get('char-1').worldBookIds, ['book-1'])
  assert.deepEqual(repository.characterRecords.get('char-2').worldBookIds, ['book-1'])
})

test('reports rollback failures while continuing to restore other entities', async () => {
  let primaryFailureRaised = false
  const repository = memoryRepository({
    characters: [character('char-1'), character('char-2')],
    onSave: ({ entity, value, phase }) => {
      if (!primaryFailureRaised && entity === 'character' && value.id === 'char-2' && phase === 'before') {
        primaryFailureRaised = true
        throw new Error('primary write failed')
      }
      if (primaryFailureRaised && entity === 'character' && value.id === 'char-1' && value.worldBookIds.length === 0 && phase === 'before') {
        throw new Error('rollback write failed')
      }
    }
  })
  const service = createWorldBookManagementService({
    repository,
    idFactory: sequenceId('book-new', 'entry-1'),
    now: () => '2026-07-18T08:00:00.000Z'
  })

  await assert.rejects(service.create(worldBookDraft({
    characterIds: ['char-1', 'char-2'],
    entries: [{ name: '规则', keywords: ['key'], content: 'content', enabled: true, constant: false, order: 1, position: 'after_char' }]
  })), error => {
    assert.ok(error instanceof WorldBookManagementError)
    assert.equal(error.rollbackSucceeded, false)
    assert.equal(error.rollbackErrors.length, 1)
    assert.equal(error.rollbackErrors[0].entity, 'character')
    assert.equal(error.rollbackErrors[0].id, 'char-1')
    return true
  })

  assert.deepEqual(repository.characterRecords.get('char-2').worldBookIds, [])
  assert.equal(repository.worldBookRecords.get('book-new').deletedAt, '2026-07-18T08:00:00.000Z')
})

test('rejects missing target characters before performing any write', async () => {
  const repository = memoryRepository({ characters: [character('char-1')] })
  const service = createWorldBookManagementService({ repository, idFactory: sequenceId('book-new') })

  await assert.rejects(service.create(worldBookDraft({ characterIds: ['missing'] })), error => {
    assert.ok(error instanceof WorldBookManagementError)
    assert.equal(error.code, 'missing_world_book_character')
    return true
  })
  assert.equal(repository.calls.length, 0)
})

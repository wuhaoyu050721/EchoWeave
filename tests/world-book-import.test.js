import assert from 'node:assert/strict'
import test from 'node:test'
import { commitWorldBookImport, inspectWorldBook } from '../src/features/world-book-import/importWorldBook.js'

function jsonFile(name, value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }
}

test('normalizes a SillyTavern object-entry world book', async () => {
  const preview = await inspectWorldBook(jsonFile('City.JSON', {
    name: 'City Lore',
    scanDepth: 6,
    tokenBudget: 900,
    entries: {
      12: {
        uid: 12,
        key: ['harbor'],
        keysecondary: ['night', 'fog'],
        content: 'The harbor closes at midnight.',
        selective: true,
        selectiveLogic: 3,
        order: 42,
        position: 2,
        probability: 65,
        useProbability: true,
        caseSensitive: true,
        matchWholeWords: true,
        disable: false
      },
      13: { uid: 13, key: [], content: 'The city uses silver coins.', constant: true, position: 0 }
    }
  }))

  assert.equal(preview.source.format, 'sillytavern')
  assert.equal(preview.worldBook.name, 'City Lore')
  assert.equal(preview.worldBook.entryCount, 2)
  assert.equal(preview.worldBook.constantEntryCount, 1)
  assert.equal(preview.worldBook.scanDepth, 6)
  assert.equal(preview.worldBook.tokenBudget, 900)
  const entry = preview.commitData.data.entries[0]
  assert.deepEqual(entry.keys, ['harbor'])
  assert.deepEqual(entry.secondary_keys, ['night', 'fog'])
  assert.equal(entry.selective_logic, 3)
  assert.equal(entry.insertion_order, 42)
  assert.equal(entry.position, 'before_example')
  assert.equal(entry.probability, 65)
  assert.equal(entry.case_sensitive, true)
  assert.equal(entry.match_whole_words, true)
})

test('accepts Character Book arrays and preserves unknown extensions without executing them', async () => {
  const preview = await inspectWorldBook(jsonFile('book.json', {
    name: 'Character Book',
    entries: [{
      id: 'one', keys: ['hello'], secondary_keys: [], content: 'Known content', enabled: true,
      insertion_order: 5, position: 'after_char', script: 'neverRun()'
    }]
  }))

  assert.equal(preview.source.format, 'character-book')
  assert.equal(preview.requiresSensitiveExtensionConfirmation, true)
  assert.match(preview.unsafeExtensions[0], /script/)
  assert.equal(preview.commitData.data.entries[0].extensions.imported_fields.script, 'neverRun()')
})

test('rejects malformed, oversized, and non-json world book inputs', async () => {
  await assert.rejects(inspectWorldBook({ name: 'book.txt', text: async () => '{}' }), /\.json/)
  await assert.rejects(inspectWorldBook('{broken'), /JSON/)
  await assert.rejects(inspectWorldBook(jsonFile('book.json', { entries: [] }), { limits: { maxJsonBytes: 2 } }), /5 MB/)
})

test('commits a global world book with multiple validated character bindings', async () => {
  const preview = await inspectWorldBook(jsonFile('book.json', {
    name: 'Shared Lore',
    entries: [{ keys: ['moon'], content: 'The moon is red.', enabled: true }]
  }))
  let saved = null
  const characters = new Map([
    ['char-1', { id: 'char-1', worldBookIds: [] }],
    ['char-2', { id: 'char-2', worldBookIds: ['existing'] }]
  ])
  const repository = {
    getCharacter: async id => characters.get(id) || null,
    getWorldBook: async () => null,
    listCharacters: async () => [...characters.values()],
    saveWorldBookBundle: async value => { saved = value }
  }
  const result = await commitWorldBookImport(preview, {
    repository,
    characterIds: ['char-1', 'char-2', 'char-1'],
    idFactory: () => 'book-new',
    now: () => '2026-07-16T00:00:00.000Z'
  })

  assert.deepEqual(result.worldBook, saved.worldBook)
  assert.equal(saved.worldBook.id, 'book-new')
  assert.equal(saved.worldBook.scope, 'global')
  assert.equal(saved.worldBook.characterId, null)
  assert.deepEqual(saved.worldBook.characterIds, ['char-1', 'char-2'])
  assert.equal(saved.worldBook.data.entries.length, 1)
  assert.deepEqual(saved.characters.find(character => character.id === 'char-1').worldBookIds, ['book-new'])
  assert.deepEqual(saved.characters.find(character => character.id === 'char-2').worldBookIds, ['existing', 'book-new'])
})

test('requires risk confirmation and rejects missing character bindings before writing', async () => {
  const preview = await inspectWorldBook(jsonFile('book.json', {
    entries: [{ keys: [], content: 'Always', constant: true, scripts: ['never'] }]
  }))
  let writes = 0
  const repository = {
    getCharacter: async () => null,
    getWorldBook: async () => null,
    listCharacters: async () => [],
    saveCharacter: async () => { writes += 1 },
    saveWorldBook: async () => { writes += 1 }
  }

  await assert.rejects(commitWorldBookImport(preview, { repository }), /确认/)
  await assert.rejects(commitWorldBookImport(preview, {
    repository,
    characterIds: ['missing'],
    allowSensitiveExtensions: true
  }), /不存在/)
  assert.equal(writes, 0)
})

test('rolls back standalone world-book reverse bindings when a fallback write fails', async () => {
  const preview = await inspectWorldBook(jsonFile('book.json', {
    name: 'Rollback Lore',
    entries: [{ keys: ['moon'], content: 'Moon lore', enabled: true }]
  }))
  const characters = new Map([
    ['char-1', { id: 'char-1', worldBookIds: [], updatedAt: 'old' }],
    ['char-2', { id: 'char-2', worldBookIds: ['existing'], updatedAt: 'old' }]
  ])
  let savedBook = null
  let failed = false
  const repository = {
    getCharacter: async id => structuredClone(characters.get(id)),
    getWorldBook: async () => null,
    listCharacters: async () => [...characters.values()].map(value => structuredClone(value)),
    saveWorldBook: async value => { savedBook = structuredClone(value) },
    saveCharacter: async value => {
      if (!failed && value.id === 'char-2' && value.worldBookIds.includes('book-rollback')) {
        failed = true
        throw new Error('disk full')
      }
      characters.set(value.id, structuredClone(value))
    }
  }

  await assert.rejects(commitWorldBookImport(preview, {
    repository,
    characterIds: ['char-1', 'char-2'],
    idFactory: () => 'book-rollback',
    now: () => '2026-07-18T01:00:00.000Z'
  }), error => error.code === 'world_book_import_commit_failed')

  assert.deepEqual(characters.get('char-1').worldBookIds, [])
  assert.deepEqual(characters.get('char-2').worldBookIds, ['existing'])
  assert.equal(savedBook.deletedAt, '2026-07-18T01:00:00.000Z')
  assert.equal(savedBook.deletionReason, 'world-book-import-rollback')
})

test('rejects a colliding standalone world-book id before writing', async () => {
  const preview = await inspectWorldBook(jsonFile('book.json', {
    name: 'Existing Lore',
    entries: [{ keys: ['moon'], content: 'Moon lore', enabled: true }]
  }))
  let writes = 0
  const repository = {
    getCharacter: async () => ({ id: 'char-1', worldBookIds: [] }),
    getWorldBook: async id => id === 'book-existing' ? { id } : null,
    saveWorldBookBundle: async () => { writes += 1 }
  }

  await assert.rejects(commitWorldBookImport(preview, {
    repository,
    characterIds: ['char-1'],
    idFactory: () => 'book-existing'
  }), error => error.code === 'duplicate_world_book_id')
  assert.equal(writes, 0)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { PlusSqliteRepository } from '../src/platform/app/plus-sqlite-repository.js'
import { createNodePlusSqlite } from './helpers/node-plus-sqlite.js'

async function setup({ sqlite = createNodePlusSqlite(), databaseName = `test-${crypto.randomUUID()}` } = {}) {
  const repository = new PlusSqliteRepository({
    sqlite,
    databaseName,
    databasePath: '_doc/test.db'
  })
  await repository.init()
  return repository
}

function executeSql(sqlite, name, sql) {
  return new Promise((resolve, reject) => sqlite.executeSql({ name, sql, success: resolve, fail: reject }))
}

function encodedSqlText(value) {
  return `'${encodeURIComponent(JSON.stringify(value)).replace(/'/g, "''")}'`
}

test('applies schema migrations once and persists Unicode with quotes', async () => {
  const repository = await setup()
  await repository.init()
  await repository.saveProvider({
    id: 'p1', name: "测试 '接口'", updatedAt: '2026-07-14T01:00:00.000Z', deletedAt: null
  })

  assert.equal((await repository.getProvider('p1')).name, "测试 '接口'")
  assert.deepEqual(await repository.getAppliedMigrations(), [1, 2, 3, 4])
  await repository.close()
})

test('chunks large character records below the Android CursorWindow cell limit', async () => {
  const sqlite = createNodePlusSqlite({
    persistOnClose: true,
    maxCursorCellCharacters: 300 * 1024
  })
  const databaseName = `test-${crypto.randomUUID()}`
  let repository = await setup({ sqlite, databaseName })
  const largeText = 'A'.repeat(700 * 1024)
  const character = {
    id: 'char-large', name: 'Large', description: largeText, sourceHash: 'large-hash',
    avatarAssetId: 'asset-large', worldBookIds: ['book-large'], assetIds: ['asset-large'],
    updatedAt: '2026-07-22T00:00:00.000Z', deletedAt: null
  }
  const worldBook = {
    id: 'book-large', characterId: 'char-large', scope: 'character', name: 'Large book',
    data: { entries: [{ keys: ['large'], content: largeText }] },
    updatedAt: '2026-07-22T00:00:00.000Z', deletedAt: null
  }
  const asset = {
    id: 'asset-large', characterId: 'char-large', type: 'icon',
    dataUrl: `data:image/png;base64,${largeText}`,
    createdAt: '2026-07-22T00:00:00.000Z', deletedAt: null
  }

  await repository.importCharacterBundle({ character, worldBooks: [worldBook], characterAssets: [asset] })
  assert.equal((await repository.listCharacters())[0].description.length, largeText.length)
  assert.equal((await repository.listWorldBooks({ characterId: character.id }))[0].data.entries[0].content.length, largeText.length)
  assert.equal((await repository.getCharacterAsset(asset.id)).dataUrl.length, asset.dataUrl.length)

  await repository.close()
  repository = await setup({ sqlite, databaseName })
  const backup = await repository.readBackupData()
  assert.equal(backup.characters[0].description, largeText)
  assert.equal(backup.worldBooks[0].data.entries[0].content, largeText)
  assert.equal(backup.characterAssets[0].dataUrl, asset.dataUrl)

  const updatedCharacter = { ...character, nickname: 'Synced large record' }
  const applied = await repository.importRecordsIfUnchanged({
    entityType: 'characters',
    entityId: character.id,
    expectedSnapshot: { exists: true, value: character },
    records: { characters: [updatedCharacter] }
  })
  assert.equal(applied, true)
  assert.equal((await repository.getCharacter(character.id)).nickname, 'Synced large record')
  await repository.close()
  sqlite.closeAll()
})

test('repairs legacy oversized character rows during startup before they reach CursorWindow', async () => {
  const sqlite = createNodePlusSqlite({
    persistOnClose: true,
    maxCursorCellCharacters: 300 * 1024
  })
  const databaseName = `test-${crypto.randomUUID()}`
  let repository = await setup({ sqlite, databaseName })
  const legacy = {
    id: 'legacy-large', name: 'Legacy large', description: '旧'.repeat(100 * 1024),
    sourceHash: 'legacy-hash', avatarAssetId: 'legacy-asset',
    worldBookIds: ['legacy-book'], assetIds: ['legacy-asset'],
    updatedAt: '2026-07-21T00:00:00.000Z', deletedAt: null
  }
  const legacyBook = {
    id: 'legacy-book', characterId: legacy.id, scope: 'character', name: 'Legacy book',
    data: { entries: [{ keys: ['legacy'], content: '书'.repeat(100 * 1024) }] },
    updatedAt: '2026-07-21T00:00:00.000Z', deletedAt: null
  }
  const legacyAsset = {
    id: 'legacy-asset', characterId: legacy.id, type: 'icon',
    dataUrl: `data:image/png;base64,${'A'.repeat(700 * 1024)}`,
    createdAt: '2026-07-21T00:00:00.000Z', deletedAt: null
  }
  await executeSql(sqlite, databaseName, `INSERT OR REPLACE INTO characters (id, source_hash, updated_at, deleted_at, payload) VALUES ('legacy-large', 'legacy-hash', '2026-07-21T00:00:00.000Z', NULL, ${encodedSqlText(legacy)})`)
  await executeSql(sqlite, databaseName, `INSERT OR REPLACE INTO world_books (id, character_id, scope, updated_at, deleted_at, payload) VALUES ('legacy-book', 'legacy-large', 'character', '2026-07-21T00:00:00.000Z', NULL, ${encodedSqlText(legacyBook)})`)
  await executeSql(sqlite, databaseName, `INSERT OR REPLACE INTO character_assets (id, character_id, created_at, payload) VALUES ('legacy-asset', 'legacy-large', '2026-07-21T00:00:00.000Z', ${encodedSqlText(legacyAsset)})`)
  await repository.close()

  repository = await setup({ sqlite, databaseName })
  const restored = await repository.getCharacter(legacy.id)
  assert.deepEqual(restored, legacy)
  assert.deepEqual((await repository.listCharacters()).map(value => value.id), [legacy.id])
  assert.deepEqual((await repository.listWorldBooks({ characterId: legacy.id })).map(value => value.id), [legacyBook.id])
  assert.equal((await repository.getCharacterAsset(legacyAsset.id)).dataUrl, legacyAsset.dataUrl)
  await repository.close()
  sqlite.closeAll()
})

test('stores providers and sorts conversations by recent activity', async () => {
  const repository = await setup()
  await repository.saveProvider({ id: 'p1', name: 'One', updatedAt: '2026-07-14T00:00:00.000Z' })
  await repository.saveConversation({ id: 'c1', title: 'Old', lastMessageAt: '2026-07-14T00:00:00.000Z' })
  await repository.saveConversation({ id: 'c2', title: 'New', lastMessageAt: '2026-07-14T02:00:00.000Z' })

  assert.equal((await repository.listProviders())[0].name, 'One')
  assert.deepEqual((await repository.listConversations()).map((item) => item.id), ['c2', 'c1'])
  await repository.close()
})

test('writes message pairs in order and deletes messages with their conversation', async () => {
  const repository = await setup()
  await repository.saveConversation({ id: 'c1', title: 'Delete me', lastMessageAt: '2026-07-14T00:00:00.000Z' })
  await repository.createMessagePair(
    { id: 'm1', conversationId: 'c1', sequence: 1, role: 'user', content: 'Hi', status: 'completed', attachmentIds: ['a1'] },
    { id: 'm2', conversationId: 'c1', sequence: 2, role: 'assistant', content: 'Hello', status: 'completed' },
    [{ id: 'a1', conversationId: 'c1', messageId: 'm1', kind: 'image', name: 'photo.jpg', dataUrl: 'data:image/jpeg;base64,AA==', byteSize: 1 }]
  )

  assert.deepEqual((await repository.listMessages('c1')).map((item) => item.id), ['m1', 'm2'])
  assert.deepEqual((await repository.listMessageAttachments('m1')).map((item) => item.id), ['a1'])
  await repository.deleteConversation('c1')
  assert.equal((await repository.listConversations()).length, 0)
  assert.equal((await repository.listMessages('c1')).length, 0)
  assert.equal((await repository.listConversationAttachments('c1')).length, 0)
  await repository.close()
})

test('recovers generating messages and stores settings and opaque secrets', async () => {
  const repository = await setup()
  await repository.saveMessage({
    id: 'm1', conversationId: 'c1', sequence: 1, role: 'assistant', content: 'partial', status: 'generating'
  })
  await repository.setSetting('appearance', { theme: 'light' })
  await repository.setSecret('native-reference', { alias: 'opaque' })

  assert.equal(await repository.recoverGeneratingMessages('2026-07-14T03:00:00.000Z'), 1)
  assert.equal((await repository.getMessage('m1')).status, 'interrupted')
  assert.deepEqual(await repository.getSetting('appearance'), { theme: 'light' })
  assert.deepEqual(await repository.getSecret('native-reference'), { alias: 'opaque' })
  await repository.close()
})

test('imports backup records atomically and returns non-secret backup data', async () => {
  const repository = await setup()
  await repository.importRecords({
    providers: [{ id: 'p1', name: 'Imported', updatedAt: '2026-07-14T00:00:00.000Z' }],
    conversations: [{ id: 'c1', title: 'Imported chat', lastMessageAt: '2026-07-14T00:00:00.000Z' }],
    messages: [{ id: 'm1', conversationId: 'c1', sequence: 1, role: 'user', content: 'Imported', attachmentIds: ['a1'] }],
    attachments: [{ id: 'a1', conversationId: 'c1', messageId: 'm1', kind: 'text', name: 'data.json', textContent: '{}', byteSize: 2 }],
    settings: { app: { appLockEnabled: false } }
  })
  await repository.setSecret('not-in-backup', { hidden: true })

  const backup = await repository.readBackupData()
  assert.equal(backup.providers.length, 1)
  assert.equal(backup.conversations.length, 1)
  assert.equal(backup.messages.length, 1)
  assert.equal(backup.attachments.length, 1)
  assert.deepEqual(backup.settings.app, { appLockEnabled: false })
  assert.equal('secrets' in backup, false)
  await repository.close()
})

test('imports a character bundle atomically and exposes it to backup', async () => {
  const repository = await setup()
  await repository.importCharacterBundle({
    character: { id: 'char-1', name: '苏墨', sourceHash: 'hash-1', avatarAssetId: 'asset-1', updatedAt: '2026-07-16T00:00:00.000Z' },
    worldBooks: [{ id: 'book-1', characterId: 'char-1', scope: 'character', name: '世界书', data: { entries: [] } }],
    characterAssets: [{ id: 'asset-1', characterId: 'char-1', type: 'icon', dataUrl: 'data:image/png;base64,AA==', createdAt: '2026-07-16T00:00:00.000Z' }]
  })

  assert.equal((await repository.listCharacters())[0].name, '苏墨')
  assert.equal((await repository.findCharactersBySourceHash('hash-1')).length, 1)
  assert.equal((await repository.listWorldBooks({ characterId: 'char-1' })).length, 1)
  assert.equal((await repository.listCharacterAssets('char-1')).length, 1)
  const backup = await repository.readBackupData()
  assert.equal(backup.characters.length, 1)
  assert.equal(backup.worldBooks.length, 1)
  assert.equal(backup.characterAssets.length, 1)
  await repository.close()
})

test('saves a world book and reverse character bindings transactionally', async () => {
  const repository = await setup()
  await repository.saveCharacter({ id: 'char-1', name: 'One', worldBookIds: [], deletedAt: null })
  await repository.saveCharacter({ id: 'char-2', name: 'Two', worldBookIds: [], deletedAt: null })
  await repository.saveWorldBookBundle({
    worldBook: {
      id: 'book-1', name: 'Selected', scope: 'global', characterId: null,
      characterIds: ['char-1'], data: { entries: [] }, deletedAt: null
    },
    characters: [{ id: 'char-1', name: 'One', worldBookIds: ['book-1'], deletedAt: null }]
  })

  assert.deepEqual((await repository.getCharacter('char-1')).worldBookIds, ['book-1'])
  assert.deepEqual((await repository.getCharacter('char-2')).worldBookIds, [])
  assert.deepEqual((await repository.listWorldBooks({ characterId: 'char-1', includeGlobal: true })).map(book => book.id), ['book-1'])
  assert.deepEqual(await repository.listWorldBooks({ characterId: 'char-2', includeGlobal: true }), [])
  await repository.close()
})

test('conditionally imports a sync record only while its local snapshot is unchanged', async () => {
  const repository = await setup()
  const baseline = { id: 'p-race', name: 'Baseline', updatedAt: '2026-07-18T01:00:00.000Z' }
  const localEdit = { ...baseline, name: 'Local edit', updatedAt: '2026-07-18T02:00:00.000Z' }
  const remoteEdit = { ...baseline, name: 'Remote edit', updatedAt: '2026-07-18T03:00:00.000Z' }
  await repository.saveProvider(baseline)
  await repository.saveProvider(localEdit)

  const staleApply = await repository.importRecordsIfUnchanged({
    entityType: 'providers',
    entityId: baseline.id,
    expectedSnapshot: { exists: true, value: baseline },
    records: { providers: [remoteEdit] }
  })
  assert.equal(staleApply, false)
  assert.equal((await repository.getProvider(baseline.id)).name, 'Local edit')

  const currentApply = await repository.importRecordsIfUnchanged({
    entityType: 'providers',
    entityId: baseline.id,
    expectedSnapshot: { exists: true, value: localEdit },
    records: { providers: [remoteEdit] }
  })
  assert.equal(currentApply, true)
  assert.equal((await repository.getProvider(baseline.id)).name, 'Remote edit')
  await repository.close()
})

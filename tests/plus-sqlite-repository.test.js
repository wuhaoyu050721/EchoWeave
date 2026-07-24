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

function selectSql(sqlite, name, sql) {
  return new Promise((resolve, reject) => sqlite.selectSql({ name, sql, success: resolve, fail: reject }))
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
  assert.deepEqual(await repository.getAppliedMigrations(), [1, 2, 3, 4, 5])
  await repository.close()
})

test('chunks large character records below the Android CursorWindow cell limit', async () => {
  const sqlite = createNodePlusSqlite({
    persistOnClose: true,
    maxCursorCellCharacters: 300 * 1024,
    maxCursorWindowCharacters: 300 * 1024
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

test('chunks large character greetings and chat attachments below the Android CursorWindow limit', async () => {
  const sqlite = createNodePlusSqlite({
    persistOnClose: true,
    maxCursorCellCharacters: 300 * 1024,
    maxCursorWindowCharacters: 300 * 1024
  })
  const databaseName = `test-${crypto.randomUUID()}`
  let repository = await setup({ sqlite, databaseName })
  const conversation = {
    id: 'large-chat', title: 'Large greeting', lastMessageAt: '2026-07-23T00:00:00.000Z'
  }
  const greeting = {
    id: 'large-greeting', conversationId: conversation.id, sequence: 1, role: 'assistant',
    content: '问'.repeat(100 * 1024), status: 'completed', attachmentIds: ['large-attachment'],
    createdAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z'
  }
  const attachment = {
    id: 'large-attachment', conversationId: conversation.id, messageId: greeting.id,
    kind: 'image', name: 'large.png', mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${'A'.repeat(700 * 1024)}`, byteSize: 525 * 1024,
    createdAt: '2026-07-23T00:00:00.000Z', deletedAt: null
  }

  await repository.createConversationWithInitialMessage(conversation, greeting)
  await repository.saveAttachments([attachment])
  assert.equal((await repository.listMessages(conversation.id))[0].content.length, greeting.content.length)
  assert.equal((await repository.getMessage(greeting.id)).content, greeting.content)
  assert.equal((await repository.listMessageAttachments(greeting.id))[0].dataUrl.length, attachment.dataUrl.length)
  assert.equal((await repository.getAttachment(attachment.id)).dataUrl, attachment.dataUrl)

  await repository.close()
  repository = await setup({ sqlite, databaseName })
  const backup = await repository.readBackupData()
  assert.equal(backup.messages[0].content, greeting.content)
  assert.equal(backup.attachments[0].dataUrl, attachment.dataUrl)

  await repository.deleteConversation(conversation.id)
  const chunkRows = await selectSql(
    sqlite,
    databaseName,
    "SELECT COUNT(*) AS count FROM payload_chunks WHERE entity_table IN ('messages', 'attachments')"
  )
  assert.equal(Number(chunkRows[0].count), 0)
  await repository.close()
  sqlite.closeAll()
})

test('reads large Android conversations through bounded message pages', async () => {
  const repository = await setup()
  await repository.saveMessages(Array.from({ length: 75 }, (_, index) => ({
    id: `page-message-${index + 1}`,
    conversationId: 'paged-chat',
    sequence: index + 1,
    role: index % 2 ? 'assistant' : 'user',
    content: `message ${index + 1}`,
    status: 'completed',
    deletedAt: null
  })))

  const latest = await repository.listMessagePage('paged-chat', { limit: 10 })
  const older = await repository.listMessagePage('paged-chat', { beforeSequence: 66, limit: 10 })
  const beginning = await repository.listMessagePage('paged-chat', { beforeSequence: 6, limit: 10 })

  assert.deepEqual(latest.messages.map(message => message.sequence), [66, 67, 68, 69, 70, 71, 72, 73, 74, 75])
  assert.equal(latest.hasMore, true)
  assert.deepEqual(older.messages.map(message => message.sequence), [56, 57, 58, 59, 60, 61, 62, 63, 64, 65])
  assert.equal(older.hasMore, true)
  assert.deepEqual(beginning.messages.map(message => message.sequence), [1, 2, 3, 4, 5])
  assert.equal(beginning.hasMore, false)
  await repository.close()
})

test('reads conversation preview messages in CursorWindow-safe batches', async () => {
  const sqlite = createNodePlusSqlite({
    maxCursorCellBytes: 300 * 1024,
    maxCursorWindowBytes: 1100 * 1024
  })
  const repository = await setup({ sqlite })
  const largePreview = 'P'.repeat(220 * 1024)
  await repository.saveMessages(Array.from({ length: 18 }, (_, index) => ({
    id: `preview-message-${index + 1}`,
    conversationId: `preview-chat-${Math.floor(index / 2) + 1}`,
    sequence: (index % 2) + 1,
    role: index % 2 ? 'assistant' : 'user',
    content: index % 2 ? largePreview : `user ${index + 1}`,
    status: 'completed',
    deletedAt: null
  })))

  const latest = await repository.listLatestMessages(
    Array.from({ length: 9 }, (_, index) => `preview-chat-${index + 1}`)
  )

  assert.equal(latest.length, 9)
  assert.deepEqual(latest.map(message => message.sequence), Array(9).fill(2))
  await repository.close()
  sqlite.closeAll()
})

test('chunks provider conversation setting and cloud sync state payloads', async () => {
  const sqlite = createNodePlusSqlite({
    persistOnClose: true,
    maxCursorCellCharacters: 300 * 1024,
    maxCursorWindowCharacters: 300 * 1024
  })
  const databaseName = `test-${crypto.randomUUID()}`
  let repository = await setup({ sqlite, databaseName })
  const largeText = 'S'.repeat(700 * 1024)
  const provider = {
    id: 'large-provider', name: 'Large provider', defaultModel: 'large-model',
    modelsCache: [largeText], updatedAt: '2026-07-23T00:00:00.000Z', deletedAt: null
  }
  const conversation = {
    id: 'large-conversation', title: 'Large conversation', metadata: largeText,
    lastMessageAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z', deletedAt: null
  }
  const setting = { enabled: true, encryptedValue: largeText }
  const syncState = { version: 1, cursor: 1, manifest: { large: largeText }, pending: [] }

  await repository.saveProvider(provider)
  await repository.saveConversation(conversation)
  await repository.setSetting('large-setting', setting)
  await repository.setSecret('cloud-sync-state-v1:account', syncState)
  await repository.close()

  repository = await setup({ sqlite, databaseName })
  assert.equal((await repository.listProviders())[0].modelsCache[0], largeText)
  assert.equal((await repository.getConversation(conversation.id)).metadata, largeText)
  assert.equal((await repository.getSetting('large-setting')).encryptedValue, largeText)
  assert.equal((await repository.getSecret('cloud-sync-state-v1:account')).manifest.large, largeText)
  const backup = await repository.readBackupData()
  assert.equal(backup.providers[0].modelsCache[0], largeText)
  assert.equal(backup.conversations[0].metadata, largeText)
  assert.equal(backup.settings['large-setting'].encryptedValue, largeText)

  await repository.deleteProvider(provider.id)
  await repository.deleteConversation(conversation.id)
  await repository.setSetting('large-setting', { enabled: false })
  await repository.setSecret('cloud-sync-state-v1:account', null)
  const chunkRows = await selectSql(
    sqlite,
    databaseName,
    "SELECT COUNT(*) AS count FROM payload_chunks WHERE entity_table IN ('providers', 'conversations', 'settings', 'secrets')"
  )
  assert.equal(Number(chunkRows[0].count), 0)
  await repository.close()
  sqlite.closeAll()
})

test('keeps every payload table below the CursorWindow byte cap across restart backup and overwrite', async () => {
  const sqlite = createNodePlusSqlite({
    persistOnClose: true,
    maxCursorCellCharacters: 300 * 1024,
    maxCursorWindowCharacters: 300 * 1024,
    maxCursorCellBytes: 300 * 1024,
    maxCursorWindowBytes: 300 * 1024
  })
  const databaseName = `test-${crypto.randomUUID()}`
  let repository = await setup({ sqlite, databaseName })
  const largeText = `${"引号'%\n界😀".repeat(40 * 1024)}-tail`
  const timestamp = '2026-07-23T08:00:00.000Z'
  const provider = {
    id: 'matrix-provider', name: 'Matrix', modelsCache: [largeText],
    updatedAt: timestamp, deletedAt: null
  }
  const conversation = {
    id: 'matrix-conversation', title: 'Matrix chat', metadata: largeText,
    lastMessageAt: timestamp, updatedAt: timestamp, deletedAt: null
  }
  const messages = [1, 2].map(sequence => ({
    id: `matrix-message-${sequence}`, conversationId: conversation.id, sequence,
    role: sequence === 1 ? 'user' : 'assistant', content: largeText,
    status: 'completed', attachmentIds: sequence === 1 ? ['matrix-attachment'] : [],
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null
  }))
  const attachment = {
    id: 'matrix-attachment', conversationId: conversation.id, messageId: messages[0].id,
    kind: 'text', name: 'matrix.txt', textContent: largeText, byteSize: Buffer.byteLength(largeText),
    createdAt: timestamp, deletedAt: null
  }
  const character = {
    id: 'matrix-character', name: 'Matrix character', description: largeText,
    sourceHash: 'matrix-hash', avatarAssetId: 'matrix-asset',
    worldBookIds: ['matrix-book'], assetIds: ['matrix-asset'],
    updatedAt: timestamp, deletedAt: null
  }
  const worldBook = {
    id: 'matrix-book', characterId: character.id, scope: 'character', name: 'Matrix book',
    data: { entries: [{ keys: ['matrix'], content: largeText }] },
    updatedAt: timestamp, deletedAt: null
  }
  const asset = {
    id: 'matrix-asset', characterId: character.id, type: 'icon',
    dataUrl: `data:image/png;base64,${largeText}`, createdAt: timestamp, deletedAt: null
  }

  await repository.saveProvider(provider)
  await repository.saveConversation(conversation)
  await repository.saveMessages(messages)
  await repository.saveAttachments([attachment])
  await repository.setSetting('matrix-setting', { value: largeText })
  await repository.setSecret('matrix-secret', { value: largeText })
  await repository.importCharacterBundle({
    character,
    worldBooks: [worldBook],
    characterAssets: [asset]
  })

  const chunkedTables = await selectSql(
    sqlite,
    databaseName,
    'SELECT entity_table, COUNT(*) AS count FROM payload_chunks GROUP BY entity_table ORDER BY entity_table'
  )
  assert.deepEqual(chunkedTables.map(row => row.entity_table), [
    'attachments',
    'character_assets',
    'characters',
    'conversations',
    'messages',
    'providers',
    'secrets',
    'settings',
    'world_books'
  ])
  assert.ok(chunkedTables.every(row => Number(row.count) > 1))

  await repository.close()
  repository = await setup({ sqlite, databaseName })
  assert.equal((await repository.listMessages(conversation.id)).length, 2)
  assert.equal((await repository.listMessages(conversation.id))[1].content, largeText)
  assert.equal((await repository.getSecret('matrix-secret')).value, largeText)
  const backup = await repository.readBackupData()
  assert.equal(backup.providers[0].modelsCache[0], largeText)
  assert.equal(backup.conversations[0].metadata, largeText)
  assert.equal(backup.messages[1].content, largeText)
  assert.equal(backup.attachments[0].textContent, largeText)
  assert.equal(backup.characters[0].description, largeText)
  assert.equal(backup.worldBooks[0].data.entries[0].content, largeText)
  assert.equal(backup.characterAssets[0].dataUrl, asset.dataUrl)
  assert.equal(backup.settings['matrix-setting'].value, largeText)

  const smallCharacter = {
    id: character.id, name: character.name, sourceHash: character.sourceHash,
    worldBookIds: [worldBook.id], assetIds: [asset.id], updatedAt: timestamp, deletedAt: null
  }
  await repository.saveProvider({ id: provider.id, name: provider.name, updatedAt: timestamp, deletedAt: null })
  await repository.saveConversation({ id: conversation.id, title: conversation.title, lastMessageAt: timestamp, deletedAt: null })
  await repository.saveMessages(messages.map(message => ({ ...message, content: 'small' })))
  await repository.saveAttachments([{ ...attachment, textContent: 'small', byteSize: 5 }])
  await repository.setSetting('matrix-setting', { value: 'small' })
  await repository.setSecret('matrix-secret', { value: 'small' })
  await repository.saveWorldBook({ ...worldBook, data: { entries: [] } })
  await repository.importCharacterBundle({
    character: smallCharacter,
    characterAssets: [{ ...asset, dataUrl: 'data:image/png;base64,AA==' }]
  })

  const remainingChunks = await selectSql(sqlite, databaseName, 'SELECT COUNT(*) AS count FROM payload_chunks')
  assert.equal(Number(remainingChunks[0].count), 0)
  await repository.close()
  sqlite.closeAll()
})

test('repairs legacy oversized character rows during startup before they reach CursorWindow', async () => {
  const sqlite = createNodePlusSqlite({
    persistOnClose: true,
    maxCursorCellCharacters: 300 * 1024,
    maxCursorWindowCharacters: 300 * 1024
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

test('repairs every remaining legacy payload table during startup', async () => {
  const sqlite = createNodePlusSqlite({
    persistOnClose: true,
    maxCursorCellCharacters: 300 * 1024,
    maxCursorWindowCharacters: 300 * 1024
  })
  const databaseName = `test-${crypto.randomUUID()}`
  let repository = await setup({ sqlite, databaseName })
  const largeText = 'L'.repeat(700 * 1024)
  const provider = {
    id: 'legacy-provider', name: 'Legacy provider', defaultModel: 'legacy-model',
    modelsCache: [largeText], updatedAt: '2026-07-22T00:00:00.000Z', deletedAt: null
  }
  const conversation = {
    id: 'legacy-conversation', title: 'Legacy conversation', metadata: largeText,
    lastMessageAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z', deletedAt: null
  }
  const setting = { encryptedValue: largeText }
  const secret = { version: 1, manifest: { large: largeText }, pending: [] }
  await executeSql(sqlite, databaseName, `INSERT OR REPLACE INTO providers (id, payload, updated_at, deleted_at) VALUES ('legacy-provider', ${encodedSqlText(provider)}, '2026-07-22T00:00:00.000Z', NULL)`)
  await executeSql(sqlite, databaseName, `INSERT OR REPLACE INTO conversations (id, payload, last_message_at, updated_at, deleted_at) VALUES ('legacy-conversation', ${encodedSqlText(conversation)}, '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z', NULL)`)
  await executeSql(sqlite, databaseName, `INSERT OR REPLACE INTO settings (key, payload) VALUES ('legacy-setting', ${encodedSqlText(setting)})`)
  await executeSql(sqlite, databaseName, `INSERT OR REPLACE INTO secrets (key, payload) VALUES ('legacy-secret', ${encodedSqlText(secret)})`)
  await repository.close()

  repository = await setup({ sqlite, databaseName })
  assert.equal((await repository.getProvider(provider.id)).modelsCache[0], largeText)
  assert.equal((await repository.getConversation(conversation.id)).metadata, largeText)
  assert.equal((await repository.getSetting('legacy-setting')).encryptedValue, largeText)
  assert.equal((await repository.getSecret('legacy-secret')).manifest.large, largeText)
  const rows = await selectSql(
    sqlite,
    databaseName,
    "SELECT entity_table, COUNT(*) AS count FROM payload_chunks WHERE entity_table IN ('providers', 'conversations', 'settings', 'secrets') GROUP BY entity_table ORDER BY entity_table"
  )
  assert.deepEqual(rows.map(row => row.entity_table), ['conversations', 'providers', 'secrets', 'settings'])
  assert.ok(rows.every(row => Number(row.count) >= 3))
  await repository.close()
  sqlite.closeAll()
})

test('repairs legacy oversized message and attachment rows during startup', async () => {
  const sqlite = createNodePlusSqlite({
    persistOnClose: true,
    maxCursorCellCharacters: 300 * 1024,
    maxCursorWindowCharacters: 300 * 1024
  })
  const databaseName = `test-${crypto.randomUUID()}`
  let repository = await setup({ sqlite, databaseName })
  const message = {
    id: 'legacy-message', conversationId: 'legacy-chat', sequence: 1, role: 'assistant',
    content: '旧'.repeat(100 * 1024), status: 'generating', attachmentIds: ['legacy-attachment'],
    createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z'
  }
  const attachment = {
    id: 'legacy-attachment', conversationId: 'legacy-chat', messageId: message.id,
    kind: 'image', name: 'legacy.png', mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${'A'.repeat(700 * 1024)}`, byteSize: 525 * 1024,
    createdAt: '2026-07-22T00:00:00.000Z', deletedAt: null
  }
  await repository.saveConversation({
    id: 'legacy-chat', title: 'Legacy chat', lastMessageAt: '2026-07-22T00:00:00.000Z'
  })
  await executeSql(sqlite, databaseName, `INSERT OR REPLACE INTO messages (id, conversation_id, sequence, status, created_at, updated_at, deleted_at, payload) VALUES ('legacy-message', 'legacy-chat', 1, 'generating', '2026-07-22T00:00:00.000Z', '2026-07-22T00:00:00.000Z', NULL, ${encodedSqlText(message)})`)
  await executeSql(sqlite, databaseName, `INSERT OR REPLACE INTO attachments (id, conversation_id, message_id, created_at, payload) VALUES ('legacy-attachment', 'legacy-chat', 'legacy-message', '2026-07-22T00:00:00.000Z', ${encodedSqlText(attachment)})`)
  await repository.close()

  repository = await setup({ sqlite, databaseName })
  assert.equal((await repository.listMessages('legacy-chat'))[0].content, message.content)
  assert.equal((await repository.listConversationAttachments('legacy-chat'))[0].dataUrl, attachment.dataUrl)
  assert.equal(await repository.recoverGeneratingMessages('2026-07-23T00:00:00.000Z'), 1)
  assert.equal((await repository.getMessage(message.id)).status, 'interrupted')
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

test('tracks character asset sync metadata without reading the full asset payload', async () => {
  const repository = await setup()
  const asset = {
    id: 'asset-sync-metadata',
    characterId: 'char-sync-metadata',
    type: 'icon',
    dataUrl: `data:image/png;base64,${'A'.repeat(600 * 1024)}`,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
    deletedAt: null
  }
  await repository.importCharacterBundle({
    character: {
      id: 'char-sync-metadata',
      name: 'Metadata',
      assetIds: [asset.id],
      updatedAt: asset.updatedAt,
      deletedAt: null
    },
    characterAssets: [asset]
  })

  let [metadata] = await repository.listCharacterAssetSyncMetadata()
  assert.equal(metadata.localRevision, 1)
  assert.equal(metadata.deleted, false)
  assert.equal(metadata.syncHash, null)

  const hash = 'a'.repeat(64)
  assert.equal(await repository.cacheCharacterAssetSyncHash(asset.id, {
    expectedRevision: 1,
    hash,
    sourceUpdatedAt: asset.updatedAt
  }), true)
  assert.equal((await repository.listCharacterAssetSyncMetadata())[0].syncHash, hash)
  assert.deepEqual((await repository.readBackupData({ includeCharacterAssets: false })).characterAssets, [])

  await repository.importRecords({
    characterAssets: [{
      ...asset,
      updatedAt: '2026-07-16T01:00:00.000Z',
      deletedAt: '2026-07-16T01:00:00.000Z'
    }]
  })
  metadata = (await repository.listCharacterAssetSyncMetadata())[0]
  assert.equal(metadata.localRevision, 2)
  assert.equal(metadata.deleted, true)
  assert.equal(metadata.syncHash, null)
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

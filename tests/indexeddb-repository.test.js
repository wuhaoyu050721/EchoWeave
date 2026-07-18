import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'

async function createRepository() {
  const repository = new IndexedDbRepository({
    indexedDB: new IDBFactory(),
    databaseName: `test-${crypto.randomUUID()}`
  })
  await repository.init()
  return repository
}

test('stores and lists providers and conversations by recent activity', async () => {
  const repository = await createRepository()
  await repository.saveProvider({ id: 'p1', name: 'One', updatedAt: '2026-07-13T00:00:00.000Z' })
  await repository.saveConversation({ id: 'c1', title: 'Old', lastMessageAt: '2026-07-13T00:00:00.000Z' })
  await repository.saveConversation({ id: 'c2', title: 'New', lastMessageAt: '2026-07-13T01:00:00.000Z' })

  assert.equal((await repository.listProviders())[0].name, 'One')
  assert.deepEqual((await repository.listConversations()).map((item) => item.id), ['c2', 'c1'])
})

test('creates user and assistant messages together and preserves sequence order', async () => {
  const repository = await createRepository()
  const attachment = {
    id: 'a1', conversationId: 'c1', messageId: 'm1', kind: 'image', name: 'photo.jpg',
    dataUrl: 'data:image/jpeg;base64,AA==', byteSize: 1, createdAt: '2026-07-13T00:00:00.000Z'
  }
  await repository.createMessagePair(
    { id: 'm1', conversationId: 'c1', sequence: 1, role: 'user', content: 'Hello', attachmentIds: ['a1'] },
    { id: 'm2', conversationId: 'c1', sequence: 2, role: 'assistant', content: '', status: 'generating' },
    [attachment]
  )

  assert.deepEqual((await repository.listMessages('c1')).map((item) => item.id), ['m1', 'm2'])
  assert.deepEqual((await repository.listMessageAttachments('m1')).map((item) => item.id), ['a1'])
})

test('deleting a conversation also deletes its messages', async () => {
  const repository = await createRepository()
  await repository.saveConversation({ id: 'c1', title: 'Delete me', lastMessageAt: '2026-07-13T00:00:00.000Z' })
  await repository.createMessagePair(
    { id: 'm1', conversationId: 'c1', sequence: 1, role: 'user', content: 'Hello', attachmentIds: ['a1'] },
    { id: 'm2', conversationId: 'c1', sequence: 2, role: 'assistant', content: 'Hi', status: 'completed' },
    [{ id: 'a1', conversationId: 'c1', messageId: 'm1', kind: 'text', name: 'notes.txt', textContent: 'hello', byteSize: 5 }]
  )

  await repository.deleteConversation('c1')

  assert.equal((await repository.listConversations()).length, 0)
  assert.equal((await repository.listMessages('c1')).length, 0)
  assert.equal((await repository.listConversationAttachments('c1')).length, 0)
})

test('recovers generating messages as interrupted and persists settings and secrets', async () => {
  const repository = await createRepository()
  await repository.saveMessage({
    id: 'm1', conversationId: 'c1', sequence: 1, role: 'assistant', content: 'partial', status: 'generating'
  })
  await repository.setSetting('appearance', { theme: 'light' })
  await repository.setSecret('device-key', { value: 'opaque' })

  const recovered = await repository.recoverGeneratingMessages('2026-07-13T02:00:00.000Z')

  assert.equal(recovered, 1)
  assert.equal((await repository.getMessage('m1')).status, 'interrupted')
  assert.deepEqual(await repository.getSetting('appearance'), { theme: 'light' })
  assert.deepEqual(await repository.getSecret('device-key'), { value: 'opaque' })
})

test('imports validated records in one repository operation', async () => {
  const repository = await createRepository()
  await repository.importRecords({
    providers: [{ id: 'p1', name: 'Imported' }],
    conversations: [{ id: 'c1', title: 'Imported conversation', lastMessageAt: '2026-07-13T00:00:00.000Z' }],
    messages: [{ id: 'm1', conversationId: 'c1', sequence: 1, role: 'user', content: 'Imported', attachmentIds: ['a1'] }],
    attachments: [{ id: 'a1', conversationId: 'c1', messageId: 'm1', kind: 'text', name: 'data.json', textContent: '{}', byteSize: 2 }],
    settings: { app: { appLockEnabled: false } }
  })

  assert.equal((await repository.listProviders()).length, 1)
  assert.equal((await repository.listConversations()).length, 1)
  assert.equal((await repository.listMessages('c1')).length, 1)
  assert.equal((await repository.listAllAttachments()).length, 1)
  assert.equal((await repository.readBackupData()).attachments.length, 1)
  assert.deepEqual(await repository.getSetting('app'), { appLockEnabled: false })
})

test('imports a character with its world book and assets in one transaction', async () => {
  const repository = await createRepository()
  await repository.importCharacterBundle({
    character: { id: 'char-1', name: '苏墨', sourceHash: 'hash-1', avatarAssetId: 'asset-1', updatedAt: '2026-07-16T00:00:00.000Z' },
    worldBooks: [{ id: 'book-1', characterId: 'char-1', scope: 'character', name: '世界书', data: { entries: [] } }],
    characterAssets: [{ id: 'asset-1', characterId: 'char-1', type: 'icon', dataUrl: 'data:image/png;base64,AA==' }]
  })

  assert.equal((await repository.listCharacters())[0].name, '苏墨')
  assert.equal((await repository.findCharactersBySourceHash('hash-1')).length, 1)
  assert.equal((await repository.listWorldBooks({ characterId: 'char-1' })).length, 1)
  assert.equal((await repository.listCharacterAssets('char-1')).length, 1)
  const backup = await repository.readBackupData()
  assert.equal(backup.characters.length, 1)
  assert.equal(backup.worldBooks.length, 1)
  assert.equal(backup.characterAssets.length, 1)
})

test('saves a world book and reverse character bindings in one repository operation', async () => {
  const repository = await createRepository()
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
})

test('aborts character and world-book bundles when a later IndexedDB put is invalid', async () => {
  const repository = await createRepository()

  await assert.rejects(repository.saveWorldBookBundle({
    worldBook: { id: 'book-invalid', name: 'Invalid', deletedAt: null },
    characters: [{ name: 'missing character id' }]
  }), error => error?.name === 'DataError')
  assert.equal(await repository.getWorldBook('book-invalid'), undefined)

  await assert.rejects(repository.importCharacterBundle({
    character: { id: 'char-invalid', name: 'Invalid', deletedAt: null },
    characterAssets: [{ characterId: 'char-invalid', dataUrl: 'data:image/png;base64,AA==' }]
  }), error => error?.name === 'DataError')
  assert.equal(await repository.getCharacter('char-invalid'), undefined)
})

test('uses a storage clone helper instead of direct structuredClone calls', async () => {
  const source = await readFile(new URL('../src/platform/browser/indexeddb-repository.js', import.meta.url), 'utf8')

  assert.match(source, /function cloneForStorage/)
  assert.doesNotMatch(source, /[^.]structuredClone\(/)
})

test('conditionally imports a sync record only while its local snapshot is unchanged', async () => {
  const repository = await createRepository()
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
})

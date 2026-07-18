import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'
import { BackupService } from '../src/services/backup-service.js'

test('exports non-sensitive data and imports validated remapped records', async () => {
  const repository = new IndexedDbRepository({ indexedDB: new IDBFactory(), databaseName: `backup-${crypto.randomUUID()}` })
  await repository.init()
  await repository.saveProvider({ id: 'p1', name: 'Provider', encryptedApiKey: { ciphertext: 'hidden' } })
  await repository.saveConversation({ id: 'c1', title: 'Conversation', providerProfileId: 'p1' })
  await repository.saveMessage({ id: 'm1', conversationId: 'c1', sequence: 1, role: 'user', content: 'Hello', attachmentIds: ['a1'] })
  await repository.saveAttachments([{ id: 'a1', conversationId: 'c1', messageId: 'm1', kind: 'text', name: 'a.txt', textContent: 'A', byteSize: 1 }])
  const service = new BackupService({ repository, idFactory: (() => { let id = 0; return () => `new-${++id}` })() })

  const exported = await service.exportData()
  assert.equal(JSON.stringify(exported).includes('hidden'), false)

  const importedCount = await service.importData(exported)
  assert.deepEqual(importedCount, { providers: 1, conversations: 1, messages: 1, attachments: 1 })
  assert.equal((await repository.listConversations()).length, 2)
})

test('does not write anything when validation fails', async () => {
  const repository = new IndexedDbRepository({ indexedDB: new IDBFactory(), databaseName: `backup-invalid-${crypto.randomUUID()}` })
  await repository.init()
  const service = new BackupService({ repository })

  await assert.rejects(service.importData({ formatVersion: 99 }), /版本/)
  assert.equal((await repository.listProviders()).length, 0)
})

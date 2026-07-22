import assert from 'node:assert/strict'
import test from 'node:test'
import { PlusSqliteRepository } from '../src/platform/app/plus-sqlite-repository.js'
import { CloudBackupService } from '../src/services/cloud-backup-service.js'
import { CloudTokenStore } from '../src/services/cloud-token-store.js'
import { createNodePlusSqlite } from './helpers/node-plus-sqlite.js'

async function createSqliteRepository(prefix) {
  const sqlite = createNodePlusSqlite()
  const repository = new PlusSqliteRepository({
    sqlite,
    databaseName: `${prefix}-${crypto.randomUUID()}`,
    databasePath: `_doc/${prefix}.db`
  })
  await repository.init()
  return { repository, sqlite }
}

test('stores cloud sessions only as device-vault ciphertext', async () => {
  let stored = null
  const repository = {
    getSecret: async () => stored,
    setSecret: async (_key, value) => { stored = value }
  }
  const vault = {
    encryptString: async value => ({ encrypted: Buffer.from(value).toString('base64') }),
    decryptString: async value => Buffer.from(value.encrypted, 'base64').toString()
  }
  const store = new CloudTokenStore({ repository, vault })
  const session = { access_token: 'access-secret', refresh_token: 'refresh-secret' }

  await store.save(session)
  assert.equal(JSON.stringify(stored).includes('access-secret'), false)
  assert.deepEqual(await store.load(), session)
  await store.clear()
  assert.equal(await store.load(), null)
})

test('uploads encrypted local backups and restores only after decryption', async () => {
  const calls = []
  const backupService = {
    exportData: async () => ({ formatVersion: 1, conversations: [{ id: 'c1' }] }),
    importData: async payload => { calls.push(['import', payload]); return { conversations: 1 } }
  }
  const apiClient = {
    uploadBackup: async input => { calls.push(['upload', input]); return { version: 1 } },
    downloadBackup: async () => ({ encrypted: true })
  }
  const service = new CloudBackupService({
    backupService,
    apiClient,
    encrypt: async (payload, password) => ({ encrypted: true, payload, password }),
    decrypt: async (envelope, password) => ({ envelope, password, formatVersion: 1 })
  })

  await service.upload({ deviceId: 'device-a', syncPassword: 'sync password' })
  const restored = await service.restore({ syncPassword: 'sync password' })

  assert.equal(calls[0][0], 'upload')
  assert.equal(calls[0][1].deviceId, 'device-a')
  assert.equal(calls[0][1].envelope.password, 'sync password')
  assert.deepEqual(calls[1], ['import', { envelope: { encrypted: true }, password: 'sync password', formatVersion: 1 }])
  assert.deepEqual(restored, { conversations: 1 })
})

test('production backup path includes secrets only inside the outer envelope and re-encrypts on restore', async () => {
  let imported = null
  const repository = {
    readBackupData: async () => ({
      providers: [{ id: 'p1', encryptedApiKey: { encrypted: 'old:sk-secret' } }],
      conversations: [{ id: 'c1', providerProfileId: 'p1' }],
      messages: [{ id: 'm1', conversationId: 'c1', attachmentIds: ['a1'] }],
      attachments: [{ id: 'a1', conversationId: 'c1', messageId: 'm1', kind: 'text', name: 'a.txt', textContent: 'A', byteSize: 1 }],
      settings: {}
    }),
    importRecords: async records => { imported = records }
  }
  const vault = {
    decryptString: async record => record.encrypted.split(':')[1],
    encryptString: async value => ({ encrypted: `new:${value}` })
  }
  let uploadedEnvelope
  const apiClient = {
    uploadBackup: async ({ envelope }) => { uploadedEnvelope = envelope; return { version: 1 } },
    downloadBackup: async () => uploadedEnvelope
  }
  const service = new CloudBackupService({
    repository,
    vault,
    apiClient,
    encrypt: async payload => ({ wrapped: payload }),
    decrypt: async envelope => envelope.wrapped
  })

  await service.upload({ deviceId: 'device-a', syncPassword: 'sync password' })
  await service.restore({ syncPassword: 'sync password' })

  assert.equal(uploadedEnvelope.wrapped.providers[0].apiKey, 'sk-secret')
  assert.deepEqual(imported.providers[0].encryptedApiKey, { encrypted: 'new:sk-secret' })
  assert.equal(imported.attachments.length, 1)
})

test('restores character conversation and avatar links into a fresh SQLite device repository', async () => {
  const source = await createSqliteRepository('cloud-backup-source')
  const target = await createSqliteRepository('cloud-backup-target')
  const avatar = {
    id: 'avatar-source', characterId: 'character-source', type: 'icon',
    dataUrl: 'data:image/png;base64,AA==', createdAt: '2026-07-22T01:00:00.000Z', deletedAt: null
  }
  const character = {
    id: 'character-source', name: 'Su Mo', sourceHash: 'same-card', avatarAssetId: avatar.id,
    assetIds: [avatar.id], worldBookIds: [], updatedAt: '2026-07-22T01:00:00.000Z', deletedAt: null
  }
  const conversation = {
    id: 'conversation-source', title: character.name, characterId: character.id,
    characterNameSnapshot: character.name, characterAvatarAssetId: avatar.id,
    providerProfileId: 'provider-source', providerNameSnapshot: 'DeepSeek', modelName: 'deepseek-v4-pro',
    lastMessageAt: '2026-07-22T01:00:00.000Z', updatedAt: '2026-07-22T01:00:00.000Z', deletedAt: null
  }
  await source.repository.importRecords({
    providers: [{ id: 'provider-source', name: 'DeepSeek', updatedAt: '2026-07-22T01:00:00.000Z', deletedAt: null }],
    conversations: [conversation],
    messages: [{
      id: 'message-source', conversationId: conversation.id, sequence: 1, role: 'assistant', content: 'Hello',
      attachmentIds: [], createdAt: '2026-07-22T01:00:00.000Z', updatedAt: '2026-07-22T01:00:00.000Z', deletedAt: null
    }],
    characters: [character],
    characterAssets: [avatar]
  })

  let envelope = null
  const apiClient = {
    uploadBackup: async input => { envelope = structuredClone(input.envelope); return { version: 1 } },
    downloadBackup: async () => structuredClone(envelope)
  }
  const vault = { encryptString: async value => value, decryptString: async value => value }
  const sourceService = new CloudBackupService({
    repository: source.repository, vault, apiClient,
    encrypt: async payload => structuredClone(payload),
    decrypt: async payload => structuredClone(payload)
  })
  const targetService = new CloudBackupService({
    repository: target.repository, vault, apiClient,
    encrypt: async payload => structuredClone(payload),
    decrypt: async payload => structuredClone(payload)
  })

  await sourceService.upload({ deviceId: 'source-device', syncPassword: 'sync password' })
  const result = await targetService.restore({ syncPassword: 'sync password' })
  const restoredConversation = (await target.repository.listConversations())[0]
  const restoredCharacter = await target.repository.getCharacter(restoredConversation.characterId)
  const restoredAvatar = await target.repository.getCharacterAsset(restoredConversation.characterAvatarAssetId)

  assert.deepEqual(result, {
    providers: 1, conversations: 1, messages: 1, attachments: 0,
    characters: 1, worldBooks: 0, characterAssets: 1
  })
  assert.equal(restoredCharacter.name, 'Su Mo')
  assert.equal(restoredCharacter.avatarAssetId, restoredAvatar.id)
  assert.equal(restoredAvatar.characterId, restoredCharacter.id)
  assert.equal(restoredAvatar.dataUrl, avatar.dataUrl)

  await source.repository.close()
  await target.repository.close()
  source.sqlite.closeAll()
  target.sqlite.closeAll()
})

test('rejects an encrypted envelope above the server limit before uploading', async () => {
  let uploads = 0
  const service = new CloudBackupService({
    backupService: {
      exportData: async () => ({ formatVersion: 1, providers: [], conversations: [], messages: [], settings: {} }),
      importData: async () => ({})
    },
    apiClient: {
      uploadBackup: async () => { uploads += 1 },
      downloadBackup: async () => ({})
    },
    encrypt: async () => ({ ciphertext: 'x'.repeat(80) }),
    decrypt: async value => value,
    maxUploadBytes: 64
  })

  await assert.rejects(service.upload({ deviceId: 'device-a', syncPassword: 'sync password' }), error => (
    error.code === 'backup_too_large' && error.status === 413 && error.byteSize > error.maxBytes
  ))
  assert.equal(uploads, 0)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { CloudBackupService } from '../src/services/cloud-backup-service.js'
import { CloudTokenStore } from '../src/services/cloud-token-store.js'

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

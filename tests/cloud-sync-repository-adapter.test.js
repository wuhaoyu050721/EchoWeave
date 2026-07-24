import assert from 'node:assert/strict'
import test from 'node:test'
import { hashSyncValue } from '../src/core/cloud-sync-crypto.js'
import { syncRecordKey } from '../src/core/cloud-sync-protocol.js'
import { CloudSyncRepositoryAdapter } from '../src/services/cloud-sync-repository-adapter.js'

function createRepository(data) {
  const imports = []
  return {
    imports,
    readBackupData: async () => structuredClone(data),
    importRecords: async records => { imports.push(structuredClone(records)) },
    getProvider: async id => data.providers.find(value => value.id === id),
    getConversation: async id => data.conversations.find(value => value.id === id),
    getMessage: async id => data.messages.find(value => value.id === id),
    listAllAttachments: async () => data.attachments,
    getCharacter: async id => data.characters.find(value => value.id === id),
    getWorldBook: async id => data.worldBooks.find(value => value.id === id),
    getCharacterAsset: async id => data.characterAssets.find(value => value.id === id),
    getSetting: async (key, fallback) => Object.prototype.hasOwnProperty.call(data.settings, key) ? data.settings[key] : fallback
  }
}

test('converts device-bound secrets to portable records and excludes transport settings', async () => {
  const data = {
    providers: [{ id: 'p1', updatedAt: '2027-01-15T00:00:00.000Z', encryptedApiKey: { local: 'sk-private' } }],
    conversations: [{ id: 'c1', encryptedSystemPrompt: { local: 'private prompt' } }],
    messages: [{ id: 'm1', conversationId: 'c1', sequence: 1 }],
    attachments: [{ id: 'a1', conversationId: 'c1', messageId: 'm1', textContent: 'private attachment' }],
    characters: [{ id: 'character-1', name: 'Character' }],
    worldBooks: [{ id: 'world-1', scope: 'global', data: { entries: [] } }],
    characterAssets: [{ id: 'asset-1', characterId: 'character-1', dataUrl: 'data:image/png;base64,AA==' }],
    settings: {
      systemPrompt: { enabled: true, encryptedValue: { local: 'global private prompt' } },
      appearance: { theme: 'light' },
      numericSetting: { value: 5 },
      cloudDeviceId: 'device-local',
      cloudAutoBackup: true,
      cloudConfig: { baseUrl: 'https://cloud.example.com' }
    }
  }
  const repository = createRepository(data)
  const vault = {
    decryptString: async record => record.local,
    encryptString: async value => ({ local: `device:${value}` })
  }
  const adapter = new CloudSyncRepositoryAdapter({ repository, vault })

  const records = await adapter.readRecords()
  const provider = records.find(record => record.entityType === 'providers')
  const conversation = records.find(record => record.entityType === 'conversations')
  const prompt = records.find(record => record.entityType === 'settings' && record.entityId === 'systemPrompt')

  assert.equal(records.length, 10)
  assert.equal(provider.value.apiKey, 'sk-private')
  assert.equal('encryptedApiKey' in provider.value, false)
  assert.equal(conversation.value.systemPrompt, 'private prompt')
  assert.equal(prompt.value.value, 'global private prompt')
  assert.deepEqual(records.find(record => record.entityId === 'numericSetting').value, { value: 5 })
  assert.equal(records.some(record => record.entityId === 'cloudDeviceId'), false)
  assert.equal(records.some(record => record.entityId === 'cloudAutoBackup'), false)
  assert.equal(records.some(record => record.entityId === 'cloudConfig'), false)
})

test('re-encrypts portable secrets and stores encrypted tombstones with required references', async () => {
  const repository = createRepository({
    providers: [], conversations: [], messages: [], attachments: [],
    characters: [], worldBooks: [], characterAssets: [], settings: {}
  })
  const vault = {
    decryptString: async record => record.local,
    encryptString: async value => ({ local: `new-device:${value}` })
  }
  const adapter = new CloudSyncRepositoryAdapter({ repository, vault })

  await adapter.applyRecord({
    entityType: 'providers',
    entityId: 'p1',
    operation: 'upsert',
    updatedAt: 1_800_000_000_000,
    value: { id: 'p1', apiKey: 'sk-portable', name: 'Remote' }
  })
  await adapter.applyRecord({
    entityType: 'messages',
    entityId: 'm1',
    operation: 'delete',
    updatedAt: 1_800_000_000_001,
    tombstone: {
      deletedAt: '2027-01-15T08:00:00.001Z',
      refs: { conversationId: 'c1', sequence: 4 }
    }
  })
  await adapter.applyRecord({
    entityType: 'settings',
    entityId: 'appearance',
    operation: 'delete',
    updatedAt: 1_800_000_000_002,
    tombstone: { deletedAt: '2027-01-15T08:00:00.002Z', refs: {} }
  })

  assert.deepEqual(repository.imports[0].providers[0].encryptedApiKey, { local: 'new-device:sk-portable' })
  assert.equal('apiKey' in repository.imports[0].providers[0], false)
  assert.equal(repository.imports[1].messages[0].conversationId, 'c1')
  assert.equal(repository.imports[1].messages[0].deletedAt, '2027-01-15T08:00:00.001Z')
  assert.equal(repository.imports[2].settings.appearance, null)
})

test('uses a conditional repository write when the local storage snapshot is available', async () => {
  const data = {
    providers: [], conversations: [], messages: [], attachments: [],
    characters: [], worldBooks: [], characterAssets: [],
    settings: { appearance: { theme: 'light' } }
  }
  const repository = createRepository(data)
  repository.importRecordsIfUnchanged = async ({ expectedSnapshot, records }) => {
    const current = data.settings.appearance
    if (JSON.stringify(expectedSnapshot) !== JSON.stringify({ exists: true, value: current })) return false
    repository.imports.push(structuredClone(records))
    return true
  }
  const adapter = new CloudSyncRepositoryAdapter({
    repository,
    vault: { decryptString: async value => value, encryptString: async value => value }
  })
  const local = await adapter.readRecordState('settings', 'appearance')
  data.settings.appearance = { theme: 'local-new' }

  const result = await adapter.applyRecord({
    entityType: 'settings',
    entityId: 'appearance',
    operation: 'upsert',
    updatedAt: 1_800_000_000_000,
    value: { theme: 'remote' }
  }, { expectedSnapshot: local.snapshot })

  assert.deepEqual(result, { applied: false, reason: 'local_changed' })
  assert.equal(repository.imports.length, 0)
  assert.deepEqual(data.settings.appearance, { theme: 'local-new' })
})

test('reuses synced character asset hashes without loading large payloads', async () => {
  const asset = {
    id: 'asset-large',
    characterId: 'character-large',
    dataUrl: `data:image/png;base64,${'A'.repeat(1024 * 1024)}`,
    createdAt: '2027-01-15T08:00:00.000Z',
    updatedAt: '2027-01-15T08:00:00.000Z',
    deletedAt: null
  }
  const data = {
    providers: [], conversations: [], messages: [], attachments: [],
    characters: [{ id: asset.characterId, name: 'Large asset' }],
    worldBooks: [], characterAssets: [asset], settings: {}
  }
  const repository = createRepository(data)
  let assetReads = 0
  let cachedHash = null
  repository.readBackupData = async ({ includeCharacterAssets = true } = {}) => ({
    ...structuredClone(data),
    characterAssets: includeCharacterAssets ? structuredClone(data.characterAssets) : []
  })
  repository.listCharacterAssetSyncMetadata = async () => [{
    id: asset.id,
    characterId: asset.characterId,
    createdAt: asset.createdAt,
    sourceUpdatedAt: asset.updatedAt,
    localRevision: 0,
    metadataKnown: false,
    deleted: null,
    syncHash: cachedHash
  }]
  repository.getCharacterAsset = async id => {
    assetReads += 1
    return id === asset.id ? structuredClone(asset) : null
  }
  repository.cacheCharacterAssetSyncHash = async (_id, { hash }) => {
    cachedHash = hash
    return true
  }
  const adapter = new CloudSyncRepositoryAdapter({
    repository,
    vault: { decryptString: async value => value, encryptString: async value => value }
  })
  const expectedHash = hashSyncValue(asset)
  const manifest = {
    [syncRecordKey('characterAssets', asset.id)]: {
      entityType: 'characterAssets',
      entityId: asset.id,
      hash: expectedHash,
      deleted: false,
      updatedAt: Date.parse(asset.updatedAt),
      revision: 1
    }
  }

  const records = await adapter.readRecords({ manifest })
  const descriptor = records.find(record => record.entityType === 'characterAssets')
  assert.equal(assetReads, 0)
  assert.equal(descriptor.value, undefined)
  assert.equal(descriptor.hash, expectedHash)
  assert.equal(cachedHash, expectedHash)

  const materialized = await adapter.materializeRecord(descriptor)
  assert.equal(assetReads, 1)
  assert.deepEqual(materialized.value, asset)
  assert.equal(materialized.hash, expectedHash)
})

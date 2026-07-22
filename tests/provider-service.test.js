import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'
import { ProviderService } from '../src/services/provider-service.js'

async function setup() {
  const repository = new IndexedDbRepository({ indexedDB: new IDBFactory(), databaseName: `provider-${crypto.randomUUID()}` })
  await repository.init()
  const encryptedValues = []
  const encryptedRecords = new Map()
  const vault = {
    async encryptString(value) {
      encryptedValues.push(value)
      const ciphertext = `cipher-${encryptedValues.length}`
      encryptedRecords.set(ciphertext, value)
      return { version: 1, ciphertext }
    },
    async decryptString(record) {
      return encryptedRecords.get(record?.ciphertext) ?? ''
    }
  }
  const protocol = { listModels: async () => ['model-b', 'model-a'] }
  const service = new ProviderService({
    repository,
    vault,
    provider: protocol,
    idFactory: () => 'provider-1',
    now: () => '2026-07-13T00:00:00.000Z'
  })
  return { repository, service, encryptedValues }
}

test('encrypts API keys and exposes only hasApiKey to UI', async () => {
  const { repository, service, encryptedValues } = await setup()
  const saved = await service.saveProvider({
    name: ' OpenAI ', baseUrl: 'https://api.openai.com', apiKey: 'sk-secret', defaultModel: 'gpt-test'
  })
  const stored = await repository.getProvider('provider-1')

  assert.deepEqual(encryptedValues, ['sk-secret'])
  assert.equal(saved.hasApiKey, true)
  assert.equal(saved.encryptedApiKey, undefined)
  assert.equal(JSON.stringify(stored).includes('sk-secret'), false)
  assert.equal(stored.protocolType, 'openai-compatible')
  assert.equal(stored.baseUrl, 'https://api.openai.com/v1')
})

test('reveals a saved API key only through an explicit editing request', async () => {
  const { service } = await setup()
  await service.saveProvider({
    name: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: 'sk-secret', defaultModel: 'gpt-test'
  })

  const listed = await service.listProviders()
  assert.equal(listed[0].hasApiKey, true)
  assert.equal(listed[0].apiKey, undefined)
  assert.equal(listed[0].encryptedApiKey, undefined)
  assert.equal(await service.getApiKeyForEditing('provider-1'), 'sk-secret')
  await assert.rejects(() => service.getApiKeyForEditing('missing-provider'), /当前接口不存在/)
})

test('persists Gemini protocol profiles and normalizes their native base URL', async () => {
  const { repository, service } = await setup()
  const saved = await service.saveProvider({
    name: 'Gemini',
    protocolType: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: 'google-key',
    defaultModel: 'gemini-2.5-flash'
  })
  const stored = await repository.getProvider(saved.id)

  assert.equal(saved.protocolType, 'gemini')
  assert.equal(stored.protocolType, 'gemini')
  assert.equal(stored.baseUrl, 'https://generativelanguage.googleapis.com/v1beta')
})

test('preserves existing ciphertext when edited with a blank API key', async () => {
  const { repository, service, encryptedValues } = await setup()
  await service.saveProvider({ name: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: 'sk-secret', defaultModel: 'gpt-test' })
  const original = await repository.getProvider('provider-1')
  await service.saveProvider({ id: 'provider-1', name: 'Renamed', baseUrl: 'https://api.openai.com/v1', apiKey: '', defaultModel: 'gpt-test' })
  const updated = await repository.getProvider('provider-1')

  assert.equal(encryptedValues.length, 1)
  assert.deepEqual(updated.encryptedApiKey, original.encryptedApiKey)
})

test('tests connection with decrypted key and persists model cache', async () => {
  const { repository, service } = await setup()
  await service.saveProvider({ name: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: 'sk-secret', defaultModel: 'gpt-test' })

  const result = await service.testConnection('provider-1')
  const stored = await repository.getProvider('provider-1')

  assert.deepEqual(result.modelsCache, ['model-b', 'model-a'])
  assert.equal(stored.lastTestStatus, 'success')
  assert.deepEqual(stored.modelsCache, ['model-b', 'model-a'])
})

test('fetches models from unsaved form values without persisting the provider', async () => {
  const { repository, service } = await setup()
  let writes = 0
  const originalSave = repository.saveProvider.bind(repository)
  repository.saveProvider = async (...args) => {
    writes += 1
    return originalSave(...args)
  }
  let profile
  service.provider.listModels = async (value) => {
    profile = value
    return ['model-b', 'model-a']
  }

  const models = await service.fetchModels({
    name: 'Unsaved',
    baseUrl: 'http://127.0.0.1:4319',
    apiKey: 'temporary-key',
    defaultModel: 'manual-model'
  })

  assert.deepEqual(models, ['model-b', 'model-a'])
  assert.equal(profile.baseUrl, 'http://127.0.0.1:4319/v1')
  assert.equal(profile.apiKey, 'temporary-key')
  assert.equal(writes, 0)
})

test('fetches Gemini models with the selected unsaved protocol', async () => {
  const { service } = await setup()
  let profile
  service.provider.listModels = async value => {
    profile = value
    return ['gemini-2.5-flash']
  }

  await service.fetchModels({
    protocolType: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: 'temporary-key'
  })

  assert.equal(profile.protocolType, 'gemini')
  assert.equal(profile.baseUrl, 'https://generativelanguage.googleapis.com/v1beta')
  assert.equal(profile.apiKey, 'temporary-key')
})

test('reuses the stored encrypted key when an edit form key is blank', async () => {
  const { service } = await setup()
  await service.saveProvider({
    name: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: 'stored-key', defaultModel: 'gpt-test'
  })
  let profile
  service.provider.listModels = async (value) => {
    profile = value
    return ['gpt-test']
  }

  await service.fetchModels({ id: 'provider-1', baseUrl: 'https://example.com/v1', apiKey: '' })

  assert.equal(profile.baseUrl, 'https://example.com/v1')
  assert.equal(profile.apiKey, 'stored-key')
})

test('uses a temporary edit key instead of the stored key', async () => {
  const { service } = await setup()
  await service.saveProvider({
    name: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: 'stored-key', defaultModel: 'gpt-test'
  })
  let profile
  service.provider.listModels = async (value) => {
    profile = value
    return ['gpt-test']
  }

  await service.fetchModels({
    id: 'provider-1', baseUrl: 'https://example.com/v1', apiKey: 'temporary-edit-key'
  })

  assert.equal(profile.apiKey, 'temporary-edit-key')
})

test('persists provider avatar choices and preserves them when omitted during later edits', async () => {
  const { repository, service } = await setup()
  const saved = await service.saveProvider({
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'stored-key',
    defaultModel: 'deepseek-chat',
    avatar: { mode: 'preset', presetId: 'claude' }
  })

  assert.equal(saved.avatar.mode, 'preset')
  assert.equal(saved.avatar.presetId, 'claude')

  await service.saveProvider({
    id: saved.id,
    name: 'Renamed',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    defaultModel: 'deepseek-chat'
  })

  const stored = await repository.getProvider(saved.id)
  assert.equal(stored.avatar.mode, 'preset')
  assert.equal(stored.avatar.presetId, 'claude')
})

test('rejects invalid custom provider avatars before writing', async () => {
  const { repository, service } = await setup()

  await assert.rejects(() => service.saveProvider({
    name: 'Invalid avatar',
    baseUrl: 'https://example.com/v1',
    defaultModel: 'model',
    avatar: { mode: 'custom', dataUrl: 'https://example.com/avatar.png' }
  }), /头像图片无效/)

  assert.equal((await repository.listProviders()).length, 0)
})

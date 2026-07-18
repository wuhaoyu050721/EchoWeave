import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudServices } from '../src/app/create-cloud-services.js'

test('assembles a cloud client with encrypted token storage', async () => {
  let secret = null
  const repository = {
    getSecret: async () => secret,
    setSecret: async (_key, value) => { secret = value }
  }
  const vault = {
    encryptString: async value => ({ value }),
    decryptString: async record => record.value
  }
  const transport = { request: async () => ({ status: 200, headers: {}, text: '{}' }) }
  const backupService = { exportData() {}, importData() {} }

  const services = createCloudServices({
    baseUrl: 'https://cloud.example.com', repository, vault, transport, backupService,
    getDeviceId: async () => 'device-a'
  })
  await services.tokenStore.save({ access_token: 'access' })

  assert.equal((await services.tokenStore.load()).access_token, 'access')
  assert.equal(typeof services.apiClient.login, 'function')
  assert.equal(typeof services.cloudBackupService.upload, 'function')
  assert.equal(typeof services.credentialStore.save, 'function')
  assert.equal(typeof services.scheduler.start, 'function')
})

test('prefers a device-level token store over workspace secrets', async () => {
  let workspaceSecretWrites = 0
  let session = null
  const repository = {
    getSecret: async () => null,
    setSecret: async () => { workspaceSecretWrites += 1 }
  }
  const vault = {
    encryptString: async value => ({ value }),
    decryptString: async record => record.value
  }
  const tokenStore = {
    load: async () => session,
    save: async value => { session = value },
    clear: async () => { session = null }
  }
  const services = createCloudServices({
    baseUrl: 'https://cloud.example.com',
    repository,
    vault,
    tokenStore,
    transport: { request: async () => ({ status: 200, headers: {}, text: '{}' }) },
    backupService: { exportData() {}, importData() {} }
  })

  await services.tokenStore.save({ access_token: 'device-token' })

  assert.equal(services.tokenStore, tokenStore)
  assert.equal((await services.tokenStore.load()).access_token, 'device-token')
  assert.equal(workspaceSecretWrites, 0)
})

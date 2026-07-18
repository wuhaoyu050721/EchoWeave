import assert from 'node:assert/strict'
import test from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import {
  createBrowserDeviceServices,
  createBrowserServices,
  createBrowserWorkspaceManager
} from '../src/app/create-browser-services.js'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'
import { WebCryptoVault } from '../src/platform/browser/web-crypto-vault.js'
import { CloudTokenStore } from '../src/services/cloud-token-store.js'
import { migrateLegacyCloudToken } from '../src/workspace/device-token-migration.js'
import { WorkspaceServiceManager } from '../src/workspace/workspace-service-manager.js'
import { deriveAccountWorkspaceId } from '../src/workspace/workspace-id.js'

test('preserves the legacy browser local database and migrates its token to the device store', async () => {
  const indexedDB = new IDBFactory()
  const legacyRepository = new IndexedDbRepository({ indexedDB })
  await legacyRepository.init()
  await legacyRepository.saveProvider({ id: 'local-provider', name: 'Legacy local data' })
  const legacyVault = new WebCryptoVault({ repository: legacyRepository, crypto: globalThis.crypto })
  await legacyVault.init()
  const legacyTokenStore = new CloudTokenStore({ repository: legacyRepository, vault: legacyVault })
  const session = { user: { id: 7, username: 'Account' }, access_token: 'access' }
  await legacyTokenStore.save(session)
  await legacyRepository.setSetting('cloudConfig', { baseUrl: 'https://legacy-cloud.example/' })
  await legacyRepository.close()

  const services = await createBrowserServices({ indexedDB, crypto: globalThis.crypto })

  assert.equal(services.workspaceId, 'local')
  assert.equal((await services.repository.listProviders())[0].id, 'local-provider')
  assert.deepEqual(await services.tokenStore.load(), {
    ...session,
    cloud_base_url: 'https://legacy-cloud.example'
  })
  assert.equal((await new CloudTokenStore({
    repository: services.repository,
    vault: services.vault
  }).load()), null)
  assert.equal(services.deviceTokenMigration.status, 'migrated')
  await services.dispose()
})

test('restores a legacy local token into its account workspace on the first upgraded startup', async () => {
  const indexedDB = new IDBFactory()
  const legacyRepository = new IndexedDbRepository({ indexedDB })
  await legacyRepository.init()
  await legacyRepository.saveProvider({ id: 'local-only', name: 'Local' })
  const legacyVault = new WebCryptoVault({ repository: legacyRepository, crypto: globalThis.crypto })
  await legacyVault.init()
  const legacyTokenStore = new CloudTokenStore({ repository: legacyRepository, vault: legacyVault })
  const session = { user: { id: 'upgraded-account' }, access_token: 'access' }
  await legacyTokenStore.save(session)
  await legacyRepository.setSetting('cloudConfig', { baseUrl: 'https://legacy-cloud.example/' })
  await legacyRepository.close()

  const manager = await createBrowserWorkspaceManager({ indexedDB, crypto: globalThis.crypto })
  const restored = await manager.openFromStoredSession()

  const scopedSession = { ...session, cloud_base_url: 'https://legacy-cloud.example' }
  assert.deepEqual(restored.session, scopedSession)
  assert.equal(restored.workspaceId, deriveAccountWorkspaceId(session.user, {
    accountNamespace: scopedSession.cloud_base_url
  }))
  assert.deepEqual(await restored.services.repository.listProviders(), [])
  const local = await manager.switchToLocal()
  assert.deepEqual((await local.repository.listProviders()).map(item => item.id), ['local-only'])
  await manager.close()
})

test('clears an unscoped legacy token when its original cloud server cannot be determined', async () => {
  const indexedDB = new IDBFactory()
  const legacyRepository = new IndexedDbRepository({ indexedDB })
  await legacyRepository.init()
  const legacyVault = new WebCryptoVault({ repository: legacyRepository, crypto: globalThis.crypto })
  await legacyVault.init()
  const legacyTokenStore = new CloudTokenStore({ repository: legacyRepository, vault: legacyVault })
  await legacyTokenStore.save({ user: { id: 'unknown-server' }, access_token: 'legacy-access' })
  await legacyRepository.close()

  const manager = await createBrowserWorkspaceManager({ indexedDB, crypto: globalThis.crypto })
  const opened = await manager.openFromStoredSession()

  assert.equal(opened.session, null)
  assert.equal(opened.workspaceId, 'local')
  assert.equal(opened.services.deviceTokenMigration.status, 'reauth-required')
  assert.equal(await manager.tokenStore.load(), null)
  assert.equal(await new CloudTokenStore({
    repository: opened.services.repository,
    vault: opened.services.vault
  }).load(), null)
  await manager.close()
})

test('repairs an already device-level unscoped session from the same legacy local workspace', async () => {
  const indexedDB = new IDBFactory()
  const localRepository = new IndexedDbRepository({ indexedDB })
  await localRepository.init()
  await localRepository.setSetting('cloudConfig', { baseUrl: 'https://legacy-device.example/' })
  await localRepository.close()
  const deviceServices = await createBrowserDeviceServices({ indexedDB, crypto: globalThis.crypto })
  const session = { user: { id: 'device-level-legacy' }, access_token: 'legacy-access' }
  await deviceServices.tokenStore.save(session)
  const manager = await createBrowserWorkspaceManager({
    indexedDB,
    crypto: globalThis.crypto,
    deviceServices
  })

  const opened = await manager.openFromStoredSession()

  assert.deepEqual(opened.session, {
    ...session,
    cloud_base_url: 'https://legacy-device.example'
  })
  assert.equal(opened.workspaceId, deriveAccountWorkspaceId(session.user, {
    accountNamespace: 'https://legacy-device.example'
  }))
  await manager.close()
})

test('fails closed and clears device tokens when legacy migration cannot be inspected', async () => {
  let deviceSession = {
    user: { id: 'legacy-account' },
    access_token: 'legacy-access',
    refresh_token: 'legacy-refresh'
  }
  let legacySecret = { corrupted: true }
  const result = await migrateLegacyCloudToken({
    workspaceId: 'local',
    repository: {
      getSecret: async () => legacySecret,
      setSecret: async (_key, value) => { legacySecret = value },
      getSetting: async () => null
    },
    vault: {
      decryptString: async () => { throw new Error('corrupted legacy ciphertext') },
      encryptString: async value => value
    },
    deviceTokenStore: {
      load: async () => deviceSession,
      save: async value => { deviceSession = value },
      clear: async () => { deviceSession = null }
    }
  })

  assert.equal(result.status, 'reauth-required')
  assert.equal(result.reason, 'migration-failed')
  assert.equal(result.cleanupFailed, false)
  assert.equal(deviceSession, null)
  assert.equal(legacySecret, null)
})

test('keeps local and account workspaces empty and isolated until explicitly populated', async () => {
  const indexedDB = new IDBFactory()
  const manager = await createBrowserWorkspaceManager({
    indexedDB,
    crypto: globalThis.crypto,
    accountNamespace: 'https://cloud.example'
  })
  const sessionA = {
    user: { id: 'a', username: 'A' },
    access_token: 'token-a',
    cloud_base_url: 'https://cloud.example'
  }
  const sessionB = {
    user: { id: 'b', username: 'B' },
    access_token: 'token-b',
    cloud_base_url: 'https://cloud.example'
  }

  const local = await manager.switchToLocal()
  await local.repository.saveProvider({ id: 'local-only', name: 'Local' })
  await manager.tokenStore.save(sessionA)

  const accountA = await manager.switchToSession(sessionA)
  assert.deepEqual(await accountA.repository.listProviders(), [])
  await assert.rejects(local.repository.listProviders(), /尚未初始化/)
  await accountA.repository.saveProvider({ id: 'a-only', name: 'A' })

  await assert.rejects(manager.switchToAccount(sessionB.user), /不一致/)
  assert.equal(manager.services, accountA)
  await manager.tokenStore.save(sessionB)
  const accountB = await manager.switchToSession(sessionB)
  assert.deepEqual(await accountB.repository.listProviders(), [])
  await accountB.repository.saveProvider({ id: 'b-only', name: 'B' })

  await manager.tokenStore.save(sessionA)
  const reopenedA = await manager.switchToSession(sessionA)
  assert.deepEqual((await reopenedA.repository.listProviders()).map(item => item.id), ['a-only'])
  assert.deepEqual(await manager.tokenStore.load(), sessionA)

  const reopenedLocal = await manager.switchToLocal()
  assert.deepEqual((await reopenedLocal.repository.listProviders()).map(item => item.id), ['local-only'])
  await manager.close()
})

test('does not validate a stored token against a caller-supplied server namespace', async () => {
  const indexedDB = new IDBFactory()
  const manager = await createBrowserWorkspaceManager({ indexedDB, crypto: globalThis.crypto })
  const sessionA = {
    user: { id: 'same-id' },
    access_token: 'token-a',
    cloud_base_url: 'https://cloud-a.example'
  }
  const sessionB = {
    user: { id: 'same-id' },
    access_token: 'token-b',
    cloud_base_url: 'https://cloud-b.example'
  }
  await manager.tokenStore.save(sessionA)
  await manager.switchToSession(sessionA)
  await manager.tokenStore.save(sessionB)

  await assert.rejects(manager.switchToSession(sessionA), /不一致/)
  assert.equal(manager.workspaceId, deriveAccountWorkspaceId(sessionA.user, {
    accountNamespace: sessionA.cloud_base_url
  }))
  await manager.close()
})

test('creates the target workspace before stopping and closing the previous workspace', async () => {
  const events = []
  const accountWorkspaceId = deriveAccountWorkspaceId({ id: 'next' })
  const manager = new WorkspaceServiceManager({
    createServices: async ({ workspaceId }) => {
      events.push(`create:${workspaceId}`)
      return {
        workspaceId,
        chatService: {
          async stopAndWait() {
            events.push(`stop:${workspaceId}`)
            await Promise.resolve()
            events.push(`stopped:${workspaceId}`)
          }
        },
        repository: {
          async close() { events.push(`close:${workspaceId}`) }
        }
      }
    }
  })

  await manager.switchToLocal()
  await manager.switchToWorkspace(accountWorkspaceId, {
    beforeClose: () => events.push('before-close')
  })

  assert.deepEqual(events, [
    'create:local',
    `create:${accountWorkspaceId}`,
    'before-close',
    'stop:local',
    'stopped:local',
    'close:local'
  ])
  await manager.close()
})

test('keeps the current workspace usable when the target workspace cannot be created', async () => {
  const accountWorkspaceId = deriveAccountWorkspaceId({ id: 'broken-target' })
  let localClosed = false
  const localServices = {
    workspaceId: 'local',
    repository: {
      async close() { localClosed = true },
      async ping() {
        if (localClosed) throw new Error('closed')
        return 'ok'
      }
    }
  }
  const manager = new WorkspaceServiceManager({
    createServices: async ({ workspaceId }) => {
      if (workspaceId === accountWorkspaceId) throw new Error('target init failed')
      return localServices
    }
  })

  await manager.switchToLocal()
  await assert.rejects(manager.switchToWorkspace(accountWorkspaceId), /target init failed/)

  assert.equal(manager.services, localServices)
  assert.equal(manager.workspaceId, 'local')
  assert.equal(await manager.services.repository.ping(), 'ok')
  await manager.close()
})

test('disposes the prepared target and keeps the current workspace when beforeClose fails', async () => {
  const accountWorkspaceId = deriveAccountWorkspaceId({ id: 'cancelled-target' })
  const closed = []
  const manager = new WorkspaceServiceManager({
    createServices: async ({ workspaceId }) => ({
      workspaceId,
      repository: { async close() { closed.push(workspaceId) } }
    })
  })

  const local = await manager.switchToLocal()
  await assert.rejects(
    manager.switchToWorkspace(accountWorkspaceId, {
      beforeClose: () => { throw new Error('beforeClose failed') }
    }),
    /beforeClose failed/
  )

  assert.equal(manager.services, local)
  assert.equal(manager.workspaceId, 'local')
  assert.deepEqual(closed, [accountWorkspaceId])
  await manager.close()
})

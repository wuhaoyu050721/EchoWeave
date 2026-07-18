import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAppServices,
  createAppWorkspaceManager,
  resolveAndroidLocalDatabase
} from '../src/app/create-app-services.js'
import { AndroidKeystoreVault } from '../src/platform/app/android-keystore-vault.js'
import { PlusSqliteRepository } from '../src/platform/app/plus-sqlite-repository.js'
import { CloudTokenStore } from '../src/services/cloud-token-store.js'
import { createNodePlusSqlite } from './helpers/node-plus-sqlite.js'

function createUniApi() {
  let iv = 0
  return {
    request() { return { abort() {} } },
    aiChatKeystoreReady: () => true,
    aiChatKeystoreEncrypt(value) {
      iv += 1
      return JSON.stringify({
        version: 1,
        algorithm: 'AES-GCM',
        iv: `iv-${iv}`,
        ciphertext: Buffer.from(value).toString('base64')
      })
    },
    aiChatKeystoreDecrypt(recordJson) {
      return Buffer.from(JSON.parse(recordJson).ciphertext, 'base64').toString()
    }
  }
}

test('detects the ai_chat_local Android legacy database when present', async () => {
  const requested = []
  const plusApi = {
    io: {
      resolveLocalFileSystemURL(path, success, fail) {
        requested.push(path)
        if (path === '_doc/ai_chat_local.db') success({})
        else fail(new Error('missing'))
      }
    }
  }

  assert.deepEqual(await resolveAndroidLocalDatabase(plusApi), {
    name: 'ai_chat_local',
    path: '_doc/ai_chat_local.db'
  })
  assert.deepEqual(requested, ['_doc/ai-chat-custom.db', '_doc/ai_chat_local.db'])
})

test('refuses to choose silently when both Android legacy databases exist', async () => {
  const plusApi = {
    io: {
      resolveLocalFileSystemURL(_path, success) { success({}) }
    }
  }

  await assert.rejects(resolveAndroidLocalDatabase(plusApi), /多个历史本地数据库/)
})

test('preserves the Android local database and migrates its cloud token after a restart', async () => {
  const sqlite = createNodePlusSqlite({ persistOnClose: true })
  const uniApi = createUniApi()
  const legacyRepository = new PlusSqliteRepository({ sqlite })
  await legacyRepository.init()
  await legacyRepository.saveProvider({ id: 'local-provider', name: 'Local' })
  const legacyVault = new AndroidKeystoreVault({ nativeApi: uniApi })
  await legacyVault.init()
  const session = { user: { id: 9 }, access_token: 'android-token' }
  await new CloudTokenStore({ repository: legacyRepository, vault: legacyVault }).save(session)
  await legacyRepository.setSetting('cloudConfig', { baseUrl: 'https://legacy-cloud.example/' })
  await legacyRepository.close()

  const services = await createAppServices({ plusApi: { sqlite }, uniApi })

  assert.equal((await services.repository.listProviders())[0].id, 'local-provider')
  assert.deepEqual(await services.tokenStore.load(), {
    ...session,
    cloud_base_url: 'https://legacy-cloud.example'
  })
  assert.equal(services.deviceTokenMigration.status, 'migrated')
  assert.equal(await new CloudTokenStore({
    repository: services.repository,
    vault: services.vault
  }).load(), null)
  await services.dispose()
  sqlite.closeAll()
})

test('switches Android SQLite workspaces without exposing local, A, or B records', async () => {
  const sqlite = createNodePlusSqlite({ persistOnClose: true })
  const manager = await createAppWorkspaceManager({
    plusApi: { sqlite },
    uniApi: createUniApi(),
    accountNamespace: 'https://cloud.example'
  })
  const sessionA = {
    user: { id: 'account-a' },
    access_token: 'a',
    cloud_base_url: 'https://cloud.example'
  }
  const sessionB = {
    user: { id: 'account-b' },
    access_token: 'b',
    cloud_base_url: 'https://cloud.example'
  }

  const local = await manager.switchToLocal()
  await local.repository.saveProvider({ id: 'local-only', name: 'Local' })
  await manager.tokenStore.save(sessionA)

  const accountA = await manager.switchToSession(sessionA)
  assert.deepEqual(await accountA.repository.listProviders(), [])
  await assert.rejects(local.repository.listProviders(), /尚未初始化/)
  await accountA.repository.saveProvider({ id: 'a-only', name: 'A' })

  await manager.tokenStore.save(sessionB)
  const accountB = await manager.switchToSession(sessionB)
  assert.deepEqual(await accountB.repository.listProviders(), [])
  await accountB.repository.saveProvider({ id: 'b-only', name: 'B' })

  await manager.tokenStore.save(sessionA)
  const reopenedA = await manager.switchToSession(sessionA)
  assert.deepEqual((await reopenedA.repository.listProviders()).map(item => item.id), ['a-only'])
  const reopenedLocal = await manager.switchToLocal()
  assert.deepEqual((await reopenedLocal.repository.listProviders()).map(item => item.id), ['local-only'])
  assert.deepEqual(await manager.tokenStore.load(), sessionA)

  await manager.close()
  sqlite.closeAll()
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'
import { PlusSqliteRepository } from '../src/platform/app/plus-sqlite-repository.js'
import { createNodePlusSqlite } from './helpers/node-plus-sqlite.js'
import { BackupService } from '../src/services/backup-service.js'
import { createBackup, prepareImport } from '../src/core/backup-format.js'
import { createCloudBackupPayload, prepareCloudRestore } from '../src/core/cloud-backup-format.js'
import { CloudSyncRepositoryAdapter } from '../src/services/cloud-sync-repository-adapter.js'
import { DEVICE_LOCAL_SETTING_KEYS } from '../src/core/local-settings.js'

const vault = { encryptString: async value => ({ value }), decryptString: async record => record.value }
const emptyRecords = () => ({ providers: [], conversations: [], messages: [], attachments: [], characters: [], worldBooks: [], characterAssets: [], settings: {} })
const foreignLock = { appLockEnabled: true, appLock: { hash: 'foreign-pin-hash', salt: 'foreign-salt' } }

test('portable and encrypted formats exclude device secrets and reject them in legacy imports', async () => {
  const data = emptyRecords()
  data.settings = Object.fromEntries(DEVICE_LOCAL_SETTING_KEYS.map(key => [key, foreignLock]))
  data.settings.appearance = { theme: 'dark' }
  const portable = createBackup(data)
  const encryptedPayload = await createCloudBackupPayload(data, vault)
  for (const payload of [portable, encryptedPayload]) {
    assert.deepEqual(payload.settings, { appearance: { theme: 'dark' } })
    assert.equal(JSON.stringify(payload).includes('foreign-pin-hash'), false)
  }
  assert.deepEqual(prepareImport({ ...portable, settings: data.settings }).settings, portable.settings)
  assert.deepEqual((await prepareCloudRestore({ ...encryptedPayload, settings: data.settings }, { vault })).settings, portable.settings)
  assert.equal(data.settings.app, foreignLock, 'formatters must not mutate source records')
})

for (const platform of ['IndexedDB', 'SQLite']) {
  test(`${platform}: local, encrypted, and incremental imports preserve this device's lock`, async () => {
    const repository = platform === 'IndexedDB'
      ? new IndexedDbRepository({ indexedDB: new IDBFactory(), databaseName: `local-security-${crypto.randomUUID()}` })
      : new PlusSqliteRepository({ sqlite: createNodePlusSqlite(), databaseName: `local-security-${crypto.randomUUID()}`, databasePath: '_doc/security-test.db' })
    await repository.init()
    try {
      const localLock = { appLockEnabled: true, appLock: { hash: 'local-pin-hash', salt: 'local-salt' } }
      const localProxy = { enabled: true, mode: 'smart', url: '' }
      await repository.setSetting('app', localLock)
      await repository.setSetting('networkProxy', localProxy)
      const legacy = { ...emptyRecords(), settings: { app: foreignLock, networkProxy: { enabled: false }, appearance: { theme: 'dark' } } }
      await new BackupService({ repository }).importData({ ...legacy, formatVersion: 5 })
      assert.deepEqual(await repository.getSetting('app'), localLock)
      assert.deepEqual(await repository.getSetting('networkProxy'), localProxy)
      assert.deepEqual(await repository.getSetting('appearance'), { theme: 'dark' })

      legacy.settings.app = null
      await repository.importRecords(await prepareCloudRestore({ ...legacy, cloudFormatVersion: 5 }, { vault }))
      assert.deepEqual(await repository.getSetting('app'), localLock, 'cloud restore must not disable an existing PIN')

      const adapter = new CloudSyncRepositoryAdapter({ repository, vault, localOnlySettingKeys: [] })
      assert.equal((await adapter.readRecords()).some(record => record.entityType === 'settings' && record.entityId === 'app'), false)
      for (const operation of ['upsert', 'delete']) {
        assert.deepEqual(await adapter.applyRecord({ entityType: 'settings', entityId: 'app', operation, value: foreignLock }), { skipped: 'local_only_setting' })
        assert.deepEqual(await repository.getSetting('app'), localLock)
      }
      const exported = await new BackupService({ repository }).exportData()
      assert.equal('app' in exported.settings, false)
    } finally {
      await repository.close()
    }
  })
}

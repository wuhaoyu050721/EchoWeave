import assert from 'node:assert/strict'
import test from 'node:test'
import { CloudBackupScheduler } from '../src/services/cloud-backup-scheduler.js'
import { CloudSyncCredentialStore } from '../src/services/cloud-sync-credential-store.js'

test('stores the sync password only as device-vault ciphertext', async () => {
  let stored = null
  const repository = { getSecret: async () => stored, setSecret: async (_key, value) => { stored = value } }
  const vault = {
    encryptString: async value => ({ cipher: Buffer.from(value).toString('base64') }),
    decryptString: async value => Buffer.from(value.cipher, 'base64').toString()
  }
  const store = new CloudSyncCredentialStore({ repository, vault })

  await store.save('sync password secret')
  assert.equal(JSON.stringify(stored).includes('sync password secret'), false)
  assert.equal(await store.load(), 'sync password secret')

  await assert.rejects(
    store.save('different sync password'),
    error => error.code === 'sync_password_change_unsupported'
  )
  assert.equal(await store.load(), 'sync password secret')

  await store.clear()
  await store.save('different sync password')
  assert.equal(await store.load(), 'different sync password')
})

test('runs immediately and every interval without overlapping uploads', async () => {
  let intervalCallback
  let uploads = 0
  let release
  let markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  const scheduler = new CloudBackupScheduler({
    cloudBackupService: {
      upload: async input => {
        uploads += 1
        markStarted()
        if (uploads === 1) await new Promise(resolve => { release = resolve })
        return input
      }
    },
    credentialStore: { load: async () => 'sync password' },
    getDeviceId: async () => 'device-a',
    setIntervalFn: callback => { intervalCallback = callback; return 7 },
    clearIntervalFn: () => {}
  })

  const first = scheduler.start()
  await started
  const overlapping = scheduler.trigger('foreground')
  intervalCallback()
  assert.equal(uploads, 1)
  release()
  await first
  await overlapping
  await scheduler.trigger('manual')
  assert.equal(uploads, 2)
  scheduler.stop()
})

test('skips automatic backup when no encrypted sync password exists', async () => {
  let uploads = 0
  const scheduler = new CloudBackupScheduler({
    cloudBackupService: { upload: async () => { uploads += 1 } },
    credentialStore: { load: async () => '' },
    getDeviceId: async () => 'device-a',
    setIntervalFn: () => 1,
    clearIntervalFn: () => {}
  })

  assert.deepEqual(await scheduler.trigger(), { skipped: 'missing_sync_password' })
  assert.equal(uploads, 0)
})

test('stopAndWait blocks late triggers until the scheduler is explicitly started again', async () => {
  let release
  let uploads = 0
  const scheduler = new CloudBackupScheduler({
    cloudBackupService: {
      upload: async () => {
        uploads += 1
        await new Promise(resolve => { release = resolve })
        return { uploaded: true }
      }
    },
    credentialStore: { load: async () => 'sync password' },
    getDeviceId: async () => 'device-a',
    setIntervalFn: () => 3,
    clearIntervalFn: () => {}
  })

  scheduler.start()
  await new Promise(resolve => setImmediate(resolve))
  const stopping = scheduler.stopAndWait()
  assert.deepEqual(await scheduler.trigger('network-restored'), { skipped: 'stopped' })
  release()
  assert.equal(await stopping, true)
  assert.equal(uploads, 1)
})

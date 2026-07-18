import assert from 'node:assert/strict'
import test from 'node:test'
import { AndroidWorkManagerSyncAdapter } from '../src/services/android-workmanager-sync-adapter.js'
import { CloudSyncCoordinator } from '../src/services/cloud-sync-coordinator.js'

test('coalesces foreground, onShow, network-restored and manual triggers', async () => {
  let intervalCallback
  let calls = 0
  let release
  const statuses = []
  const coordinator = new CloudSyncCoordinator({
    syncEngine: {
      sync: async input => {
        calls += 1
        if (calls === 1) await new Promise(resolve => { release = resolve })
        return { ...input, calls }
      }
    },
    credentialStore: { load: async () => 'sync password secret' },
    getDeviceId: async () => 'device-a',
    getAccountId: async () => 'account-1',
    intervalMs: 60000,
    setIntervalFn: callback => { intervalCallback = callback; return 7 },
    clearIntervalFn: () => {},
    onStatus: status => statuses.push(status)
  })

  const first = coordinator.startForeground()
  await new Promise(resolve => setImmediate(resolve))
  const onShow = coordinator.onAppShow()
  const network = coordinator.onNetworkRestored()
  intervalCallback()
  assert.equal(calls, 1)
  release()
  assert.deepEqual(await onShow, await first)
  assert.deepEqual(await network, await first)

  await coordinator.manualSync()
  assert.equal(calls, 2)
  assert.deepEqual(statuses.map(status => status.state), ['syncing', 'completed', 'syncing', 'completed'])
  coordinator.stopForeground()
})

test('stopAndWait clears the foreground interval and waits for the active sync', async () => {
  let release
  let clearedInterval = null
  let waitFinished = false
  const coordinator = new CloudSyncCoordinator({
    syncEngine: {
      sync: async () => new Promise(resolve => { release = resolve })
    },
    credentialStore: { load: async () => 'sync password secret' },
    getDeviceId: async () => 'device-a',
    getAccountId: async () => 'account-1',
    setIntervalFn: () => 19,
    clearIntervalFn: interval => { clearedInterval = interval }
  })

  coordinator.startForeground()
  await new Promise(resolve => setImmediate(resolve))
  const waiting = coordinator.stopAndWait().then(result => {
    waitFinished = true
    return result
  })
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(clearedInterval, 19)
  assert.equal(waitFinished, false)
  release({ pushed: 1 })
  assert.equal(await waiting, true)
  assert.equal(waitFinished, true)
  assert.equal(coordinator.active, null)

  assert.deepEqual(await coordinator.onNetworkRestored(), { skipped: 'stopped' })
  assert.equal(await coordinator.stopAndWait(), false)
})

test('exposes a no-UI WorkManager entry point without claiming native scheduling', async () => {
  const adapter = new AndroidWorkManagerSyncAdapter({
    coordinator: { syncNow: async reason => ({ reason, pushed: 1 }) }
  })

  assert.deepEqual(adapter.capabilities, {
    schedulesNativeWork: false,
    survivesProcessTerminationWithoutNativeBridge: false,
    headlessEntryPoint: 'run'
  })
  assert.deepEqual(await adapter.run(), {
    outcome: 'success',
    result: { reason: 'android-work-manager', pushed: 1 }
  })
})

test('maps offline and transient failures to WorkManager retry outcomes', async () => {
  const offline = new AndroidWorkManagerSyncAdapter({
    coordinator: { syncNow: async () => ({ skipped: 'offline' }) }
  })
  const transient = new AndroidWorkManagerSyncAdapter({
    coordinator: {
      syncNow: async () => {
        const error = new Error('temporarily unavailable')
        error.status = 503
        throw error
      }
    }
  })

  assert.equal((await offline.run()).outcome, 'retry')
  assert.equal((await transient.run()).outcome, 'retry')
})

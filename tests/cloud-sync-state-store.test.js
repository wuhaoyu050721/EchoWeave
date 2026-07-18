import assert from 'node:assert/strict'
import test from 'node:test'
import { CloudSyncStateStore } from '../src/services/cloud-sync-state-store.js'

test('isolates manifests, cursors and encrypted pending mutations by account', async () => {
  const secrets = new Map()
  const repository = {
    getSecret: async key => structuredClone(secrets.get(key) ?? null),
    setSecret: async (key, value) => { secrets.set(key, structuredClone(value)) }
  }
  const store = new CloudSyncStateStore({ repository })
  const first = await store.load('account-a')
  first.cursor = 7
  first.manifest['["settings","appearance"]'] = { hash: 'a'.repeat(64), revision: 7 }
  first.pending.push({ mutationId: 'mutation-1', envelope: { ciphertext: 'opaque' } })
  await store.save('account-a', first)

  assert.equal((await store.load('account-a')).cursor, 7)
  assert.equal((await store.load('account-b')).cursor, 0)
  assert.equal(JSON.stringify(Array.from(secrets.values())).includes('mutation-1'), true)
  await store.clear('account-a')
  assert.equal((await store.load('account-a')).cursor, 0)
})

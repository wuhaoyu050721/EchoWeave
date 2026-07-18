import assert from 'node:assert/strict'
import test from 'node:test'
import { createDiagnosticLogStore } from '../src/core/diagnostic-log.js'

test('redacts API keys and bearer tokens from entries and exports', () => {
  const store = createDiagnosticLogStore({ now: () => 1000 })
  store.add('request', {
    message: 'Bearer secret-key',
    headers: { Authorization: 'Bearer secret-key' },
    secrets: ['secret-key']
  })

  assert.equal(JSON.stringify(store.entries()).includes('secret-key'), false)
  assert.equal(JSON.stringify(store.exportData({ apiKey: 'secret-key' })).includes('secret-key'), false)
})

test('limits retained entries and string detail length', () => {
  let timestamp = 0
  const store = createDiagnosticLogStore({ now: () => ++timestamp, maxEntries: 2, maxDetailLength: 8 })
  store.add('one', { message: '123456789' })
  store.add('two', { message: 'second' })
  store.add('three', { message: 'third' })

  assert.deepEqual(store.entries().map((entry) => entry.type), ['two', 'three'])
  assert.equal(store.entries()[0].message, 'second')
})

test('clears entries without retaining secret configuration', () => {
  const store = createDiagnosticLogStore({ now: () => 1000 })
  store.add('request', { message: 'secret', secrets: ['secret'] })
  store.clear()

  assert.deepEqual(store.entries(), [])
})

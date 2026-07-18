import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function loadRuntimeId() {
  try {
    return await import('../src/core/runtime-id.js')
  } catch {
    return null
  }
}

test('creates distinct IDs when the runtime has no Web Crypto API', async () => {
  const module = await loadRuntimeId()
  assert.ok(module, 'runtime ID module is missing')

  const options = { cryptoApi: null, now: () => 1234567890, random: () => 0.5 }
  const first = module.createRuntimeId(options)
  const second = module.createRuntimeId(options)

  assert.notEqual(first, second)
  assert.match(first, /^local-/)
})

test('shared services do not reference bare crypto.randomUUID', async () => {
  const paths = [
    '../src/services/provider-service.js',
    '../src/services/chat-service.js',
    '../src/services/backup-service.js',
    '../src/core/backup-format.js',
    '../src/core/cloud-backup-format.js'
  ]
  const sources = await Promise.all(paths.map(path => readFile(new URL(path, import.meta.url), 'utf8')))

  for (const source of sources) {
    assert.doesNotMatch(source, /\bcrypto\.randomUUID\(\)/)
    assert.match(source, /createRuntimeId/)
  }
})

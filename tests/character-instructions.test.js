import assert from 'node:assert/strict'
import test from 'node:test'
import { createUserNameResolver, syncProfileNameFromCloudSession } from '../src/app/create-character-instructions.js'

test('persists the cloud username for character user placeholders', async () => {
  const settings = new Map()
  const repository = {
    setSetting: async (key, value) => settings.set(key, value),
    getSetting: async (key, fallback) => settings.has(key) ? settings.get(key) : fallback
  }

  assert.equal(await syncProfileNameFromCloudSession(repository, { user: { username: '小明' } }), '小明')
  assert.equal(await createUserNameResolver(repository)(), '小明')
})

test('does not overwrite the local placeholder name with an empty cloud username', async () => {
  let writes = 0
  const repository = { setSetting: async () => { writes += 1 } }

  assert.equal(await syncProfileNameFromCloudSession(repository, { user: { username: '  ' } }), '')
  assert.equal(writes, 0)
})

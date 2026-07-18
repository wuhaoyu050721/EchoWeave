import test from 'node:test'
import assert from 'node:assert/strict'
import { isProxy, reactive } from 'vue'
import { preserveServiceIdentity } from '../src/app/vue-service-container.js'
import { readFile } from 'node:fs/promises'

class PrivateService {
  #value() {
    return 'ok'
  }

  read() {
    return this.#value()
  }
}

test('keeps service class instances outside Vue reactive proxies', () => {
  const services = preserveServiceIdentity({ repository: new PrivateService() })
  const state = reactive({ services })

  assert.equal(isProxy(state.services), false)
  assert.equal(isProxy(state.services.repository), false)
  assert.equal(state.services.repository.read(), 'ok')
})

test('keeps the workspace manager outside the main page reactive state', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(
    source,
    /this\.workspaceManager = markRaw\(await createPlatformWorkspaceManager\(\{ accountNamespace: DEFAULT_CLOUD_BASE_URL \}\)\)/
  )
})

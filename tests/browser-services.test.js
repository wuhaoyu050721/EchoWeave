import assert from 'node:assert/strict'
import test from 'node:test'
import { browserProxyPath } from '../src/app/create-browser-services.js'

test('uses the local proxy only for the dedicated preview route', () => {
  assert.equal(browserProxyPath('/preview/'), '/__ai_proxy')
  assert.equal(browserProxyPath('/preview/index.html'), '/__ai_proxy')
  assert.equal(browserProxyPath('/'), null)
})

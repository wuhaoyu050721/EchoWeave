import test from 'node:test'
import assert from 'node:assert/strict'
import { filterProxyRequestHeaders, validateProxyTarget } from '../src/platform/browser/proxy-rules.js'

test('accepts HTTP and HTTPS model targets including local services', () => {
  assert.equal(validateProxyTarget('https://api.openai.com/v1/models').href, 'https://api.openai.com/v1/models')
  assert.equal(validateProxyTarget('http://127.0.0.1:11434/v1/models').port, '11434')
})

test('rejects unsafe or recursive proxy targets', () => {
  assert.throws(() => validateProxyTarget('file:///tmp/key'), /HTTP/)
  assert.throws(() => validateProxyTarget('https://user:pass@example.com/v1'), /凭据/)
  assert.throws(() => validateProxyTarget('http://127.0.0.1:4173/__ai_proxy'), /代理/)
  assert.throws(() => validateProxyTarget('not a url'), /目标地址/)
})

test('forwards only model request headers and excludes proxy metadata', () => {
  const filtered = filterProxyRequestHeaders({
    authorization: 'Bearer hidden',
    'x-goog-api-key': 'gemini-hidden',
    'content-type': 'application/json',
    accept: 'text/event-stream',
    'x-ai-target-url': 'https://example.com',
    cookie: 'session=bad',
    connection: 'keep-alive'
  })

  assert.deepEqual(filtered, {
    authorization: 'Bearer hidden',
    'x-goog-api-key': 'gemini-hidden',
    'content-type': 'application/json',
    accept: 'text/event-stream'
  })
})

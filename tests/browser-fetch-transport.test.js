import test from 'node:test'
import assert from 'node:assert/strict'
import { BrowserFetchTransport, ModelHttpError } from '../src/platform/browser/browser-fetch-transport.js'

test('sends target through local proxy and returns response text', async () => {
  const requests = []
  const transport = new BrowserFetchTransport({
    fetch: async (url, options) => {
      requests.push({ url, options })
      return new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })

  const response = await transport.request({
    url: 'https://example.com/v1/models',
    headers: { Authorization: 'Bearer test' }
  })

  assert.equal(requests[0].url, '/__ai_proxy')
  assert.equal(requests[0].options.headers['x-ai-target-url'], 'https://example.com/v1/models')
  assert.equal(response.text, '{"data":[]}')
})

test('requests the target directly when the proxy is disabled', async () => {
  const requests = []
  const transport = new BrowserFetchTransport({
    proxyPath: null,
    fetch: async (url, options) => {
      requests.push({ url, options })
      return new Response('{"ok":true}', { status: 200 })
    }
  })

  await transport.request({
    url: 'http://118.145.98.165:8018/api/v1/backup/meta',
    headers: { Authorization: 'Bearer test' }
  })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'http://118.145.98.165:8018/api/v1/backup/meta')
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test')
  assert.equal(requests[0].options.headers['x-ai-target-url'], undefined)
})

test('falls back to the target when the local proxy route is missing', async () => {
  const requests = []
  const transport = new BrowserFetchTransport({
    fetch: async (url, options) => {
      requests.push({ url, options })
      if (url === '/__ai_proxy') return new Response(null, { status: 404 })
      return new Response('{"ok":true}', { status: 200 })
    }
  })

  const response = await transport.request({
    url: 'http://118.145.98.165:8018/api/v1/backup/meta',
    headers: { Authorization: 'Bearer test' }
  })

  assert.equal(requests.length, 2)
  assert.equal(requests[1].url, 'http://118.145.98.165:8018/api/v1/backup/meta')
  assert.equal(requests[1].options.headers.Authorization, 'Bearer test')
  assert.equal(requests[1].options.headers['x-ai-target-url'], undefined)
  assert.equal(response.text, '{"ok":true}')
})

test('does not retry a proxied JSON 404 against the target', async () => {
  let requestCount = 0
  const transport = new BrowserFetchTransport({
    fetch: async () => {
      requestCount += 1
      return new Response('{"error":{"message":"Backup not found"}}', {
        status: 404,
        headers: { 'content-type': 'application/json' }
      })
    }
  })

  await assert.rejects(
    transport.request({ url: 'http://118.145.98.165:8018/api/v1/backup' }),
    (error) => error instanceof ModelHttpError && error.status === 404 && /Backup not found/.test(error.message)
  )
  assert.equal(requestCount, 1)
})

test('delivers streamed bytes in order', async () => {
  const chunks = []
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('first'))
      controller.enqueue(new TextEncoder().encode('second'))
      controller.close()
    }
  })
  const transport = new BrowserFetchTransport({ fetch: async () => new Response(stream, { status: 200 }) })

  await transport.request({
    url: 'https://example.com/v1/chat/completions',
    onChunk: (chunk) => chunks.push(new TextDecoder().decode(chunk))
  })

  assert.deepEqual(chunks, ['first', 'second'])
})

test('returns binary response bodies for generated image downloads', async () => {
  const transport = new BrowserFetchTransport({
    fetch: async () => new Response(new Uint8Array([0, 1, 2]), {
      status: 200,
      headers: { 'content-type': 'image/png' }
    })
  })

  const response = await transport.request({
    url: 'https://cdn.example.com/image.png',
    responseType: 'arraybuffer'
  })

  assert.deepEqual([...response.data], [0, 1, 2])
  assert.equal(response.text, '')
})

test('passes AbortSignal to fetch and maps HTTP errors', async () => {
  const controller = new AbortController()
  let receivedSignal
  const transport = new BrowserFetchTransport({
    fetch: async (url, options) => {
      receivedSignal = options.signal
      return new Response('{"error":{"message":"bad key"}}', { status: 401 })
    }
  })

  await assert.rejects(
    transport.request({ url: 'https://example.com/v1/models', signal: controller.signal }),
    (error) => error instanceof ModelHttpError && error.status === 401 && /bad key/.test(error.message)
  )
  assert.equal(receivedSignal, controller.signal)
})

test('preserves the global receiver required by browser native fetch', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = function () {
    assert.equal(this, globalThis)
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }))
  }

  try {
    const transport = new BrowserFetchTransport()
    const response = await transport.request({ url: 'https://example.com/v1/models' })
    assert.equal(response.text, '{"ok":true}')
  } finally {
    globalThis.fetch = originalFetch
  }
})

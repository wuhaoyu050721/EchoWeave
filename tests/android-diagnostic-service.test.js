import assert from 'node:assert/strict'
import test from 'node:test'
import { createDiagnosticLogStore } from '../src/core/diagnostic-log.js'
import { AndroidDiagnosticService } from '../src/services/android-diagnostic-service.js'

const encoder = new TextEncoder()

function createService(transport, now = (() => {
  let value = 1000
  return () => value += 25
})()) {
  return new AndroidDiagnosticService({
    transport,
    logStore: createDiagnosticLogStore({ now }),
    now
  })
}

test('builds an OpenAI request and streams parsed deltas', async () => {
  let request
  let fullText = ''
  const states = []
  const service = createService({
    async request(value) {
      request = value
      value.onChunk(encoder.encode('data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}\n\n'))
      value.onChunk(encoder.encode('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
      return { statusCode: 200, headers: {} }
    }
  })

  const result = await service.start({
    baseUrl: 'https://example.com',
    apiKey: 'secret',
    model: 'demo-model',
    prompt: '测试',
    timeout: 12000
  }, {
    onDelta: (delta, text) => { fullText = text },
    onState: (state) => states.push(state)
  })

  assert.equal(request.url, 'https://example.com/v1/chat/completions')
  assert.equal(request.headers.Authorization, 'Bearer secret')
  assert.deepEqual(JSON.parse(request.body), {
    model: 'demo-model',
    messages: [{ role: 'user', content: '测试' }],
    stream: true
  })
  assert.equal(fullText, '你好')
  assert.equal(result.status, 'completed')
  assert.equal(result.finishReason, 'stop')
  assert.equal(result.doneReceived, true)
  assert.equal(result.chunkCount, 2)
  assert.equal(states.some((state) => state.status === 'streaming'), true)
})

test('builds a Gemini native request and parses Gemini SSE diagnostics', async () => {
  let request
  let fullText = ''
  const service = createService({
    async request(value) {
      request = value
      value.onChunk(encoder.encode(
        'data: {"candidates":[{"content":{"parts":[{"text":"Gemini 正常"}]},"finishReason":"STOP"}]}\n\n'
      ))
      return { statusCode: 200, headers: {} }
    }
  })

  const result = await service.start({
    protocolType: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'google-key',
    model: 'gemini-2.5-flash',
    prompt: '测试 Gemini'
  }, {
    onDelta: (delta, text) => { fullText = text }
  })

  assert.equal(
    request.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
  )
  assert.equal(request.headers['x-goog-api-key'], 'google-key')
  assert.equal(request.headers.Authorization, undefined)
  assert.deepEqual(JSON.parse(request.body), {
    contents: [{ role: 'user', parts: [{ text: '测试 Gemini' }] }]
  })
  assert.equal(fullText, 'Gemini 正常')
  assert.equal(result.status, 'completed')
  assert.equal(result.finishReason, 'STOP')
  assert.equal(result.eventCount, 1)
})

test('stops once and prevents late chunks from changing output', async () => {
  let output = ''
  const service = createService({
    request({ signal, onLateChunk }) {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          onLateChunk(encoder.encode('data: {"choices":[{"delta":{"content":"late"}}]}\n\n'))
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    }
  })

  const pending = service.start({ baseUrl: 'https://example.com', model: 'demo', prompt: 'stop' }, {
    onDelta: (delta, text) => { output = text }
  })
  assert.equal(service.stop(), true)
  assert.equal(service.stop(), false)
  const result = await pending

  assert.equal(result.status, 'aborted')
  assert.equal(output, '')
  assert.equal(service.isRunning(), false)
})

test('rejects concurrent sessions and reports malformed SSE as failed', async () => {
  let release
  const service = createService({
    request() { return new Promise((resolve) => { release = resolve }) }
  })
  const first = service.start({ baseUrl: 'https://example.com', model: 'demo', prompt: 'one' })
  await assert.rejects(
    service.start({ baseUrl: 'https://example.com', model: 'demo', prompt: 'two' }),
    /正在运行/
  )
  release({ statusCode: 200, headers: {} })
  await first

  const malformed = createService({
    async request({ onChunk }) {
      onChunk(encoder.encode('data: not-json\n\n'))
      return { statusCode: 200, headers: {} }
    }
  })
  const result = await malformed.start({ baseUrl: 'https://example.com', model: 'demo', prompt: 'bad' })
  assert.equal(result.status, 'failed')
  assert.match(result.errorMessage, /无法解析模型 SSE 数据/)
})

test('invalid base URLs do not leave a diagnostic session active', async () => {
  const service = createService({ request() { throw new Error('should not request') } })

  await assert.rejects(
    service.start({ baseUrl: 'not-a-url', model: 'demo', prompt: 'bad url' }),
    /有效 URL/
  )
  assert.equal(service.isRunning(), false)
})

test('uses the fallback abort controller when the App runtime omits the browser API', async () => {
  const nativeAbortController = globalThis.AbortController
  globalThis.AbortController = undefined
  try {
    const service = createService({
      async request({ onChunk }) {
        onChunk(encoder.encode('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
        return { statusCode: 200, headers: {} }
      }
    })
    const result = await service.start({ baseUrl: 'https://example.com', model: 'demo', prompt: 'fallback' })
    assert.equal(result.status, 'completed')
  } finally {
    globalThis.AbortController = nativeAbortController
  }
})

test('does not report success when a 200 response has no stream or non-SSE chunks', async () => {
  const empty = createService({
    async request() { return { statusCode: 200, headers: {} } }
  })
  const emptyResult = await empty.start({ baseUrl: 'https://example.com', model: 'demo', prompt: 'empty' })
  assert.equal(emptyResult.status, 'failed')
  assert.match(emptyResult.errorMessage, /没有收到任何流式分块/)

  const nonSse = createService({
    async request({ onChunk }) {
      onChunk(encoder.encode('{"message":"not a stream"}'))
      return { statusCode: 200, headers: {} }
    }
  })
  const nonSseResult = await nonSse.start({ baseUrl: 'https://example.com', model: 'demo', prompt: 'json' })
  assert.equal(nonSseResult.status, 'failed')
  assert.match(nonSseResult.errorMessage, /不是 OpenAI SSE 数据/)
})

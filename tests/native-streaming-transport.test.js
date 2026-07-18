import assert from 'node:assert/strict'
import test from 'node:test'
import { ModelHttpError } from '../src/core/model-http-error.js'
import { NativeStreamingTransport } from '../src/platform/app/native-streaming-transport.js'

test('forwards native headers and decoded chunks in order', async () => {
  let options
  let streamListener
  const chunks = []
  const headers = []
  const nativeApi = {
    onAiChatStreamEvent(callback) { streamListener = callback },
    aiChatStreamRequest(value) { options = value },
    aiChatStreamCancel() { return false }
  }
  const transport = new NativeStreamingTransport({ nativeApi })
  const pending = transport.request({
    url: 'https://example.com/v1/chat/completions',
    headers: { Accept: 'text/event-stream' },
    body: '{}',
    timeout: 12000,
    onHeaders: value => headers.push(value),
    onChunk: bytes => chunks.push(new TextDecoder().decode(bytes))
  })

  streamListener({
    requestId: options.requestId,
    eventType: 'headers',
    statusCode: 200,
    headers: [{ name: 'Content-Type', value: 'text/event-stream' }]
  })
  streamListener({ requestId: options.requestId, eventType: 'chunk', data: Buffer.from('第一块').toString('base64') })
  streamListener({ requestId: options.requestId, eventType: 'chunk', data: Buffer.from(' second').toString('base64') })
  streamListener({ requestId: options.requestId, eventType: 'success', statusCode: 200, headers: [] })

  assert.deepEqual(await pending, { status: 200, headers: {}, text: '' })
  assert.equal(options.method, 'POST')
  assert.equal(options.timeout, 12000)
  assert.deepEqual(options.headers, [{ name: 'Accept', value: 'text/event-stream' }])
  assert.deepEqual(chunks, ['第一块', ' second'])
  assert.deepEqual(headers, [{ statusCode: 200, headers: { 'content-type': 'text/event-stream' } }])
})

test('settles abort before native cancellation callbacks can race it', async () => {
  let options
  let streamListener
  let cancelledId = ''
  const nativeApi = {
    onAiChatStreamEvent(callback) { streamListener = callback },
    aiChatStreamRequest(value) { options = value },
    aiChatStreamCancel(requestId) {
      cancelledId = requestId
      streamListener({ requestId, eventType: 'failure', code: 'network_error', message: 'disconnect raced' })
      return true
    }
  }
  const controller = new AbortController()
  const transport = new NativeStreamingTransport({ nativeApi })
  const pending = transport.request({ url: 'https://example.com', signal: controller.signal })

  controller.abort()

  await assert.rejects(pending, (error) => error.name === 'AbortError' && error.code === 'request_aborted')
  assert.equal(cancelledId, options.requestId)
})

test('maps native HTTP and network failures', async () => {
  let options
  let streamListener
  const nativeApi = {
    onAiChatStreamEvent(callback) { streamListener = callback },
    aiChatStreamRequest(value) { options = value },
    aiChatStreamCancel() { return false }
  }
  const transport = new NativeStreamingTransport({ nativeApi })

  const httpPending = transport.request({ url: 'https://example.com' })
  streamListener({
    requestId: options.requestId,
    eventType: 'failure',
    code: 'http_error',
    statusCode: 401,
    body: '{"error":{"message":"bad key"}}',
    message: 'HTTP 401'
  })
  await assert.rejects(
    httpPending,
    error => error instanceof ModelHttpError && error.code === 'authentication_error' && /bad key/.test(error.message)
  )

  const networkPending = transport.request({ url: 'https://example.com' })
  streamListener({
    requestId: options.requestId,
    eventType: 'failure',
    code: 'network_error',
    message: 'offline',
    statusCode: 0,
    body: ''
  })
  await assert.rejects(networkPending, error => error.code === 'network_error' && /offline/.test(error.message))
})

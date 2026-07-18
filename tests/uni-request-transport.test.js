import assert from 'node:assert/strict'
import test from 'node:test'
import { extractModelErrorMessage, ModelHttpError } from '../src/core/model-http-error.js'
import { UniRequestTransport } from '../src/platform/app/uni-request-transport.js'

test('localizes the missing API key response shown by compatible gateways', () => {
  const message = extractModelErrorMessage(JSON.stringify({
    error: { message: 'API key is required in Authorization header (Bearer scheme), x-api-key header, or x-goog-api-key header' }
  }), 401)

  assert.equal(message, 'API 密钥缺失或无效，请在接口页面填写并保存后重试')
})

test('returns text responses for normal requests', async () => {
  let options
  const transport = new UniRequestTransport({
    uniApi: {
      request(value) {
        options = value
        return { abort() {} }
      }
    }
  })
  const pending = transport.request({
    url: 'https://example.com/v1/models', method: 'GET', headers: { Authorization: 'Bearer key' }
  })
  options.success({ statusCode: 200, header: { server: 'test' }, data: '{"data":[]}' })

  assert.deepEqual(await pending, { status: 200, headers: { server: 'test' }, text: '{"data":[]}' })
  assert.equal(options.dataType, 'text')
  assert.equal(options.responseType, 'text')
})

test('returns arraybuffer bodies for generated image downloads', async () => {
  let options
  const transport = new UniRequestTransport({
    uniApi: {
      request(value) {
        options = value
        return { abort() {} }
      }
    }
  })
  const pending = transport.request({
    url: 'https://cdn.example.com/image.png', responseType: 'arraybuffer'
  })
  options.success({ statusCode: 200, header: { 'content-type': 'image/png' }, data: new Uint8Array([1, 2]).buffer })

  const response = await pending
  assert.equal(options.responseType, 'arraybuffer')
  assert.deepEqual([...response.data], [1, 2])
  assert.equal(response.text, '')
})

test('streams arraybuffer chunks in order', async () => {
  let options
  let chunkListener
  const chunks = []
  const transport = new UniRequestTransport({
    uniApi: {
      request(value) {
        options = value
        return { onChunkReceived(listener) { chunkListener = listener }, abort() {} }
      }
    }
  })
  const pending = transport.request({
    url: 'https://example.com/v1/chat/completions', method: 'POST', body: '{}',
    onChunk: (bytes) => chunks.push([...bytes])
  })
  chunkListener({ data: new Uint8Array([1, 2]).buffer })
  chunkListener({ data: new Uint8Array([3]).buffer })
  options.success({ statusCode: 200, header: {}, data: new ArrayBuffer(0) })

  assert.deepEqual(await pending, { status: 200, headers: {}, text: '' })
  assert.equal(options.enableChunked, true)
  assert.equal(options.responseType, 'arraybuffer')
  assert.deepEqual(chunks, [[1, 2], [3]])
})

test('delegates streams to a native streaming transport when configured', async () => {
  let received
  const streamingResult = { status: 200, headers: {}, text: '' }
  const transport = new UniRequestTransport({
    uniApi: { request() { assert.fail('uni.request should not handle native streams') } },
    streamingTransport: {
      async request(options) {
        received = options
        return streamingResult
      }
    }
  })
  const onChunk = () => {}

  assert.equal(await transport.request({ url: 'https://example.com', method: 'POST', body: '{}', onChunk }), streamingResult)
  assert.equal(received.url, 'https://example.com')
  assert.equal(received.onChunk, onChunk)
})

test('maps authentication errors and network failures', async () => {
  let httpOptions
  const http = new UniRequestTransport({
    uniApi: { request(value) { httpOptions = value; return { abort() {} } } }
  })
  const httpPending = http.request({ url: 'https://example.com' })
  httpOptions.success({ statusCode: 401, header: {}, data: '{"error":{"message":"bad key"}}' })
  await assert.rejects(
    httpPending,
    (error) => error instanceof ModelHttpError && error.code === 'authentication_error' && /bad key/.test(error.message)
  )

  let networkOptions
  const network = new UniRequestTransport({
    uniApi: { request(value) { networkOptions = value; return { abort() {} } } }
  })
  const networkPending = network.request({ url: 'https://example.com' })
  networkOptions.fail({ errMsg: 'request:fail offline' })
  await assert.rejects(networkPending, /offline/)
})

test('preserves JSON error details for arraybuffer image requests', async () => {
  let options
  const transport = new UniRequestTransport({
    uniApi: { request(value) { options = value; return { abort() {} } } }
  })
  const pending = transport.request({
    url: 'https://example.com/v1/images/generations', responseType: 'arraybuffer'
  })
  const bytes = new TextEncoder().encode('{"error":{"message":"image model unavailable"}}')
  options.success({ statusCode: 400, header: {}, data: bytes.buffer })

  await assert.rejects(
    pending,
    (error) => error instanceof ModelHttpError && /image model unavailable/.test(error.message)
  )
})

test('maps App request timeouts to a readable error with the configured duration', async () => {
  let options
  const transport = new UniRequestTransport({
    uniApi: { request(value) { options = value; return { abort() {} } } }
  })
  const pending = transport.request({ url: 'https://example.com', timeout: 300000 })
  options.fail({ errMsg: 'request:fail abort statusCode:-1 timeout' })

  await assert.rejects(
    pending,
    (error) => error.code === 'request_timeout' && /300 秒/.test(error.message)
  )
})

test('aborts immediately and requires chunk callback support only for streams', async () => {
  let abortCalls = 0
  const controller = new AbortController()
  const transport = new UniRequestTransport({
    uniApi: { request() { return { abort() { abortCalls += 1 } } } }
  })
  const pending = transport.request({ url: 'https://example.com', signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, (error) => error.name === 'AbortError')
  assert.equal(abortCalls, 1)

  await assert.rejects(
    transport.request({ url: 'https://example.com', onChunk() {} }),
    (error) => error.code === 'chunk_callback_unsupported'
  )
})

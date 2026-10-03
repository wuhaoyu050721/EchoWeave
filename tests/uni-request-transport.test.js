import assert from 'node:assert/strict'
import test from 'node:test'
import { extractModelErrorMessage, ModelHttpError } from '../src/core/model-http-error.js'
import { NativeStreamingTransport } from '../src/platform/app/native-streaming-transport.js'
import { UniRequestTransport } from '../src/platform/app/uni-request-transport.js'
import { OpenAIProvider } from '../src/providers/openai-provider.js'

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

test('recovers an Android success body when the runtime never fires its supported chunk callback', async () => {
  const body = JSON.stringify({ choices: [{ message: { content: 'Android complete reply' }, finish_reason: 'stop' }] })
  let requestCalls = 0
  const provider = new OpenAIProvider({ transport: new UniRequestTransport({
    uniApi: { request(options) {
      requestCalls += 1
      queueMicrotask(() => options.success({ statusCode: 200, header: { 'content-type': 'application/json' }, data: new TextEncoder().encode(body).buffer }))
      return { onChunkReceived() {}, abort() {} }
    } }
  }) })
  const deltas = []
  const result = await provider.streamChat({ baseUrl: 'https://example.test/v1' }, {
    model: 'model', messages: [{ role: 'user', content: 'continue' }]
  }, { onDelta: text => deltas.push(text) })

  assert.deepEqual(deltas, ['Android complete reply'])
  assert.equal(requestCalls, 1)
  assert.equal(result.responseDiagnostics.chunkCount, 0)
  assert.equal(result.responseDiagnostics.receivedBytes, new TextEncoder().encode(body).length)
  assert.equal(result.responseDiagnostics.responseFormat, 'json')
})

test('does not replay an aggregate Android success body after live chunks', async () => {
  let options
  let onChunk
  const transport = new UniRequestTransport({ uniApi: { request(value) {
    options = value
    return { onChunkReceived(callback) { onChunk = callback }, abort() {} }
  } } })
  const chunks = []
  const pending = transport.request({ url: 'https://example.test', onChunk: bytes => chunks.push(new TextDecoder().decode(bytes)) })
  onChunk({ data: new TextEncoder().encode('live output').buffer })
  options.success({ statusCode: 200, data: 'live output' })
  const result = await pending
  assert.deepEqual(chunks, ['live output'])
  assert.equal(result.text, '')
})

test('keeps native HTTP headers in provider diagnostics when the stream later times out', async () => {
  let listener
  const nativeApi = {
    onAiChatStreamEvent(callback) { listener = callback },
    aiChatStreamCancel() {},
    aiChatStreamRequest({ requestId }) {
      queueMicrotask(() => {
        listener({ requestId, eventType: 'headers', statusCode: 200, headers: [{ name: 'content-type', value: 'text/event-stream' }] })
        listener({ requestId, eventType: 'chunk', data: Buffer.from('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n').toString('base64') })
        listener({ requestId, eventType: 'failure', code: 'request_timeout', message: 'timeout' })
      })
    }
  }
  const provider = new OpenAIProvider({ transport: new UniRequestTransport({
    uniApi: { request() { assert.fail('native transport must be used') } },
    streamingTransport: new NativeStreamingTransport({ nativeApi })
  }) })
  await assert.rejects(provider.streamChat({ baseUrl: 'https://example.test/v1' }, {
    model: 'model', messages: [{ role: 'user', content: 'continue' }]
  }), error => {
    assert.equal(error.code, 'request_timeout')
    assert.equal(error.responseDiagnostics.status, 200)
    assert.equal(error.responseDiagnostics.contentType, 'text/event-stream')
    assert.equal(error.responseDiagnostics.textCharacters, 7)
    assert.ok(error.responseDiagnostics.receivedBytes > 0)
    return true
  })
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

test('routes non-streaming requests through the native transport when an App proxy is enabled', async () => {
  let options
  let streamListener
  const nativeApi = {
    onAiChatStreamEvent(callback) { streamListener = callback },
    aiChatStreamRequest(value) { options = value },
    aiChatStreamCancel() { return false }
  }
  const transport = new UniRequestTransport({
    uniApi: { request() { assert.fail('proxied App requests should bypass uni.request') } },
    getProxyUrl: async () => 'http://192.168.1.10:7897',
    streamingTransport: new NativeStreamingTransport({ nativeApi })
  })
  const pending = transport.request({
    url: 'https://example.com/v1/models',
    headers: { Accept: 'application/json' }
  })

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(options.proxyUrl, 'http://192.168.1.10:7897')
  streamListener({ requestId: options.requestId, eventType: 'headers', statusCode: 200, headers: [] })
  streamListener({ requestId: options.requestId, eventType: 'chunk', data: Buffer.from('{"data":[]}').toString('base64') })
  streamListener({ requestId: options.requestId, eventType: 'success', statusCode: 200, headers: [] })

  assert.deepEqual(await pending, { status: 200, headers: {}, text: '{"data":[]}' })
})

function createNativeApiStub(onRequest) {
  const api = {
    listener: null,
    onAiChatStreamEvent(callback) { api.listener = callback },
    aiChatStreamRequest(value) { onRequest(api, value) },
    aiChatStreamCancel() { return false }
  }
  return api
}

function emitFailure(listener, requestId, { statusCode = 0, code = 'network_error', message = 'Connection refused' } = {}) {
  listener({ requestId, eventType: 'failure', statusCode, headers: [], data: '', code, message, body: '' })
}

function emitBody(listener, requestId, text) {
  listener({ requestId, eventType: 'headers', statusCode: 200, headers: [] })
  listener({ requestId, eventType: 'chunk', statusCode: 200, headers: [], data: Buffer.from(text).toString('base64'), code: '', message: '', body: '' })
  listener({ requestId, eventType: 'success', statusCode: 200, headers: [], data: '', code: '', message: '', body: '' })
}

test('falls back to a direct request when the detected App proxy fails before any data arrives', async () => {
  const attempts = []
  const failures = []
  const nativeApi = createNativeApiStub((api, value) => {
    attempts.push(value.proxyUrl)
    setImmediate(() => {
      if (value.proxyUrl) emitFailure(api.listener, value.requestId)
      else emitBody(api.listener, value.requestId, 'direct ok')
    })
  })
  const transport = new UniRequestTransport({
    uniApi: { request() { assert.fail('proxied App requests should bypass uni.request') } },
    getProxyRoute: async () => ({ proxyUrl: 'http://127.0.0.1:7890', allowDirectFallback: true }),
    onProxyFailure: (url, error) => failures.push({ url, code: error.code }),
    streamingTransport: new NativeStreamingTransport({ nativeApi })
  })
  const chunks = []
  const response = await transport.request({
    url: 'https://example.com/v1/chat/completions',
    method: 'POST',
    body: '{}',
    headers: { Accept: 'text/event-stream' },
    onChunk: bytes => chunks.push(new TextDecoder().decode(bytes))
  })

  assert.deepEqual(attempts, ['http://127.0.0.1:7890', ''])
  assert.deepEqual(chunks, ['direct ok'])
  assert.equal(response.status, 200)
  assert.deepEqual(failures, [{ url: 'http://127.0.0.1:7890', code: 'network_error' }])
})

test('never retries once the proxy has produced output or returned a real HTTP status', async () => {
  const streamedAttempts = []
  const streamApi = createNativeApiStub((api, value) => {
    streamedAttempts.push(value.proxyUrl)
    setImmediate(() => {
      api.listener({ requestId: value.requestId, eventType: 'chunk', statusCode: 200, headers: [], data: Buffer.from('部分内容').toString('base64'), code: '', message: '', body: '' })
      emitFailure(api.listener, value.requestId)
    })
  })
  const streaming = new UniRequestTransport({
    uniApi: { request() { assert.fail('should stay on the native transport') } },
    getProxyRoute: async () => ({ proxyUrl: 'http://127.0.0.1:7890', allowDirectFallback: true }),
    streamingTransport: new NativeStreamingTransport({ nativeApi: streamApi })
  })
  await assert.rejects(
    streaming.request({ url: 'https://example.com', method: 'POST', body: '{}', onChunk() {} }),
    (error) => error.code === 'network_error'
  )
  assert.deepEqual(streamedAttempts, ['http://127.0.0.1:7890'])

  const httpAttempts = []
  const httpApi = createNativeApiStub((api, value) => {
    httpAttempts.push(value.proxyUrl)
    setImmediate(() => emitFailure(api.listener, value.requestId, {
      statusCode: 401,
      code: 'http_error',
      message: '模型接口返回 HTTP 401'
    }))
  })
  const http = new UniRequestTransport({
    uniApi: { request() { assert.fail('should stay on the native transport') } },
    getProxyRoute: async () => ({ proxyUrl: 'http://127.0.0.1:7890', allowDirectFallback: true }),
    streamingTransport: new NativeStreamingTransport({ nativeApi: httpApi })
  })
  await assert.rejects(
    http.request({ url: 'https://example.com/v1/models' }),
    (error) => error.status === 401
  )
  assert.deepEqual(httpAttempts, ['http://127.0.0.1:7890'])
})

for (const streaming of [false, true]) {
  for (const scenario of [
    { name: 'headers then timeout', headers: true, code: 'request_timeout', message: 'read timed out' },
    { name: 'timeout before headers', headers: false, code: 'request_timeout', message: 'read timed out' },
    { name: 'connection reset before headers', headers: false, code: 'network_error', message: 'Connection reset' },
    { name: 'headers then a connection failure', headers: true, code: 'network_error', message: 'Connection refused' }
  ]) {
    test(`does not replay an uncertain proxy POST: ${scenario.name} (${streaming ? 'stream' : 'non-stream'})`, async () => {
      const attempts = []
      const nativeApi = createNativeApiStub((api, value) => {
        attempts.push(value.proxyUrl)
        setImmediate(() => {
          if (scenario.headers) api.listener({ requestId: value.requestId, eventType: 'headers', statusCode: 200, headers: [] })
          emitFailure(api.listener, value.requestId, { code: scenario.code, message: scenario.message })
        })
      })
      const transport = new UniRequestTransport({
        uniApi: { request() { assert.fail('must not retry via uni') } },
        getProxyRoute: async () => ({ proxyUrl: 'http://127.0.0.1:7890', allowDirectFallback: true }),
        onProxyFailure() { assert.fail('do not disable a proxy after an ambiguous response') },
        streamingTransport: new NativeStreamingTransport({ nativeApi })
      })
      await assert.rejects(transport.request({
        url: 'https://example.com/v1/chat/completions', method: 'POST', body: '{}',
        ...(streaming ? { onChunk() {} } : {})
      }), error => error.code === scenario.code)
      assert.deepEqual(attempts, ['http://127.0.0.1:7890'])
    })
  }
}

for (const responseType of ['text', 'arraybuffer']) {
  test(`does not replay a non-streaming proxy POST after ${responseType} bytes arrive without headers`, async () => {
    const attempts = []
    const proxyUrl = 'http://127.0.0.1:7890'
    const failure = Object.assign(new Error('Connection refused'), { code: 'network_error' })
    const transport = new UniRequestTransport({
      getProxyRoute: async () => ({ proxyUrl, allowDirectFallback: true }),
      onProxyFailure() { assert.fail('a proxy that returned bytes must not be suppressed') },
      streamingTransport: { request(options) {
        attempts.push(options.proxyUrl)
        options.onChunk(new TextEncoder().encode('accepted response'))
        return Promise.reject(failure)
      } },
      uniApi: { request() { assert.fail('a response body must prevent direct replay even without response headers') } }
    })

    await assert.rejects(transport.request({
      url: 'https://example.test/v1/chat/completions', method: 'POST', body: '{}', responseType
    }), error => error === failure)
    assert.deepEqual(attempts, [proxyUrl])
  })

  test(`an empty non-streaming ${responseType} chunk still permits safe smart proxy fallback`, async () => {
    const attempts = []
    const failures = []
    const proxyUrl = 'http://127.0.0.1:7890'
    const transport = new UniRequestTransport({
      getProxyRoute: async () => ({ proxyUrl, allowDirectFallback: true }),
      onProxyFailure: url => failures.push(url),
      streamingTransport: { request(options) {
        attempts.push(['native', options.proxyUrl])
        options.onChunk(new Uint8Array())
        return Promise.reject(Object.assign(new Error('Connection refused'), { code: 'network_error' }))
      } },
      uniApi: { request(options) {
        attempts.push(['uni', options.url])
        queueMicrotask(() => options.success({
          statusCode: 200,
          data: responseType === 'arraybuffer' ? new Uint8Array([1, 2]).buffer : 'direct ok'
        }))
        return { abort() {} }
      } }
    })

    const response = await transport.request({
      url: 'https://example.test/v1/chat/completions', method: 'POST', body: '{}', responseType
    })
    assert.deepEqual(attempts, [['native', proxyUrl], ['uni', 'https://example.test/v1/chat/completions']])
    assert.deepEqual(failures, [proxyUrl])
    if (responseType === 'arraybuffer') assert.deepEqual([...response.data], [1, 2])
    else assert.equal(response.text, 'direct ok')
  })
}

test('falls back to uni.request for a non-streaming smart proxy connection refusal', async () => {
  const attempts = []
  const failures = []
  const proxyUrl = 'http://127.0.0.1:7890'
  const nativeApi = createNativeApiStub((api, value) => {
    attempts.push(['native', value.proxyUrl])
    setImmediate(() => emitFailure(api.listener, value.requestId))
  })
  const transport = new UniRequestTransport({
    getProxyRoute: async () => ({ proxyUrl, allowDirectFallback: true }),
    onProxyFailure: url => failures.push(url),
    streamingTransport: new NativeStreamingTransport({ nativeApi }),
    uniApi: { request(options) {
      attempts.push(['uni', options.url])
      queueMicrotask(() => options.success({ statusCode: 200, data: 'direct ok' }))
      return { abort() {} }
    } }
  })

  const response = await transport.request({ url: 'https://example.test/v1/chat/completions', method: 'POST', body: '{}' })
  assert.deepEqual(attempts, [['native', proxyUrl], ['uni', 'https://example.test/v1/chat/completions']])
  assert.deepEqual(failures, [proxyUrl])
  assert.equal(response.text, 'direct ok')
})

for (const streaming of [false, true]) {
  for (const resolver of ['route', 'legacy']) {
    test(`preserves a manual proxy failure without direct retry (${streaming ? 'stream' : 'non-stream'}, ${resolver})`, async () => {
      const attempts = []
      const proxyUrl = 'http://127.0.0.1:7890'
      const failure = Object.assign(new Error('Connection refused: 127.0.0.1:7890'), { code: 'network_error' })
      const transport = new UniRequestTransport({
        ...(resolver === 'route'
          ? { getProxyRoute: async () => ({ proxyUrl, allowDirectFallback: false }) }
          : { getProxyUrl: async () => proxyUrl }),
        onProxyFailure() { assert.fail('manual failures must not suppress the configured proxy') },
        streamingTransport: { request(options) {
          attempts.push(options.proxyUrl)
          return Promise.reject(failure)
        } },
        uniApi: { request() { assert.fail('manual proxy failures must not use direct requests') } }
      })

      await assert.rejects(transport.request({
        url: 'https://example.test/v1/chat/completions', method: 'POST', body: '{}',
        ...(streaming ? { onChunk() {} } : {})
      }), error => error === failure)
      assert.deepEqual(attempts, [proxyUrl])
    })

    test(`rejects an enabled proxy when the native transport is missing (${streaming ? 'stream' : 'non-stream'}, ${resolver})`, async () => {
      const proxyUrl = 'http://127.0.0.1:7890'
      const transport = new UniRequestTransport({
        ...(resolver === 'route'
          ? { getProxyRoute: async () => ({ proxyUrl, allowDirectFallback: false }) }
          : { getProxyUrl: async () => proxyUrl }),
        uniApi: { request() { assert.fail('a configured proxy must not be silently ignored') } }
      })

      await assert.rejects(transport.request({
        url: 'https://example.test/v1/chat/completions', method: 'POST', body: '{}',
        ...(streaming ? { onChunk() {} } : {})
      }), error => error.code === 'proxy_transport_unavailable' && /不支持代理请求/.test(error.message))
    })

    test(`does not send a request cancelled while resolving its proxy (${streaming ? 'stream' : 'non-stream'}, ${resolver})`, async () => {
      const controller = new AbortController()
      let finishResolution
      let requests = 0
      const resolveProxy = () => new Promise(resolve => { finishResolution = resolve })
      const transport = new UniRequestTransport({
        ...(resolver === 'route' ? { getProxyRoute: resolveProxy } : { getProxyUrl: resolveProxy }),
        streamingTransport: { request() { requests += 1; assert.fail('cancelled requests must not reach native transport') } },
        uniApi: { request() { requests += 1; assert.fail('cancelled requests must not reach uni.request') } }
      })
      const pending = transport.request({
        url: 'https://example.test/v1/chat/completions', method: 'POST', body: '{}', signal: controller.signal,
        ...(streaming ? { onChunk() {} } : {})
      })
      await Promise.resolve()
      controller.abort()
      finishResolution(resolver === 'route' ? { proxyUrl: '', allowDirectFallback: true } : '')

      await assert.rejects(pending, error => error.name === 'AbortError' && error.code === 'request_aborted')
      assert.equal(requests, 0)
    })
  }
}

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

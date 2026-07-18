import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAIProvider, serializeOpenAIMessages } from '../src/providers/openai-provider.js'

test('loads and sorts model identifiers', async () => {
  const requests = []
  const provider = new OpenAIProvider({
    transport: {
      async request(options) {
        requests.push(options)
        return { text: JSON.stringify({ data: [{ id: 'z-model' }, { id: 'a-model' }] }) }
      }
    }
  })

  const models = await provider.listModels({ baseUrl: 'https://example.com', apiKey: 'key' })

  assert.deepEqual(models, ['a-model', 'z-model'])
  assert.equal(requests[0].url, 'https://example.com/v1/models')
  assert.equal(requests[0].headers.Authorization, 'Bearer key')
})

test('streams Chat Completions deltas and sends expected payload', async () => {
  const requests = []
  const deltas = []
  const provider = new OpenAIProvider({
    transport: {
      async request(options) {
        requests.push(options)
        options.onChunk(new TextEncoder().encode(
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n' +
          'data: [DONE]\n\n'
        ))
        return { text: '' }
      }
    }
  })

  const result = await provider.streamChat({ baseUrl: 'https://example.com/v1', apiKey: '' }, {
    model: 'test-model',
    messages: [{ role: 'user', content: 'Hi' }]
  }, { onDelta: (value) => deltas.push(value) })

  assert.deepEqual(deltas, ['Hello', ' world'])
  assert.equal(result.finishReason, 'stop')
  assert.equal(requests[0].url, 'https://example.com/v1/chat/completions')
  assert.equal(requests[0].headers.Authorization, undefined)
  assert.deepEqual(JSON.parse(requests[0].body), {
    model: 'test-model',
    messages: [{ role: 'user', content: 'Hi' }],
    stream: true
  })
})

test('rejects malformed model responses', async () => {
  const provider = new OpenAIProvider({ transport: { request: async () => ({ text: '{}' }) } })
  await assert.rejects(provider.listModels({ baseUrl: 'https://example.com/v1' }), /模型列表/)
})

test('serializes image and text attachments as ordered content parts', () => {
  const messages = serializeOpenAIMessages([{
    role: 'user',
    content: 'Review these',
    attachments: [
      { kind: 'image', dataUrl: 'data:image/jpeg;base64,AA==' },
      { kind: 'text', name: 'notes.txt', textContent: 'hello' }
    ]
  }])

  assert.deepEqual(messages, [{
    role: 'user',
    content: [
      { type: 'text', text: 'Review these' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA==' } },
      { type: 'text', text: '[Attachment start: notes.txt]\nhello\n[Attachment end: notes.txt]' }
    ]
  }])
})

test('serializes attachment-only messages and rejects malformed records', () => {
  assert.deepEqual(serializeOpenAIMessages([{
    role: 'user', content: '', attachments: [{ kind: 'text', name: 'a.txt', textContent: 'A' }]
  }]), [{
    role: 'user',
    content: [{ type: 'text', text: '[Attachment start: a.txt]\nA\n[Attachment end: a.txt]' }]
  }])

  assert.throws(() => serializeOpenAIMessages([{
    role: 'user', content: '', attachments: [{ kind: 'image', dataUrl: '' }]
  }]), /图片附件无效/)
})

test('generates images and normalizes base64 responses', async () => {
  let request
  const provider = new OpenAIProvider({
    transport: {
      async request(options) {
        request = options
        return { text: JSON.stringify({ data: [{ b64_json: 'AA==', revised_prompt: 'clean prompt' }] }) }
      }
    }
  })

  const result = await provider.generateImage({ baseUrl: 'https://example.com/v1', apiKey: 'secret' }, {
    model: 'gpt-image-test',
    prompt: 'draw a tree'
  })

  assert.equal(request.url, 'https://example.com/v1/images/generations')
  assert.equal(request.responseType, 'arraybuffer')
  assert.equal(request.timeout, 300000)
  assert.equal(request.headers.Authorization, 'Bearer secret')
  assert.deepEqual(JSON.parse(request.body), { model: 'gpt-image-test', prompt: 'draw a tree', n: 1 })
  assert.equal(result.images[0].dataUrl, 'data:image/png;base64,AA==')
  assert.equal(result.revisedPrompt, 'clean prompt')
})

test('downloads URL image responses for persistent chat history', async () => {
  const requests = []
  const provider = new OpenAIProvider({
    transport: {
      async request(options) {
        requests.push(options)
        if (options.url.includes('/images/generations')) {
          return { text: JSON.stringify({ data: [{ url: 'https://cdn.example.com/image.png' }] }) }
        }
        return {
          data: new Uint8Array([0, 1, 2]),
          headers: { 'content-type': 'image/png' },
          text: ''
        }
      }
    }
  })

  const result = await provider.generateImage({ baseUrl: 'https://example.com/v1' }, {
    model: 'image-model', prompt: 'test'
  })

  assert.equal(requests[1].responseType, 'arraybuffer')
  assert.equal(requests[1].timeout, 120000)
  assert.equal(result.images[0].sourceUrl, 'https://cdn.example.com/image.png')
  assert.equal(result.images[0].dataUrl, 'data:image/png;base64,AAEC')
})

test('accepts a direct binary image generation response', async () => {
  let request
  const provider = new OpenAIProvider({
    transport: {
      async request(options) {
        request = options
        return {
          data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          headers: { 'content-type': 'image/png' },
          text: ''
        }
      }
    }
  })

  const result = await provider.generateImage({ baseUrl: 'https://example.com/v1' }, {
    model: 'binary-image-model', prompt: 'test'
  })

  assert.equal(request.responseType, 'arraybuffer')
  assert.equal(result.images[0].mimeType, 'image/png')
  assert.match(result.images[0].dataUrl, /^data:image\/png;base64,/)
})

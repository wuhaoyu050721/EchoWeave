import assert from 'node:assert/strict'
import test from 'node:test'
import { GeminiProvider, serializeGeminiMessages } from '../src/providers/gemini-provider.js'

const encoder = new TextEncoder()

test('loads Gemini generateContent models and uses Google API key authentication', async () => {
  let request
  const provider = new GeminiProvider({
    transport: {
      async request(options) {
        request = options
        return {
          text: JSON.stringify({
            models: [
              { name: 'models/gemini-z', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
              { name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] }
            ]
          })
        }
      }
    }
  })

  const models = await provider.listModels({
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'google-key'
  })

  assert.deepEqual(models, ['gemini-a', 'gemini-z'])
  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000')
  assert.equal(request.headers['x-goog-api-key'], 'google-key')
  assert.equal(request.headers.Authorization, undefined)
})

test('serializes Gemini system instructions, roles, images, and text attachments', () => {
  assert.deepEqual(serializeGeminiMessages([
    { role: 'system', content: '保持简洁' },
    {
      role: 'user',
      content: '查看附件',
      attachments: [
        { kind: 'image', dataUrl: 'data:image/jpeg;base64,AA==' },
        { kind: 'text', name: 'note.txt', textContent: '内容' }
      ]
    },
    { role: 'assistant', content: '收到' }
  ]), {
    contents: [
      {
        role: 'user',
        parts: [
          { text: '查看附件' },
          { inlineData: { mimeType: 'image/jpeg', data: 'AA==' } },
          { text: '[Attachment start: note.txt]\n内容\n[Attachment end: note.txt]' }
        ]
      },
      { role: 'model', parts: [{ text: '收到' }] }
    ],
    systemInstruction: { parts: [{ text: '保持简洁' }] }
  })
})

test('moves a leading assistant history entry into Gemini system context', () => {
  assert.deepEqual(serializeGeminiMessages([
    { role: 'assistant', content: '欢迎回来' },
    { role: 'user', content: '继续' }
  ]), {
    contents: [{ role: 'user', parts: [{ text: '继续' }] }],
    systemInstruction: {
      parts: [{ text: 'The assistant already sent this opening message:\n欢迎回来' }]
    }
  })
})

test('streams Gemini SSE text and inline images across split byte chunks', async () => {
  let request
  const deltas = []
  const callbackImages = []
  const provider = new GeminiProvider({
    transport: {
      async request(options) {
        request = options
        const bytes = encoder.encode(
          'data: {"candidates":[{"content":{"parts":[{"text":"你"}]}}]}\n\n' +
          'data: {"candidates":[{"content":{"parts":[{"text":"好"},{"inlineData":{"mimeType":"image/png","data":"AA=="}}]},"finishReason":"STOP"}]}\n\n'
        )
        options.onChunk(bytes.slice(0, 57))
        options.onChunk(bytes.slice(57, 93))
        options.onChunk(bytes.slice(93))
        return { text: '' }
      }
    }
  })

  const result = await provider.streamChat({
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'key',
    requestTimeout: 45000
  }, {
    model: 'models/gemini-2.5-flash',
    messages: [{ role: 'user', content: '测试' }]
  }, {
    onDelta: delta => deltas.push(delta),
    onImage: image => callbackImages.push(image)
  })

  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse')
  assert.equal(request.timeout, 45000)
  assert.deepEqual(JSON.parse(request.body), {
    contents: [{ role: 'user', parts: [{ text: '测试' }] }]
  })
  assert.deepEqual(deltas, ['你', '好'])
  assert.equal(result.finishReason, 'STOP')
  assert.equal(result.images.length, 1)
  assert.equal(callbackImages.length, 1)
  assert.equal(result.images[0].dataUrl, 'data:image/png;base64,AA==')
})

test('uses generateContent image modalities and returns embedded Gemini images', async () => {
  let request
  const provider = new GeminiProvider({
    transport: {
      async request(options) {
        request = options
        return {
          text: JSON.stringify({
            candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AA==' } }] } }]
          })
        }
      }
    }
  })

  const result = await provider.generateImage({
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'key'
  }, {
    model: 'gemini-2.5-flash-image',
    prompt: '画一架纸飞机',
    aspectRatio: '16:9'
  })

  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent')
  assert.equal(request.timeout, 300000)
  assert.deepEqual(JSON.parse(request.body), {
    contents: [{ role: 'user', parts: [{ text: '画一架纸飞机' }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: '16:9' }
    }
  })
  assert.equal(result.images[0].dataUrl, 'data:image/png;base64,AA==')
})

test('rejects malformed Gemini model and SSE responses', async () => {
  const malformedModels = new GeminiProvider({ transport: { request: async () => ({ text: '{}' }) } })
  await assert.rejects(
    malformedModels.listModels({ baseUrl: 'https://example.com/v1beta' }),
    /models 数组/
  )

  const malformedStream = new GeminiProvider({
    transport: {
      async request({ onChunk }) {
        onChunk(encoder.encode('data: not-json\n\n'))
        return { text: '' }
      }
    }
  })
  await assert.rejects(
    malformedStream.streamChat({ baseUrl: 'https://example.com/v1beta' }, {
      model: 'gemini-test', messages: [{ role: 'user', content: 'test' }]
    }),
    /无法解析 Gemini SSE 数据/
  )

  const nonSseStream = new GeminiProvider({
    transport: {
      async request({ onChunk }) {
        onChunk(encoder.encode('{"candidates":[]}'))
        return { text: '' }
      }
    }
  })
  await assert.rejects(
    nonSseStream.streamChat({ baseUrl: 'https://example.com/v1beta' }, {
      model: 'gemini-test', messages: [{ role: 'user', content: 'test' }]
    }),
    /不包含有效 SSE 事件/
  )
})

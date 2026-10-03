import test from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { ChatService } from '../src/services/chat-service.js'
import { OpenAIProvider } from '../src/providers/openai-provider.js'
import { NativeStreamingTransport } from '../src/platform/app/native-streaming-transport.js'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'
import { createDiagnosticLogStore } from '../src/core/diagnostic-log.js'
import { sanitizeResponseDiagnostics } from '../src/core/chat-response-diagnostics.js'

const sse = payload => `data: ${JSON.stringify(payload)}\n\n`
const hiddenStatus = '<sumo_monitor><status>[当前位置|PRIVATE_ROOM]</status></sumo_monitor>'
const hiddenMemory = '<echo_story_memory>{"sceneSummary":"PRIVATE_MEMORY"}</echo_story_memory>'
const cases = [
  { name: 'no response bytes', body: '', code: 'empty_response', kind: 'no_bytes' },
  { name: 'DONE only', body: 'data: [DONE]\n\n', code: 'empty_response', kind: 'no_text' },
  { name: 'usage and finish only', body: sse({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { completion_tokens: 30 } }), code: 'empty_response', kind: 'no_text' },
  { name: 'reasoning only', body: sse({ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING' }, finish_reason: 'length' }] }), code: 'empty_response', kind: 'reasoning_only' },
  { name: 'tool only', body: sse({ choices: [{ delta: { tool_calls: [{ function: { name: 'PRIVATE_TOOL' } }] }, finish_reason: 'tool_calls' }] }), code: 'empty_response', kind: 'tool_only' },
  { name: 'HTTP 200 error', body: sse({ error: { message: 'PRIVATE_UPSTREAM_ERROR secret-api-key' } }), code: 'upstream_response_error' },
  { name: 'whitespace only', body: sse({ choices: [{ delta: { content: ' \n\t ' }, finish_reason: 'stop' }] }), code: 'empty_visible_response', kind: 'whitespace' },
  { name: 'status only', body: sse({ choices: [{ delta: { content: hiddenStatus }, finish_reason: 'stop' }] }), code: 'empty_visible_response', kind: 'hidden_only' },
  { name: 'story memory only', body: sse({ choices: [{ delta: { content: hiddenMemory }, finish_reason: 'stop' }] }), code: 'empty_visible_response', kind: 'hidden_only' },
  { name: 'HTML instead of SSE', body: '<html>PRIVATE_PROXY_ERROR</html>', code: 'invalid_sse_response', kind: 'unrecognized_format' },
  { name: 'ordinary JSON completion', body: JSON.stringify({ choices: [{ message: { content: 'Visible JSON reply' }, finish_reason: 'stop' }] }), expected: 'Visible JSON reply', format: 'json' },
  { name: 'message content in SSE', body: sse({ choices: [{ message: { content: 'Visible SSE reply' }, finish_reason: 'stop' }] }), expected: 'Visible SSE reply', format: 'sse' }
]

async function setup(body) {
  let receiveEvent
  let providerCalls = 0
  const nativeApi = {
    onAiChatStreamEvent: callback => { receiveEvent = callback },
    aiChatStreamCancel() {},
    aiChatStreamRequest(options) {
      providerCalls += 1
      queueMicrotask(() => {
        receiveEvent({ requestId: options.requestId, eventType: 'headers', statusCode: 200, headers: [{ name: 'content-type', value: 'text/event-stream' }] })
        const bytes = new TextEncoder().encode(body)
        // Split into real native bridge byte chunks, including inside UTF-8.
        for (let offset = 0; offset < bytes.length; offset += 13) {
          receiveEvent({ requestId: options.requestId, eventType: 'chunk', data: Buffer.from(bytes.slice(offset, offset + 13)).toString('base64') })
        }
        receiveEvent({ requestId: options.requestId, eventType: 'success', statusCode: 200, headers: [{ name: 'content-type', value: 'text/event-stream' }] })
      })
    }
  }
  const repository = new IndexedDbRepository({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange, databaseName: `empty-${crypto.randomUUID()}` })
  await repository.init()
  await repository.saveConversation({ id: 'conversation', title: 'Chat', providerProfileId: 'provider', modelName: 'model' })
  await repository.saveMessages([
    { id: 'old-user', conversationId: 'conversation', sequence: 1, role: 'user', content: 'PRIVATE_QUESTION', status: 'completed' },
    { id: 'old-assistant', conversationId: 'conversation', sequence: 2, role: 'assistant', content: 'Old visible answer', status: 'completed' }
  ])
  const diagnosticLogStore = createDiagnosticLogStore()
  let notifications = 0
  const service = new ChatService({
    repository,
    providerService: { getRequestProfile: async () => ({ protocolType: 'openai-compatible', baseUrl: 'https://example.test/v1', apiKey: 'secret-api-key', defaultModel: 'model' }) },
    provider: new OpenAIProvider({ transport: new NativeStreamingTransport({ nativeApi }) }),
    diagnosticLogStore,
    replyNotificationService: { notifyReply: async () => { notifications += 1 } }
  })
  return { repository, service, diagnosticLogStore, calls: () => providerCalls, notifications: () => notifications }
}

for (const requestKind of ['send', 'continue']) {
  for (const scenario of cases) {
    test(`Android ${requestKind}: ${scenario.name} is classified and persisted`, async () => {
      const app = await setup(scenario.body)
      const result = requestKind === 'continue'
        ? await app.service.continueResponse('old-assistant')
        : await app.service.send({ conversationId: 'conversation', content: 'PRIVATE_NEW_QUESTION' })
      const saved = await app.repository.getMessage(result.id)

      assert.equal(app.calls(), 1, 'never issue a duplicate paid request')
      assert.equal(result.status, scenario.expected ? 'completed' : 'failed')
      assert.equal(saved.status, result.status)
      assert.equal(result.responseDiagnostics.requestKind, requestKind)
      assert.equal(result.responseDiagnostics.transportObserved, true)
      assert.equal(result.responseDiagnostics.receivedBytes, new TextEncoder().encode(scenario.body).length)
      assert.equal(result.responseDiagnostics.status, 200)
      assert.equal(app.notifications(), scenario.expected ? 1 : 0)
      if (scenario.expected) {
        assert.equal(saved.content, scenario.expected)
        assert.equal(saved.responseDiagnostics.responseFormat, scenario.format)
      } else {
        assert.equal(saved.errorCode, scenario.code)
        assert.ok(saved.errorMessage.length > 0)
        assert.equal(saved.responseDiagnostics.visibleCharacters, 0)
        if (scenario.kind) assert.equal(saved.responseDiagnostics.emptyKind, scenario.kind)
      }
      const summaries = app.diagnosticLogStore.entries().filter(item => item.type === 'chat_response_summary')
      assert.equal(summaries.length, 1)
      assert.doesNotMatch(JSON.stringify(summaries), /PRIVATE_|secret-api-key|Visible JSON reply|Visible SSE reply/)
      assert.deepEqual(saved.responseDiagnostics, result.responseDiagnostics)
    })
  }
}

test('unknown provider observations do not claim that no response bytes arrived', async () => {
  const app = await setup('')
  app.service.provider = { streamChat: async () => ({ finishReason: 'stop' }) }
  const result = await app.service.continueResponse('old-assistant')
  assert.equal(result.status, 'failed')
  assert.equal(result.errorCode, 'empty_response')
  assert.equal(result.responseDiagnostics.transportObserved, false)
  assert.equal(result.responseDiagnostics.emptyKind, 'no_text')
  assert.doesNotMatch(result.errorMessage, /没有收到响应字节/)
})

test('response diagnostics drop payloads, headers, URLs, and unknown metadata strings', () => {
  const output = sanitizeResponseDiagnostics({
    receivedBytes: 8, status: 200, requestKind: 'continue',
    payload: 'PRIVATE_BODY', apiKey: 'secret-api-key', headers: { Authorization: 'Bearer secret' },
    url: 'https://secret.example', finishReason: 'PRIVATE_FINISH', contentType: 'PRIVATE_TYPE', emptyKind: 'PRIVATE_REASON'
  })
  assert.equal(output.receivedBytes, 8)
  assert.equal(output.finishReason, 'other')
  assert.doesNotMatch(JSON.stringify(output), /PRIVATE_|secret|Authorization|https:/)
})

test('Android continuation preserves partial text if a later SSE event is an error', async () => {
  const app = await setup(sse({ choices: [{ delta: { content: 'Partial visible answer' } }] }) + sse({ error: { message: 'PRIVATE_ERROR' } }))
  const result = await app.service.continueResponse('old-assistant')
  assert.equal(result.status, 'interrupted')
  assert.equal(result.content, 'Partial visible answer')
  assert.equal(result.errorCode, 'upstream_response_error')
  assert.equal(result.responseDiagnostics.textCharacters, result.content.length)
  assert.equal(app.notifications(), 0)
  assert.equal(app.calls(), 1)
})

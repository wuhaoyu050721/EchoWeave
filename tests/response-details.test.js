import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { isEmptyCompletedReply, messageResponseDetails } from '../src/app/message-response-details.js'
import { createComposerDraftStore } from '../src/app/composer-drafts.js'
import { setGenerating } from '../src/ui-state.js'
import { createStoryReaderBlocks, createStoryReaderLayoutCache } from '../src/core/story-reader.js'

test('empty historical replies get a fallback without confusing images or pending segments', () => {
  const message = { role: 'assistant', status: 'completed', content: '<sumo_monitor>private</sumo_monitor>', displayContent: '', attachments: [] }
  assert.equal(isEmptyCompletedReply(message), true)
  assert.equal(isEmptyCompletedReply({ ...message, displayContent: '  \n ' }), true)
  assert.equal(isEmptyCompletedReply({ ...message, displayContent: 'pending segment', visibleSegmentCount: 0 }), false)
  assert.equal(isEmptyCompletedReply({ ...message, imageAttachments: [{ id: 'image', kind: 'image' }] }), false)
  assert.equal(isEmptyCompletedReply({ ...message, status: 'generating' }), false)
})

test('response details distinguish unknown transport evidence and expose only safe summary fields', () => {
  assert.match(messageResponseDetails({}), /无法确认当时上游是否返回/)
  const message = { content: 'private reply', errorMessage: 'private provider error', responseDiagnostics: {
    transportObserved: false, requestKind: 'continue', receivedBytes: 0, textCharacters: 0, visibleCharacters: 0,
    emptyKind: 'reasoning_only', reasoningCharacters: 128, apiKey: 'private key', prompt: 'private prompt', finishReason: 'stop'
  } }
  const text = messageResponseDetails(message)
  assert.match(text, /未记录，不能据此判断上游是否返回/)
  assert.match(text, /只返回了思考过程/)
  assert.doesNotMatch(text, /private/)
  assert.match(messageResponseDetails({ responseDiagnostics: { ...message.responseDiagnostics, transportObserved: true, receivedBytes: 280, chunkCount: 2 } }), /280 字节 · 2 个分块/)
})

test('story history surfaces a decorated empty reply and invalidates the cached layout', () => {
  const message = { id: 'blank', role: 'assistant', content: '', displayContent: '', status: 'completed' }
  const cache = createStoryReaderLayoutCache()
  assert.equal(cache.update([message]).blocks.length, 0)
  const decorated = { ...message, emptyCompletedReply: true }
  const blocks = cache.update([decorated]).blocks
  assert.deepEqual(blocks, createStoryReaderBlocks([decorated]))
  assert.equal(blocks[0].type, 'status')
  assert.match(blocks[0].text, /响应详情/)
  assert.equal(blocks[0].showActions, false)
})

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
function actualMethod(start, end, name, dependencies = {}) {
  const text = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))).trim().replace(/,$/, '')
  return new Function(...Object.keys(dependencies), `return ({ ${text} }).${name}`)(...Object.values(dependencies))
}
const manageConversation = actualMethod('async manageConversation(conversation) {', 'commitMessageUpdate(message) {', 'manageConversation')

test('deletion completed in an old workspace clears only its original draft', async () => {
  const drafts = createComposerDraftStore()
  drafts.get('a', 'shared').text = 'A draft'
  drafts.get('b', 'shared').text = 'B draft'
  let finish, started
  const ready = new Promise(resolve => { started = resolve })
  const app = {
    services: { workspaceId: 'a', chatService: { deleteConversation: async () => { started(); await new Promise(resolve => { finish = resolve }) } } },
    composerDraftStore: drafts, ui: { activeConversationId: 'shared' }, chooseConversationAction: async () => 'delete', confirmAction: async () => true,
    backToConversations() { assert.fail('must not navigate the new workspace') }, loadConversations() { assert.fail('must not refresh the new workspace') }, handleError(error) { throw error }
  }
  const pending = manageConversation.call(app, { id: 'shared' })
  await ready
  app.services = { workspaceId: 'b' }
  finish()
  await pending
  assert.equal(drafts.get('a', 'shared').text, '')
  assert.equal(drafts.get('b', 'shared').text, 'B draft')
})

test('switching workspace during delete confirmation aborts the old action', async () => {
  let confirm, started
  const ready = new Promise(resolve => { started = resolve })
  const app = {
    services: { workspaceId: 'a', chatService: { deleteConversation() { assert.fail('must not delete') } } },
    chooseConversationAction: async () => 'delete', confirmAction: () => { started(); return new Promise(resolve => { confirm = resolve }) },
    loadConversations() { assert.fail('must not refresh') }, handleError(error) { throw error }
  }
  const pending = manageConversation.call(app, { id: 'shared' })
  await ready
  app.services = { workspaceId: 'b', chatService: { deleteConversation() { assert.fail('must not delete') } } }
  confirm(true)
  await pending
})

for (const [methodName, serviceMethod, end] of [
  ['continueMessage', 'continueResponse', 'async copyMessage(content)'],
  ['retryMessage', 'retry', 'isEmptyCompletedReply,']
]) {
  test(`${methodName} cannot apply late callbacks to a new workspace with the same conversation ID`, async () => {
    const method = actualMethod(`async ${methodName}(messageId) {`, end, methodName, { setGenerating })
    let callbacks, finish
    const app = {
      services: { chatService: { [serviceMethod]: (id, handlers) => { callbacks = handlers; return new Promise(resolve => { finish = resolve }) } } },
      ui: { activeConversationId: 'shared', generating: false }, activeProvider: { id: 'provider' }, closeStoryMenus() {},
      upsertMessage() { assert.fail('must not insert into new workspace') }, loadConversations() { assert.fail('must not refresh new workspace') }, handleError(error) { throw error }
    }
    const pending = method.call(app, 'message')
    app.services = { workspaceId: 'b' }
    callbacks.onMessage({ id: 'message', conversationId: 'shared' })
    callbacks.onState({ generating: true })
    finish()
    await pending
    assert.equal(app.ui.generating, false)
  })
}

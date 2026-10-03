import assert from 'node:assert/strict'
import test from 'node:test'
import { createComposerDraftStore, restoreUnsentDraft } from '../src/app/composer-drafts.js'
import { composerMethods } from '../src/app/chat-composer-methods.js'

function harness() {
  const drafts = createComposerDraftStore()
  const app = {
    services: { workspaceId: 'local', attachmentService: {}, chatService: {} },
    ui: { activeConversationId: 'a', generationMode: 'chat', generating: false },
    canSend: true, messageHistoryTrimmed: false, activeProvider: { id: 'provider' },
    errorMessage: '', errors: [], updates: [],
    closeComposerMenus() {}, async loadConversations() {},
    handleError(error) { this.errors.push(error) },
    upsertMessage(message) { this.updates.push(message) }, showToast() {}
  }
  Object.defineProperty(app, 'composerDraft', { get: () => drafts.get(app.services.workspaceId, app.ui.activeConversationId) })
  Object.defineProperty(app, 'attachmentProcessing', { get: () => app.composerDraft.processing })
  return app
}

test('draft text and attachments return only to the originating workspace and conversation', () => {
  const drafts = createComposerDraftStore()
  const local = drafts.get('local', 'same-chat')
  local.text = 'private local draft'
  local.attachments.push({ name: 'private.txt' })
  assert.equal(drafts.get('account-a', 'same-chat').text, '')
  assert.deepEqual(drafts.get('local', 'another-chat').attachments, [])
  assert.equal(drafts.get('local', 'same-chat'), local)
  assert.equal(drafts.get('local', 'same-chat').attachments[0].name, 'private.txt')
})

test('slow attachment preparation updates its original conversation after switching', async () => {
  const app = harness()
  let finish
  app.services.attachmentService.prepareFiles = () => new Promise(resolve => { finish = resolve })
  const origin = app.composerDraft
  const pending = composerMethods.handleAttachmentSelection.call(app, { target: { files: [{}], value: 'chosen' } })
  app.ui.activeConversationId = 'b'
  assert.equal(app.attachmentProcessing, false)
  finish([{ kind: 'text', name: 'a.txt' }])
  await pending
  assert.deepEqual(app.composerDraft.attachments, [])
  assert.equal(origin.attachments[0].name, 'a.txt')
  assert.equal(origin.processing, false)
})

test('failed sends restore only the originating draft and retain newer unsent edits', async () => {
  const app = harness()
  let fail
  const origin = app.composerDraft
  origin.text = 'first attempt'
  origin.attachments = [{ name: 'first.txt' }]
  app.services.chatService.send = () => new Promise((resolve, reject) => { fail = reject })
  const pending = composerMethods.sendMessage.call(app)
  assert.equal(origin.sending, true)
  assert.equal(origin.text, '')
  origin.text = 'new edit'
  app.ui.activeConversationId = 'b'
  app.composerDraft.text = 'B only'
  fail(new Error('storage unavailable'))
  await pending
  assert.equal(app.composerDraft.text, 'B only')
  assert.deepEqual(app.composerDraft.attachments, [])
  assert.equal(origin.text, 'first attempt\nnew edit')
  assert.equal(origin.attachments[0].name, 'first.txt')
  assert.equal(origin.sending, false)
  assert.deepEqual(app.errors, [])
})

test('late send callbacks cannot write messages or change generation state in a new workspace', async () => {
  const app = harness()
  let finish
  let callbacks
  app.composerDraft.text = 'A message'
  app.services.chatService.send = options => {
    callbacks = options
    return new Promise(resolve => { finish = resolve })
  }
  const pending = composerMethods.sendMessage.call(app)
  app.services = { workspaceId: 'account-b' }
  callbacks.onMessage({ role: 'user', content: 'A message' })
  callbacks.onState({ generating: true })
  finish({})
  await pending
  assert.deepEqual(app.updates, [])
  assert.equal(app.ui.generating, false)
  assert.equal(app.composerDraft.text, '')
})

test('recovery does not duplicate the same attachment when a caller retains it', () => {
  const attachment = { name: 'notes.txt' }
  const draft = { text: '', attachments: [attachment] }
  restoreUnsentDraft(draft, { content: 'hello', attachments: [attachment] })
  assert.equal(draft.attachments.length, 1)
})

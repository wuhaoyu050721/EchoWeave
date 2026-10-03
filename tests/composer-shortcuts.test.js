import assert from 'node:assert/strict'
import test from 'node:test'
import { composerMethods } from '../src/app/chat-composer-methods.js'

function harness() {
  const calls = []
  const result = Promise.resolve('sent')
  const app = {
    canSend: true,
    ui: { generating: false },
    attachmentProcessing: false,
    composerDraft: { sending: false },
    draftMessage: 'Ready to send',
    pendingAttachments: [],
    sendMessage() { calls.push('send'); return result },
    handleComposerAction() { assert.fail('keyboard shortcut must send directly') },
    stopGeneration() { assert.fail('keyboard shortcut must not stop generation') },
    startVoiceInput() { assert.fail('keyboard shortcut must not start voice input') },
    continueMessage() { assert.fail('keyboard shortcut must not continue a story') }
  }
  const event = {
    key: 'Enter', ctrlKey: true, metaKey: false,
    preventDefault() { calls.push('preventDefault') }
  }
  return { app, event, calls, result }
}

test('Ctrl+Enter and Cmd+Enter prevent a newline and send exactly once', () => {
  for (const modifiers of [{ ctrlKey: true, metaKey: false }, { ctrlKey: false, metaKey: true }]) {
    const { app, event, calls, result } = harness()
    Object.assign(event, modifiers)
    assert.equal(composerMethods.handleComposerKeydown.call(app, event), result)
    assert.deepEqual(calls, ['preventDefault', 'send'])
  }
})

test('Enter and Shift+Enter preserve normal textarea newline behavior', () => {
  for (const shiftKey of [false, true]) {
    const { app, event, calls } = harness()
    Object.assign(event, { ctrlKey: false, shiftKey })
    composerMethods.handleComposerKeydown.call(app, event)
    assert.deepEqual(calls, [])
  }
})

test('other keys, IME confirmation and held shortcuts never send or suppress input', () => {
  for (const scenario of [
    { key: 'a' },
    { key: 'Enter', isComposing: true },
    { key: 'Enter', keyCode: 229 },
    { key: 'Enter', repeat: true }
  ]) {
    const { app, event, calls } = harness()
    Object.assign(event, scenario)
    composerMethods.handleComposerKeydown.call(app, event)
    assert.deepEqual(calls, [], JSON.stringify(scenario))
  }
})

test('generation, attachment preparation and a pending draft send block the shortcut', () => {
  for (const busyState of ['generation', 'attachments', 'draft']) {
    const { app, event, calls } = harness()
    if (busyState === 'generation') app.ui.generating = true
    if (busyState === 'attachments') app.attachmentProcessing = true
    if (busyState === 'draft') app.composerDraft.sending = true
    composerMethods.handleComposerKeydown.call(app, event)
    assert.deepEqual(calls, [], busyState)
  }
})

test('an unavailable send does not fall through to voice input or empty story continuation', () => {
  const { app, event, calls } = harness()
  app.canSend = false
  app.canStoryContinue = true
  app.draftMessage = ''
  app.pendingAttachments = []
  composerMethods.handleComposerKeydown.call(app, event)
  assert.deepEqual(calls, [])
})

test('an empty story draft cannot send even when story continuation makes canSend true', () => {
  for (const draftMessage of ['', ' \n\t ']) {
    const { app, event, calls } = harness()
    app.canStoryContinue = true
    app.draftMessage = draftMessage
    composerMethods.handleComposerKeydown.call(app, event)
    assert.deepEqual(calls, [])
  }
})

test('an attachment-only draft can use the send shortcut', () => {
  const { app, event, calls, result } = harness()
  app.draftMessage = ''
  app.pendingAttachments = [{ kind: 'image', name: 'photo.png' }]
  assert.equal(composerMethods.handleComposerKeydown.call(app, event), result)
  assert.deepEqual(calls, ['preventDefault', 'send'])
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
const method = source.slice(source.indexOf('async jumpToLatestChat() {'), source.indexOf('messageAnchorId(message) {')).trim().replace(/,$/, '')
const jumpToLatestChat = new Function(`return ({ ${method} }).jumpToLatestChat`)()

function harness(overrides = {}) {
  const calls = []
  const app = {
    ui: { screen: 'chat', activeConversationId: 'conversation', generating: false },
    services: {}, messageHistoryLoading: false, messageHistoryTrimmed: false,
    chatVirtualScrollTimer: null, _chatVirtualPendingScroll: { pinnedToBottom: false },
    async reloadLatestMessages() { calls.push('reload') },
    scrollChatToBottom(immediate, force) { calls.push(['scroll', immediate, force]) },
    ...overrides
  }
  return { app, calls }
}

test('returning to the tail clears a queued old scroll before explicitly following the latest reply', async () => {
  const { app, calls } = harness()
  app.chatVirtualScrollTimer = setTimeout(() => calls.push('stale-scroll'), 5)
  await jumpToLatestChat.call(app)
  await new Promise(resolve => setTimeout(resolve, 15))
  assert.deepEqual(calls, [['scroll', true, true]])
  assert.equal(app.chatVirtualScrollTimer, null)
  assert.equal(app._chatVirtualPendingScroll, null)
})

test('an older retained history window delegates the loaded window and scroll to the existing guarded loader', async () => {
  const { app, calls } = harness({ messageHistoryTrimmed: true })
  await jumpToLatestChat.call(app)
  assert.deepEqual(calls, ['reload'])
})

test('busy history and navigation away cannot initiate a jump, but following loaded streaming messages is allowed', async () => {
  for (const state of ['loading', 'trimmed-generation', 'another-screen']) {
    const { app, calls } = harness()
    if (state === 'loading') app.messageHistoryLoading = true
    if (state === 'trimmed-generation') { app.messageHistoryTrimmed = true; app.ui.generating = true }
    if (state === 'another-screen') app.ui.screen = 'conversations'
    await jumpToLatestChat.call(app)
    assert.deepEqual(calls, [], state)
  }
  const { app, calls } = harness()
  app.ui.generating = true
  await jumpToLatestChat.call(app)
  assert.deepEqual(calls, [['scroll', true, true]])
})

test('a history load completing after navigation or reopening the same conversation cannot scroll the new view', async () => {
  for (const change of ['workspace', 'conversation', 'screen', 'reopen-same-conversation']) {
    const { app, calls } = harness({ messageHistoryTrimmed: true })
    let finish
    app.reloadLatestMessages = () => new Promise(resolve => { finish = resolve })
    const pending = jumpToLatestChat.call(app)
    if (change === 'workspace') app.services = {}
    if (change === 'conversation') app.ui.activeConversationId = 'other'
    if (change === 'screen') app.ui.screen = 'conversations'
    if (change === 'reopen-same-conversation') {
      app.ui.screen = 'conversations'
      app.chatLoadRevision = 2
      app.ui.screen = 'chat'
      app.chatLoadRevision = 3
      app._chatVirtualPendingScroll = { pinnedToBottom: false, scrollTop: 300 }
    }
    finish()
    await pending
    assert.deepEqual(calls, [], change)
    assert.notEqual(app._chatVirtualPendingScroll, null, change)
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'
import { PlusSqliteRepository } from '../src/platform/app/plus-sqlite-repository.js'
import { createNodePlusSqlite } from './helpers/node-plus-sqlite.js'

for (const platform of ['browser', 'android']) {
  test(`${platform} restores early, middle and latest anchors in bounded story windows`, async () => {
    const repository = platform === 'browser'
      ? new IndexedDbRepository({ indexedDB: new IDBFactory(), keyRange: IDBKeyRange, databaseName: `window-${crypto.randomUUID()}` })
      : new PlusSqliteRepository({ sqlite: createNodePlusSqlite(), databaseName: `window-${crypto.randomUUID()}`, databasePath: '_doc/test.db' })
    await repository.init()
    try {
      const messages = Array.from({ length: 180 }, (_, index) => ({
        id: `story-message-${index + 1}`, conversationId: 'story', sequence: index + 1,
        role: 'assistant', content: `第 ${index + 1} 段。`, status: 'completed'
      }))
      await repository.saveMessages(messages)
      await repository.saveMessage({ ...messages[5], deletedAt: '2026-10-03T00:00:00.000Z' })
      await repository.saveMessage({ id: 'other-message', conversationId: 'other', sequence: 1, content: 'private' })
      repository.listMessages = () => { throw new Error('Anchor reads must not scan the entire story') }
      for (const [anchor, first, last, hasMore, hasNewer] of [
        [1, 1, 61, false, true],
        [90, 61, 120, true, true],
        [180, 121, 180, true, false]
      ]) {
        const window = await repository.listMessageWindow('story', { anchorMessageId: `story-message-${anchor}`, limit: 60 })
        assert.equal(window.anchorFound, true)
        assert.equal(window.messages.length, 60)
        assert.equal(window.messages[0].sequence, first)
        assert.equal(window.messages.at(-1).sequence, last)
        assert.equal(window.hasMore, hasMore)
        assert.equal(window.hasNewer, hasNewer)
        assert.ok(window.messages.some(message => message.sequence === anchor))
        assert.ok(window.messages.every(message => message.conversationId === 'story' && !message.deletedAt))
        assert.deepEqual(window.messages.map(message => message.sequence), window.messages.map(message => message.sequence).sort((a, b) => a - b))
      }
      for (const id of ['story-message-6', 'missing', 'other-message', '']) {
        assert.deepEqual(await repository.listMessageWindow('story', { anchorMessageId: id }), {
          messages: [], hasMore: false, hasNewer: false, anchorFound: false
        })
      }
      const single = await repository.listMessageWindow('story', { anchorMessageId: 'story-message-90', limit: 1 })
      assert.deepEqual(single.messages.map(message => message.sequence), [90])
      assert.equal(single.hasMore, true)
      assert.equal(single.hasNewer, true)
      assert.ok((await repository.listMessageWindow('story', { anchorMessageId: 'story-message-90', limit: 100000 })).messages.length <= 200)
      let window = await repository.listMessageWindow('story', { anchorMessageId: 'story-message-1', limit: 60 })
      const readSequences = window.messages.map(message => message.sequence)
      while (window.hasNewer) {
        const tail = window.messages.at(-1)
        window = await repository.listMessageWindow('story', { anchorMessageId: tail.id, limit: 60 })
        const next = window.messages.filter(message => message.sequence > tail.sequence)
        assert.ok(next.length, 'Forward windows must make progress')
        readSequences.push(...next.map(message => message.sequence))
      }
      assert.deepEqual(readSequences, messages.filter(message => message.sequence !== 6).map(message => message.sequence))
    } finally {
      await repository.close?.()
    }
  })
}

test('Android anchor payload reads respect CursorWindow limits', async () => {
  const sqlite = createNodePlusSqlite({ maxCursorCellBytes: 300 * 1024, maxCursorWindowBytes: 1100 * 1024 })
  const repository = new PlusSqliteRepository({ sqlite, databaseName: `window-${crypto.randomUUID()}`, databasePath: '_doc/test.db' })
  await repository.init()
  try {
    await repository.saveMessages(Array.from({ length: 10 }, (_, index) => ({
      id: `large-${index}`, conversationId: 'story', sequence: index, role: 'assistant', status: 'completed', content: 'A'.repeat(220 * 1024)
    })))
    const window = await repository.listMessageWindow('story', { anchorMessageId: 'large-5', limit: 10 })
    assert.equal(window.messages.length, 10)
    assert.ok(window.messages.every(message => message.content.length === 220 * 1024))
  } finally {
    await repository.close()
  }
})

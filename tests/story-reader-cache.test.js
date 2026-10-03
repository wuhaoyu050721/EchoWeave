import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStoryReaderBlocks, createStoryReaderLayoutCache, paginateStoryBlocks,
  storyPageIndexForPosition, storyReaderPositionMessageId
} from '../src/core/story-reader.js'

const makeMessage = (sequence, overrides = {}) => ({
  id: `message-${sequence}`, sequence, conversationId: 'story', role: 'assistant', status: 'completed',
  content: (`这是第 ${sequence} 段。风经过长街，树叶缓缓摇曳。`.repeat(12)) + '\n\n' + '接着他们继续前行。'.repeat(8),
  ...overrides
})

function assertFreshLayout(layout, messages, capacity = 360) {
  const freshBlocks = createStoryReaderBlocks(messages)
  assert.deepEqual(layout.blocks, freshBlocks)
  assert.deepEqual(layout.pages, paginateStoryBlocks(freshBlocks, { capacity }))
}

test('streaming repaginates only the changed tail while reusing settled messages and pages', () => {
  const messages = Array.from({ length: 150 }, (_, index) => makeMessage(index + 1))
  messages.at(-1).status = 'generating'
  const cache = createStoryReaderLayoutCache()
  let layout = cache.update(messages)
  const settledFirstPage = layout.pages[0]
  const settledFirstBlock = layout.blocks[0]
  for (let delta = 0; delta < 4; delta += 1) {
    messages.at(-1).content += '这是新到达的一段文字。'.repeat(4)
    layout = cache.update(messages)
    assertFreshLayout(layout, messages)
    assert.equal(layout.stats.builtMessages, 1)
    assert.ok(layout.stats.paginatedBlocks <= 3)
    assert.ok(layout.stats.reusedPages > 100)
    assert.equal(layout.blocks[0], settledFirstBlock)
    assert.equal(layout.pages[0], settledFirstPage)
  }
  messages.at(-1).status = 'completed'
  assertFreshLayout(cache.update(messages), messages)
  const unchanged = cache.update(messages)
  assert.equal(unchanged.stats.builtMessages, 0)
  assert.equal(unchanged.stats.paginatedBlocks, 0)
})

test('cache invalidates edits, deletions, insertion, segmented display, attachments and viewport changes', () => {
  const messages = Array.from({ length: 8 }, (_, index) => makeMessage(index + 1))
  const cache = createStoryReaderLayoutCache()
  cache.update(messages)
  const check = (capacity = 360) => assertFreshLayout(cache.update(messages, { capacity }), messages, capacity)
  messages[3].content = '重新编辑的正文。'.repeat(75)
  check()
  messages[1].deletedAt = '2026-10-03'
  check()
  messages.splice(4, 1)
  check()
  messages.pop()
  check()
  messages.push(makeMessage(12))
  check()
  messages.unshift(makeMessage(0))
  check()
  messages[2].responseDisplayMode = 'segmented'
  messages[2].displaySegments = ['先显示这一段。', '再显示第二段。']
  messages[2].visibleSegmentCount = 1
  check()
  messages[2].visibleSegmentCount = 2
  check()
  messages[2].displaySegments[0] = '同一个数组也可以被编辑。'
  check()
  messages[2].attachments = [{ id: 'image', kind: 'image', dataUrl: 'data:image/png;base64,AA==' }]
  check()
  messages[2].attachments[0].kind = 'text'
  check()
  messages[2].feedback = { rating: 'up' }
  check()
  messages[2].feedback.rating = 'down'
  check()
  check(650)
  check(220)
  messages.splice(0)
  check()
  messages.push(makeMessage(200))
  check()
})

test('saved paragraph and event positions resolve exact message IDs across long loaded windows', () => {
  for (const anchor of [1, 90, 180]) {
    const position = { conversationId: 'story', blockId: `message-${anchor}-paragraph-2`, characterOffset: 15 }
    assert.equal(storyReaderPositionMessageId(position), `message-${anchor}`)
    const start = Math.max(1, Math.min(121, anchor - 29))
    const messages = Array.from({ length: 60 }, (_, offset) => makeMessage(start + offset))
    const layout = createStoryReaderLayoutCache().update(messages)
    assert.ok(storyPageIndexForPosition(layout.pages, position) >= 0)
  }
  assert.equal(storyReaderPositionMessageId({ conversationId: 'story', blockId: 'message-paragraph-3-event', characterOffset: 0 }), 'message-paragraph-3')
  assert.equal(storyReaderPositionMessageId(null), '')
})

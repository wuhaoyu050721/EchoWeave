import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  createStoryReaderBlocks, createStoryReaderPosition, normalizeStoryReaderBookmark,
  paginateStoryBlocks, storyPageIndexForPosition
} from '../src/core/story-reader.js'

// Exercise the component method itself without requiring a DOM or duplicating
// its navigation policy in a test-only implementation.
const source = await readFile(new URL('../src/components/story-reader.vue', import.meta.url), 'utf8')
const method = source.slice(source.indexOf('openBookmark(value) {'), source.indexOf('rememberReadingPosition(position) {')).trim().replace(/,$/, '')
const openBookmark = new Function('normalizeStoryReaderBookmark', 'storyPageIndexForPosition', `return ({ ${method} }).openBookmark`)(normalizeStoryReaderBookmark, storyPageIndexForPosition)
const watcherSource = source.slice(source.indexOf('storyPages(nextPages, previousPages) {'), source.indexOf('readerPosition: {', source.indexOf('storyPages(nextPages, previousPages) {'))).trim().replace(/,$/, '')
const storyPagesWatcher = new Function('storyPageIndexForPosition', `return ({ ${watcherSource} }).storyPages`)(storyPageIndexForPosition)

function readerContext(overrides = {}) {
  const events = []
  const context = {
    conversation: { id: 'story' },
    storyPages: [{ blocks: [{ id: 'loaded-paragraph-1', text: '正文', sourceOffset: 0 }] }],
    loading: false, generating: false, normalizedMode: 'page',
    closeBookmarkPanel() { events.push('close') },
    changePage(index, options) { events.push(['page', index, options.position.blockId]) },
    rememberReadingPosition(position) { events.push(['remember', position.blockId]) },
    scheduleScrollPositionRestore(position) { events.push(['scroll', position.blockId]) },
    $emit(event, position) { events.push([event, position.blockId]) },
    ...overrides
  }
  return { context, events }
}

test('loaded bookmarks remain navigable while generating in page and scroll modes', () => {
  const bookmark = { conversationId: 'story', blockId: 'loaded-paragraph-1', characterOffset: 0 }
  for (const mode of ['page', 'scroll']) {
    const { context, events } = readerContext({ generating: true, normalizedMode: mode })
    openBookmark.call(context, bookmark)
    assert.ok(events.some(event => Array.isArray(event) && event[0] === mode))
    assert.equal(events.some(event => Array.isArray(event) && event[0] === 'load-position'), false)
  }
})

test('unloaded bookmarks request a window only when fetching is safe', () => {
  const bookmark = { conversationId: 'story', blockId: 'earlier-paragraph-1', characterOffset: 0 }
  const allowed = readerContext()
  openBookmark.call(allowed.context, bookmark)
  assert.deepEqual(allowed.events, ['close', ['load-position', bookmark.blockId]])
  assert.equal(allowed.context.requestedPosition.blockId, bookmark.blockId)
  for (const state of [{ generating: true }, { loading: true }]) {
    const denied = readerContext(state)
    openBookmark.call(denied.context, bookmark)
    assert.deepEqual(denied.events, [])
  }
})

test('forward window navigation skips newly loaded blank and system messages before anchoring readable prose', () => {
  const priorMessage = { id: 'prior', sequence: 100, role: 'assistant', status: 'completed', content: '已经读过的正文。' }
  const messages = [
    priorMessage,
    { id: 'blank', sequence: 101, role: 'assistant', status: 'completed', content: '  ' },
    { id: 'system', sequence: 102, role: 'system', content: '不显示的内部消息' },
    { id: 'readable', sequence: 103, role: 'assistant', status: 'completed', content: '下一段可读正文。' }
  ]
  const storyBlocks = createStoryReaderBlocks(messages)
  const pages = paginateStoryBlocks(storyBlocks)
  const previousPages = paginateStoryBlocks(createStoryReaderBlocks([priorMessage]))
  for (const normalizedMode of ['page', 'scroll']) {
    const restored = []
    const context = {
      messages, storyBlocks, normalizedMode, requestedNextSequence: 100, requestedPosition: null,
      initialViewportMeasured: true, initialPagePositioned: true, currentPageIndex: 0,
      positionForBlock(block) { return createStoryReaderPosition('story', block) },
      positionForPage(page) { return this.positionForBlock(page.blocks[0]) },
      rememberReadingPosition(position) { restored.push(['remember', position.blockId]) },
      restorePagePosition(position) { restored.push(['page', position.blockId]) },
      scheduleScrollPositionRestore(position) { restored.push(['scroll', position.blockId]) }
    }
    storyPagesWatcher.call(context, pages, previousPages)
    assert.equal(context.requestedNextSequence, null)
    assert.ok(restored.some(([kind, blockId]) => kind === normalizedMode && blockId === 'readable-paragraph-1'))
    assert.equal(context.requestedPosition, null)
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  STORY_READER_MODE_SETTING_KEY,
  createStoryReaderBookmark,
  createStoryReaderPosition,
  createStoryReaderBlocks,
  normalizeStoryReaderBookmarks,
  normalizeStoryReaderMode,
  normalizeStoryReaderPosition,
  paginateStoryBlocks,
  readStoryReaderMode,
  readStoryReaderBookmarks,
  readStoryReaderPosition,
	storyBlockDomId,
  storyBlockSourceOffset,
  storyMessageHasPendingSegments,
  storyPageCapacity,
  storyPageIndexForPosition,
  storyReaderBookmarksSettingKey,
  storyReaderPositionSettingKey,
  visibleStoryMessageContent
} from '../src/core/story-reader.js'

function assistantMessage(overrides = {}) {
  return {
    id: 'assistant-1',
    role: 'assistant',
    status: 'completed',
    content: '',
    displayContent: '',
    attachments: [],
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  }
}

test('paginates long Chinese narrative without dropping or duplicating text', () => {
  const paragraphs = [
    '雨落在废弃车站的玻璃穹顶上。银白色的水线沿着裂纹缓慢滑落，远处的信号灯仍在雾里明灭。'.repeat(8),
    '她把旧地图摊在长椅上，指尖停在被红墨圈出的山谷入口。'.repeat(8)
  ]
  const blocks = createStoryReaderBlocks([
    assistantMessage({ content: paragraphs.join('\n\n'), displayContent: paragraphs.join('\n\n') })
  ])
  const pages = paginateStoryBlocks(blocks, { capacity: 260 })
  const visibleText = pages.flatMap(page => page.blocks)
    .filter(block => block.type === 'narrative')
    .map(block => block.text)
    .join('')

  assert.ok(pages.length > 2)
  assert.equal(visibleText, paragraphs.join(''))
  assert.ok(pages.every(page => page.blocks.length > 0))
  assert.equal(pages.at(-1).blocks.at(-1).isMessageEnd, true)
})

test('uses the remaining page space by continuing medium narrative blocks', () => {
  const firstParagraph = '凌晨的灯火沿着长廊一盏盏亮起。'.repeat(10)
  const secondParagraph = '她将旧信收进口袋，推开了通往庭院的门。'.repeat(10)
  const content = `${firstParagraph}\n\n${secondParagraph}`
  const blocks = createStoryReaderBlocks([
    assistantMessage({ content, displayContent: content })
  ])
  const pages = paginateStoryBlocks(blocks, { capacity: 360 })
  const narrativeBlocks = pages.flatMap(page => page.blocks)
    .filter(block => block.type === 'narrative')

  assert.ok(pages.length >= 2)
  assert.ok(pages[0].blocks.length >= 2)
  assert.ok(pages[0].weight >= 300)
  assert.ok(pages.every(page => page.weight <= 360))
  assert.equal(narrativeBlocks.map(block => block.text).join(''), firstParagraph + secondParagraph)
  assert.equal(pages[0].blocks.at(-1).showActions, false)
  assert.equal(pages[0].blocks.at(-1).isMessageEnd, false)
  assert.equal(narrativeBlocks.at(-1).showActions, true)
  assert.equal(narrativeBlocks.at(-1).isMessageEnd, true)
  assert.equal(narrativeBlocks.at(-1).continuation, true)
})

test('uses a useful page-end remainder instead of leaving a large blank area', () => {
  const firstParagraph = '甲'.repeat(290)
  const secondParagraph = '乙'.repeat(100)
  const content = `${firstParagraph}\n\n${secondParagraph}`
  const blocks = createStoryReaderBlocks([
    assistantMessage({ content, displayContent: content })
  ])
  const pages = paginateStoryBlocks(blocks, { capacity: 360 })
  const continuedBlock = pages[0].blocks[1]

  assert.equal(pages[0].blocks.length, 2)
  assert.ok(continuedBlock.text.length >= 21)
  assert.equal(continuedBlock.text + pages.slice(1).flatMap(page => page.blocks)
    .filter(block => block.id.includes('paragraph-2'))
    .map(block => block.text)
    .join(''), secondParagraph)
  assert.equal(continuedBlock.showActions, false)
  assert.equal(continuedBlock.isMessageEnd, false)
})

test('fills a single-line page remainder without creating a tiny trailing page', () => {
  const firstParagraph = '甲'.repeat(302)
  const secondParagraph = '乙'.repeat(100)
  const content = `${firstParagraph}\n\n${secondParagraph}`
  const blocks = createStoryReaderBlocks([
    assistantMessage({ content, displayContent: content })
  ])
  const pages = paginateStoryBlocks(blocks, { capacity: 360 })
  const pageEnd = pages[0].blocks.at(-1)

  assert.equal(pages[0].blocks.length, 2)
  assert.equal(pageEnd.sourceId, blocks[1].id)
  assert.ok(pageEnd.text.length >= 16)
  assert.ok(pageEnd.text.length < 30)
  assert.equal(pages.flatMap(page => page.blocks)
    .filter(block => block.sourceId === blocks[1].id)
    .map(block => block.text)
    .join(''), secondParagraph)
  assert.ok(pages.at(-1).blocks.at(-1).text.length >= 48)
})

test('avoids leaving a tiny narrative continuation by balancing adjacent pages', () => {
  const blocks = [
    { id: 'opening', type: 'narrative', text: '甲'.repeat(120), showActions: false },
    { id: 'following', type: 'narrative', text: '乙'.repeat(84), showActions: false }
  ]
  const pages = paginateStoryBlocks(blocks, { capacity: 220 })
  const followingFragments = pages.flatMap(page => page.blocks)
    .filter(block => block.sourceId === 'following')

  assert.equal(pages.length, 2)
  assert.equal(followingFragments.map(block => block.text).join(''), blocks[1].text)
  assert.ok(followingFragments.at(-1).text.length >= 48)
})

test('fills the current page when a short continuation has more narrative after it', () => {
  const blocks = [
    { id: 'opening', type: 'narrative', text: '甲'.repeat(258), showActions: false },
    { id: 'middle', type: 'narrative', text: '乙'.repeat(62), showActions: false },
    { id: 'following', type: 'narrative', text: '丙'.repeat(80), showActions: false }
  ]
  const pages = paginateStoryBlocks(blocks, { capacity: 328 })
  const middleFragments = pages.flatMap(page => page.blocks)
    .filter(block => block.sourceId === 'middle')

  assert.equal(pages[0].weight, 328)
  assert.equal(pages[0].blocks.at(-1).text.length, 30)
  assert.equal(middleFragments.map(block => block.text).join(''), blocks[1].text)
})

test('keeps a short final paragraph and its actions on a page with available reading space', () => {
  const opening = '甲'.repeat(265)
  const ending = '终章落定。'
  const content = `${opening}\n\n${ending}`
  const blocks = createStoryReaderBlocks([
    assistantMessage({ content, displayContent: content })
  ])
  const pages = paginateStoryBlocks(blocks, { capacity: 360 })

  assert.equal(pages.length, 1)
  assert.equal(pages[0].blocks.map(block => block.text).join(''), opening + ending)
  assert.ok(pages[0].weight <= 360)
  assert.equal(pages[0].blocks.at(-1).showActions, true)
})

test('fills non-final narrative pages close to capacity even when natural breaks are frequent', () => {
  const content = '风穿过长廊，她继续向前。'.repeat(120)
  const blocks = createStoryReaderBlocks([
    assistantMessage({ content, displayContent: content })
  ])
  const pages = paginateStoryBlocks(blocks, { capacity: 360 })

  assert.ok(pages.length > 3)
  assert.ok(pages.slice(0, -1).every(page => page.weight >= 280))
})

test('maps paginated fragments back to a stable paragraph and character offset', () => {
  const content = '墨'.repeat(920)
  const blocks = createStoryReaderBlocks([
    assistantMessage({ content, displayContent: content })
  ])
  const pages = paginateStoryBlocks(blocks, { capacity: 220 })
  const fragment = pages[2].blocks[0]
  const relativeOffset = Math.floor(fragment.text.length / 2)
  const position = createStoryReaderPosition('story-1', fragment, relativeOffset)

  assert.equal(fragment.sourceId, blocks[0].id)
  assert.ok(storyBlockSourceOffset(fragment) > 0)
  assert.deepEqual(normalizeStoryReaderPosition(position, 'story-1'), position)
  assert.equal(storyPageIndexForPosition(pages, position), 2)
  assert.equal(position.characterOffset, storyBlockSourceOffset(fragment) + relativeOffset)
})

test('creates a cross-platform scroll anchor from a story block id', () => {
	assert.equal(storyBlockDomId({ id: 'message:7/paragraph 3' }), 'story-block-message-7-paragraph-3')
	assert.equal(storyBlockDomId({}), '')
})

test('stores story reading positions under a conversation-specific setting key', async () => {
  const expected = {
    version: 1,
    conversationId: 'story-42',
    blockId: 'message-7-paragraph-3',
    characterOffset: 86
  }
  const seen = []
  const repository = {
    async getSetting(key, fallback) {
      seen.push([key, fallback])
      return expected
    }
  }

  assert.equal(storyReaderPositionSettingKey('story-42'), 'storyReaderPosition:story-42')
  assert.deepEqual(await readStoryReaderPosition(repository, 'story-42'), expected)
  assert.deepEqual(seen, [['storyReaderPosition:story-42', null]])
  assert.equal(normalizeStoryReaderPosition({ ...expected, conversationId: 'another-story' }, 'story-42'), null)
})

test('stores bounded deduplicated story bookmarks under each conversation', async () => {
  const position = {
    version: 1,
    conversationId: 'story-42',
    blockId: 'message-7-paragraph-3',
    characterOffset: 86
  }
  const bookmark = createStoryReaderBookmark(
    'story-42',
    position,
    `  雨声沿着玻璃滑落。\n${'很长的摘要'.repeat(40)}  `,
    '2026-08-01T08:30:00+08:00'
  )
  const repository = {
    async getSetting(key, fallback) {
      assert.equal(key, 'storyReaderBookmarks:story-42')
      assert.deepEqual(fallback, [])
      return [bookmark, { ...bookmark, id: 'duplicate' }, { ...bookmark, conversationId: 'another-story' }]
    }
  }

  assert.equal(storyReaderBookmarksSettingKey('story-42'), 'storyReaderBookmarks:story-42')
  assert.equal(bookmark.conversationId, 'story-42')
  assert.equal(bookmark.blockId, position.blockId)
  assert.equal(bookmark.characterOffset, position.characterOffset)
  assert.ok(bookmark.excerpt.startsWith('雨声沿着玻璃滑落。'))
  assert.ok(bookmark.excerpt.length <= 96)
  assert.equal(bookmark.createdAt, '2026-08-01T00:30:00.000Z')
  assert.equal(normalizeStoryReaderBookmarks([bookmark, { ...bookmark, id: 'duplicate' }], 'story-42').length, 1)
  assert.deepEqual(await readStoryReaderBookmarks(repository, 'story-42'), [bookmark])
})

test('measures every short narrative paragraph as at least one visible line', () => {
  const blocks = Array.from({ length: 8 }, (_, index) => ({
    id: `short-paragraph-${index + 1}`,
    type: 'narrative',
    text: '短句。',
    isMessageStart: index === 0,
    isMessageEnd: index === 7,
    showActions: false
  }))
  const pages = paginateStoryBlocks(blocks, { capacity: 220 })

  assert.equal(pages.length, 2)
  assert.ok(pages[0].blocks.length < blocks.length)
  assert.equal(pages.flatMap(page => page.blocks).map(block => block.text).join(''), '短句。'.repeat(8))
})

test('renders user choices as event blocks and assistant prose as narrative blocks', () => {
  const blocks = createStoryReaderBlocks([
    { id: 'user-1', role: 'user', status: 'completed', content: '选择从侧门潜入。', attachments: [] },
    assistantMessage({ content: '门轴发出一声轻响。\n\n走廊尽头亮起微弱的灯。', displayContent: '门轴发出一声轻响。\n\n走廊尽头亮起微弱的灯。' })
  ])

  assert.deepEqual(blocks.map(block => block.type), ['event', 'narrative', 'narrative'])
  assert.equal(blocks[0].text, '选择从侧门潜入。')
  assert.equal(blocks[0].role, 'user')
  assert.equal(blocks.at(-1).showActions, true)
})

test('only exposes revealed segmented paragraphs and keeps a generating marker', () => {
  const message = assistantMessage({
    responseDisplayMode: 'segmented',
    displaySegments: ['第一段。', '第二段。', '第三段。'],
    visibleSegmentCount: 2,
    displayContent: '第一段。\n\n第二段。\n\n第三段。'
  })

  assert.equal(visibleStoryMessageContent(message), '第一段。\n\n第二段。')
  assert.equal(storyMessageHasPendingSegments(message), true)
  const blocks = createStoryReaderBlocks([message])
  assert.deepEqual(blocks.map(block => block.type), ['narrative', 'narrative', 'status'])
  assert.equal(blocks.at(-1).statusKind, 'generating')
  assert.equal(blocks.at(-1).showActions, false)
})

test('keeps interrupted and failed generation states actionable', () => {
  const blocks = createStoryReaderBlocks([
    assistantMessage({ status: 'interrupted', content: '半截故事。', displayContent: '半截故事。' }),
    assistantMessage({ id: 'assistant-2', status: 'failed', errorMessage: '请求超时' })
  ])

  assert.equal(blocks[1].type, 'status')
  assert.equal(blocks[1].statusKind, 'interrupted')
  assert.equal(blocks.at(-1).text, '请求超时')
  assert.equal(blocks.at(-1).isMessageEnd, true)
})

test('reader mode defaults to page and persists through the repository setting', async () => {
  const seen = []
  const repository = {
    async getSetting(key, fallback) {
      seen.push([key, fallback])
      return 'scroll'
    }
  }

  assert.equal(normalizeStoryReaderMode('unknown'), 'page')
  assert.equal(normalizeStoryReaderMode('scroll'), 'scroll')
  assert.equal(await readStoryReaderMode(repository), 'scroll')
  assert.deepEqual(seen, [[STORY_READER_MODE_SETTING_KEY, 'page']])
})

test('page capacity responds to available viewport without exceeding its bounds', () => {
  const compact = storyPageCapacity({ width: 360, height: 640 })
  const tall = storyPageCapacity({ width: 430, height: 932 })
	const immersive = storyPageCapacity({ width: 430, height: 932, reservedHeight: 122 })

  assert.ok(compact >= 220)
  assert.ok(tall > compact)
  assert.ok(tall <= 1200)
	assert.ok(immersive > tall)
})

export const STORY_READER_MODE_SETTING_KEY = 'storyReaderMode'
export const STORY_READER_POSITION_SETTING_PREFIX = 'storyReaderPosition:'
export const STORY_READER_BOOKMARKS_SETTING_PREFIX = 'storyReaderBookmarks:'

const DEFAULT_PAGE_CAPACITY = 360
const MIN_PAGE_CAPACITY = 220
const MAX_PAGE_CAPACITY = 1200
const MIN_TEXT_CHUNK_WEIGHT = 30
const MIN_PAGE_FILL_TEXT_WEIGHT = 16
const MIN_NARRATIVE_TEXT_WEIGHT = 20
const MIN_TRAILING_NARRATIVE_WEIGHT = 48
const STORY_ACTION_WEIGHT = 32
const PREFERRED_BREAK_MIN_RATIO = 0.88
const PAGE_CAPACITY_USAGE = 0.876
const MAX_STORY_READER_BOOKMARKS = 80
const MAX_STORY_BOOKMARK_EXCERPT_LENGTH = 96

function cleanText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim()
}

function finiteNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function storyTextLength(value) {
  return Array.from(String(value ?? '')).length
}

export function storyBlockSourceId(block = {}) {
  return String(block.sourceId || block.id || '')
}

export function storyBlockDomId(block = {}) {
  const blockId = String(block.id || '').replace(/[^A-Za-z0-9_-]/g, '-')
  return blockId ? `story-block-${blockId}` : ''
}

export function storyBlockSourceOffset(block = {}) {
  return Math.max(0, Math.floor(finiteNumber(block.sourceOffset, 0)))
}

export function storyBlockSourceLength(block = {}) {
  const minimum = storyBlockSourceOffset(block) + storyTextLength(block.text)
  return Math.max(minimum, Math.floor(finiteNumber(block.sourceLength, minimum)))
}

function messageAttachments(message) {
  if (Array.isArray(message?.attachments)) return message.attachments.filter(Boolean)
  return []
}

function visibleSegmentCount(message, segments) {
  const requested = Number(message?.visibleSegmentCount)
  if (!Number.isFinite(requested)) return segments.length
  return Math.max(0, Math.min(segments.length, Math.floor(requested)))
}

export function normalizeStoryReaderMode(value) {
  return value === 'scroll' ? 'scroll' : 'page'
}

export async function readStoryReaderMode(repository) {
  const value = await repository?.getSetting?.(STORY_READER_MODE_SETTING_KEY, 'page')
  return normalizeStoryReaderMode(value)
}

export function storyReaderPositionSettingKey(conversationId) {
  const normalizedId = String(conversationId ?? '').trim()
  return normalizedId ? `${STORY_READER_POSITION_SETTING_PREFIX}${normalizedId}` : ''
}

export function storyReaderBookmarksSettingKey(conversationId) {
  const normalizedId = String(conversationId ?? '').trim()
  return normalizedId ? `${STORY_READER_BOOKMARKS_SETTING_PREFIX}${normalizedId}` : ''
}

export function normalizeStoryReaderPosition(value, expectedConversationId = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const expectedId = String(expectedConversationId ?? '').trim()
  const conversationId = String(value.conversationId ?? expectedId).trim()
  const blockId = String(value.blockId ?? '').trim()
  const characterOffset = Number(value.characterOffset)
  if (!conversationId || (expectedId && conversationId !== expectedId) || !blockId || blockId.length > 512) return null
  if (!Number.isFinite(characterOffset) || characterOffset < 0) return null
  return {
    version: 1,
    conversationId,
    blockId,
    characterOffset: Math.min(10_000_000, Math.floor(characterOffset))
  }
}

export async function readStoryReaderPosition(repository, conversationId) {
  const key = storyReaderPositionSettingKey(conversationId)
  if (!key) return null
  const value = await repository?.getSetting?.(key, null)
  return normalizeStoryReaderPosition(value, conversationId)
}

export function normalizeStoryReaderBookmark(value, expectedConversationId = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const position = normalizeStoryReaderPosition(value.position ?? value, expectedConversationId)
  if (!position) return null
  const excerpt = cleanText(value.excerpt).replace(/\s+/g, ' ').slice(0, MAX_STORY_BOOKMARK_EXCERPT_LENGTH)
  const suppliedId = String(value.id ?? '').trim().slice(0, 640)
  const createdAt = String(value.createdAt ?? '').trim()
  return {
    version: 1,
    id: suppliedId || `bookmark:${position.blockId}:${position.characterOffset}`,
    conversationId: position.conversationId,
    blockId: position.blockId,
    characterOffset: position.characterOffset,
    excerpt,
    createdAt: Number.isNaN(Date.parse(createdAt)) ? '' : new Date(createdAt).toISOString()
  }
}

export function normalizeStoryReaderBookmarks(values, expectedConversationId = '') {
  if (!Array.isArray(values)) return []
  const bookmarks = []
  const seenPositions = new Set()
  for (const value of values) {
    const bookmark = normalizeStoryReaderBookmark(value, expectedConversationId)
    if (!bookmark) continue
    const positionKey = `${bookmark.blockId}:${bookmark.characterOffset}`
    if (seenPositions.has(positionKey)) continue
    seenPositions.add(positionKey)
    bookmarks.push(bookmark)
    if (bookmarks.length >= MAX_STORY_READER_BOOKMARKS) break
  }
  return bookmarks
}

export function createStoryReaderBookmark(conversationId, position, excerpt = '', createdAt = new Date().toISOString()) {
  const normalizedPosition = normalizeStoryReaderPosition(position, conversationId)
  if (!normalizedPosition) return null
  return normalizeStoryReaderBookmark({
    ...normalizedPosition,
    excerpt,
    createdAt
  }, conversationId)
}

export async function readStoryReaderBookmarks(repository, conversationId) {
  const key = storyReaderBookmarksSettingKey(conversationId)
  if (!key) return []
  const value = await repository?.getSetting?.(key, [])
  return normalizeStoryReaderBookmarks(value, conversationId)
}

export function createStoryReaderPosition(conversationId, block, relativeCharacterOffset = 0) {
  const sourceId = storyBlockSourceId(block)
  if (!sourceId) return null
  const fragmentLength = storyTextLength(block?.text)
  const relativeOffset = Math.max(0, Math.min(fragmentLength, Math.floor(finiteNumber(relativeCharacterOffset, 0))))
  return normalizeStoryReaderPosition({
    conversationId,
    blockId: sourceId,
    characterOffset: storyBlockSourceOffset(block) + relativeOffset
  })
}

export function storyPageIndexForPosition(pages = [], position) {
  const normalized = normalizeStoryReaderPosition(position)
  if (!normalized) return -1
  let firstMatch = -1
  let precedingMatch = -1
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    for (const block of pages[pageIndex]?.blocks || []) {
      if (storyBlockSourceId(block) !== normalized.blockId) continue
      if (firstMatch < 0) firstMatch = pageIndex
      const start = storyBlockSourceOffset(block)
      const end = start + Math.max(1, storyTextLength(block.text))
      if (normalized.characterOffset >= start && normalized.characterOffset < end) return pageIndex
      if (normalized.characterOffset >= start) precedingMatch = pageIndex
    }
  }
  return precedingMatch >= 0 ? precedingMatch : firstMatch
}

export function visibleStoryMessageContent(message = {}) {
  if (message.role === 'assistant' && message.responseDisplayMode === 'segmented') {
    const segments = Array.isArray(message.displaySegments) ? message.displaySegments : []
    return cleanText(segments.slice(0, visibleSegmentCount(message, segments)).join('\n\n'))
  }
  return cleanText(message.displayContent ?? message.content)
}

export function storyMessageHasPendingSegments(message = {}) {
  if (message.role !== 'assistant' || message.responseDisplayMode !== 'segmented') return false
  const segments = Array.isArray(message.displaySegments) ? message.displaySegments : []
  return visibleSegmentCount(message, segments) < segments.length
}

export function splitStoryParagraphs(content) {
  return cleanText(content)
    .split(/\n\s*\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
}

function blockFromMessage(message, values) {
  const block = {
    messageId: String(message.id || ''),
    messageStatus: String(message.status || 'completed'),
    messageContent: visibleStoryMessageContent(message),
    feedback: message.feedback || null,
    updatedAt: message.updatedAt || message.createdAt || '',
    isGreeting: Boolean(message.isGreeting),
    role: message.role === 'user' ? 'user' : 'assistant',
    isMessageStart: false,
    isMessageEnd: false,
    showActions: false,
    ...values
  }
  return {
    ...block,
    sourceId: storyBlockSourceId(block),
    sourceOffset: 0,
    sourceLength: storyTextLength(block.text)
  }
}

export function createStoryReaderBlocks(messages = []) {
  const blocks = []
  for (const message of Array.isArray(messages) ? messages : []) {
    if (!message || message.deletedAt || !['user', 'assistant'].includes(message.role)) continue
    const content = visibleStoryMessageContent(message)
    const attachments = messageAttachments(message)
    const messageBlocks = []

    if (message.role === 'user') {
      if (content) {
        messageBlocks.push(blockFromMessage(message, {
          id: `${message.id}-event`,
          type: 'event',
          text: content
        }))
      }
    } else {
      splitStoryParagraphs(content).forEach((paragraph, index) => {
        messageBlocks.push(blockFromMessage(message, {
          id: `${message.id}-paragraph-${index + 1}`,
          type: 'narrative',
          text: paragraph
        }))
      })
    }

    if (attachments.length) {
      messageBlocks.push(blockFromMessage(message, {
        id: `${message.id}-media`,
        type: 'media',
        text: '',
        attachments
      }))
    }

    const pendingSegments = storyMessageHasPendingSegments(message)
    if (message.role === 'assistant' && (message.status === 'generating' || pendingSegments)) {
      messageBlocks.push(blockFromMessage(message, {
        id: `${message.id}-generating`,
        type: 'status',
        statusKind: 'generating',
        text: pendingSegments ? '正在整理下一段' : '正在续写'
      }))
    } else if (message.role === 'assistant' && message.status && message.status !== 'completed') {
      messageBlocks.push(blockFromMessage(message, {
        id: `${message.id}-status`,
        type: 'status',
        statusKind: message.status,
        text: cleanText(message.errorMessage) || (message.status === 'interrupted' ? '本次续写已中断' : '本次续写未完成')
      }))
    }

    if (!messageBlocks.length) continue
    messageBlocks[0].isMessageStart = true
    const finalBlock = messageBlocks[messageBlocks.length - 1]
    finalBlock.isMessageEnd = true
    finalBlock.showActions = message.role === 'assistant' && message.status === 'completed' && !pendingSegments
    blocks.push(...messageBlocks)
  }
  return blocks
}

export function measureStoryText(content) {
  let weight = 0
  for (const character of Array.from(String(content ?? ''))) {
    if (character === '\n') weight += 10
    else weight += character.codePointAt(0) > 255 ? 1 : 0.55
  }
  return weight
}

function storyBlockBaseWeight(block) {
	if (block.type === 'event') return 32
  if (block.type === 'status') return 74
  if (block.type === 'media') {
    const imageCount = (block.attachments || []).filter(attachment => attachment?.kind === 'image').length
    const fileCount = Math.max(0, (block.attachments || []).length - imageCount)
    return 110 + Math.ceil(imageCount / 2) * 150 + fileCount * 38
  }
  return 20
}

export function measureStoryBlock(block = {}) {
  const actionWeight = block.showActions ? STORY_ACTION_WEIGHT : 0
  const textWeight = measureStoryText(block.text)
  const visibleTextWeight = block.type === 'narrative'
    ? Math.max(MIN_NARRATIVE_TEXT_WEIGHT, textWeight)
    : textWeight
  return storyBlockBaseWeight(block) + visibleTextWeight + actionWeight
}

function isPreferredBreak(character) {
  return /[。！？!?；;，,、：:\s”’"')）】\]]/.test(character)
}

export function splitStoryText(content, maximumWeight, { minimumWeight = MIN_TEXT_CHUNK_WEIGHT } = {}) {
  const characters = Array.from(String(content ?? ''))
  const normalizedMinimum = Math.max(1, finiteNumber(minimumWeight, MIN_TEXT_CHUNK_WEIGHT))
  const limit = Math.max(normalizedMinimum, finiteNumber(maximumWeight, 180))
  if (measureStoryText(content) <= limit) return [String(content ?? '')]

  const chunks = []
  let start = 0
  while (start < characters.length) {
    let end = start
    let weight = 0
    let preferredEnd = -1
    while (end < characters.length) {
      const character = characters[end]
      const nextWeight = weight + measureStoryText(character)
      if (nextWeight > limit && end > start) break
      weight = nextWeight
      end += 1
      if (weight >= limit * PREFERRED_BREAK_MIN_RATIO && isPreferredBreak(character)) preferredEnd = end
      if (weight >= limit) break
    }
    if (end < characters.length && preferredEnd > start) end = preferredEnd
    if (end <= start) end = start + 1
    const chunk = characters.slice(start, end).join('')
    if (chunk) chunks.push(chunk)
    start = end
  }
  return chunks
}

function splitBlockWithSourceOffsets(block, chunks, idSegment) {
  const sourceId = storyBlockSourceId(block)
  const sourceLength = storyBlockSourceLength(block)
  let sourceOffset = storyBlockSourceOffset(block)
  return chunks.map((text, index) => {
    const nextBlock = {
      ...block,
      id: `${block.id}-${idSegment}-${index + 1}`,
      text,
      sourceId,
      sourceOffset,
      sourceLength,
      continuation: Boolean(block.continuation) || index > 0,
      isMessageStart: block.isMessageStart && index === 0,
      isMessageEnd: block.isMessageEnd && index === chunks.length - 1,
      showActions: block.showActions && index === chunks.length - 1
    }
    sourceOffset += storyTextLength(text)
    return nextBlock
  })
}

function splitOversizedBlock(block, capacity) {
  if (!['narrative', 'event'].includes(block.type)) return [block]
  const baseWeight = storyBlockBaseWeight(block)
  const textLimit = Math.max(60, capacity - baseWeight)
  const chunks = splitStoryText(block.text, textLimit)
  if (block.showActions && chunks.length) {
    const finalTextLimit = Math.max(MIN_TEXT_CHUNK_WEIGHT, capacity - baseWeight - STORY_ACTION_WEIGHT)
    const finalChunk = chunks[chunks.length - 1]
    if (measureStoryText(finalChunk) > finalTextLimit) {
      chunks.splice(chunks.length - 1, 1, ...splitStoryText(finalChunk, finalTextLimit))
    }
  }
  if (chunks.length <= 1) return [block]
  return splitBlockWithSourceOffsets(block, chunks, 'part')
}

function splitNarrativeForPageRemainder(block, availableWeight, { preserveTrailingMinimum = false } = {}) {
  if (block.type !== 'narrative') return null
  const textLimit = availableWeight - storyBlockBaseWeight(block)
  const textWeight = measureStoryText(block.text)
  const splitLimit = block.showActions && textWeight <= textLimit
    ? textWeight - MIN_TRAILING_NARRATIVE_WEIGHT
    : textLimit
  if (splitLimit < MIN_PAGE_FILL_TEXT_WEIGHT) return null

  let chunks = splitStoryText(block.text, splitLimit, { minimumWeight: MIN_PAGE_FILL_TEXT_WEIGHT })
  if (chunks.length <= 1) return null

  let leadingText = chunks[0]
  let trailingText = chunks.slice(1).join('')
  const trailingWeight = measureStoryText(trailingText)
	if (preserveTrailingMinimum && trailingWeight < MIN_TRAILING_NARRATIVE_WEIGHT) {
    const balancedLimit = Math.max(
      MIN_PAGE_FILL_TEXT_WEIGHT,
      splitLimit - (MIN_TRAILING_NARRATIVE_WEIGHT - trailingWeight)
    )
    const balancedChunks = splitStoryText(block.text, balancedLimit, { minimumWeight: MIN_PAGE_FILL_TEXT_WEIGHT })
    if (balancedChunks.length > 1) {
      chunks = balancedChunks
      leadingText = chunks[0]
      trailingText = chunks.slice(1).join('')
    }
  }
  if (!leadingText || !trailingText) return null

  return [
    {
      ...block,
      id: `${block.id}-fill-1`,
      text: leadingText,
      sourceId: storyBlockSourceId(block),
      sourceOffset: storyBlockSourceOffset(block),
      sourceLength: storyBlockSourceLength(block),
      isMessageEnd: false,
      showActions: false
    },
    {
      ...block,
      id: `${block.id}-fill-2`,
      text: trailingText,
      sourceId: storyBlockSourceId(block),
      sourceOffset: storyBlockSourceOffset(block) + storyTextLength(leadingText),
      sourceLength: storyBlockSourceLength(block),
      continuation: true,
      isMessageStart: false
    }
  ]
}

export function paginateStoryBlocks(blocks = [], { capacity = DEFAULT_PAGE_CAPACITY } = {}) {
  const pageCapacity = Math.max(MIN_PAGE_CAPACITY, Math.min(MAX_PAGE_CAPACITY, finiteNumber(capacity, DEFAULT_PAGE_CAPACITY)))
  const expandedBlocks = (Array.isArray(blocks) ? blocks : [])
    .flatMap(block => splitOversizedBlock(block, pageCapacity))
  if (!expandedBlocks.length) return [{ id: 'story-page-empty', blocks: [], weight: 0 }]

  const pages = []
  let pageBlocks = []
  let pageWeight = 0
  const commitPage = () => {
    if (!pageBlocks.length) return
    pages.push({
      id: `story-page-${pages.length + 1}-${pageBlocks[0].id}`,
      blocks: pageBlocks,
      weight: pageWeight
    })
    pageBlocks = []
    pageWeight = 0
  }

	for (let expandedIndex = 0; expandedIndex < expandedBlocks.length; expandedIndex += 1) {
		const expandedBlock = expandedBlocks[expandedIndex]
		let block = expandedBlock
    while (block) {
      const blockWeight = measureStoryBlock(block)
      if (!pageBlocks.length || pageWeight + blockWeight <= pageCapacity) {
        pageBlocks.push(block)
        pageWeight += blockWeight
        break
      }

			const splitBlocks = splitNarrativeForPageRemainder(block, pageCapacity - pageWeight, {
				preserveTrailingMinimum: expandedIndex === expandedBlocks.length - 1
			})
      if (!splitBlocks) {
        commitPage()
        continue
      }

      const [leadingBlock, trailingBlock] = splitBlocks
      pageBlocks.push(leadingBlock)
      pageWeight += measureStoryBlock(leadingBlock)
      commitPage()
      block = trailingBlock
    }
  }
  commitPage()
  return pages
}

export function storyPageCapacity({ width = 390, height = 844, reservedHeight = 250 } = {}) {
  const viewportWidth = Math.max(280, finiteNumber(width, 390))
  const viewportHeight = Math.max(520, finiteNumber(height, 844))
  const chromeHeight = Math.max(80, Math.min(320, finiteNumber(reservedHeight, 250)))
  const readingWidth = Math.max(240, Math.min(760, viewportWidth - 48))
  const readingHeight = Math.max(330, viewportHeight - chromeHeight)
  const charactersPerLine = readingWidth / 18.5
  const visibleLines = readingHeight / 31
  return Math.max(MIN_PAGE_CAPACITY, Math.min(MAX_PAGE_CAPACITY, Math.floor(charactersPerLine * visibleLines * PAGE_CAPACITY_USAGE)))
}

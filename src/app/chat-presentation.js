function uniqueIds(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
}

function finitePositive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function contentLineUnits(content) {
  return String(content ?? '').split('\n').reduce((total, line) => {
    let units = 0
    for (const character of line) units += character.codePointAt(0) > 255 ? 1 : 0.55
    return total + Math.max(1, Math.ceil(units / 22))
  }, 0)
}

export function estimateChatMessageHeight(message = {}) {
  const content = String(message.displayContent ?? message.content ?? '')
  const imageCount = Array.isArray(message.imageAttachments)
    ? message.imageAttachments.length
    : (Array.isArray(message.attachments)
        ? message.attachments.filter(attachment => attachment?.kind === 'image').length
        : 0)
  const textAttachmentCount = Array.isArray(message.textAttachments)
    ? message.textAttachments.length
    : (Array.isArray(message.attachments)
        ? message.attachments.filter(attachment => attachment?.kind === 'text').length
        : 0)
  const segmentCount = message.responseDisplayMode === 'segmented'
    ? Math.max(1, Array.isArray(message.displaySegments) ? message.displaySegments.length : 1)
    : 1
  const textHeight = content ? 44 + contentLineUnits(content) * 21 : 0
  const imageRows = Math.ceil(imageCount / 2)
  const imageHeight = imageCount === 1 ? 276 : imageRows * 132
  const attachmentHeight = textAttachmentCount * 56
  const segmentSpacing = Math.max(0, segmentCount - 1) * 15
  const statusHeight = message.status && message.status !== 'completed' ? 44 : 0
  const assistantChrome = message.role === 'assistant' ? 18 : 8

  return Math.max(72, Math.min(6000,
    10 + assistantChrome + textHeight + imageHeight + attachmentHeight + segmentSpacing + statusHeight
  ))
}

function measuredMessageHeight(measurements, message, estimateHeight) {
  const id = String(message?.id || '')
  const measured = typeof measurements?.get === 'function'
    ? measurements.get(id)
    : measurements?.[id]
  return finitePositive(measured, finitePositive(estimateHeight(message), 112))
}

export function buildVirtualMessageLayout(messages = [], {
  measurements = null,
  estimateHeight = estimateChatMessageHeight
} = {}) {
  const items = Array.isArray(messages) ? messages : []
  const heights = new Array(items.length)
  const offsets = new Array(items.length + 1)
  offsets[0] = 0
  for (let index = 0; index < items.length; index += 1) {
    heights[index] = measuredMessageHeight(measurements, items[index], estimateHeight)
    offsets[index + 1] = offsets[index] + heights[index]
  }
  return {
    heights,
    offsets,
    totalHeight: offsets[offsets.length - 1] || 0
  }
}

function messageIndexAtOffset(offsets, target) {
  const itemCount = Math.max(0, offsets.length - 1)
  if (!itemCount) return 0
  const value = Math.max(0, Number(target) || 0)
  let low = 0
  let high = itemCount - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (offsets[middle + 1] <= value) low = middle + 1
    else high = middle
  }
  return low
}

export function createVirtualMessageWindow(messages = [], {
  scrollTop = 0,
  viewportHeight = 720,
  overscanPixels = 720,
  minimumItems = 12,
  maximumItems = 48,
  pinnedToBottom = false,
  measurements = null,
  estimateHeight = estimateChatMessageHeight
} = {}) {
  const items = Array.isArray(messages) ? messages : []
  const layout = buildVirtualMessageLayout(items, { measurements, estimateHeight })
  if (!items.length) {
    return {
      items: [], startIndex: 0, endIndex: 0,
      topPadding: 0, bottomPadding: 0, ...layout
    }
  }

  const viewport = finitePositive(viewportHeight, 720)
  const overscan = Math.max(0, Number(overscanPixels) || 0)
  const minimum = Math.max(1, Math.min(items.length, Number(minimumItems) || 12))
  const maximum = Math.max(minimum, Math.min(items.length, Number(maximumItems) || 48))
  const maximumScrollTop = Math.max(0, layout.totalHeight - viewport)
  const effectiveScrollTop = pinnedToBottom
    ? maximumScrollTop
    : Math.max(0, Math.min(maximumScrollTop, Number(scrollTop) || 0))
  const visibleStart = messageIndexAtOffset(layout.offsets, effectiveScrollTop)
  const visibleEnd = Math.min(items.length,
    messageIndexAtOffset(layout.offsets, effectiveScrollTop + viewport) + 1
  )
  let startIndex = messageIndexAtOffset(layout.offsets, Math.max(0, effectiveScrollTop - overscan))
  let endIndex = Math.min(items.length,
    messageIndexAtOffset(layout.offsets, effectiveScrollTop + viewport + overscan) + 1
  )

  if (endIndex - startIndex > maximum) {
    const visibleCount = Math.min(maximum, Math.max(1, visibleEnd - visibleStart))
    const leading = Math.floor((maximum - visibleCount) / 2)
    startIndex = Math.max(0, visibleStart - leading)
    endIndex = Math.min(items.length, startIndex + maximum)
    startIndex = Math.max(0, endIndex - maximum)
  }
  if (endIndex - startIndex < minimum) {
    const missing = minimum - (endIndex - startIndex)
    const leading = Math.min(startIndex, Math.ceil(missing / 2))
    startIndex -= leading
    endIndex = Math.min(items.length, endIndex + missing - leading)
    startIndex = Math.max(0, endIndex - minimum)
  }

  return {
    ...layout,
    items: items.slice(startIndex, endIndex),
    startIndex,
    endIndex,
    topPadding: layout.offsets[startIndex],
    bottomPadding: Math.max(0, layout.totalHeight - layout.offsets[endIndex])
  }
}

export function splitAssistantReplySegments(content, {
  includeTrailing = true,
  minimumCharacters = 90,
  maximumCharacters = 260,
  maximumSegments = Number.POSITIVE_INFINITY
} = {}) {
  const text = String(content ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return []
  const minimumLength = Math.max(30, Number(minimumCharacters) || 90)
  const characterLimit = Math.max(80, Number(maximumCharacters) || 260)
  const requestedSegmentLimit = Number(maximumSegments)
  const segmentLimit = Number.isFinite(requestedSegmentLimit)
    ? Math.max(1, Math.floor(requestedSegmentLimit))
    : Number.MAX_SAFE_INTEGER
  const sentenceEndings = '。！？!?；;'
  const closingCharacters = '”’"\')）】]'
  const segments = []
  let start = 0
  let index = 0
  let fenced = false

  const commit = (end, nextStart = end) => {
    const segment = text.slice(start, end).trim()
    if (segment) segments.push(segment)
    start = nextStart
  }

  while (index < text.length && segments.length < segmentLimit - 1) {
    if (text.slice(index, index + 3) === '```') {
      fenced = !fenced
      index += 3
      continue
    }
    if (!fenced && text[index] === '\n' && text[index + 1] === '\n') {
      let next = index + 2
      while (next < text.length && /\s/.test(text[next])) next += 1
      commit(index, next)
      index = next
      continue
    }
    if (!fenced && sentenceEndings.includes(text[index])) {
      let end = index + 1
      while (end < text.length && closingCharacters.includes(text[end])) end += 1
      const segmentLength = text.slice(start, end).trim().length
      const hasFollowingContent = end < text.length
      if (hasFollowingContent && segmentLength >= minimumLength) {
        while (end < text.length && text[end] === ' ') end += 1
        commit(end, end)
        index = end
        continue
      }
    }
    index += 1
  }

  const trailing = text.slice(start).trim()
  if (includeTrailing && trailing) {
    if (trailing.length <= characterLimit || segments.length >= segmentLimit - 1 || trailing.includes('```')) {
      segments.push(trailing)
    } else {
      let remaining = trailing
      while (remaining && segments.length < segmentLimit) {
        if (segments.length === segmentLimit - 1 || remaining.length <= characterLimit) {
          segments.push(remaining)
          break
        }
        let breakIndex = characterLimit
        const minimumBreak = Math.max(40, Math.floor(characterLimit * 0.5))
        for (let candidate = characterLimit; candidate >= minimumBreak; candidate -= 1) {
          if (sentenceEndings.includes(remaining[candidate - 1]) || /\s/.test(remaining[candidate - 1])) {
            breakIndex = candidate
            break
          }
        }
        segments.push(remaining.slice(0, breakIndex).trim())
        remaining = remaining.slice(breakIndex).trim()
      }
    }
  }
  return segments.filter(Boolean)
}

async function readMany(repository, bulkMethod, singleMethod, ids) {
  if (!ids.length) return []
  if (typeof repository?.[bulkMethod] === 'function') return repository[bulkMethod](ids)
  return Promise.all(ids.map(id => repository?.[singleMethod]?.(id)))
}

export async function loadChatMessageResources(repository, messages = []) {
  const attachmentIds = uniqueIds(messages.flatMap(message => (
    Array.isArray(message?.attachmentIds) ? message.attachmentIds : []
  )))
  const avatarIds = uniqueIds(messages.map(message => message?.speakerAvatarAssetId))
  const [attachments, avatars] = await Promise.all([
    readMany(repository, 'getAttachments', 'getAttachment', attachmentIds),
    readMany(repository, 'getCharacterAssets', 'getCharacterAsset', avatarIds)
  ])
  return {
    attachmentsById: new Map(
      attachments.filter(attachment => attachment && !attachment.deletedAt)
        .map(attachment => [attachment.id, attachment])
    ),
    avatarsById: new Map(
      avatars.filter(Boolean).map(avatar => [avatar.id, avatar])
    )
  }
}

export function mergeEarlierMessageWindow(current, earlier, maxMessages = 240) {
  const existingIds = new Set(current.map(message => message.id))
  const merged = [
    ...earlier.filter(message => !existingIds.has(message.id)),
    ...current
  ]
  const limit = Math.max(1, Number(maxMessages) || 240)
  return {
    messages: merged.length > limit ? merged.slice(0, limit) : merged,
    trimmedNewer: merged.length > limit
  }
}

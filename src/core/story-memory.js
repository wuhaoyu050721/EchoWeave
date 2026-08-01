const STORY_MEMORY_TAG = 'echo_story_memory'

function cleanText(value) {
  return String(value ?? '').trim()
}

function stripJsonFence(value) {
  const text = cleanText(value)
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text)
  return match ? match[1].trim() : text
}

function normalizeKeys(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map(value => cleanText(value))
    .filter(Boolean))]
    .slice(0, 8)
}

export function extractStoryMemory(content, { hideIncomplete = false } = {}) {
  const source = String(content ?? '')
  const openPattern = /<\s*echo_story_memory\b[^>]*>/gi
  const closePattern = /<\s*\/\s*echo_story_memory\s*>/i
  let visible = ''
  let cursor = 0
  let latestMemory = null
  let latestRaw = ''
  let match = openPattern.exec(source)
  while (match) {
    const openStart = match.index
    const bodyStart = openPattern.lastIndex
    const closeMatch = closePattern.exec(source.slice(bodyStart))
    if (!closeMatch) {
      return hideIncomplete
        ? { content: `${visible}${source.slice(cursor, openStart)}`.trimEnd(), memory: null, pending: true, raw: source.slice(openStart) }
        : { content: source, memory: null, pending: true, raw: source.slice(openStart) }
    }

    visible += source.slice(cursor, openStart)
    const closeStart = bodyStart + closeMatch.index
    const closeEnd = closeStart + closeMatch[0].length
    const rawBody = source.slice(bodyStart, closeStart)
    latestRaw = source.slice(openStart, closeEnd)
    try {
      latestMemory = normalizeStoryMemory(JSON.parse(stripJsonFence(rawBody)))
    } catch {
      latestMemory = null
    }
    cursor = closeEnd
    openPattern.lastIndex = closeEnd
    match = openPattern.exec(source)
  }

  if (!latestRaw) return { content: source, memory: null, pending: false, raw: '' }
  return {
    content: `${visible}${source.slice(cursor)}`.trimEnd(),
    memory: latestMemory,
    pending: false,
    raw: latestRaw
  }
}

export function normalizeStoryMemory(value = {}) {
  const source = value && typeof value === 'object' ? value : {}
  const sceneSummary = cleanText(source.sceneSummary || source.summary)
  const characterPatches = (Array.isArray(source.characterPatches) ? source.characterPatches : [])
    .map(item => ({
      characterId: cleanText(item?.characterId),
      characterName: cleanText(item?.characterName || item?.name),
      field: cleanText(item?.field || 'story_memory').slice(0, 48) || 'story_memory',
      content: cleanText(item?.content || item?.value).slice(0, 1200),
      confidence: Number.isFinite(Number(item?.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : null
    }))
    .filter(item => item.content && (item.characterId || item.characterName))
    .slice(0, 8)
  const worldBookEntries = (Array.isArray(source.worldBookEntries) ? source.worldBookEntries : [])
    .map(item => ({
      name: cleanText(item?.name || item?.title).slice(0, 80) || '故事记忆',
      keys: normalizeKeys(item?.keys?.length ? item.keys : (item?.key || item?.name)),
      content: cleanText(item?.content || item?.description).slice(0, 1600),
      constant: item?.constant === true,
      confidence: Number.isFinite(Number(item?.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : null
    }))
    .filter(item => item.content)
    .slice(0, 12)
  return { sceneSummary, characterPatches, worldBookEntries }
}

export function storyMemoryHasChanges(memory) {
  return Boolean(memory?.sceneSummary || memory?.characterPatches?.length || memory?.worldBookEntries?.length)
}

export function createStoryMemoryEntry({
  id,
  name,
  keys = [],
  content,
  constant = false,
  order = 100,
  sourceMessageId = ''
}) {
  return {
    id,
    name: cleanText(name).slice(0, 80) || '故事记忆',
    comment: cleanText(sourceMessageId) ? `自动记忆：${sourceMessageId}` : '自动记忆',
    keys: normalizeKeys(keys),
    secondary_keys: [],
    content: cleanText(content),
    enabled: true,
    constant: Boolean(constant),
    insertion_order: Number.isFinite(Number(order)) ? Number(order) : 100,
    position: 'after_char',
    extensions: { source: STORY_MEMORY_TAG }
  }
}

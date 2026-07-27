function uniqueIds(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))]
}

export function splitAssistantReplySegments(content, {
  includeTrailing = true,
  minimumCharacters = 90,
  maximumCharacters = 260,
  maximumSegments = 12
} = {}) {
  const text = String(content ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return []
  const minimumLength = Math.max(30, Number(minimumCharacters) || 90)
  const characterLimit = Math.max(80, Number(maximumCharacters) || 260)
  const segmentLimit = Math.max(1, Math.min(20, Number(maximumSegments) || 12))
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

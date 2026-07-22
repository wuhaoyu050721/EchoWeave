const TAG_PATTERN = /<\s*(\/?)\s*([A-Za-z][A-Za-z0-9_.:-]*)\b([^<>]*?)>/g
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'link', 'meta'])
const STATUS_TAG_NAMES = new Set([
  'status', 'state', 'monitor', 'dashboard', 'statusbar', 'statebar',
  'statusblock', 'stateblock', 'statuspanel', 'statepanel', 'statetracker',
  'statusmonitor', 'characterstatus', 'roleplaystatus'
])
const STATUS_SECTION_NAMES = new Set([
  ...STATUS_TAG_NAMES,
  'bodydata', 'body', 'appearance', 'outfit', 'privateparts', 'relationship',
  'relationships', 'inventory', 'location', 'environment', 'worldstate',
  'memory', 'stats', 'variables'
])

const SECTION_LABELS = Object.freeze({
  status: '当前状态',
  state: '当前状态',
  statusbar: '当前状态',
  statusblock: '当前状态',
  stateblock: '当前状态',
  bodydata: '外观与动作',
  body: '外观与动作',
  appearance: '外观与动作',
  outfit: '服装',
  privateparts: '私密状态',
  relationship: '关系',
  relationships: '关系',
  inventory: '随身物品',
  location: '环境与位置',
  environment: '环境与位置',
  worldstate: '环境与位置',
  memory: '记忆'
})

function compactTagName(value) {
  return String(value ?? '').split(':').pop().toLowerCase().replace(/[_.-]+/g, '')
}

function isStatusTag(value) {
  const name = compactTagName(value)
  if (STATUS_TAG_NAMES.has(name)) return true
  return name.endsWith('status') || name.endsWith('monitor') || name.endsWith('dashboard')
}

function isStatusSectionTag(value) {
  return isStatusTag(value) || STATUS_SECTION_NAMES.has(compactTagName(value))
}

function trimEndIndex(value, end = value.length) {
  let index = Math.min(value.length, end)
  while (index > 0 && /\s/.test(value[index - 1])) index -= 1
  return index
}

function tagTokens(value, end = value.length) {
  const tokens = []
  TAG_PATTERN.lastIndex = 0
  let match
  while ((match = TAG_PATTERN.exec(value))) {
    if (match.index >= end) break
    const tokenEnd = match.index + match[0].length
    if (tokenEnd > end) break
    const name = match[2]
    const normalizedName = name.toLowerCase()
    const closing = Boolean(match[1])
    const selfClosing = !closing && (/\/\s*$/.test(match[3]) || VOID_TAGS.has(normalizedName))
    tokens.push({
      name,
      normalizedName,
      start: match.index,
      end: tokenEnd,
      closing,
      selfClosing
    })
  }
  return tokens
}

function findTrailingElement(value, end = value.length) {
  const trimmedEnd = trimEndIndex(value, end)
  const closingMatch = /<\/\s*([A-Za-z][A-Za-z0-9_.:-]*)\s*>$/.exec(value.slice(0, trimmedEnd))
  if (!closingMatch) return null
  const closingStart = trimmedEnd - closingMatch[0].length
  const normalizedName = closingMatch[1].toLowerCase()
  const matchingTokens = tagTokens(value, trimmedEnd).filter(token => token.normalizedName === normalizedName)
  let depth = 0
  for (let index = matchingTokens.length - 1; index >= 0; index -= 1) {
    const token = matchingTokens[index]
    if (token.closing) {
      depth += 1
      continue
    }
    if (token.selfClosing) continue
    depth -= 1
    if (depth === 0) {
      return {
        name: token.name,
        start: token.start,
        openEnd: token.end,
        closeStart: closingStart,
        end: trimmedEnd
      }
    }
  }
  return null
}

function collectTrailingElements(value) {
  const nodes = []
  let cursor = value.length
  for (let count = 0; count < 16; count += 1) {
    const node = findTrailingElement(value, cursor)
    if (!node) break
    nodes.unshift(node)
    cursor = node.start
  }
  return nodes
}

function findLastCompleteNamedElement(value, compactName) {
  const stack = []
  let latest = null
  for (const token of tagTokens(value)) {
    if (compactTagName(token.name) !== compactName || token.selfClosing) continue
    if (!token.closing) {
      stack.push(token)
      continue
    }
    const opening = stack.pop()
    if (!opening) continue
    latest = {
      name: opening.name,
      start: opening.start,
      openEnd: opening.end,
      closeStart: token.start,
      end: token.end
    }
  }
  return latest
}

function directChildElements(value, node) {
  const children = []
  const stack = []
  for (const token of tagTokens(value.slice(node.openEnd, node.closeStart))) {
    const absolute = { ...token, start: token.start + node.openEnd, end: token.end + node.openEnd }
    if (absolute.selfClosing) continue
    if (!absolute.closing) {
      stack.push({
        name: absolute.name,
        normalizedName: absolute.normalizedName,
        start: absolute.start,
        openEnd: absolute.end
      })
      continue
    }
    const opening = stack[stack.length - 1]
    if (!opening || opening.normalizedName !== absolute.normalizedName) {
      stack.length = 0
      continue
    }
    stack.pop()
    if (!stack.length) {
      children.push({
        name: opening.name,
        start: opening.start,
        openEnd: opening.openEnd,
        closeStart: absolute.start,
        end: absolute.end
      })
    }
  }
  return children
}

function decodeEntities(value) {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

function sectionText(value) {
  const withoutTags = value.replace(TAG_PATTERN, '\n')
  const lines = decodeEntities(withoutTags).replace(/\r\n?/g, '\n').split('\n').map(line => line.trim())
  while (lines[0] === '') lines.shift()
  while (lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

function parseSectionItems(content) {
  const items = []
  const remaining = []
  for (const line of content.split('\n')) {
    const match = /^[\[【]\s*([^|｜:：\]】]{1,32})\s*[|｜:：]\s*(.*?)\s*[\]】]$/.exec(line.trim())
    if (match) items.push({ label: match[1].trim(), value: match[2].trim() })
    else if (line.trim()) remaining.push(line.trim())
  }
  return { items, text: remaining.join('\n') }
}

function sectionLabel(tagName) {
  const compact = compactTagName(tagName)
  if (SECTION_LABELS[compact]) return SECTION_LABELS[compact]
  if (isStatusTag(tagName)) return '角色状态'
  return String(tagName ?? '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .trim() || '状态信息'
}

function createSections(value, nodes) {
  return nodes.map((node, index) => {
    const content = sectionText(value.slice(node.openEnd, node.closeStart))
    const parsed = parseSectionItems(content)
    return {
      id: `${compactTagName(node.name) || 'section'}-${index}`,
      tag: node.name,
      label: sectionLabel(node.name),
      content,
      items: parsed.items,
      text: parsed.text
    }
  }).filter(section => section.content)
}

function hasOnlyDirectChildContent(value, node, children) {
  let cursor = node.openEnd
  let outside = ''
  for (const child of children) {
    outside += value.slice(cursor, child.start)
    cursor = child.end
  }
  outside += value.slice(cursor, node.closeStart)
  return !outside.trim()
}

function structuredStatusChildren(value, root) {
  const children = directChildElements(value, root)
  if (!children.length || !children.every(child => isStatusSectionTag(child.name))) return []
  if (!hasOnlyDirectChildContent(value, root, children)) return []
  const statusChild = children.find(child => isStatusTag(child.name))
  if (!statusChild) return []
  const content = sectionText(value.slice(statusChild.openEnd, statusChild.closeStart))
  if (children.length === 1 && !parseSectionItems(content).items.length) return []
  return children
}

function statusSummary(sections) {
  const primary = sections.find(section => isStatusTag(section.tag)) || sections[0]
  if (!primary) return '状态已更新'
  if (!primary.items.length) return primary.text.split('\n')[0] || primary.content.split('\n')[0] || '状态已更新'

  const preferred = []
  const others = []
  for (const item of primary.items) {
    if (/当前状态|状态|位置|地点|好感|关系|心情|情绪|health|hp/i.test(item.label)) preferred.push(item)
    else others.push(item)
  }
  return [...preferred, ...others].slice(0, 3).map(item => {
    if (/好感|关系|health|hp/i.test(item.label)) return `${item.label} ${item.value}`
    return item.value || item.label
  }).filter(Boolean).join(' · ') || '状态已更新'
}

function findStatusItem(items, pattern) {
  return items.find(item => pattern.test(String(item?.label ?? '').trim())) || null
}

function statusScorePercent(value) {
  const normalized = String(value ?? '').trim()
  const ratio = normalized.match(/(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/)
  if (ratio && Number(ratio[2]) > 0) {
    return Math.round(Math.max(0, Math.min(100, (Number(ratio[1]) / Number(ratio[2])) * 100)))
  }
  const number = normalized.match(/-?\d+(?:\.\d+)?/)
  if (!number) return null
  return Math.round(Math.max(0, Math.min(100, Number(number[0]))))
}

export function assistantStatusProgressColor(value) {
  const percent = statusScorePercent(value)
  if (percent === null) return '#2fa49f'
  if (percent <= 20) return '#85929a'
  if (percent <= 40) return '#3f8fbd'
  if (percent <= 60) return '#2fa49f'
  if (percent <= 80) return '#e0a12f'
  return '#e64e75'
}

export function createAssistantStatusOverview(status) {
  if (!status) return null
  const sections = Array.isArray(status.sections) ? status.sections : []
  const items = sections.flatMap(section => Array.isArray(section.items) ? section.items : [])
  const stateItem = findStatusItem(items, /^(?:当前)?(?:状态|心情|情绪|阶段)$/i)
  const locationItem = findStatusItem(items, /位置|地点|场所|location/i)
  const scoreItem = findStatusItem(items, /好感|亲密|关系值|affection|relationship/i)
  const fallbackItem = items.find(item => item !== locationItem && item !== scoreItem)

  return {
    primary: String(stateItem?.value || fallbackItem?.value || status.summary || '状态已更新').trim(),
    location: String(locationItem?.value || '').trim(),
    scoreLabel: String(scoreItem?.label || '').trim(),
    scoreValue: String(scoreItem?.value || '').trim(),
    scorePercent: scoreItem ? statusScorePercent(scoreItem.value) : null
  }
}

export function assistantStatusSectionsForDisplay(status, { showPrivate = false } = {}) {
  const sections = Array.isArray(status?.sections) ? status.sections : []
  if (showPrivate) return sections
  return sections.filter(section => (
    compactTagName(section?.tag) !== 'privateparts' && section?.label !== '私密状态'
  ))
}

function startsOnOwnLine(value, index) {
  const lineStart = value.lastIndexOf('\n', Math.max(0, index - 1)) + 1
  return !value.slice(lineStart, index).trim()
}

function isInsideCodeFence(value, index) {
  const prefix = value.slice(0, index)
  const backtickCount = (prefix.match(/```/g) || []).length
  const tildeCount = (prefix.match(/~~~/g) || []).length
  return backtickCount % 2 === 1 || tildeCount % 2 === 1
}

function narrativeBeforeStatus(value, index) {
  return value.slice(0, index)
    .trimEnd()
    .replace(/(?:^|\n)[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/, '')
    .trimEnd()
}

function canonicalStatusNarrative(value, node) {
  const before = value.slice(0, node.start)
    .replace(/[ \t]*```(?:xml)?[ \t]*\r?\n?[ \t]*$/i, '')
  const after = value.slice(node.end)
    .replace(/^[ \t\r\n]*```[ \t]*(?:\r?\n|$)/, '')
    .trim()
  return [narrativeBeforeStatus(before, before.length), after].filter(Boolean).join('\n\n')
}

function pendingStatusStart(value) {
  const stack = []
  for (const token of tagTokens(value)) {
    if (token.selfClosing) continue
    if (!token.closing) {
      if (isStatusTag(token.name)) stack.push(token)
      continue
    }
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index].normalizedName === token.normalizedName) {
        stack.splice(index, 1)
        break
      }
    }
  }
  return stack.find(token => startsOnOwnLine(value, token.start) && !isInsideCodeFence(value, token.start))?.start ?? -1
}

function pendingCanonicalStatusStart(value) {
  const stack = []
  for (const token of tagTokens(value)) {
    if (compactTagName(token.name) !== 'sumomonitor' || token.selfClosing) continue
    if (!token.closing) stack.push(token)
    else if (stack.length) stack.pop()
  }
  return stack.length ? stack[stack.length - 1].start : -1
}

export function extractAssistantStatus(input, { hideIncomplete = false } = {}) {
  const value = String(input ?? '')
  if (!value.includes('<')) return { content: value, status: null, pending: false }
  const trailing = collectTrailingElements(value)
  const statusIndex = trailing.findIndex(node => isStatusTag(node.name))
  let nodes = statusIndex >= 0 ? trailing.slice(statusIndex) : []
  let first = nodes[0]
  let sectionNodes = []
  if (first) {
    const rootChildren = nodes.length === 1 ? directChildElements(value, first) : []
    sectionNodes = rootChildren.length ? rootChildren : nodes
  } else if (trailing.length) {
    const root = trailing[trailing.length - 1]
    const children = structuredStatusChildren(value, root)
    if (children.length) {
      nodes = [root]
      first = root
      sectionNodes = children
    }
  }

  if (first) {
    if (startsOnOwnLine(value, first.start) && !isInsideCodeFence(value, first.start)) {
      const sections = createSections(value, sectionNodes)
      if (sections.length) {
        return {
          content: narrativeBeforeStatus(value, first.start),
          status: {
            rootTag: first.name,
            summary: statusSummary(sections),
            sections,
            raw: value.slice(first.start, nodes[nodes.length - 1].end).trim()
          },
          pending: false
        }
      }
    }
  }

  const canonicalRoot = findLastCompleteNamedElement(value, 'sumomonitor')
  if (canonicalRoot) {
    const children = directChildElements(value, canonicalRoot).filter(child => isStatusSectionTag(child.name))
    if (children.some(child => isStatusTag(child.name))) {
      const sections = createSections(value, children)
      if (sections.length) {
        return {
          content: canonicalStatusNarrative(value, canonicalRoot),
          status: {
            rootTag: canonicalRoot.name,
            summary: statusSummary(sections),
            sections,
            raw: value.slice(canonicalRoot.start, canonicalRoot.end).trim()
          },
          pending: false
        }
      }
    }
  }

  if (hideIncomplete) {
    const regularStart = pendingStatusStart(value)
    const canonicalStart = regularStart >= 0 ? -1 : pendingCanonicalStatusStart(value)
    const start = regularStart >= 0 ? regularStart : canonicalStart
    if (start >= 0) {
      if (regularStart >= 0) {
        return { content: narrativeBeforeStatus(value, start), status: null, pending: true }
      }
      const before = value.slice(0, start).replace(/[ \t]*```(?:xml)?[ \t]*\r?\n?[ \t]*$/i, '')
      return { content: narrativeBeforeStatus(before, before.length), status: null, pending: true }
    }
  }
  return { content: value, status: null, pending: false }
}

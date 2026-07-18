function cleanText(value) {
  return String(value ?? '').trim()
}

export function renderCharacterTemplate(value, { characterName = '', userName = '用户' } = {}) {
  return String(value ?? '')
    .replace(/\{\{\s*char\s*\}\}/gi, characterName)
    .replace(/\{\{\s*user\s*\}\}/gi, userName)
    .replace(/<char>/gi, characterName)
    .replace(/<user>/gi, userName)
}

function literalMatch(haystack, needle, { caseSensitive = false, wholeWords = false } = {}) {
  const source = caseSensitive ? haystack : haystack.toLocaleLowerCase()
  const query = caseSensitive ? needle : needle.toLocaleLowerCase()
  if (!query) return false
  if (!wholeWords) return source.includes(query)
  let offset = source.indexOf(query)
  while (offset >= 0) {
    const before = offset === 0 ? '' : source[offset - 1]
    const after = offset + query.length >= source.length ? '' : source[offset + query.length]
    if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) return true
    offset = source.indexOf(query, offset + 1)
  }
  return false
}

function entryProbability(entry) {
  const value = Number(entry.probability ?? entry.extensions?.probability ?? 100)
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100
}

function entryMatches(entry, text, random) {
  if (entry.enabled === false) return false
  if (entry.constant) return random() * 100 < entryProbability(entry)
  if (entry.use_regex) return false
  const options = {
    caseSensitive: Boolean(entry.case_sensitive ?? entry.extensions?.case_sensitive),
    wholeWords: Boolean(entry.match_whole_words ?? entry.extensions?.match_whole_words)
  }
  const primary = Array.isArray(entry.keys) ? entry.keys : []
  if (!primary.some(key => literalMatch(text, String(key), options))) return false
  const secondary = Array.isArray(entry.secondary_keys) ? entry.secondary_keys : []
  if (entry.selective) {
    const matches = secondary.map(key => literalMatch(text, String(key), options))
    const logic = Number(entry.selective_logic ?? entry.extensions?.selective_logic ?? 0)
    if (logic === 1 && matches.every(Boolean)) return false
    if (logic === 2 && matches.some(Boolean)) return false
    if (logic === 3 && (!matches.length || !matches.every(Boolean))) return false
    if (![1, 2, 3].includes(logic) && !matches.some(Boolean)) return false
  }
  return random() * 100 < entryProbability(entry)
}

function recentScanText(messages, depth) {
  return messages
    .filter(message => !message.deletedAt && ['user', 'assistant'].includes(message.role))
    .slice(-Math.max(1, Number(depth) || 4))
    .map(message => String(message.content ?? ''))
    .join('\n')
    .slice(-20000)
}

function activateWorldBooks(worldBooks, messages, random) {
  const activated = []
  const skippedRegexEntries = []
  for (const book of worldBooks) {
    const data = book?.data || book
    const scanText = recentScanText(messages, data?.scan_depth)
    const entries = Array.isArray(data?.entries) ? data.entries : []
    let usedCharacters = 0
    const characterBudget = Math.max(256, (Number(data?.token_budget) || 2048) * 4)
    const matches = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        if (entry.enabled !== false && entry.use_regex && !entry.constant) skippedRegexEntries.push(entry.id ?? `${book.id || 'book'}-${entry.insertion_order ?? 100}`)
        return entryMatches(entry, scanText, random)
      })
      .sort((left, right) => {
        const leftOrder = Number(left.entry.insertion_order)
        const rightOrder = Number(right.entry.insertion_order)
        return (Number.isFinite(leftOrder) ? leftOrder : 100) - (Number.isFinite(rightOrder) ? rightOrder : 100) || left.index - right.index
      })
    for (const { entry, index } of matches) {
      const content = cleanText(entry.content)
      if (!content) continue
      if (usedCharacters + content.length > characterBudget && usedCharacters > 0) break
      activated.push({
        id: entry.id ?? `${book.id || 'book'}-${index}`,
        position: [
          'before_char', 'after_char', 'before_example', 'after_example',
          'before_author_note', 'after_author_note', 'at_depth'
        ].includes(entry.position) ? entry.position : 'after_char',
        order: Number.isFinite(Number(entry.insertion_order)) ? Number(entry.insertion_order) : 100,
        content
      })
      usedCharacters += content.length
    }
  }
  activated.sort((left, right) => left.order - right.order)
  return { activated, skippedRegexEntries }
}

function section(label, value) {
  const content = cleanText(value)
  return content ? `[${label}]\n${content}` : ''
}

export function buildCharacterPromptBundle({
  character,
  worldBooks = [],
  messages = [],
  userName = '用户',
  random = Math.random
} = {}) {
  if (!character?.card?.data) return { systemPrompt: '', postHistoryPrompt: '', activatedEntryIds: [], skippedRegexEntries: [] }
  const card = character.card.data
  const render = value => renderCharacterTemplate(value, { characterName: card.name, userName })
  const { activated, skippedRegexEntries } = activateWorldBooks(worldBooks, messages, random)
  const positionedContent = position => activated
    .filter(entry => entry.position === position)
    .map(entry => render(entry.content))
    .join('\n\n')
  const systemPrompt = [
    section('世界书：角色设定前', positionedContent('before_char')),
    section('角色名称', render(card.name)),
    section('角色描述', render(card.description)),
    section('角色性格', render(card.personality)),
    section('当前场景', render(card.scenario)),
    section('角色指令', render(card.system_prompt)),
    section('世界书：角色设定后', positionedContent('after_char')),
    section('世界书：示例对话前', positionedContent('before_example')),
    section('对话示例', render(card.mes_example)),
    section('世界书：示例对话后', positionedContent('after_example'))
  ].filter(Boolean).join('\n\n')
  const postHistoryPrompt = [
    section('世界书：作者注释前', positionedContent('before_author_note')),
    render(card.post_history_instructions),
    section('世界书：作者注释后', positionedContent('after_author_note')),
    section('世界书：历史深度位置', positionedContent('at_depth'))
  ].filter(Boolean).join('\n\n')
  return {
    systemPrompt,
    postHistoryPrompt,
    activatedEntryIds: activated.map(entry => entry.id),
    skippedRegexEntries
  }
}

export function mergePromptBundles(globalPrompt, characterBundle) {
  return {
    systemPrompt: [cleanText(globalPrompt), cleanText(characterBundle?.systemPrompt)].filter(Boolean).join('\n\n'),
    postHistoryPrompt: cleanText(characterBundle?.postHistoryPrompt)
  }
}

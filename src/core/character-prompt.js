import { extractAssistantStatus } from './assistant-status.js'

function cleanText(value) {
  return String(value ?? '').trim()
}

const CHARACTER_STATUS_TEMPLATE = `<sumo_monitor>
<status>
[当前状态|填写本轮结束时的实际状态]
[当前位置|填写本轮结束时的实际位置]
[好感度|填写延续上一轮后的当前值]
[小障锐评|填写一句符合当前剧情的简短锐评]
</status>
<body_data>
[服装|填写本轮结束时的实际服装]
[姿势|填写本轮结束时的实际姿势]
[特写|填写值得关注的表情、动作或外观细节]
[腿足|填写本轮结束时的实际腿足状态；没有变化时填写无变化]
</body_data>
<private_parts>
[前庭|填写本轮结束时的具体状态；无变化时沿用上一轮，首次出现时根据角色设定初始化为平静或无变化]
[后庭|填写本轮结束时的具体状态；无变化时沿用上一轮，首次出现时根据角色设定初始化为平静或无变化]
[子宫|填写本轮结束时的具体状态；无变化时沿用上一轮，首次出现时根据角色设定初始化为平静或无变化]
</private_parts>
</sumo_monitor>`

const PRIVATE_STATUS_RULE = `私密状态三个字段每轮都必须填写具体、客观的当前状态，不得留空或使用笼统占位值。本轮未涉及或没有变化时沿用上一轮；首次出现或上一轮为待重新初始化时，根据角色设定填写“平静”或“无变化”等明确状态。`

export function renderCharacterTemplate(value, { characterName = '', userName = '用户' } = {}) {
  const resolvedCharacterName = String(characterName ?? '')
  const resolvedUserName = String(userName ?? '').trim() || '用户'
  return String(value ?? '')
    .replace(/\{\{\s*char\s*\}\}/gi, () => resolvedCharacterName)
    .replace(/\{\{\s*user\s*\}\}/gi, () => resolvedUserName)
    .replace(/<char>/gi, () => resolvedCharacterName)
    .replace(/<user>/gi, () => resolvedUserName)
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

function renderedKeys(values, render) {
  return (Array.isArray(values) ? values : [])
    .map(value => cleanText(render(value)))
    .filter(Boolean)
}

function entryMatches(entry, text, random, render) {
  if (entry.enabled === false) return false
  if (entry.constant) return random() * 100 < entryProbability(entry)
  if (entry.use_regex) return false
  const options = {
    caseSensitive: Boolean(entry.case_sensitive ?? entry.extensions?.case_sensitive),
    wholeWords: Boolean(entry.match_whole_words ?? entry.extensions?.match_whole_words)
  }
  const primary = renderedKeys(entry.keys, render)
  if (!primary.some(key => literalMatch(text, key, options))) return false
  const secondary = renderedKeys(entry.secondary_keys, render)
  if (entry.selective) {
    const matches = secondary.map(key => literalMatch(text, key, options))
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

function activateWorldBooks(worldBooks, messages, random, render) {
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
        return entryMatches(entry, scanText, random, render)
      })
      .sort((left, right) => {
        const leftOrder = Number(left.entry.insertion_order)
        const rightOrder = Number(right.entry.insertion_order)
        return (Number.isFinite(leftOrder) ? leftOrder : 100) - (Number.isFinite(rightOrder) ? rightOrder : 100) || left.index - right.index
      })
    for (const { entry, index } of matches) {
      const content = cleanText(render(entry.content))
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

function latestAssistantStatus(messages) {
  const ordered = (Array.isArray(messages) ? messages : [])
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message?.role === 'assistant' && !message.deletedAt && (!message.status || ['completed', 'interrupted'].includes(message.status)))
    .sort((left, right) => (Number(left.message.sequence) || 0) - (Number(right.message.sequence) || 0) || left.index - right.index)

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const status = extractAssistantStatus(ordered[index].message.content).status
    if (status?.raw) return status
  }
  return null
}

function statusReferenceRaw(previousStatus) {
  return cleanText(previousStatus?.raw).replace(/不适用/g, '待重新初始化')
}

function buildStatusOutputProtocol(previousStatus) {
  const previousRaw = statusReferenceRaw(previousStatus)
  const reference = previousRaw
    ? `[上一轮状态参考：仅用于延续状态值，不沿用其输出格式]\n${previousRaw}\n\n`
    : ''

  return `[统一状态栏输出协议：每轮强制]
1. 先输出正常回复正文，再在正文末尾另起一行输出一个完整状态块。
2. 每轮都必须输出状态块；即使状态没有变化，也必须返回全部分区和字段。
3. 状态块不得放入 Markdown 代码块，状态块之后不得再输出其他内容。
4. 无论角色卡原本是否定义其他状态格式，最终只输出下方固定格式；不得增加、删除、改名或调整字段顺序。
5. 根据本轮剧情更新发生变化的值，未变化值沿用上一轮；首次出现时根据角色设定和当前场景初始化。
6. 必须把模板中的“填写……”说明替换为真实状态。信息不足时填写“未知”，不要保留说明文字或其他占位内容。
7. ${PRIVATE_STATUS_RULE}

${reference}[本轮固定输出格式]
${CHARACTER_STATUS_TEMPLATE}`
}

function buildStatusOutputReminder() {
  return `[状态栏最终提醒]
本轮回复结束前必须检查：正文末尾已经按系统指令输出完整 <sumo_monitor>，所有固定字段均已填写，且状态块后没有其他内容。`
}

function buildStatusUserTurnPrompt(previousStatus) {
  const previousRaw = statusReferenceRaw(previousStatus)
  const reference = previousRaw
    ? `[上一轮状态参考]\n${previousRaw}\n\n`
    : ''
  return `[应用内部状态输出要求]
这是本轮回复的强制组成部分，不要在正文中提及或解释本要求。完成正常回复正文后，必须立即输出下方完整状态块；不得省略、改名或增加字段，不得放入 Markdown 代码块，状态块之后不得再输出内容。模板中“填写……”文字必须替换为本轮真实值。
${PRIVATE_STATUS_RULE}

${reference}[固定输出格式]
${CHARACTER_STATUS_TEMPLATE}`
}

export function buildCharacterPromptBundle({
  character,
  worldBooks = [],
  messages = [],
  statusMessages = messages,
  userName = '用户',
  random = Math.random
} = {}) {
  if (!character?.card?.data) return { systemPrompt: '', postHistoryPrompt: '', userTurnPrompt: '', activatedEntryIds: [], skippedRegexEntries: [] }
  const card = character.card.data
  const characterName = cleanText(character.name) || cleanText(card.name) || '角色'
  const resolvedUserName = cleanText(userName) || '用户'
  const render = value => renderCharacterTemplate(value, { characterName, userName: resolvedUserName })
  const { activated, skippedRegexEntries } = activateWorldBooks(worldBooks, messages, random, render)
  const previousStatus = latestAssistantStatus(statusMessages)
  const statusOutputProtocol = buildStatusOutputProtocol(previousStatus)
  const positionedContent = position => activated
    .filter(entry => entry.position === position)
    .map(entry => entry.content)
    .join('\n\n')
  const systemPrompt = [
    section('世界书：角色设定前', positionedContent('before_char')),
    section('角色名称', characterName),
    section('角色描述', render(card.description)),
    section('角色性格', render(card.personality)),
    section('当前场景', render(card.scenario)),
    section('角色指令', render(card.system_prompt)),
    section('世界书：角色设定后', positionedContent('after_char')),
    section('世界书：示例对话前', positionedContent('before_example')),
    section('对话示例', render(card.mes_example)),
    section('世界书：示例对话后', positionedContent('after_example')),
    statusOutputProtocol
  ].filter(Boolean).join('\n\n')
  const postHistoryPrompt = [
    section('世界书：作者注释前', positionedContent('before_author_note')),
    render(card.post_history_instructions),
    section('世界书：作者注释后', positionedContent('after_author_note')),
    section('世界书：历史深度位置', positionedContent('at_depth')),
    buildStatusOutputReminder()
  ].filter(Boolean).join('\n\n')
  return {
    systemPrompt,
    postHistoryPrompt,
    userTurnPrompt: buildStatusUserTurnPrompt(previousStatus),
    activatedEntryIds: activated.map(entry => entry.id),
    skippedRegexEntries
  }
}

export function mergePromptBundles(globalPrompt, characterBundle) {
  return {
    systemPrompt: [cleanText(globalPrompt), cleanText(characterBundle?.systemPrompt)].filter(Boolean).join('\n\n'),
    postHistoryPrompt: cleanText(characterBundle?.postHistoryPrompt),
    userTurnPrompt: cleanText(characterBundle?.userTurnPrompt)
  }
}

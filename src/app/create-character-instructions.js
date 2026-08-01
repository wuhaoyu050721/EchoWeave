import {
  activateWorldBooks,
  buildCharacterPromptBundle,
  mergePromptBundles,
  renderCharacterTemplate
} from '../core/character-prompt.js'
import { readCharacterStatusEnabled } from '../core/character-status-setting.js'
import {
  GROUP_REPLY_CHAIN_LIMIT,
  groupParticipantKind,
  groupStatusMessages,
  groupVisibleMessages,
  isGroupConversation,
  normalizeGroupParticipants
} from '../core/group-chat.js'

function cleanText(value) {
  return String(value ?? '').trim()
}

function section(label, value) {
  const content = cleanText(value)
  return content ? `[${label}]\n${content}` : ''
}

function worldBookAppliesToCharacter(book, characterId) {
  const targetId = cleanText(characterId)
  const boundIds = Array.isArray(book?.characterIds) ? book.characterIds.map(value => cleanText(value)).filter(Boolean) : []
  return cleanText(book?.characterId) === targetId ||
    boundIds.includes(targetId) ||
    (book?.scope === 'global' && !book?.characterId && boundIds.length === 0)
}

function isStoryConversation(conversation) {
  return conversation?.conversationKind === 'story'
}

function storyCharacterIds(conversation) {
  return [...new Set([
    ...(Array.isArray(conversation?.storyConfig?.characterIds) ? conversation.storyConfig.characterIds : []),
    conversation?.characterId
  ].map(value => cleanText(value)).filter(Boolean))]
}

function worldBookCharacterIds(book) {
  return [...new Set([
    book?.characterId,
    ...(Array.isArray(book?.characterIds) ? book.characterIds : [])
  ].map(value => cleanText(value)).filter(Boolean))]
}

function worldBookTargetsStoryCharacters(book, characterIds) {
  const storyIds = new Set(characterIds.map(value => cleanText(value)).filter(Boolean))
  return worldBookCharacterIds(book).some(characterId => storyIds.has(characterId))
}

function worldBookAppliesToStory(book, conversation, characterIds) {
  const bookId = cleanText(book?.id)
  const conversationId = cleanText(conversation?.id)
  const bookConversationId = cleanText(book?.conversationId)
  const targetsStoryCharacter = worldBookTargetsStoryCharacters(book, characterIds)
  const storyBookIds = new Set((Array.isArray(conversation?.storyConfig?.worldBookIds)
    ? conversation.storyConfig.worldBookIds
    : []).map(value => cleanText(value)).filter(Boolean))
  const explicitlySelected = Boolean(bookId && storyBookIds.has(bookId))
  if (book?.scope === 'story') {
    if (bookConversationId) return bookConversationId === conversationId || explicitlySelected
    return explicitlySelected || targetsStoryCharacter
  }
  return characterIds.some(characterId => worldBookAppliesToCharacter(book, characterId))
}

function storyPatchesText(character) {
  const patches = Array.isArray(character?.storyMemoryPatches) ? character.storyMemoryPatches : []
  return patches
    .slice(-24)
    .map(patch => cleanText(patch.content))
    .filter(Boolean)
    .map(content => `- ${content}`)
    .join('\n')
}

function storyCharacterSection(character, userName) {
  const card = character?.card?.data || {}
  const characterName = cleanText(character?.name || card.name) || '故事角色'
  const render = value => renderCharacterTemplate(value, { characterName, userName })
  return [
    `## ${characterName}`,
    section('角色描述', render(card.description)),
    section('角色性格', render(card.personality)),
    section('当前场景', render(card.scenario)),
    section('角色指令', render(card.system_prompt)),
    section('故事内角色记忆', storyPatchesText(character))
  ].filter(Boolean).join('\n\n')
}

function buildStoryMemoryProtocol(characters) {
  const roster = characters
    .map(character => `- ${cleanText(character.id)}：${cleanText(character.name || character.card?.data?.name) || '故事角色'}`)
    .join('\n')
  return `[故事记忆写入协议]
你正在故事模式中续写长篇剧情。每次回复必须先输出给用户阅读的故事正文，然后在正文末尾另起一行输出一个内部记忆块。内部记忆块会被应用隐藏，并用于实时更新故事角色卡和故事世界书。

固定格式如下，不要放入 Markdown 代码块：
<echo_story_memory>
{
  "sceneSummary": "用 1-3 句话更新当前剧情阶段、地点、冲突和伏笔",
  "characterPatches": [
    {
      "characterId": "从下方角色 ID 中选择；不确定时留空并填写 characterName",
      "characterName": "角色名",
      "field": "relationship_memory",
      "content": "只记录长期有效、会影响后续剧情的角色变化",
      "confidence": 0.8
    }
  ],
  "worldBookEntries": [
    {
      "name": "地点/组织/道具/伏笔名称",
      "keys": ["关键词1", "关键词2"],
      "content": "长期有效的世界设定、事件后果、伏笔或规则",
      "constant": false,
      "confidence": 0.8
    }
  ]
}
</echo_story_memory>

角色 ID：
${roster || '- 无'}

只写值得长期记住的内容；不要把普通动作、临时情绪、重复事实写入记忆。信息没有变化时也要输出空数组和当前剧情摘要。`
}

function buildStoryPromptBundle({
  conversation,
  characters = [],
  worldBooks = [],
  messages = [],
  userName = '用户',
  random = Math.random
} = {}) {
  const activeCharacters = characters.filter(Boolean)
  const primary = activeCharacters[0] || {}
  const primaryName = cleanText(primary.name || primary.card?.data?.name) || '故事角色'
  const render = value => renderCharacterTemplate(value, { characterName: primaryName, userName })
  const { activated } = activateWorldBooks(worldBooks, messages, random, render)
  const memoryText = activated.map(entry => entry.content).filter(Boolean).join('\n\n')
  const characterText = activeCharacters
    .map(character => storyCharacterSection(character, userName))
    .filter(Boolean)
    .join('\n\n---\n\n')
  const systemPrompt = [
    `[故事模式]
你是长篇故事续写引擎。你的任务是延续当前故事，而不是普通聊天。
用户输入代表事件方向、选择、补充设定或镜头要求；如果用户留空或要求续写，就紧接上一段继续推进。
保持角色卡设定、已有剧情、世界书和故事记忆一致。不要因为上下文变长而忘记长期设定。
不要替用户做重大选择；可以呈现选择带来的后果、悬念和角色反应。
默认输出连贯小说正文，不要用问答腔，不要解释自己正在写作。`,
    '故事模式只使用 <echo_story_memory> 内部记忆块，不要输出状态栏或其他常规聊天状态协议。',
    section('故事标题', conversation?.title),
    section('用户名称', userName),
    section('故事角色卡', characterText),
    section('已激活世界书与故事记忆', memoryText)
  ].filter(Boolean).join('\n\n')
  return {
    systemPrompt,
    postHistoryPrompt: buildStoryMemoryProtocol(activeCharacters),
    userTurnPrompt: `[故事模式本轮要求]
将用户输入视为剧情走向或续写指令，继续输出故事正文。正文之后必须附带完整 <echo_story_memory> 内部记忆块；不要在正文中解释该记忆块。`
  }
}

function memberSummary(character, participant) {
  const name = cleanText(character?.name || participant?.nameSnapshot) || '未命名角色'
  if (groupParticipantKind(participant) === 'provider') {
    const modelName = cleanText(participant?.modelName)
    return modelName ? `- ${name}：AI 接口，模型 ${modelName}` : `- ${name}：AI 接口`
  }
  const card = character?.card?.data || {}
  const detail = cleanText(card.description || card.personality)
    .replace(/\s+/g, ' ')
    .slice(0, 240)
  return detail ? `- ${name}：${detail}` : `- ${name}`
}

function groupInstruction(conversation, participants, characters, active, userName) {
  const activeCharacterId = cleanText(active?.characterId)
  const activeCharacter = characters.get(activeCharacterId)
  const activeName = cleanText(activeCharacter?.name || active?.nameSnapshot) || '当前角色'
  const roster = participants
    .map(participant => memberSummary(characters.get(participant.characterId), participant))
    .join('\n')
  const isProviderMember = groupParticipantKind(active) === 'provider'
  const identityRule = isProviderMember
    ? `你是群聊中的独立 AI 接口成员“${activeName}”，当前模型为“${cleanText(active?.modelName) || '接口默认模型'}”。
你没有角色卡，也不加载任何角色世界书或角色状态协议。不要扮演群内角色，不要输出 <sumo_monitor>。`
    : `当前唯一允许发言的角色是：${activeName}。`
  const outputRule = isProviderMember
    ? `只以${activeName}这个 AI 接口成员的身份回答，不得替其他成员发言或同时模拟多人。
可以分析并回应群内已经出现的内容。不要在回复开头添加“${activeName}：”等姓名前缀，应用会自动显示发言者。`
    : `只以${activeName}的身份输出本轮言行，不得替其他群成员发言、补写其他成员对白或同时扮演多人。
可以自然回应其他成员已经说过的话。不要在回复开头添加“${activeName}：”等姓名前缀，应用会自动显示发言者。`
  const handoffRule = conversation?.replyPolicy?.autoHandoff === false
    ? ''
    : `如果确实希望某位群成员在你之后接话，请在正文中写出对方的完整名称并使用 @ 点名，例如“@成员名”。应用会让被点名成员接着发言。
普通提及成员时不要使用 @，不要替被点名者生成回答。每次用户消息最多产生 ${GROUP_REPLY_CHAIN_LIMIT} 条群成员回复。`

  return `[群聊身份与发言规则]
你正在参加群聊“${cleanText(conversation?.title) || '角色群聊'}”。
${identityRule}
用户名称：${cleanText(userName) || '用户'}。
群成员：
${roster}

${outputRule}
${handoffRule}`.trim()
}

async function loadGroupCharacters(repository, participants) {
  const characters = new Map()
  await Promise.all(participants.map(async participant => {
    if (groupParticipantKind(participant) !== 'character') return
    const characterId = cleanText(participant.characterId)
    if (!characterId || characters.has(characterId)) return
    const character = await repository.getCharacter?.(characterId)
    if (character && !character.deletedAt) characters.set(characterId, character)
  }))
  return characters
}

export function createUserNameResolver(repository) {
  return async () => String(await repository.getSetting('profileName', '用户') || '用户').trim() || '用户'
}

export async function saveLocalProfileName(repository, value) {
  const username = String(value ?? '').trim()
  if (!username) throw new Error('本地用户名不能为空')
  if (username.length > 32) throw new Error('本地用户名不能超过 32 个字符')
  if (!repository?.setSetting) throw new Error('本地用户名存储服务不可用')
  await repository.setSetting('profileName', username)
  return username
}

export async function syncProfileNameFromCloudSession(repository, session) {
  const username = String(session?.user?.username ?? '').trim()
  if (!username) return ''
  if (!repository?.setSetting) throw new Error('本地用户名存储服务不可用')
  await repository.setSetting('profileName', username)
  return username
}

export function createChatInstructionResolver({ repository, vault, getUserName = createUserNameResolver(repository) } = {}) {
  return async (conversation, {
    messages = [],
    speakerCharacterId = null,
    speakerProviderProfileId = null
  } = {}) => {
    let globalPrompt = ''
    if (conversation?.systemPromptMode === 'override' && conversation.encryptedSystemPrompt) {
      globalPrompt = await vault.decryptString(conversation.encryptedSystemPrompt)
    } else if (conversation?.systemPromptMode !== 'disabled') {
      const settings = await repository.getSetting('systemPrompt', { enabled: false, encryptedValue: null })
      if (settings.enabled && settings.encryptedValue) globalPrompt = await vault.decryptString(settings.encryptedValue)
    }
    const groupConversation = isGroupConversation(conversation)
    const participants = groupConversation
      ? normalizeGroupParticipants(conversation?.participants)
      : []
    const targetCharacterId = cleanText(speakerCharacterId || conversation?.characterId)
    const targetProviderProfileId = cleanText(speakerProviderProfileId)
    const activeParticipant = groupConversation
      ? participants.find(participant => (
          targetProviderProfileId
            ? participant.providerProfileId === targetProviderProfileId
            : participant.characterId === targetCharacterId
        ))
      : null
    if (groupConversation && groupParticipantKind(activeParticipant) === 'provider') {
      const [userName, characters] = await Promise.all([
        getUserName(),
        loadGroupCharacters(repository, participants)
      ])
      return [globalPrompt, groupInstruction(
        conversation,
        participants,
        characters,
        activeParticipant,
        userName
      )].filter(Boolean).join('\n\n')
    }

    if (isStoryConversation(conversation)) {
      const ids = storyCharacterIds(conversation)
      if (!ids.length || !repository.getCharacter) return globalPrompt
      const [userName, characters] = await Promise.all([
        getUserName(),
        Promise.all(ids.map(id => repository.getCharacter(id)))
      ])
      const activeCharacters = characters.filter(character => character && !character.deletedAt)
      if (!activeCharacters.length) return globalPrompt
      const availableBooks = repository.listAllWorldBooks
        ? await repository.listAllWorldBooks()
        : []
      const worldBooks = availableBooks.filter(book => worldBookAppliesToStory(book, conversation, ids))
      return mergePromptBundles(globalPrompt, buildStoryPromptBundle({
        conversation,
        characters: activeCharacters,
        worldBooks,
        messages,
        userName
      }))
    }

    if (!targetCharacterId || !repository.getCharacter) return globalPrompt

    const character = await repository.getCharacter(targetCharacterId)
    if (!character || character.deletedAt) return globalPrompt
    const availableBooks = repository.listWorldBooks
      ? await repository.listWorldBooks({ characterId: character.id, includeGlobal: true })
      : []
    const worldBooks = availableBooks.filter(book => worldBookAppliesToCharacter(book, String(character.id)))
    const [userName, statusEnabled] = await Promise.all([
      getUserName(),
      readCharacterStatusEnabled(repository)
    ])
    const characters = groupConversation
      ? await loadGroupCharacters(repository, participants)
      : new Map()
    characters.set(String(character.id), character)
    const dialogueMessages = groupConversation
      ? groupVisibleMessages(messages, { userName })
      : messages
    const statusMessages = groupConversation
      ? groupStatusMessages(messages, targetCharacterId)
      : messages
    const characterBundle = buildCharacterPromptBundle({
      character,
      worldBooks,
      messages: dialogueMessages,
      statusMessages,
      statusEnabled,
      userName
    })
    const groupPrompt = groupConversation
      ? groupInstruction(conversation, participants, characters, activeParticipant, userName)
      : ''
    return mergePromptBundles([globalPrompt, groupPrompt].filter(Boolean).join('\n\n'), characterBundle)
  }
}

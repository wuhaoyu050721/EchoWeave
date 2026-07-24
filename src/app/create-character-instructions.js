import { buildCharacterPromptBundle, mergePromptBundles } from '../core/character-prompt.js'
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

function worldBookAppliesToCharacter(book, characterId) {
  const boundIds = Array.isArray(book?.characterIds) ? book.characterIds.map(String) : []
  return String(book?.characterId ?? '') === characterId ||
    boundIds.includes(characterId) ||
    (book?.scope === 'global' && !book?.characterId && boundIds.length === 0)
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
    if (!targetCharacterId || !repository.getCharacter) return globalPrompt

    const character = await repository.getCharacter(targetCharacterId)
    if (!character || character.deletedAt) return globalPrompt
    const availableBooks = repository.listWorldBooks
      ? await repository.listWorldBooks({ characterId: character.id, includeGlobal: true })
      : []
    const worldBooks = availableBooks.filter(book => worldBookAppliesToCharacter(book, String(character.id)))
    const userName = await getUserName()
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
      userName
    })
    const groupPrompt = groupConversation
      ? groupInstruction(conversation, participants, characters, activeParticipant, userName)
      : ''
    return mergePromptBundles([globalPrompt, groupPrompt].filter(Boolean).join('\n\n'), characterBundle)
  }
}

import { extractAssistantStatus } from './assistant-status.js'

export const GROUP_MEMBER_LIMIT = 8
export const GROUP_DEFAULT_RESPONDERS = 2
export const GROUP_REPLY_CHAIN_LIMIT = 8
export const GROUP_MEMBER_KINDS = Object.freeze({
  CHARACTER: 'character',
  PROVIDER: 'provider'
})

const REPLY_MODES = new Set(['round-robin', 'all', 'mention'])

function text(value) {
  return String(value ?? '').trim()
}

export function isGroupConversation(conversation) {
  return conversation?.conversationKind === 'group'
}

export function groupParticipantKind(participant) {
  const explicit = text(participant?.memberKind || participant?.kind).toLowerCase()
  if (explicit === GROUP_MEMBER_KINDS.PROVIDER) return GROUP_MEMBER_KINDS.PROVIDER
  if (explicit === GROUP_MEMBER_KINDS.CHARACTER) return GROUP_MEMBER_KINDS.CHARACTER
  return !text(participant?.characterId) && text(participant?.providerProfileId)
    ? GROUP_MEMBER_KINDS.PROVIDER
    : GROUP_MEMBER_KINDS.CHARACTER
}

export function groupParticipantKey(participant) {
  const kind = groupParticipantKind(participant)
  const id = kind === GROUP_MEMBER_KINDS.PROVIDER
    ? text(participant?.providerProfileId)
    : text(typeof participant === 'string' ? participant : participant?.characterId)
  return id ? `${kind}:${id}` : ''
}

export function groupMessageSpeakerKey(message) {
  if (text(message?.speakerProviderProfileId)) {
    return `${GROUP_MEMBER_KINDS.PROVIDER}:${text(message.speakerProviderProfileId)}`
  }
  return text(message?.speakerCharacterId)
    ? `${GROUP_MEMBER_KINDS.CHARACTER}:${text(message.speakerCharacterId)}`
    : ''
}

export function createGroupParticipant(character, {
  enabled = true,
  joinedAt = null
} = {}) {
  const characterId = text(character?.id)
  if (!characterId) throw new Error('群聊成员缺少角色 ID')
  return {
    memberKind: GROUP_MEMBER_KINDS.CHARACTER,
    characterId,
    nameSnapshot: text(character.name) || '未命名角色',
    avatarAssetId: text(character.avatarAssetId) || null,
    enabled: enabled !== false,
    joinedAt
  }
}

export function createGroupProviderParticipant(provider, {
  enabled = true,
  joinedAt = null,
  modelName = null,
  avatarSource = null
} = {}) {
  const providerProfileId = text(provider?.id || provider?.providerProfileId)
  if (!providerProfileId) throw new Error('群聊接口成员缺少接口 ID')
  return {
    memberKind: GROUP_MEMBER_KINDS.PROVIDER,
    providerProfileId,
    modelName: text(modelName || provider?.defaultModel || provider?.modelName),
    nameSnapshot: text(provider?.name || provider?.nameSnapshot) || '未命名接口',
    avatarSource: text(avatarSource || provider?.logo || provider?.avatarSource) || null,
    enabled: enabled !== false,
    joinedAt
  }
}

export function normalizeGroupParticipants(participants, {
  maximum = GROUP_MEMBER_LIMIT
} = {}) {
  const result = []
  const seen = new Set()
  for (const value of Array.isArray(participants) ? participants : []) {
    const source = typeof value === 'string' ? { characterId: value } : value
    const memberKind = groupParticipantKind(source)
    const key = groupParticipantKey(source)
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (memberKind === GROUP_MEMBER_KINDS.PROVIDER) {
      result.push({
        memberKind,
        providerProfileId: text(source.providerProfileId),
        modelName: text(source.modelName || source.defaultModel),
        nameSnapshot: text(source.nameSnapshot || source.name) || '未命名接口',
        avatarSource: text(source.avatarSource || source.logo) || null,
        enabled: source.enabled !== false,
        joinedAt: source.joinedAt || null
      })
    } else {
      result.push({
        memberKind,
        characterId: text(source.characterId),
        nameSnapshot: text(source.nameSnapshot || source.name) || '未命名角色',
        avatarAssetId: text(source.avatarAssetId || source.characterAvatarAssetId) || null,
        enabled: source.enabled !== false,
        joinedAt: source.joinedAt || null
      })
    }
    if (result.length >= Math.max(1, Number(maximum) || GROUP_MEMBER_LIMIT)) break
  }
  return result
}

export function normalizeGroupReplyPolicy(policy = {}, activeMemberCount = GROUP_MEMBER_LIMIT) {
  const mode = REPLY_MODES.has(policy?.mode) ? policy.mode : 'round-robin'
  const maximum = Math.max(1, Math.min(GROUP_MEMBER_LIMIT, Number(activeMemberCount) || 1))
  const requested = Number(policy?.respondersPerTurn)
  const respondersPerTurn = Math.max(
    1,
    Math.min(maximum, Number.isInteger(requested) ? requested : GROUP_DEFAULT_RESPONDERS)
  )
  return {
    mode,
    respondersPerTurn,
    autoHandoff: policy?.autoHandoff !== false
  }
}

export function mentionedGroupParticipantIds(content, participants) {
  const source = String(content ?? '')
  const normalized = normalizeGroupParticipants(participants)
  const candidates = normalized
    .map(participant => ({
      key: groupParticipantKey(participant),
      name: text(participant.nameSnapshot)
    }))
    .filter(candidate => candidate.key && candidate.name)
  const mentionedKeys = new Set()
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '@' && source[index] !== '＠') continue
    const remainder = source.slice(index + 1)
    const matching = candidates.filter(candidate => remainder.startsWith(candidate.name))
    const longestNameLength = matching.reduce(
      (maximum, candidate) => Math.max(maximum, candidate.name.length),
      0
    )
    for (const candidate of matching) {
      if (candidate.name.length === longestNameLength) mentionedKeys.add(candidate.key)
    }
  }
  return normalized
    .map(groupParticipantKey)
    .filter(key => mentionedKeys.has(key))
}

export function groupMentionQuery(content) {
  const match = /[@＠]([^@＠\s]*)$/u.exec(String(content ?? ''))
  return match ? match[1] : null
}

export function insertGroupMention(content, name) {
  const value = String(content ?? '')
  const label = text(name)
  if (!label) return value
  const match = /[@＠][^@＠\s]*$/u.exec(value)
  const prefix = match ? value.slice(0, match.index) : `${value}${value && !/\s$/u.test(value) ? ' ' : ''}`
  return `${prefix}@${label} `
}

export function selectGroupResponders({
  conversation,
  messages = [],
  content = ''
} = {}) {
  const participants = normalizeGroupParticipants(conversation?.participants)
    .filter(participant => participant.enabled !== false)
  if (!participants.length) return []

  const mentionedKeys = new Set(mentionedGroupParticipantIds(content, participants))
  if (mentionedKeys.size) {
    return participants.filter(participant => mentionedKeys.has(groupParticipantKey(participant)))
  }

  const policy = normalizeGroupReplyPolicy(conversation?.replyPolicy, participants.length)
  if (policy.mode === 'all') return participants
  if (policy.mode === 'mention') return []

  let lastSpeakerIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const speakerKey = groupMessageSpeakerKey(messages[index])
    const participantIndex = participants.findIndex(participant => groupParticipantKey(participant) === speakerKey)
    if (participantIndex >= 0) {
      lastSpeakerIndex = participantIndex
      break
    }
  }

  const selected = []
  const count = Math.min(policy.respondersPerTurn, participants.length)
  for (let offset = 1; offset <= count; offset += 1) {
    selected.push(participants[(lastSpeakerIndex + offset) % participants.length])
  }
  return selected
}

export function groupStatusMessages(messages, speakerCharacterId) {
  const speakerId = text(speakerCharacterId)
  if (!speakerId) return []
  return (Array.isArray(messages) ? messages : []).filter(message => (
    message?.role === 'assistant' &&
    text(message.speakerCharacterId) === speakerId
  ))
}

export function groupVisibleMessages(messages, {
  userName = '用户'
} = {}) {
  const resolvedUserName = text(userName) || '用户'
  return (Array.isArray(messages) ? messages : []).map(message => {
    const content = String(message?.content ?? '')
    if (message?.role === 'user') {
      return {
        ...message,
        content: content ? `${resolvedUserName}：${content}` : content
      }
    }
    if (message?.role !== 'assistant') return { ...message }
    const visibleContent = extractAssistantStatus(content).content
    const speakerName = text(message.speakerNameSnapshot)
    return {
      ...message,
      content: speakerName && visibleContent ? `${speakerName}：${visibleContent}` : visibleContent
    }
  })
}

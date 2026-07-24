import { groupParticipantKind, isGroupConversation } from '../core/group-chat.js'

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function text(value) {
  return String(value ?? '').trim()
}

function timestampValue(now) {
  const value = typeof now === 'function' ? now() : now
  return value instanceof Date ? value.toISOString() : String(value || new Date().toISOString())
}

function newestCharacter(characters) {
  return [...characters].sort((left, right) => {
    const avatarDifference = Number(Boolean(right.avatarAssetId)) - Number(Boolean(left.avatarAssetId))
    if (avatarDifference) return avatarDifference
    const updatedDifference = text(right.updatedAt).localeCompare(text(left.updatedAt))
    if (updatedDifference) return updatedDifference
    return text(left.id).localeCompare(text(right.id))
  })[0] || null
}

function activeCharacterByName(characters, name) {
  const normalizedName = text(name)
  if (!normalizedName) return null
  const matches = characters.filter(character => text(character.name) === normalizedName)
  return matches.length === 1 ? matches[0] : null
}

async function formerCharacterForConversation(repository, conversation, cache) {
  const formerId = text(conversation.deletedCharacterId || conversation.characterId)
  if (!formerId || typeof repository.getCharacter !== 'function') return null
  if (!cache.has(formerId)) cache.set(formerId, await repository.getCharacter(formerId) || null)
  return cache.get(formerId)
}

function replacementFromSourceHash(characters, formerCharacter) {
  const sourceHash = text(formerCharacter?.sourceHash)
  if (!sourceHash) return null
  return newestCharacter(characters.filter(character => (
    character.id !== formerCharacter.id && text(character.sourceHash) === sourceHash
  )))
}

function hasCharacterEvidence(conversation) {
  return Boolean(
    text(conversation.characterId) ||
    text(conversation.deletedCharacterId) ||
    text(conversation.characterNameSnapshot) ||
    text(conversation.characterAvatarAssetId) ||
    conversation.characterDeletedAt
  )
}

function repairedConversation(conversation, character, updatedAt) {
  const repaired = {
    ...cloneJson(conversation),
    characterId: character.id,
    characterNameSnapshot: character.name || conversation.characterNameSnapshot || conversation.title,
    characterAvatarAssetId: character.avatarAssetId || null,
    updatedAt
  }
  delete repaired.deletedCharacterId
  delete repaired.characterDeletedAt
  return repaired
}

function linkedConversationNeedsRefresh(conversation, character) {
  return text(conversation.characterNameSnapshot) !== text(character.name) ||
    text(conversation.characterAvatarAssetId) !== text(character.avatarAssetId) ||
    Boolean(conversation.deletedCharacterId || conversation.characterDeletedAt)
}

function groupParticipantNeedsRefresh(participant, character) {
  return text(participant?.nameSnapshot) !== text(character?.name) ||
    text(participant?.avatarAssetId) !== text(character?.avatarAssetId) ||
    Boolean(participant?.characterDeletedAt)
}

function refreshedGroupParticipant(participant, character, { reenable = false } = {}) {
  const refreshed = {
    ...cloneJson(participant),
    characterId: character.id,
    nameSnapshot: character.name || participant.nameSnapshot || '未命名角色',
    avatarAssetId: character.avatarAssetId || null,
    enabled: reenable ? true : participant.enabled !== false
  }
  delete refreshed.characterDeletedAt
  return refreshed
}

async function repairGroupConversation(repository, conversation, activeCharacters, activeById, formerCache, updatedAt) {
  const sourceParticipants = Array.isArray(conversation.participants) ? conversation.participants : []
  const occupiedIds = new Set(sourceParticipants
    .map(participant => text(participant?.characterId))
    .filter(characterId => activeById.has(characterId)))
  let repaired = false
  let refreshed = false
  const participants = []

  for (const source of sourceParticipants) {
    const participant = cloneJson(source)
    if (groupParticipantKind(participant) === 'provider') {
      participants.push(participant)
      continue
    }
    const characterId = text(participant.characterId)
    const linkedCharacter = activeById.get(characterId)
    if (linkedCharacter) {
      if (groupParticipantNeedsRefresh(participant, linkedCharacter)) {
        participants.push(refreshedGroupParticipant(participant, linkedCharacter))
        refreshed = true
      } else {
        participants.push(participant)
      }
      continue
    }

    const formerCharacter = await formerCharacterForConversation(
      repository,
      { characterId, deletedCharacterId: characterId },
      formerCache
    )
    const replacement = replacementFromSourceHash(activeCharacters, formerCharacter) ||
      activeCharacterByName(activeCharacters, participant.nameSnapshot)
    if (!replacement || occupiedIds.has(text(replacement.id))) {
      participants.push(participant)
      continue
    }
    occupiedIds.add(text(replacement.id))
    participants.push(refreshedGroupParticipant(participant, replacement, {
      reenable: Boolean(participant.characterDeletedAt)
    }))
    repaired = true
  }

  if (!repaired && !refreshed) return null
  return {
    conversation: {
      ...cloneJson(conversation),
      participants,
      updatedAt
    },
    repaired,
    refreshed
  }
}

async function persistConversations(repository, conversations) {
  if (!conversations.length) return
  if (typeof repository.importRecords === 'function') {
    await repository.importRecords({ conversations })
    return
  }
  if (typeof repository.saveConversation !== 'function') {
    throw new Error('Current repository cannot repair character conversation links')
  }
  for (const conversation of conversations) await repository.saveConversation(conversation)
}

export async function repairConversationCharacterLinks(repository, {
  now = () => new Date().toISOString()
} = {}) {
  if (typeof repository?.listConversations !== 'function' || typeof repository?.listCharacters !== 'function') {
    return { repaired: 0, refreshed: 0, conversations: [] }
  }

  const [conversations, activeCharacters] = await Promise.all([
    repository.listConversations(),
    repository.listCharacters()
  ])
  const activeById = new Map(activeCharacters.map(character => [text(character.id), character]))
  const formerCache = new Map()
  const updates = []
  let repaired = 0
  let refreshed = 0

  for (const conversation of conversations) {
    if (isGroupConversation(conversation)) {
      const groupRepair = await repairGroupConversation(
        repository,
        conversation,
        activeCharacters,
        activeById,
        formerCache,
        timestampValue(now)
      )
      if (!groupRepair) continue
      updates.push(groupRepair.conversation)
      if (groupRepair.repaired) repaired += 1
      else if (groupRepair.refreshed) refreshed += 1
      continue
    }
    if (!hasCharacterEvidence(conversation)) continue
    const linkedCharacter = activeById.get(text(conversation.characterId))
    if (linkedCharacter) {
      if (!linkedConversationNeedsRefresh(conversation, linkedCharacter)) continue
      updates.push(repairedConversation(conversation, linkedCharacter, timestampValue(now)))
      refreshed += 1
      continue
    }

    const formerCharacter = await formerCharacterForConversation(repository, conversation, formerCache)
    const replacement = replacementFromSourceHash(activeCharacters, formerCharacter) ||
      activeCharacterByName(activeCharacters, conversation.characterNameSnapshot)
    if (!replacement) continue
    updates.push(repairedConversation(conversation, replacement, timestampValue(now)))
    repaired += 1
  }

  await persistConversations(repository, updates)
  return { repaired, refreshed, conversations: updates }
}

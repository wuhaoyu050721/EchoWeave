import assert from 'node:assert/strict'
import test from 'node:test'

import { repairConversationCharacterLinks } from '../src/services/conversation-character-link-service.js'

function clone(value) {
  return structuredClone(value)
}

function createRepository({ conversations, characters }) {
  const records = {
    conversations: new Map(conversations.map(value => [value.id, clone(value)])),
    characters: new Map(characters.map(value => [value.id, clone(value)]))
  }
  return {
    records,
    listConversations: async () => [...records.conversations.values()].filter(value => !value.deletedAt).map(clone),
    listCharacters: async () => [...records.characters.values()].filter(value => !value.deletedAt).map(clone),
    getCharacter: async id => clone(records.characters.get(id) ?? null),
    importRecords: async ({ conversations: updates = [] }) => {
      for (const conversation of updates) records.conversations.set(conversation.id, clone(conversation))
    }
  }
}

test('relinks a detached restored conversation to the active character with the same source hash', async () => {
  const repository = createRepository({
    conversations: [{
      id: 'conversation-restored',
      title: 'Su Mo',
      characterId: null,
      characterNameSnapshot: 'Su Mo',
      characterAvatarAssetId: null,
      deletedCharacterId: 'character-restored-copy',
      characterDeletedAt: '2026-07-22T02:20:36.856Z',
      updatedAt: '2026-07-22T02:20:36.856Z'
    }],
    characters: [
      {
        id: 'character-active', name: 'Su Mo', sourceHash: 'same-card', avatarAssetId: 'avatar-active',
        updatedAt: '2026-07-20T08:18:00.063Z', deletedAt: null
      },
      {
        id: 'character-restored-copy', name: 'Su Mo', sourceHash: 'same-card', avatarAssetId: null,
        updatedAt: '2026-07-22T02:20:36.856Z', deletedAt: '2026-07-22T02:20:36.856Z'
      }
    ]
  })

  const result = await repairConversationCharacterLinks(repository, {
    now: () => '2026-07-22T03:00:00.000Z'
  })
  const repaired = repository.records.conversations.get('conversation-restored')

  assert.equal(result.repaired, 1)
  assert.equal(repaired.characterId, 'character-active')
  assert.equal(repaired.characterNameSnapshot, 'Su Mo')
  assert.equal(repaired.characterAvatarAssetId, 'avatar-active')
  assert.equal(repaired.updatedAt, '2026-07-22T03:00:00.000Z')
  assert.equal('deletedCharacterId' in repaired, false)
  assert.equal('characterDeletedAt' in repaired, false)
})

test('refreshes linked avatar snapshots without turning ordinary chats into character chats', async () => {
  const repository = createRepository({
    conversations: [
      {
        id: 'linked', title: 'Custom title', characterId: 'character-1',
        characterNameSnapshot: 'Old name', characterAvatarAssetId: 'old-avatar'
      },
      { id: 'ordinary', title: 'Su Mo', characterId: null, characterNameSnapshot: null }
    ],
    characters: [{
      id: 'character-1', name: 'Su Mo', sourceHash: 'card-1', avatarAssetId: 'avatar-1', deletedAt: null
    }]
  })

  const result = await repairConversationCharacterLinks(repository, {
    now: () => '2026-07-22T04:00:00.000Z'
  })

  assert.equal(result.refreshed, 1)
  assert.equal(repository.records.conversations.get('linked').characterAvatarAssetId, 'avatar-1')
  assert.equal(repository.records.conversations.get('linked').characterNameSnapshot, 'Su Mo')
  assert.equal(repository.records.conversations.get('ordinary').characterId, null)
})

test('does not guess when an orphan snapshot matches multiple active characters', async () => {
  const repository = createRepository({
    conversations: [{ id: 'orphan', title: 'Su Mo', characterId: null, characterNameSnapshot: 'Su Mo' }],
    characters: [
      { id: 'character-1', name: 'Su Mo', sourceHash: 'card-1', deletedAt: null },
      { id: 'character-2', name: 'Su Mo', sourceHash: 'card-2', deletedAt: null }
    ]
  })

  const result = await repairConversationCharacterLinks(repository)

  assert.equal(result.repaired, 0)
  assert.equal(repository.records.conversations.get('orphan').characterId, null)
})

test('refreshes group member snapshots and relinks a reimported deleted member', async () => {
  const repository = createRepository({
    conversations: [{
      id: 'group-1',
      conversationKind: 'group',
      participants: [
        {
          characterId: 'character-active',
          nameSnapshot: 'Old active name',
          avatarAssetId: 'old-avatar',
          enabled: true
        },
        {
          characterId: 'character-deleted',
          nameSnapshot: 'Lin Xia',
          avatarAssetId: 'deleted-avatar',
          enabled: false,
          characterDeletedAt: '2026-07-22T01:00:00.000Z'
        }
      ]
    }],
    characters: [
      {
        id: 'character-active', name: 'Su Mo', sourceHash: 'card-a', avatarAssetId: 'avatar-active', deletedAt: null
      },
      {
        id: 'character-deleted', name: 'Lin Xia', sourceHash: 'card-b', avatarAssetId: null,
        deletedAt: '2026-07-22T01:00:00.000Z'
      },
      {
        id: 'character-reimported', name: 'Lin Xia', sourceHash: 'card-b', avatarAssetId: 'avatar-reimported', deletedAt: null
      }
    ]
  })

  const result = await repairConversationCharacterLinks(repository, {
    now: () => '2026-07-23T04:00:00.000Z'
  })
  const group = repository.records.conversations.get('group-1')

  assert.equal(result.repaired, 1)
  assert.deepEqual(group.participants.map(participant => ({
    characterId: participant.characterId,
    nameSnapshot: participant.nameSnapshot,
    avatarAssetId: participant.avatarAssetId,
    enabled: participant.enabled
  })), [
    {
      characterId: 'character-active',
      nameSnapshot: 'Su Mo',
      avatarAssetId: 'avatar-active',
      enabled: true
    },
    {
      characterId: 'character-reimported',
      nameSnapshot: 'Lin Xia',
      avatarAssetId: 'avatar-reimported',
      enabled: true
    }
  ])
  assert.equal('characterDeletedAt' in group.participants[1], false)
})

test('leaves AI interface group members untouched even when a character has the same name', async () => {
  const providerParticipant = {
    memberKind: 'provider',
    providerProfileId: 'provider-1',
    modelName: 'deepseek-chat',
    nameSnapshot: '同名成员',
    avatarSource: '/static/providers/deepseek.png',
    enabled: true
  }
  const repository = createRepository({
    conversations: [{
      id: 'group-provider',
      conversationKind: 'group',
      participants: [providerParticipant, {
        memberKind: 'character',
        characterId: 'character-1',
        nameSnapshot: '角色',
        enabled: true
      }]
    }],
    characters: [
      { id: 'character-1', name: '角色', avatarAssetId: null, deletedAt: null },
      { id: 'character-same-name', name: '同名成员', avatarAssetId: 'avatar-same', deletedAt: null }
    ]
  })

  await repairConversationCharacterLinks(repository)

  const [restoredProvider] = repository.records.conversations.get('group-provider').participants
  assert.deepEqual(restoredProvider, providerParticipant)
})

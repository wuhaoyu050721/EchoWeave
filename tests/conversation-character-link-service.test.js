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

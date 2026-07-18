import assert from 'node:assert/strict'
import test from 'node:test'
import { IDBFactory } from 'fake-indexeddb'

import {
  DEFAULT_CHARACTER_AVATAR_DATA_URL,
  applyCharacterAvatar,
  softDeleteCharacter
} from '../src/features/character-management.js'
import { PlusSqliteRepository } from '../src/platform/app/plus-sqlite-repository.js'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'
import { createNodePlusSqlite } from './helpers/node-plus-sqlite.js'

function characterRecord() {
  return {
    id: 'character-1',
    name: '苏墨',
    card: { spec: 'chara_card_v3', spec_version: '3.0', data: { name: '苏墨' } },
    sourceHash: 'hash-1',
    avatarAssetId: 'avatar-1',
    assetIds: ['avatar-1'],
    worldBookIds: [],
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    deletedAt: null
  }
}

function avatarRecord() {
  return {
    id: 'avatar-1',
    characterId: 'character-1',
    type: 'icon',
    dataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    deletedAt: null
  }
}

async function exerciseRepository(repository) {
  await repository.importCharacterBundle({
    character: characterRecord(),
    characterAssets: [avatarRecord()]
  })
  await repository.saveConversation({
    id: 'conversation-1',
    title: '苏墨',
    characterId: 'character-1',
    characterAvatarAssetId: 'avatar-1',
    lastMessageAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    deletedAt: null
  })

  await applyCharacterAvatar({
    repository,
    characterId: 'character-1',
    avatar: DEFAULT_CHARACTER_AVATAR_DATA_URL,
    now: () => '2026-07-18T01:00:00.000Z'
  })
  const updatedAsset = await repository.getCharacterAsset('avatar-1')
  assert.equal(updatedAsset.mimeType, 'image/png')
  assert.equal(updatedAsset.width, 1)
  assert.equal((await repository.getCharacter('character-1')).avatarAssetId, 'avatar-1')

  await softDeleteCharacter({
    repository,
    characterId: 'character-1',
    now: () => '2026-07-18T02:00:00.000Z'
  })
  assert.equal((await repository.listCharacters()).length, 0)
  assert.equal((await repository.listCharacterAssets('character-1')).length, 0)
  assert.equal((await repository.getCharacter('character-1')).deletedAt, '2026-07-18T02:00:00.000Z')
  assert.equal((await repository.getCharacterAsset('avatar-1')).deletedAt, '2026-07-18T02:00:00.000Z')
  const conversation = await repository.getConversation('conversation-1')
  assert.equal(conversation.characterId, null)
  assert.equal(conversation.characterAvatarAssetId, null)
  assert.equal(conversation.deletedCharacterId, 'character-1')
}

test('character management orchestration works with IndexedDB repository APIs', async () => {
  const repository = new IndexedDbRepository({
    indexedDB: new IDBFactory(),
    databaseName: `character-management-${crypto.randomUUID()}`
  })
  await repository.init()
  await exerciseRepository(repository)
  await repository.close()
})

test('character management orchestration works with Plus SQLite repository APIs', async () => {
  const repository = new PlusSqliteRepository({
    sqlite: createNodePlusSqlite(),
    databaseName: `character-management-${crypto.randomUUID()}`,
    databasePath: '_doc/character-management.db'
  })
  await repository.init()
  await exerciseRepository(repository)
  await repository.close()
})

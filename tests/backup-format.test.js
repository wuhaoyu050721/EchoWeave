import test from 'node:test'
import assert from 'node:assert/strict'
import { createBackup, prepareImport } from '../src/core/backup-format.js'

test('creates versioned backup without encrypted or plaintext secrets', () => {
  const backup = createBackup({
    providers: [{
      id: 'provider-1',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      encryptedApiKey: { ciphertext: 'secret-cipher' },
      apiKey: 'plain-secret'
    }],
    conversations: [{ id: 'conversation-1', title: 'Hello', encryptedSystemPrompt: { ciphertext: 'prompt' } }],
    messages: [{ id: 'message-1', conversationId: 'conversation-1', role: 'user', content: 'Hi' }],
    settings: {
      theme: 'light',
      profileAvatar: { version: 1, dataUrl: 'data:image/png;base64,AA==', byteSize: 1 },
      encryptedSystemPrompt: { ciphertext: 'prompt' }
    }
  }, new Date('2026-07-13T00:00:00.000Z'))

  assert.equal(backup.formatVersion, 5)
  assert.deepEqual(backup.attachments, [])
  assert.deepEqual(backup.characters, [])
  assert.deepEqual(backup.worldBooks, [])
  assert.deepEqual(backup.characterAssets, [])
  assert.equal(backup.exportedAt, '2026-07-13T00:00:00.000Z')
  assert.equal(backup.providers[0].apiKey, undefined)
  assert.equal(backup.providers[0].encryptedApiKey, undefined)
  assert.equal(backup.conversations[0].encryptedSystemPrompt, undefined)
  assert.equal(backup.settings.encryptedSystemPrompt, undefined)
  assert.equal(backup.settings.profileAvatar.dataUrl, 'data:image/png;base64,AA==')
  assert.equal(JSON.stringify(backup).includes('secret-cipher'), false)
})

test('rejects unsupported backup versions before preparing writes', () => {
  assert.throws(() => prepareImport({ formatVersion: 6 }), /版本/)
})

test('remaps provider, conversation, and message identifiers on import', () => {
  let sequence = 0
  const imported = prepareImport({
    formatVersion: 1,
    providers: [{ id: 'provider-old', name: 'Provider', baseUrl: 'https://example.com/v1', defaultModel: 'model' }],
    conversations: [{ id: 'conversation-old', providerProfileId: 'provider-old', title: 'Title' }],
    messages: [{ id: 'message-old', conversationId: 'conversation-old', role: 'user', content: 'Hello' }],
    settings: { appLockEnabled: false }
  }, () => `new-${++sequence}`)

  assert.equal(imported.providers[0].id, 'new-1')
  assert.equal(imported.conversations[0].id, 'new-2')
  assert.equal(imported.conversations[0].providerProfileId, 'new-1')
  assert.equal(imported.messages[0].id, 'new-3')
  assert.equal(imported.messages[0].conversationId, 'new-2')
  assert.deepEqual(imported.attachments, [])
})

test('remaps message and attachment references in version 2 backups', () => {
  let sequence = 0
  const imported = prepareImport({
    formatVersion: 2,
    providers: [{ id: 'p1' }],
    conversations: [{ id: 'c1', providerProfileId: 'p1' }],
    messages: [{ id: 'm1', conversationId: 'c1', role: 'user', content: '', attachmentIds: ['a1'] }],
    attachments: [{ id: 'a1', conversationId: 'c1', messageId: 'm1', kind: 'text', name: 'a.txt', textContent: 'A', byteSize: 1 }],
    settings: {}
  }, () => `new-${++sequence}`)

  assert.equal(imported.messages[0].id, 'new-3')
  assert.deepEqual(imported.messages[0].attachmentIds, ['new-4'])
  assert.equal(imported.attachments[0].id, 'new-4')
  assert.equal(imported.attachments[0].conversationId, 'new-2')
  assert.equal(imported.attachments[0].messageId, 'new-3')
})

test('rejects broken attachment references atomically', () => {
  assert.throws(() => prepareImport({
    formatVersion: 2,
    providers: [],
    conversations: [{ id: 'c1' }],
    messages: [{ id: 'm1', conversationId: 'c1', attachmentIds: ['missing'] }],
    attachments: [],
    settings: {}
  }), /附件/)
})

test('rejects malformed entities without returning a partial import', () => {
  assert.throws(() => prepareImport({
    formatVersion: 1,
    providers: [],
    conversations: [{ id: '', title: 'Broken' }],
    messages: [],
    settings: {}
  }), /会话/)
})

test('remaps the complete character graph in version 3 backups', () => {
  let sequence = 0
  const imported = prepareImport({
    formatVersion: 3,
    providers: [{ id: 'p1' }],
    conversations: [{ id: 'c1', providerProfileId: 'p1', characterId: 'char-1', characterAvatarAssetId: 'asset-1' }],
    messages: [{ id: 'm1', conversationId: 'c1', role: 'assistant', content: 'Hello', isGreeting: true }],
    attachments: [],
    characters: [{ id: 'char-1', avatarAssetId: 'asset-1', worldBookIds: ['book-1'], assetIds: ['asset-1'] }],
    worldBooks: [
      { id: 'book-1', characterId: 'char-1', scope: 'character', data: { entries: [] } },
      { id: 'book-2', characterId: null, characterIds: ['char-1'], scope: 'global', data: { entries: [] } }
    ],
    characterAssets: [{ id: 'asset-1', characterId: 'char-1', dataUrl: 'data:image/png;base64,AA==' }],
    settings: {}
  }, () => `new-${++sequence}`)

  const character = imported.characters[0]
  assert.equal(imported.conversations[0].characterId, character.id)
  assert.equal(imported.conversations[0].characterAvatarAssetId, imported.characterAssets[0].id)
  assert.equal(character.avatarAssetId, imported.characterAssets[0].id)
  assert.deepEqual(character.worldBookIds, [imported.worldBooks[0].id])
  assert.deepEqual(character.assetIds, [imported.characterAssets[0].id])
  assert.equal(imported.worldBooks[0].characterId, character.id)
  assert.deepEqual(imported.worldBooks[1].characterIds, [character.id])
  assert.equal(imported.characterAssets[0].characterId, character.id)
})

test('rejects broken character references before returning import records', () => {
  assert.throws(() => prepareImport({
    formatVersion: 3,
    providers: [],
    conversations: [{ id: 'c1', characterId: 'missing' }],
    messages: [],
    attachments: [],
    characters: [],
    worldBooks: [],
    characterAssets: [],
    settings: {}
  }), /角色/)
})

test('remaps group participants and message speaker snapshots in version 4 backups', () => {
  let sequence = 0
  const imported = prepareImport({
    formatVersion: 4,
    providers: [{ id: 'p1' }],
    conversations: [{
      id: 'group-1',
      providerProfileId: 'p1',
      conversationKind: 'group',
      participants: [
        { characterId: 'char-1', nameSnapshot: '苏墨', avatarAssetId: 'asset-1', enabled: true },
        { characterId: 'char-2', nameSnapshot: '林夏', avatarAssetId: 'asset-2', enabled: true }
      ]
    }],
    messages: [{
      id: 'message-1',
      conversationId: 'group-1',
      role: 'assistant',
      content: '群聊回复',
      speakerCharacterId: 'char-2',
      speakerNameSnapshot: '林夏',
      speakerAvatarAssetId: 'asset-2'
    }],
    attachments: [],
    characters: [
      { id: 'char-1', avatarAssetId: 'asset-1', assetIds: ['asset-1'] },
      { id: 'char-2', avatarAssetId: 'asset-2', assetIds: ['asset-2'] }
    ],
    worldBooks: [],
    characterAssets: [
      { id: 'asset-1', characterId: 'char-1', dataUrl: 'data:image/png;base64,AA==' },
      { id: 'asset-2', characterId: 'char-2', dataUrl: 'data:image/png;base64,AA==' }
    ],
    settings: {}
  }, () => `new-${++sequence}`)

  const [firstCharacter, secondCharacter] = imported.characters
  const [firstAsset, secondAsset] = imported.characterAssets
  assert.deepEqual(imported.conversations[0].participants.map(participant => ({
    characterId: participant.characterId,
    avatarAssetId: participant.avatarAssetId
  })), [
    { characterId: firstCharacter.id, avatarAssetId: firstAsset.id },
    { characterId: secondCharacter.id, avatarAssetId: secondAsset.id }
  ])
  assert.equal(imported.messages[0].speakerCharacterId, secondCharacter.id)
  assert.equal(imported.messages[0].speakerAvatarAssetId, secondAsset.id)
  assert.equal(imported.messages[0].speakerNameSnapshot, '林夏')
})

test('remaps provider group members and provider speaker references in version 5 backups', () => {
  let sequence = 0
  const imported = prepareImport({
    formatVersion: 5,
    providers: [
      { id: 'p-common', name: '公共接口' },
      { id: 'p-member', name: '独立接口', defaultModel: 'deepseek-chat' }
    ],
    conversations: [{
      id: 'group-1',
      providerProfileId: 'p-common',
      conversationKind: 'group',
      participants: [
        { memberKind: 'character', characterId: 'char-1', nameSnapshot: '苏墨', enabled: true },
        {
          memberKind: 'provider',
          providerProfileId: 'p-member',
          modelName: 'deepseek-chat',
          nameSnapshot: '独立接口',
          avatarSource: '/static/providers/deepseek.png',
          enabled: true
        }
      ]
    }],
    messages: [{
      id: 'message-1',
      conversationId: 'group-1',
      role: 'assistant',
      content: '接口回复',
      speakerProviderProfileId: 'p-member',
      speakerModelName: 'deepseek-chat',
      speakerNameSnapshot: '独立接口',
      speakerAvatarSource: '/static/providers/deepseek.png'
    }],
    attachments: [],
    characters: [{ id: 'char-1', assetIds: [] }],
    worldBooks: [],
    characterAssets: [],
    settings: {}
  }, () => `new-${++sequence}`)

  const providerMember = imported.conversations[0].participants[1]
  assert.equal(imported.conversations[0].providerProfileId, imported.providers[0].id)
  assert.equal(providerMember.providerProfileId, imported.providers[1].id)
  assert.equal(providerMember.modelName, 'deepseek-chat')
  assert.equal(imported.messages[0].speakerProviderProfileId, imported.providers[1].id)
  assert.equal(imported.messages[0].speakerModelName, 'deepseek-chat')
  assert.equal(imported.messages[0].speakerAvatarSource, '/static/providers/deepseek.png')
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { createCloudBackupPayload, prepareCloudRestore } from '../src/core/cloud-backup-format.js'

function createVault(prefix = 'cipher') {
  return {
    encryptString: async value => ({ encrypted: `${prefix}:${value}` }),
    decryptString: async record => String(record.encrypted).split(':').slice(1).join(':')
  }
}

test('moves device-encrypted secrets into the outer encrypted backup payload', async () => {
  const payload = await createCloudBackupPayload({
    providers: [{ id: 'p1', name: 'OpenAI', encryptedApiKey: { encrypted: 'old:sk-secret' } }],
    conversations: [{ id: 'c1', providerProfileId: 'p1', encryptedSystemPrompt: { encrypted: 'old:conversation prompt' } }],
    messages: [{ id: 'm1', conversationId: 'c1', content: 'history' }],
    settings: { systemPrompt: { enabled: true, encryptedValue: { encrypted: 'old:global prompt' } } }
  }, createVault('old'), new Date('2026-07-14T00:00:00.000Z'))

  assert.equal(payload.cloudFormatVersion, 5)
  assert.deepEqual(payload.attachments, [])
  assert.deepEqual(payload.characters, [])
  assert.deepEqual(payload.worldBooks, [])
  assert.deepEqual(payload.characterAssets, [])
  assert.equal(payload.providers[0].apiKey, 'sk-secret')
  assert.equal('encryptedApiKey' in payload.providers[0], false)
  assert.equal(payload.conversations[0].systemPrompt, 'conversation prompt')
  assert.equal(payload.settings.systemPrompt.value, 'global prompt')
})

test('re-encrypts sensitive fields with the restoring device vault and remaps IDs', async () => {
  let sequence = 0
  const restored = await prepareCloudRestore({
    cloudFormatVersion: 2,
    providers: [{ id: 'p1', apiKey: 'sk-secret' }],
    conversations: [{ id: 'c1', providerProfileId: 'p1', systemPrompt: 'conversation prompt' }],
    messages: [{ id: 'm1', conversationId: 'c1', content: 'history', attachmentIds: ['a1'] }],
    attachments: [{ id: 'a1', conversationId: 'c1', messageId: 'm1', kind: 'image', name: 'photo.jpg', dataUrl: 'data:image/jpeg;base64,AA==', byteSize: 1 }],
    settings: { systemPrompt: { enabled: true, value: 'global prompt' } }
  }, {
    vault: createVault('new'),
    idFactory: () => `new-${++sequence}`
  })

  assert.equal(restored.providers[0].id, 'new-1')
  assert.deepEqual(restored.providers[0].encryptedApiKey, { encrypted: 'new:sk-secret' })
  assert.equal('apiKey' in restored.providers[0], false)
  assert.equal(restored.conversations[0].providerProfileId, 'new-1')
  assert.deepEqual(restored.conversations[0].encryptedSystemPrompt, { encrypted: 'new:conversation prompt' })
  assert.equal(restored.messages[0].conversationId, restored.conversations[0].id)
  assert.deepEqual(restored.messages[0].attachmentIds, [restored.attachments[0].id])
  assert.equal(restored.attachments[0].messageId, restored.messages[0].id)
  assert.equal(restored.attachments[0].conversationId, restored.conversations[0].id)
  assert.deepEqual(restored.settings.systemPrompt.encryptedValue, { encrypted: 'new:global prompt' })
})

test('rejects malformed cloud payloads before encrypting or writing anything', async () => {
  let encryptions = 0
  const vault = { encryptString: async () => { encryptions += 1; return {} } }

  await assert.rejects(prepareCloudRestore({ cloudFormatVersion: 6 }, { vault }), /云端备份格式/)
  await assert.rejects(prepareCloudRestore({ cloudFormatVersion: 1, providers: [], conversations: [], messages: [{ id: 'm1', conversationId: 'missing' }], settings: {} }, { vault }), /不存在的会话/)
  await assert.rejects(prepareCloudRestore({
    cloudFormatVersion: 2,
    providers: [],
    conversations: [{ id: 'c1' }],
    messages: [{ id: 'm1', conversationId: 'c1', attachmentIds: ['missing'] }],
    attachments: [],
    settings: {}
  }, { vault }), /附件/)
  assert.equal(encryptions, 0)
})

test('restores and remaps encrypted character data in cloud format 3', async () => {
  let sequence = 0
  const restored = await prepareCloudRestore({
    cloudFormatVersion: 3,
    providers: [],
    conversations: [{ id: 'c1', characterId: 'char-1', characterAvatarAssetId: 'asset-1' }],
    messages: [],
    attachments: [],
    characters: [{ id: 'char-1', avatarAssetId: 'asset-1', worldBookIds: ['book-1'], assetIds: ['asset-1'] }],
    worldBooks: [{ id: 'book-1', characterId: 'char-1', scope: 'character', data: { entries: [] } }],
    characterAssets: [{ id: 'asset-1', characterId: 'char-1', dataUrl: 'data:image/png;base64,AA==' }],
    settings: {}
  }, {
    vault: createVault('new'),
    idFactory: () => `new-${++sequence}`
  })

  assert.equal(restored.conversations[0].characterId, restored.characters[0].id)
  assert.equal(restored.characters[0].avatarAssetId, restored.characterAssets[0].id)
  assert.equal(restored.worldBooks[0].characterId, restored.characters[0].id)
  assert.equal(restored.characterAssets[0].characterId, restored.characters[0].id)
})

test('restores group participant and speaker references in cloud format 4', async () => {
  let sequence = 0
  const restored = await prepareCloudRestore({
    cloudFormatVersion: 4,
    providers: [],
    conversations: [{
      id: 'group-1',
      conversationKind: 'group',
      participants: [
        { characterId: 'char-1', nameSnapshot: '苏墨', avatarAssetId: 'asset-1', enabled: true },
        { characterId: 'char-2', nameSnapshot: '林夏', avatarAssetId: 'asset-2', enabled: true }
      ]
    }],
    messages: [{
      id: 'message-1',
      conversationId: 'group-1',
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
  }, {
    vault: createVault('new'),
    idFactory: () => `new-${++sequence}`
  })

  assert.equal(restored.conversations[0].participants[1].characterId, restored.characters[1].id)
  assert.equal(restored.conversations[0].participants[1].avatarAssetId, restored.characterAssets[1].id)
  assert.equal(restored.messages[0].speakerCharacterId, restored.characters[1].id)
  assert.equal(restored.messages[0].speakerAvatarAssetId, restored.characterAssets[1].id)
})

test('restores provider members and their speaker references in cloud format 5', async () => {
  let sequence = 0
  const restored = await prepareCloudRestore({
    cloudFormatVersion: 5,
    providers: [
      { id: 'p-common', apiKey: 'common-secret' },
      { id: 'p-member', apiKey: 'member-secret', defaultModel: 'deepseek-chat' }
    ],
    conversations: [{
      id: 'group-1',
      providerProfileId: 'p-common',
      conversationKind: 'group',
      participants: [
        { memberKind: 'character', characterId: 'char-1', nameSnapshot: '苏墨', enabled: true },
        { memberKind: 'provider', providerProfileId: 'p-member', modelName: 'deepseek-chat', nameSnapshot: '独立接口', enabled: true }
      ]
    }],
    messages: [{
      id: 'message-1',
      conversationId: 'group-1',
      speakerProviderProfileId: 'p-member',
      speakerModelName: 'deepseek-chat',
      speakerNameSnapshot: '独立接口'
    }],
    attachments: [],
    characters: [{ id: 'char-1', assetIds: [] }],
    worldBooks: [],
    characterAssets: [],
    settings: {}
  }, {
    vault: createVault('new'),
    idFactory: () => `new-${++sequence}`
  })

  assert.equal(restored.conversations[0].providerProfileId, restored.providers[0].id)
  assert.equal(restored.conversations[0].participants[1].providerProfileId, restored.providers[1].id)
  assert.equal(restored.messages[0].speakerProviderProfileId, restored.providers[1].id)
  assert.deepEqual(restored.providers[1].encryptedApiKey, { encrypted: 'new:member-secret' })
})

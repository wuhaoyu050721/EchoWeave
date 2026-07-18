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

  assert.equal(payload.cloudFormatVersion, 3)
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

  await assert.rejects(prepareCloudRestore({ cloudFormatVersion: 4 }, { vault }), /云端备份格式/)
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

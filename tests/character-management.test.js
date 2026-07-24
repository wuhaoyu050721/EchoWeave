import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DEFAULT_CHARACTER_AVATAR_DATA_URL,
  applyCharacterAvatar,
  createCharacterWithAvatar,
  createCharacterCardV3,
  exportCharacterCardJson,
  exportCharacterCardPng,
  softDeleteCharacter,
  validateCharacterAvatar
} from '../src/features/character-management.js'
import {
  asciiBytesToString,
  decodeBase64Strict,
  decodeDataUrl,
  encodeBase64
} from '../src/features/character-import/binary.js'
import { readPngChunks } from '../src/features/character-import/png/readPngChunks.js'
import { inspectCharacterCard } from '../src/features/character-import/inspectCharacterCard.js'

function characterFixture(overrides = {}) {
  return {
    id: 'character-1',
    name: '苏墨',
    nickname: '阿墨',
    description: '角色描述',
    tags: ['剧情'],
    creator: '测试作者',
    characterVersion: '3.0',
    card: {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: '旧名称',
        nickname: '',
        description: '旧描述',
        personality: '沉稳',
        scenario: '书房',
        first_mes: '你好',
        alternate_greetings: ['久等了'],
        group_only_greetings: [],
        mes_example: '<START>',
        system_prompt: '保持角色设定',
        post_history_instructions: '',
        creator_notes: '备注',
        tags: [],
        creator: '',
        character_version: '3.0',
        extensions: { custom: { keep: true } },
        assets: [],
        unknown_v3_field: { keep: true }
      }
    },
    sourceHash: 'source-hash',
    avatarAssetId: 'avatar-1',
    assetIds: ['avatar-1', 'emotion-1'],
    worldBookIds: ['world-book-1'],
    createdAt: '2026-07-17T00:00:00.000Z',
    updatedAt: '2026-07-17T00:00:00.000Z',
    deletedAt: null,
    ...overrides
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function decodedMetadata(chunk) {
  const encoded = asciiBytesToString(chunk.textBytes)
  return JSON.parse(new TextDecoder().decode(decodeBase64Strict(encoded)))
}

test('validates avatar bytes, real dimensions, MIME signatures, and configured boundaries', () => {
  const avatar = validateCharacterAvatar(DEFAULT_CHARACTER_AVATAR_DATA_URL)
  assert.equal(avatar.mimeType, 'image/png')
  assert.equal(avatar.width, 1)
  assert.equal(avatar.height, 1)
  assert.equal(avatar.byteSize, avatar.bytes.byteLength)

  assert.throws(
    () => validateCharacterAvatar('data:image/jpeg;base64,' + DEFAULT_CHARACTER_AVATAR_DATA_URL.split(',')[1]),
    error => error.code === 'avatar_mime_mismatch'
  )
  assert.throws(
    () => validateCharacterAvatar(DEFAULT_CHARACTER_AVATAR_DATA_URL, { limits: { maxBytes: avatar.byteSize - 1 } }),
    error => error.code === 'avatar_file_too_large'
  )
  assert.throws(
    () => validateCharacterAvatar(DEFAULT_CHARACTER_AVATAR_DATA_URL, { limits: { maxWidth: 0 } }),
    error => error.code === 'avatar_dimensions_exceeded'
  )
  assert.throws(
    () => validateCharacterAvatar('data:image/png;base64,AA=='),
    error => error.code === 'invalid_avatar_image'
  )
})

test('applies an avatar by updating the existing icon asset and persisted character', async () => {
  const originalCharacter = { ...characterFixture(), avatarDataUrl: 'view-only' }
  const originalAsset = {
    id: 'avatar-1', characterId: 'character-1', type: 'icon', dataUrl: 'old',
    createdAt: '2026-07-17T00:00:00.000Z', deletedAt: null
  }
  let bundle = null
  const repository = {
    getCharacter: async () => clone(originalCharacter),
    saveCharacter: async () => {},
    getCharacterAsset: async () => clone(originalAsset),
    importCharacterBundle: async value => { bundle = clone(value) },
    listConversations: async () => []
  }

  const result = await applyCharacterAvatar({
    repository,
    characterId: 'character-1',
    avatar: { dataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL, name: 'portrait.png' },
    now: () => '2026-07-18T01:00:00.000Z'
  })

  assert.equal(result.asset.id, 'avatar-1')
  assert.equal(result.asset.characterId, 'character-1')
  assert.equal(result.asset.type, 'icon')
  assert.equal(result.asset.uri, 'ccdefault:')
  assert.equal(result.asset.width, 1)
  assert.equal(result.asset.height, 1)
  assert.equal(result.asset.sourceName, 'portrait.png')
  assert.equal(result.character.avatarAssetId, 'avatar-1')
  assert.equal(result.character.updatedAt, '2026-07-18T01:00:00.000Z')
  assert.equal('avatarDataUrl' in result.character, false)
  assert.equal(result.previewCharacter.avatarDataUrl, DEFAULT_CHARACTER_AVATAR_DATA_URL)
  assert.deepEqual(bundle.characterAssets.map(asset => asset.id), ['avatar-1'])
  assert.equal(originalAsset.dataUrl, 'old')
})

test('creates a new avatar asset and refreshes linked conversation snapshots when needed', async () => {
  const character = characterFixture({ avatarAssetId: null, assetIds: [] })
  const conversations = [{
    id: 'conversation-1', characterId: character.id, characterAvatarAssetId: null,
    title: character.name, updatedAt: 'old', deletedAt: null
  }]
  const savedConversations = []
  let bundle = null
  const repository = {
    getCharacter: async () => clone(character),
    saveCharacter: async () => {},
    getCharacterAsset: async () => null,
    listConversations: async () => clone(conversations),
    saveConversation: async conversation => savedConversations.push(clone(conversation)),
    importCharacterBundle: async value => { bundle = clone(value) }
  }

  const result = await applyCharacterAvatar({
    repository,
    characterId: character.id,
    avatar: DEFAULT_CHARACTER_AVATAR_DATA_URL,
    idFactory: () => 'avatar-new',
    now: () => '2026-07-18T02:00:00.000Z'
  })

  assert.equal(result.character.avatarAssetId, 'avatar-new')
  assert.deepEqual(result.character.assetIds, ['avatar-new'])
  assert.equal(savedConversations.length, 0)
  assert.equal(bundle.conversations[0].characterAvatarAssetId, 'avatar-new')
  assert.equal(bundle.characterAssets[0].id, 'avatar-new')
})

test('refreshes a group participant avatar without rewriting historical message snapshots', async () => {
  const character = characterFixture({ avatarAssetId: null, assetIds: [] })
  const conversation = {
    id: 'group-1',
    conversationKind: 'group',
    participants: [
      { characterId: character.id, nameSnapshot: character.name, avatarAssetId: null, enabled: true },
      { characterId: 'character-2', nameSnapshot: '林夏', avatarAssetId: 'avatar-2', enabled: true }
    ]
  }
  let bundle = null
  const repository = {
    getCharacter: async () => clone(character),
    saveCharacter: async () => {},
    getCharacterAsset: async () => null,
    listConversations: async () => [clone(conversation)],
    importCharacterBundle: async value => { bundle = clone(value) }
  }

  await applyCharacterAvatar({
    repository,
    characterId: character.id,
    avatar: DEFAULT_CHARACTER_AVATAR_DATA_URL,
    idFactory: () => 'avatar-group-new',
    now: () => '2026-07-23T05:00:00.000Z'
  })

  assert.equal(bundle.conversations[0].participants[0].avatarAssetId, 'avatar-group-new')
  assert.equal(bundle.conversations[0].participants[1].avatarAssetId, 'avatar-2')
  assert.equal('messages' in bundle, false)
})

test('creates a custom character and its staged avatar in one repository bundle', async () => {
  const character = characterFixture({
    id: 'custom-1',
    avatarAssetId: null,
    assetIds: [],
    worldBookIds: [],
    avatarDataUrl: 'preview-only'
  })
  let bundle = null
  const repository = {
    getCharacter: async () => null,
    saveCharacter: async () => {},
    importCharacterBundle: async value => { bundle = clone(value) }
  }

  const result = await createCharacterWithAvatar({
    repository,
    character,
    avatar: { dataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL, name: 'custom.png' },
    idFactory: () => 'custom-avatar-1',
    now: () => '2026-07-18T02:30:00.000Z'
  })

  assert.equal(result.character.id, 'custom-1')
  assert.equal(result.character.avatarAssetId, 'custom-avatar-1')
  assert.deepEqual(result.character.assetIds, ['custom-avatar-1'])
  assert.equal('avatarDataUrl' in bundle.character, false)
  assert.equal(bundle.characterAssets[0].id, 'custom-avatar-1')
  assert.equal(bundle.characterAssets[0].dataUrl, DEFAULT_CHARACTER_AVATAR_DATA_URL)
})

test('soft-deletes a character and its assets while preserving and detaching chat history', async () => {
  const character = characterFixture()
  const assets = [
    { id: 'avatar-1', characterId: character.id, type: 'icon', dataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL, deletedAt: null },
    { id: 'emotion-1', characterId: character.id, type: 'emotion', dataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL, deletedAt: null }
  ]
  const conversations = [
    { id: 'linked', characterId: character.id, characterAvatarAssetId: 'avatar-1', title: '苏墨', deletedAt: null },
    { id: 'unrelated', characterId: 'other', title: 'Other', deletedAt: null }
  ]
  const worldBooks = [{
    id: 'world-book-1', scope: 'global', characterId: null,
    characterIds: [character.id], data: { entries: [] }, deletedAt: null
  }]
  const savedConversations = []
  let bundle = null
  const repository = {
    getCharacter: async () => clone(character),
    saveCharacter: async () => {},
    listCharacterAssets: async () => clone(assets),
    listAllWorldBooks: async () => clone(worldBooks),
    listConversations: async () => clone(conversations),
    saveConversation: async conversation => savedConversations.push(clone(conversation)),
    importCharacterBundle: async value => { bundle = clone(value) }
  }

  const result = await softDeleteCharacter({
    repository,
    characterId: character.id,
    now: () => '2026-07-18T03:00:00.000Z'
  })

  assert.equal(result.character.deletedAt, '2026-07-18T03:00:00.000Z')
  assert.equal(result.character.avatarAssetId, null)
  assert.deepEqual(result.character.assetIds, [])
  assert.equal(result.character.deletedAvatarAssetId, 'avatar-1')
  assert.deepEqual(result.character.worldBookIds, [])
  assert.deepEqual(result.character.deletedWorldBookIds, ['world-book-1'])
  assert.equal(result.assets.every(asset => asset.deletedAt === '2026-07-18T03:00:00.000Z'), true)
  assert.equal(result.assets.every(asset => asset.deletionReason === 'character-deleted'), true)
  assert.equal(savedConversations.length, 0)
  assert.equal(bundle.conversations.length, 1)
  assert.equal(bundle.conversations[0].id, 'linked')
  assert.equal(bundle.conversations[0].characterId, null)
  assert.equal(bundle.conversations[0].characterAvatarAssetId, null)
  assert.equal(bundle.conversations[0].deletedCharacterId, character.id)
  assert.equal(bundle.conversations[0].characterDeletedAt, '2026-07-18T03:00:00.000Z')
  assert.equal(result.worldBooks[0].deletedAt, '2026-07-18T03:00:00.000Z')
  assert.equal(result.worldBooks[0].deletionReason, 'character-deleted-last-binding')
  assert.deepEqual(bundle.worldBooks, result.worldBooks)
  assert.equal(character.deletedAt, null)
  assert.equal(conversations[0].characterId, character.id)
})

test('soft-deleting a group member disables the participant and preserves its snapshot', async () => {
  const character = characterFixture()
  const group = {
    id: 'group-1',
    conversationKind: 'group',
    participants: [
      {
        characterId: character.id,
        nameSnapshot: character.name,
        avatarAssetId: character.avatarAssetId,
        enabled: true
      },
      { characterId: 'character-2', nameSnapshot: '林夏', avatarAssetId: 'avatar-2', enabled: true }
    ]
  }
  let bundle = null
  const repository = {
    getCharacter: async () => clone(character),
    saveCharacter: async () => {},
    listCharacterAssets: async () => [],
    listAllWorldBooks: async () => [],
    listConversations: async () => [clone(group)],
    importCharacterBundle: async value => { bundle = clone(value) }
  }

  await softDeleteCharacter({
    repository,
    characterId: character.id,
    now: () => '2026-07-23T06:00:00.000Z'
  })

  const participant = bundle.conversations[0].participants[0]
  assert.equal(participant.enabled, false)
  assert.equal(participant.nameSnapshot, character.name)
  assert.equal(participant.avatarAssetId, character.avatarAssetId)
  assert.equal(participant.characterDeletedAt, '2026-07-23T06:00:00.000Z')
  assert.equal(bundle.conversations[0].participants[1].enabled, true)
})

test('rolls back detached conversations when character deletion persistence fails', async () => {
  const character = characterFixture()
  let storedConversation = { id: 'linked', characterId: character.id, characterAvatarAssetId: 'avatar-1' }
  const repository = {
    getCharacter: async () => clone(character),
    saveCharacter: async () => {},
    listCharacterAssets: async () => [],
    listConversations: async () => [clone(storedConversation)],
    saveConversation: async conversation => { storedConversation = clone(conversation) },
    importCharacterBundle: async () => { throw new Error('disk full') }
  }

  await assert.rejects(
    softDeleteCharacter({ repository, characterId: character.id }),
    error => error.code === 'soft_delete_character_failed'
  )
  assert.equal(storedConversation.characterId, character.id)
  assert.equal(storedConversation.characterAvatarAssetId, 'avatar-1')
})

test('exports canonical V3 JSON without losing extension fields', async () => {
  const character = characterFixture()
  const card = createCharacterCardV3(character)
  const exported = await exportCharacterCardJson(character)
  const parsed = JSON.parse(exported.content)

  assert.equal(card.spec, 'chara_card_v3')
  assert.equal(card.spec_version, '3.0')
  assert.equal(card.data.name, character.name)
  assert.equal(card.data.description, character.description)
  assert.deepEqual(card.data.tags, character.tags)
  assert.deepEqual(card.data.group_only_greetings, [])
  assert.deepEqual(card.data.unknown_v3_field, { keep: true })
  assert.deepEqual(card.data.extensions, { custom: { keep: true } })
  assert.deepEqual(parsed, card)
  assert.equal(exported.mimeType, 'application/json')
  assert.match(exported.fileName, /\.json$/)
})

test('exports the latest repository world book and removes stale deleted lore', async () => {
  const character = characterFixture()
  character.card.data.character_book = {
    name: 'Old Lore',
    extensions: {},
    entries: [{ keys: [], content: 'OLD', extensions: {}, enabled: true, insertion_order: 1, constant: true, position: 'before_char' }]
  }
  const repository = {
    getCharacter: async () => clone(character),
    listWorldBooks: async () => [{
      id: 'world-book-1',
      name: 'Updated Lore',
      data: {
        name: 'Updated Lore',
        extensions: {},
        entries: [{
          id: '001', name: 'Visible name', comment: 'Independent comment', keys: [], content: 'UPDATED',
          extensions: {}, enabled: true, insertion_order: 0, constant: true, position: 'before_example'
        }]
      },
      deletedAt: null
    }]
  }

  const updated = JSON.parse((await exportCharacterCardJson(character, { repository })).content)
  assert.equal(updated.data.character_book.entries[0].content, 'UPDATED')
  assert.equal(updated.data.character_book.entries[0].comment, 'Independent comment')
  assert.equal(updated.data.character_book.entries[0].insertion_order, 0)
  assert.equal(updated.data.character_book.entries[0].position, 'before_char')
  assert.equal(updated.data.character_book.entries[0].id, 1)
  assert.equal(updated.data.character_book.entries[0].extensions.ai_chat_entry_id, '001')
  assert.equal(updated.data.character_book.entries[0].extensions.ai_chat_position, 'before_example')

  repository.listWorldBooks = async () => []
  const deleted = JSON.parse((await exportCharacterCardJson(character, { repository })).content)
  assert.equal('character_book' in deleted.data, false)
})

test('exports a valid avatar-preserving PNG with ccv3 and Tavern chara metadata', async () => {
  const character = characterFixture({ avatarDataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL })
  const original = readPngChunks(decodeDataUrl(DEFAULT_CHARACTER_AVATAR_DATA_URL).bytes)
  const exported = await exportCharacterCardPng(character)
  const parsed = readPngChunks(exported.bytes)
  const metadata = Object.fromEntries(parsed.textChunks.map(chunk => [chunk.keyword, decodedMetadata(chunk)]))
  const originalImageData = original.chunks.find(chunk => chunk.type === 'IDAT').data
  const exportedImageData = parsed.chunks.find(chunk => chunk.type === 'IDAT').data

  assert.equal(exported.mimeType, 'image/png')
  assert.equal(exported.width, original.width)
  assert.equal(exported.height, original.height)
  assert.deepEqual([...exportedImageData], [...originalImageData])
  assert.equal(metadata.ccv3.spec, 'chara_card_v3')
  assert.equal(metadata.ccv3.spec_version, '3.0')
  assert.equal(metadata.chara.spec, 'chara_card_v2')
  assert.equal(metadata.chara.spec_version, '2.0')
  assert.ok(metadata.ccv3.data.assets.some(asset => asset.type === 'icon' && asset.uri === 'ccdefault:' && asset.ext === 'png'))

  const reexported = await exportCharacterCardPng(character, { avatarDataUrl: exported.dataUrl })
  const repeatedKeywords = readPngChunks(reexported.bytes).textChunks.map(chunk => chunk.keyword)
  assert.deepEqual(repeatedKeywords.filter(keyword => keyword === 'ccv3'), ['ccv3'])
  assert.deepEqual(repeatedKeywords.filter(keyword => keyword === 'chara'), ['chara'])
})

test('can omit the PNG data URL for memory-bounded native export', async () => {
  const exported = await exportCharacterCardPng(
    characterFixture({ avatarDataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL }),
    { includeDataUrl: false }
  )

  assert.equal(exported.dataUrl, '')
  assert.ok(exported.bytes.byteLength > 8)
})

test('round-trips referenced embedded assets through exported PNG chunks', async () => {
  const character = characterFixture({ avatarDataUrl: undefined })
  character.card.data.assets = [
    { type: 'icon', name: 'main', ext: 'png', uri: 'ccdefault:' },
    { type: 'emotion', name: 'smile', ext: 'png', uri: 'embeded://smile' }
  ]
  const repository = {
    getCharacter: async () => clone(character),
    listWorldBooks: async () => [],
    getCharacterAsset: async id => id === 'avatar-1'
      ? { id, characterId: character.id, dataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL }
      : null,
    listCharacterAssets: async () => [
      { id: 'avatar-1', characterId: character.id, type: 'icon', uri: 'ccdefault:', dataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL },
      {
        id: 'emotion-1', characterId: character.id, type: 'emotion', name: 'smile', ext: 'png',
        uri: 'embeded://smile', source: 'embedded', chunkKey: 'smile', dataUrl: DEFAULT_CHARACTER_AVATAR_DATA_URL
      }
    ]
  }

  const exported = await exportCharacterCardPng(character, { repository })
  const parsed = readPngChunks(exported.bytes)
  assert.equal(parsed.textChunks.some(chunk => chunk.keyword === 'chara-ext-asset_smile'), true)

  const preview = await inspectCharacterCard({
    name: 'round-trip.png',
    size: exported.bytes.byteLength,
    arrayBuffer: async () => exported.bytes.buffer.slice(exported.bytes.byteOffset, exported.bytes.byteOffset + exported.bytes.byteLength)
  })
  const restored = preview.commitData.assets.find(asset => asset.chunkKey === 'smile')
  assert.equal(restored?.source, 'embedded')
  assert.equal(restored?.dataUrl, DEFAULT_CHARACTER_AVATAR_DATA_URL)
})

test('accepts JPEG avatars for storage and requires an injected PNG converter for card export', async () => {
  const jpegBytes = new Uint8Array(await readFile(new URL('../static/chat-wallpaper.jpg', import.meta.url)))
  const jpegDataUrl = `data:image/jpeg;base64,${encodeBase64(jpegBytes)}`
  const avatar = validateCharacterAvatar(jpegDataUrl)
  const character = characterFixture({ avatarDataUrl: jpegDataUrl })

  assert.equal(avatar.mimeType, 'image/jpeg')
  assert.ok(avatar.width > 0)
  assert.ok(avatar.height > 0)
  await assert.rejects(
    exportCharacterCardPng(character),
    error => error.code === 'avatar_png_conversion_required'
  )

  let conversionInput = null
  const exported = await exportCharacterCardPng(character, {
    convertAvatarToPng: async input => {
      conversionInput = input
      return DEFAULT_CHARACTER_AVATAR_DATA_URL
    }
  })
  assert.equal(conversionInput.mimeType, 'image/jpeg')
  assert.equal(readPngChunks(exported.bytes).width, 1)
})

test('production character management modules remain browser and uni-app compatible', async () => {
  const sources = await Promise.all([
    '../src/features/character-management/avatar.js',
    '../src/features/character-management/exportCharacterCard.js',
    '../src/features/character-management/manageCharacter.js'
  ].map(path => readFile(new URL(path, import.meta.url), 'utf8')))
  const productionSource = sources.join('\n')

  assert.doesNotMatch(productionSource, /from ['"]node:/)
  assert.doesNotMatch(productionSource, /\bBuffer\b/)
  assert.doesNotMatch(productionSource, /\batob\s*\(|\bbtoa\s*\(/)
})

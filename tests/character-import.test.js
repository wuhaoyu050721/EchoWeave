import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { deflateSync } from 'node:zlib'

import { encodeBase64 } from '../src/features/character-import/binary.js'
import { CharacterImportError, commitCharacterImport, inspectCharacterCard } from '../src/features/character-import/importCharacterCard.js'
import { pngCrc32ForTest, readPngChunks } from '../src/features/character-import/png/readPngChunks.js'

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function uint32(value) {
  return Uint8Array.from([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
}

function join(parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function chunk(type, data = new Uint8Array()) {
  const typeBytes = Uint8Array.from(type, character => character.charCodeAt(0))
  const body = join([typeBytes, data])
  return join([uint32(data.length), body, uint32(pngCrc32ForTest(body))])
}

function textChunk(keyword, value, { raw = false } = {}) {
  const encoded = raw ? value : encodeBase64(new TextEncoder().encode(JSON.stringify(value)))
  return chunk('tEXt', new TextEncoder().encode(`${keyword}\0${encoded}`))
}

function cardPng(metadata = [], extraChunks = []) {
  const header = join([uint32(1), uint32(1), Uint8Array.from([8, 6, 0, 0, 0])])
  const pixels = deflateSync(Uint8Array.from([0, 0, 0, 0, 255]))
  return join([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', pixels),
    ...metadata,
    ...extraChunks,
    chunk('IEND')
  ])
}

function input(bytes, name = 'card.PNG') {
  return { name, type: 'image/png', size: bytes.length, arrayBuffer: async () => bytes }
}

function v1(name = 'V1') {
  return { name, description: '', personality: '', scenario: '', first_mes: 'Hello', mes_example: '' }
}

function v2(name = 'V2') {
  return {
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name, description: '', personality: '', scenario: '', first_mes: 'Hello', mes_example: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [],
      tags: [], creator: '', character_version: '', extensions: {}
    }
  }
}

function v3(name = 'V3') {
  return {
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
      name, description: '', personality: '', scenario: '', first_mes: 'Hello', mes_example: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [],
      group_only_greetings: [], tags: [], creator: '', character_version: '', extensions: {}, assets: [],
      character_book: {
        name: `${name} world`, extensions: {},
        entries: [{ keys: [], content: 'Always active', extensions: {}, enabled: true, insertion_order: 1, constant: true, position: 'before_char' }]
      }
    }
  }
}

test('inspects the real hybrid V3 fixture without losing its world book', async () => {
  const bytes = fs.readFileSync(new URL('../src/苏墨.png', import.meta.url))
  const preview = await inspectCharacterCard(input(bytes, '苏墨.png'))

  assert.equal(preview.source.metadataKeyword, 'ccv3')
  assert.equal(preview.character.sourceVersion, 'v3')
  assert.equal(preview.character.name, '苏墨')
  assert.equal(preview.worldBook.entryCount, 8)
  assert.equal(preview.cardV3.data.character_book.entries.length, 8)
  assert.deepEqual(preview.unsafeExtensions, ['regex_scripts'])
  assert.ok(preview.character.avatarDataUrl.startsWith('data:image/png;base64,'))
})

test('prefers ccv3 over chara and normalizes V1 V2 and V3 cards', async () => {
  const preferred = await inspectCharacterCard(input(cardPng([
    textChunk('chara', v2('Old payload')),
    textChunk('ccv3', v3('Preferred payload'))
  ])))
  assert.equal(preferred.character.name, 'Preferred payload')
  assert.equal(preferred.character.sourceVersion, 'v3')

  for (const [version, payload] of [['v1', v1()], ['v2', v2()], ['v3', v3()]]) {
    const preview = await inspectCharacterCard(input(cardPng([textChunk('chara', payload)])))
    assert.equal(preview.character.sourceVersion, version)
    assert.equal(preview.cardV3.spec, 'chara_card_v3')
  }
})

test('accepts numeric character_version and fills missing lorebook extension defaults', async () => {
  const payload = v3('Numeric')
  payload.data.character_version = 3
  delete payload.data.character_book.extensions
  const preview = await inspectCharacterCard(input(cardPng([textChunk('ccv3', payload)])))

  assert.equal(preview.cardV3.data.character_version, '3')
  assert.deepEqual(preview.cardV3.data.character_book.extensions, {})
  assert.ok(preview.warnings.some(warning => warning.code === 'numeric_character_version'))
})

test('extracts a referenced chara-ext-asset resource', async () => {
  const payload = v3('Assets')
  payload.data.assets.push({ type: 'emotion', uri: '__asset:smile.png', name: 'smile', ext: 'png' })
  const preview = await inspectCharacterCard(input(cardPng(
    [textChunk('ccv3', payload)],
    [textChunk('chara-ext-asset_smile.png', 'AA==', { raw: true })]
  )))

  const emotion = preview.commitData.assets.find(asset => asset.type === 'emotion')
  assert.equal(emotion.source, 'embedded')
  assert.equal(emotion.byteSize, 1)
  assert.equal(emotion.dataUrl, 'data:image/png;base64,AA==')
})

test('rejects corrupt PNG boundaries CRC and text metadata', async () => {
  await assert.rejects(inspectCharacterCard(input(Uint8Array.from([1, 2, 3]))), error => error.code === 'truncated_png')

  const corrupt = cardPng([textChunk('chara', v1())])
  corrupt[corrupt.length - 5] ^= 1
  await assert.rejects(inspectCharacterCard(input(corrupt)), error => error.code === 'invalid_png_crc')

  const missingSeparator = cardPng([chunk('tEXt', new TextEncoder().encode('chara'))])
  await assert.rejects(inspectCharacterCard(input(missingSeparator)), error => error.code === 'invalid_png_text')

  await assert.rejects(
    inspectCharacterCard(input(cardPng([textChunk('chara', 'not base64!', { raw: true })]))),
    error => error.code === 'invalid_base64'
  )
  await assert.rejects(
    inspectCharacterCard(input(cardPng([textChunk('chara', encodeBase64(new TextEncoder().encode('{')), { raw: true })]))),
    error => error.code === 'invalid_character_json'
  )
})

test('rejects conflicting duplicate metadata instead of choosing silently', async () => {
  await assert.rejects(
    inspectCharacterCard(input(cardPng([textChunk('ccv3', v3('One')), textChunk('ccv3', v3('Two'))]))),
    error => error instanceof CharacterImportError && error.code === 'conflicting_character_metadata'
  )
})

test('display PNG removes card metadata while remaining structurally valid', async () => {
  const preview = await inspectCharacterCard(input(cardPng([textChunk('ccv3', v3())])))
  const avatarBytes = Buffer.from(preview.character.avatarDataUrl.split(',')[1], 'base64')
  const parsed = readPngChunks(avatarBytes)

  assert.equal(parsed.textChunks.some(item => ['chara', 'ccv3'].includes(item.keyword)), false)
})

test('commit requires explicit sensitive-extension confirmation and saves one atomic bundle', async () => {
  const payload = v3('Committed')
  payload.data.extensions.regex_scripts = [{ name: 'disabled' }]
  const preview = await inspectCharacterCard(input(cardPng([textChunk('ccv3', payload)])))
  const calls = []
  let nextId = 0
  const repository = {
    findCharactersBySourceHash: async () => [{ id: 'existing' }],
    importCharacterBundle: async bundle => calls.push(bundle)
  }

  await assert.rejects(
    commitCharacterImport(preview, { repository }),
    error => error.code === 'sensitive_extension_confirmation_required'
  )
  const result = await commitCharacterImport(preview, {
    repository,
    allowSensitiveExtensions: true,
    idFactory: () => `id-${++nextId}`,
    now: () => '2026-07-16T00:00:00.000Z'
  })

  assert.equal(calls.length, 1)
  assert.equal(result.character.name, 'Committed')
  assert.equal(result.worldBooks.length, 1)
  assert.equal(result.assets.length, 1)
  assert.deepEqual(result.duplicateOfCharacterIds, ['existing'])
  assert.equal(result.character.avatarAssetId, result.assets[0].id)
})

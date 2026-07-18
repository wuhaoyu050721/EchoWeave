import { CCardLib } from '@risuai/ccardlib'
import { encodeUtf8 } from '../../core/text-encoding-polyfill.js'
import {
  bytesToDataUrl,
  concatBytes,
  decodeDataUrl,
  encodeBase64
} from '../character-import/binary.js'
import { normalizeCharacterCard } from '../character-import/normalizeCharacterCard.js'
import { readPngChunks } from '../character-import/png/readPngChunks.js'
import {
  CARD_ASSET_KEYWORD_PREFIX,
  CARD_METADATA_KEYWORDS,
  CHARACTER_IMPORT_LIMITS
} from '../character-import/types.js'
import {
  DEFAULT_CHARACTER_AVATAR_DATA_URL,
  ensurePngCharacterAvatar
} from './avatar.js'
import { asCharacterManagementError, characterManagementError } from './errors.js'

const PNG_SIGNATURE_LENGTH = 8
const CRC_TABLE = new Uint32Array(256)

for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  }
  CRC_TABLE[index] = value >>> 0
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value) {
  return typeof value === 'string' ? value : String(value ?? '')
}

function characterText(character, key, fallback) {
  return typeof character?.[key] === 'string' ? character[key] : text(fallback)
}

function characterArray(character, key, fallback = []) {
  if (Array.isArray(character?.[key])) return cloneJson(character[key])
  return Array.isArray(fallback) ? cloneJson(fallback) : []
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => text(value).trim()).filter(Boolean))]
}

function sourceCard(character) {
  const originalCard = isObject(character?.card) ? cloneJson(character.card) : {}
  const originalData = isObject(originalCard.data) ? originalCard.data : {}
  return {
    ...originalCard,
    spec: 'chara_card_v3',
    spec_version: '3.0',
    data: {
      ...originalData,
      name: characterText(character, 'name', originalData.name),
      nickname: characterText(character, 'nickname', originalData.nickname),
      description: characterText(character, 'description', originalData.description),
      personality: text(originalData.personality),
      scenario: text(originalData.scenario),
      first_mes: text(originalData.first_mes),
      alternate_greetings: Array.isArray(originalData.alternate_greetings) ? cloneJson(originalData.alternate_greetings) : [],
      group_only_greetings: Array.isArray(originalData.group_only_greetings) ? cloneJson(originalData.group_only_greetings) : [],
      mes_example: text(originalData.mes_example),
      system_prompt: text(originalData.system_prompt),
      post_history_instructions: text(originalData.post_history_instructions),
      creator_notes: text(originalData.creator_notes),
      tags: characterArray(character, 'tags', originalData.tags),
      creator: characterText(character, 'creator', originalData.creator),
      character_version: characterText(character, 'characterVersion', originalData.character_version || '3.0'),
      extensions: isObject(originalData.extensions) ? cloneJson(originalData.extensions) : {},
      assets: Array.isArray(originalData.assets) ? cloneJson(originalData.assets) : [],
      character_book: isObject(originalData.character_book) ? compatibleCharacterBook(originalData.character_book) : undefined
    }
  }
}

function mergedCharacterBook(character, worldBooks) {
  const activeBooks = worldBooks.filter(book => isObject(book?.data) && !book.deletedAt)
  if (!activeBooks.length) return null
  if (activeBooks.length === 1) return cloneJson(activeBooks[0].data)

  const first = cloneJson(activeBooks[0].data)
  const entries = activeBooks.flatMap(book => (
    Array.isArray(book.data?.entries) ? cloneJson(book.data.entries) : []
  ))
  const scanDepth = Math.max(...activeBooks.map(book => Number(book.data?.scan_depth) || 0), 1)
  const tokenBudget = activeBooks.reduce((total, book) => total + Math.max(0, Number(book.data?.token_budget) || 0), 0)
  return {
    ...first,
    name: `${text(character.name).trim() || 'Character'} World Book`,
    scan_depth: scanDepth,
    token_budget: tokenBudget || 2048,
    entries,
    extensions: {
      ...(isObject(first.extensions) ? first.extensions : {}),
      ai_chat_export: { world_book_ids: activeBooks.map(book => book.id) }
    }
  }
}

function compatibleCharacterBook(worldBook) {
  const copy = cloneJson(worldBook)
  copy.extensions = isObject(copy.extensions) ? copy.extensions : {}
  copy.entries = (Array.isArray(copy.entries) ? copy.entries : []).map(entryValue => {
    const entry = isObject(entryValue) ? cloneJson(entryValue) : {}
    const extensions = isObject(entry.extensions) ? entry.extensions : {}
    if (entry.id !== undefined && entry.id !== null) {
      if (typeof entry.id !== 'number') extensions.ai_chat_entry_id = text(entry.id)
      const numericId = Number(entry.id)
      if (Number.isFinite(numericId)) entry.id = numericId
      else {
        delete entry.id
      }
    }
    if (!['before_char', 'after_char'].includes(entry.position)) {
      if (entry.position) extensions.ai_chat_position = text(entry.position)
      entry.position = text(entry.position).startsWith('before_') ? 'before_char' : 'after_char'
    }
    return {
      ...entry,
      keys: Array.isArray(entry.keys) ? entry.keys.map(text) : [],
      secondary_keys: Array.isArray(entry.secondary_keys) ? entry.secondary_keys.map(text) : [],
      content: text(entry.content),
      extensions,
      enabled: entry.enabled !== false,
      insertion_order: Number.isFinite(Number(entry.insertion_order)) ? Number(entry.insertion_order) : 100,
      constant: Boolean(entry.constant)
    }
  })
  return copy
}

async function characterWithLatestWorldBook(character, repository) {
  let latest = cloneJson(character)
  if (!repository) return latest
  if (latest.id && typeof repository.getCharacter === 'function') {
    const stored = await repository.getCharacter(latest.id)
    if (!stored || stored.deletedAt) {
      throw characterManagementError('character_not_found', '要导出的角色不存在或已删除')
    }
    latest = cloneJson(stored)
  }

  let worldBooks = null
  if (latest.id && typeof repository.listWorldBooks === 'function') {
    worldBooks = await repository.listWorldBooks({ characterId: latest.id, includeGlobal: true })
  } else if (typeof repository.getWorldBook === 'function') {
    worldBooks = (await Promise.all(uniqueIds(latest.worldBookIds).map(id => repository.getWorldBook(id))))
      .filter(book => book && !book.deletedAt)
  } else if (typeof repository.listAllWorldBooks === 'function') {
    const ids = new Set(uniqueIds(latest.worldBookIds))
    worldBooks = (await repository.listAllWorldBooks()).filter(book => ids.has(text(book?.id)) && !book?.deletedAt)
  }

  const card = isObject(latest.card) ? cloneJson(latest.card) : {}
  const data = isObject(card.data) ? card.data : {}
  if (worldBooks === null) {
    if (uniqueIds(latest.worldBookIds).length || data.character_book) {
      throw characterManagementError('world_book_repository_unavailable', '导出角色卡需要读取最新世界书')
    }
    return latest
  }

  const order = new Map(uniqueIds(latest.worldBookIds).map((id, index) => [id, index]))
  const activeBooks = (Array.isArray(worldBooks) ? worldBooks : [])
    .filter(book => book && !book.deletedAt)
    .slice()
    .sort((left, right) => (order.get(text(left.id)) ?? Number.MAX_SAFE_INTEGER) - (order.get(text(right.id)) ?? Number.MAX_SAFE_INTEGER))
  const characterBook = mergedCharacterBook(latest, activeBooks)
  if (characterBook) data.character_book = compatibleCharacterBook(characterBook)
  else delete data.character_book
  latest.card = { ...card, data }
  latest.worldBookIds = activeBooks.map(book => book.id)
  return latest
}

function maxJsonBytes(options = {}) {
  const value = Number(options.maxJsonBytes ?? CHARACTER_IMPORT_LIMITS.maxJsonBytes)
  if (!Number.isFinite(value) || value < 1) {
    throw characterManagementError('invalid_export_limits', '角色卡 JSON 大小限制无效')
  }
  return value
}

function checkedJson(value, options = {}) {
  const json = JSON.stringify(value)
  const bytes = encodeUtf8(json)
  const maximum = maxJsonBytes(options)
  if (bytes.byteLength > maximum) {
    throw characterManagementError('character_card_json_too_large', `角色卡 JSON 不能超过 ${maximum} 字节`)
  }
  return { json, bytes }
}

function fileStem(value) {
  const stem = String(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 80)
  return stem || 'character-card'
}

function withDefaultPngAsset(card) {
  const copy = cloneJson(card)
  const assets = Array.isArray(copy.data.assets) ? copy.data.assets : []
  const index = assets.findIndex(asset => (
    isObject(asset) && String(asset.type || '').toLowerCase() === 'icon' &&
    (asset.uri === 'ccdefault:' || String(asset.name || '').toLowerCase() === 'main')
  ))
  const previous = index >= 0 ? assets[index] : {}
  const icon = { ...previous, type: 'icon', uri: 'ccdefault:', name: previous.name || 'main', ext: 'png' }
  if (index >= 0) assets.splice(index, 1, icon)
  else assets.unshift(icon)
  copy.data.assets = assets
  return copy
}

function v2Fallback(cardV3) {
  try {
    return CCardLib.character.convert(cloneJson(cardV3), { from: 'v3', to: 'v2' })
  } catch (error) {
    throw characterManagementError('character_card_v2_fallback_failed', '无法生成 Tavern 兼容的 chara 元数据', { cause: error })
  }
}

function uint32Bytes(value) {
  return Uint8Array.from([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  ])
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function asciiBytes(value) {
  const source = String(value)
  const bytes = new Uint8Array(source.length)
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index)
    if (code > 0x7f) throw characterManagementError('invalid_png_text', 'PNG tEXt 元数据必须使用 ASCII 编码')
    bytes[index] = code
  }
  return bytes
}

function pngChunk(type, data) {
  const typeBytes = asciiBytes(type)
  const body = concatBytes([typeBytes, data])
  return concatBytes([uint32Bytes(data.byteLength), body, uint32Bytes(crc32(body))])
}

function pngTextChunk(keyword, value) {
  const keywordBytes = asciiBytes(keyword)
  if (keywordBytes.length < 1 || keywordBytes.length > 79) {
    throw characterManagementError('invalid_png_text_keyword', 'PNG tEXt 元数据关键字长度无效')
  }
  return pngChunk('tEXt', concatBytes([keywordBytes, Uint8Array.of(0), asciiBytes(value)]))
}

function cardPngBytes(parsedPng, metadataChunks) {
  const output = [parsedPng.bytes.subarray(0, PNG_SIGNATURE_LENGTH)]
  for (const chunk of parsedPng.chunks) {
    const metadataKeyword = chunk.type === 'tEXt' ? String(chunk.keyword || '').toLowerCase() : ''
    if (CARD_METADATA_KEYWORDS.includes(metadataKeyword) || metadataKeyword.startsWith(CARD_ASSET_KEYWORD_PREFIX)) continue
    if (chunk.type === 'IEND') output.push(...metadataChunks)
    output.push(parsedPng.bytes.subarray(chunk.start, chunk.end))
  }
  return concatBytes(output)
}

function normalizeAssetKey(value) {
  let normalized = text(value).trim()
  try { normalized = decodeURIComponent(normalized) } catch {}
  return normalized
    .replace(/^__asset:/i, '')
    .replace(/^embed(?:d)?ed:\/\//i, '')
    .replace(/^asset:\/\//i, '')
    .replace(/^\/+/, '')
}

function assetKeys(asset) {
  return uniqueIds([
    asset?.chunkKey,
    asset?.uri,
    asset?.name,
    asset?.name && asset?.ext ? `${asset.name}.${asset.ext}` : ''
  ].map(normalizeAssetKey))
}

function isExternalAssetUri(value) {
  return /^(?:ccdefault:|data:|https?:\/\/)/i.test(text(value).trim())
}

async function characterAssetsForExport(character, options) {
  if (Array.isArray(options.characterAssets)) return options.characterAssets.filter(asset => asset && !asset.deletedAt)
  const repository = options.repository
  if (typeof repository?.listCharacterAssets === 'function') {
    return (await repository.listCharacterAssets(character.id)).filter(asset => asset && !asset.deletedAt)
  }
  if (typeof repository?.getCharacterAsset === 'function') {
    const assets = await Promise.all(uniqueIds(character.assetIds).map(id => repository.getCharacterAsset(id)))
    return assets.filter(asset => asset && !asset.deletedAt && asset.characterId === character.id)
  }
  return []
}

function embeddedAssetMetadata(card, characterAssets, options) {
  const records = characterAssets.map(asset => ({ asset, keys: assetKeys(asset) }))
  const chunks = []
  const usedRecords = new Set()
  const usedKeys = new Set()
  let totalBytes = 0

  const addRecord = (record, preferredKey = '') => {
    if (!record || usedRecords.has(record)) return
    const key = normalizeAssetKey(record.asset.chunkKey || preferredKey || record.keys[0])
    if (!key || usedKeys.has(key)) return
    if (!record.asset.dataUrl) {
      throw characterManagementError('character_asset_unavailable', `角色资源 ${record.asset.name || key} 缺少本地数据`)
    }
    const parsed = decodeDataUrl(record.asset.dataUrl)
    const maxAssetBytes = Number(options.maxAssetBytes ?? CHARACTER_IMPORT_LIMITS.maxAssetBytes)
    if (parsed.bytes.byteLength > maxAssetBytes) {
      throw characterManagementError('character_asset_too_large', `角色资源 ${record.asset.name || key} 过大`)
    }
    totalBytes += parsed.bytes.byteLength
    if (totalBytes > Number(options.maxTotalAssetBytes ?? CHARACTER_IMPORT_LIMITS.maxTotalAssetBytes)) {
      throw characterManagementError('character_assets_too_large', '角色资源总量超过导出限制')
    }
    const encodedKey = encodeURIComponent(key)
    const keyword = `${CARD_ASSET_KEYWORD_PREFIX}${encodedKey}`
    chunks.push({ keyword, chunk: pngTextChunk(keyword, encodeBase64(parsed.bytes)) })
    usedRecords.add(record)
    usedKeys.add(key)
  }

  const declaredAssets = Array.isArray(card.data.assets) ? card.data.assets : []
  for (const asset of declaredAssets) {
    if (!isObject(asset) || isExternalAssetUri(asset.uri)) continue
    const candidates = assetKeys(asset)
    const record = records.find(candidate => candidate.keys.some(key => candidates.includes(key)))
    if (!record) {
      throw characterManagementError('character_asset_unavailable', `角色资源 ${asset.name || asset.uri || 'unknown'} 不存在`)
    }
    addRecord(record, candidates[0])
  }

  for (const record of records) {
    const asset = record.asset
    if (isExternalAssetUri(asset.uri)) continue
    if (asset.unreferenced || asset.chunkKey || asset.source === 'embedded') addRecord(record)
  }
  return chunks
}

async function avatarDataUrlFor(character, {
  repository = null,
  avatarDataUrl = '',
  fallbackAvatarDataUrl = DEFAULT_CHARACTER_AVATAR_DATA_URL
} = {}) {
  if (avatarDataUrl) return avatarDataUrl
  if (character?.avatarDataUrl) return character.avatarDataUrl
  if (character?.avatarAssetId) {
    if (typeof repository?.getCharacterAsset !== 'function') {
      throw characterManagementError('character_avatar_repository_unavailable', '导出角色卡需要读取头像资产')
    }
    const asset = await repository.getCharacterAsset(character.avatarAssetId)
    if (asset?.dataUrl) return asset.dataUrl
    throw characterManagementError('character_avatar_unavailable', '角色头像资产不存在或不包含本地图片数据')
  }
  if (!fallbackAvatarDataUrl) throw characterManagementError('character_avatar_unavailable', '角色没有可导出的头像')
  return fallbackAvatarDataUrl
}

export function createCharacterCardV3(character) {
  if (!character || typeof character !== 'object') {
    throw characterManagementError('missing_character', '缺少要导出的角色')
  }
  if (character.deletedAt) throw characterManagementError('character_deleted', '已删除角色不能导出')
  try {
    return cloneJson(normalizeCharacterCard(sourceCard(character)).card)
  } catch (error) {
    throw asCharacterManagementError(error, {
      code: 'invalid_character_card_export',
      message: '角色数据无法生成标准 V3 角色卡'
    })
  }
}

export async function exportCharacterCardJson(character, {
  pretty = true,
  fileName = '',
  repository = null,
  ...limits
} = {}) {
  const exportCharacter = await characterWithLatestWorldBook(character, repository)
  const card = createCharacterCardV3(exportCharacter)
  const compact = checkedJson(card, limits)
  const content = pretty ? JSON.stringify(card, null, 2) : compact.json
  const contentBytes = encodeUtf8(content)
  const maximum = maxJsonBytes(limits)
  if (contentBytes.byteLength > maximum) {
    throw characterManagementError('character_card_json_too_large', `角色卡 JSON 不能超过 ${maximum} 字节`)
  }
  return {
    format: 'character-card-v3-json',
    fileName: fileName || `${fileStem(card.data.name)}.json`,
    mimeType: 'application/json',
    card,
    content,
    text: content,
    byteSize: contentBytes.byteLength
  }
}

export async function exportCharacterCardPng(character, options = {}) {
  const exportCharacter = await characterWithLatestWorldBook(character, options.repository)
  const card = withDefaultPngAsset(createCharacterCardV3(exportCharacter))
  const sourceAvatarDataUrl = await avatarDataUrlFor(exportCharacter, options)
  const avatar = await ensurePngCharacterAvatar(sourceAvatarDataUrl, {
    convertAvatarToPng: options.convertAvatarToPng,
    limits: options.avatarLimits
  })
  const parsedAvatar = readPngChunks(avatar.bytes, {
    maxChunks: Number(options.avatarLimits?.maxPngChunks) || CHARACTER_IMPORT_LIMITS.maxChunks
  })
  const ccv3 = checkedJson(card, options)
  const charaCard = v2Fallback(card)
  const chara = checkedJson(charaCard, options)
  const characterAssets = await characterAssetsForExport(exportCharacter, options)
  const assetMetadata = embeddedAssetMetadata(card, characterAssets, options)
  const bytes = cardPngBytes(parsedAvatar, [
    pngTextChunk('ccv3', encodeBase64(ccv3.bytes)),
    pngTextChunk('chara', encodeBase64(chara.bytes)),
    ...assetMetadata.map(item => item.chunk)
  ])

  return {
    format: 'character-card-v3-png',
    fileName: options.fileName || `${fileStem(card.data.name)}.png`,
    mimeType: 'image/png',
    card,
    bytes,
    dataUrl: options.includeDataUrl === false ? '' : bytesToDataUrl(bytes, 'image/png'),
    byteSize: bytes.byteLength,
    width: parsedAvatar.width,
    height: parsedAvatar.height,
    metadataKeywords: ['ccv3', 'chara', ...assetMetadata.map(item => item.keyword)]
  }
}

import { asciiBytesToString, bytesToDataUrl, decodeBase64Strict, decodeDataUrl } from './binary.js'
import { importError } from './errors.js'
import { CARD_ASSET_KEYWORD_PREFIX, CHARACTER_IMPORT_LIMITS } from './types.js'

const MIME_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  json: 'application/json', txt: 'text/plain', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg'
}

function normalizeAssetKey(value) {
  return decodeURIComponent(String(value ?? '').trim())
    .replace(/^__asset:/i, '')
    .replace(/^embed(?:d)?ed:\/\//i, '')
    .replace(/^asset:\/\//i, '')
    .replace(/^\/+/, '')
}

function fileExtension(value) {
  const normalized = String(value ?? '').toLowerCase()
  const dot = normalized.lastIndexOf('.')
  return dot >= 0 ? normalized.slice(dot + 1).replace(/[^a-z0-9]/g, '') : ''
}

function mimeTypeFor(asset, key) {
  const extension = String(asset.ext || fileExtension(asset.name) || fileExtension(key)).toLowerCase()
  return MIME_TYPES[extension] || 'application/octet-stream'
}

function embeddedChunks(textChunks, limits) {
  const result = new Map()
  for (const chunk of textChunks) {
    if (!chunk.keyword.startsWith(CARD_ASSET_KEYWORD_PREFIX)) continue
    const key = normalizeAssetKey(chunk.keyword.slice(CARD_ASSET_KEYWORD_PREFIX.length))
    if (!key) throw importError('invalid_asset_keyword', '内嵌资源 chunk 缺少名称')
    if (result.has(key)) throw importError('duplicate_asset_chunk', `内嵌资源 ${key} 重复`)
    const bytes = decodeBase64Strict(asciiBytesToString(chunk.textBytes), { label: `资源 ${key}` })
    if (bytes.byteLength > limits.maxAssetBytes) throw importError('asset_too_large', `资源 ${key} 超过单资源大小限制`)
    result.set(key, { key, bytes, keyword: chunk.keyword })
  }
  return result
}

function assetCandidates(asset) {
  return [asset.uri, asset.name, `${asset.name || ''}.${asset.ext || ''}`]
    .map(normalizeAssetKey)
    .filter(Boolean)
}

export function resolveCardAssets(card, textChunks, avatarBytes, {
  limits = CHARACTER_IMPORT_LIMITS
} = {}) {
  const chunks = embeddedChunks(textChunks, limits)
  const assets = []
  const usedChunkKeys = new Set()
  const declared = Array.isArray(card.data.assets) ? card.data.assets : []
  for (let index = 0; index < declared.length; index += 1) {
    const asset = declared[index]
    if (!asset || typeof asset !== 'object') throw importError('invalid_asset', `资源清单第 ${index + 1} 项格式无效`)
    const uri = String(asset.uri || '')
    const mimeType = mimeTypeFor(asset, uri)
    if (/^ccdefault:/i.test(uri)) {
      assets.push({ ...asset, source: 'avatar', mimeType: 'image/png', byteSize: avatarBytes.byteLength, dataUrl: bytesToDataUrl(avatarBytes, 'image/png') })
      continue
    }
    if (/^data:/i.test(uri)) {
      const parsed = decodeDataUrl(uri)
      if (parsed.bytes.byteLength > limits.maxAssetBytes) throw importError('asset_too_large', `资源 ${asset.name || index + 1} 超过单资源大小限制`)
      assets.push({ ...asset, source: 'data-uri', mimeType: parsed.mimeType, byteSize: parsed.bytes.byteLength, dataUrl: uri })
      continue
    }
    const key = assetCandidates(asset).find(candidate => chunks.has(candidate))
    if (key) {
      const embedded = chunks.get(key)
      usedChunkKeys.add(key)
      assets.push({ ...asset, source: 'embedded', chunkKey: key, mimeType, byteSize: embedded.bytes.byteLength, dataUrl: bytesToDataUrl(embedded.bytes, mimeType) })
      continue
    }
    if (/^https?:\/\//i.test(uri)) {
      assets.push({ ...asset, source: 'remote', mimeType, byteSize: 0, sourceUrl: uri, unresolved: true })
      continue
    }
    throw importError('missing_character_asset', `角色资源 ${asset.name || uri || index + 1} 缺少内嵌数据`)
  }

  for (const [key, embedded] of chunks) {
    if (usedChunkKeys.has(key)) continue
    const mimeType = MIME_TYPES[fileExtension(key)] || 'application/octet-stream'
    assets.push({
      type: 'x-embedded', name: key, ext: fileExtension(key) || 'bin', uri: `__asset:${key}`,
      source: 'embedded', chunkKey: key, mimeType, byteSize: embedded.bytes.byteLength,
      dataUrl: bytesToDataUrl(embedded.bytes, mimeType), unreferenced: true
    })
  }
  if (!assets.some(asset => asset.type === 'icon')) {
    assets.unshift({
      type: 'icon', name: 'main', ext: 'png', uri: 'ccdefault:', source: 'avatar',
      mimeType: 'image/png', byteSize: avatarBytes.byteLength, dataUrl: bytesToDataUrl(avatarBytes, 'image/png')
    })
  }
  if (assets.length > limits.maxAssets) throw importError('too_many_character_assets', `角色资源数量不能超过 ${limits.maxAssets}`)
  const totalBytes = assets.reduce((total, asset) => total + (asset.source === 'avatar' && total > 0 ? 0 : asset.byteSize || 0), 0)
  if (totalBytes > limits.maxTotalAssetBytes) throw importError('character_assets_too_large', '角色资源总量超过限制')
  return { assets, totalBytes, unresolvedAssets: assets.filter(asset => asset.unresolved) }
}

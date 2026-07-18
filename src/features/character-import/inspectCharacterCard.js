import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, bytesToDataUrl, readCharacterInput } from './binary.js'
import { decodeCharacterPayload } from './decodeCharacterPayload.js'
import { importError } from './errors.js'
import { normalizeCharacterCard } from './normalizeCharacterCard.js'
import { createDisplayPngBytes, readPngChunks } from './png/readPngChunks.js'
import { resolveCardAssets } from './resolveCardAssets.js'
import {
  CARD_METADATA_KEYWORDS,
  CHARACTER_IMPORT_LIMITS,
  UNSAFE_EXTENSION_KEYS,
  mergeCharacterImportLimits
} from './types.js'

function selectedMetadata(textChunks) {
  for (const keyword of CARD_METADATA_KEYWORDS) {
    const matches = textChunks.filter(chunk => chunk.keyword.toLowerCase() === keyword)
    if (!matches.length) continue
    if (matches.length > 1) {
      const first = matches[0].textBytes
      const identical = matches.slice(1).every(match => (
        match.textBytes.length === first.length && match.textBytes.every((value, index) => value === first[index])
      ))
      if (!identical) throw importError('conflicting_character_metadata', `PNG 包含冲突的 ${keyword} 元数据`)
    }
    return { chunk: matches[0], keyword, duplicateCount: matches.length - 1 }
  }
  throw importError('missing_character_metadata', 'PNG 中未找到 chara 或 ccv3 角色卡数据')
}

function findUnsafeExtensions(value, path = [], found = []) {
  if (!value || typeof value !== 'object') return found
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key]
    if (UNSAFE_EXTENSION_KEYS.includes(key.toLowerCase())) found.push(nextPath.join('.'))
    if (child && typeof child === 'object') findUnsafeExtensions(child, nextPath, found)
  }
  return found
}

function summarizeWorldBook(book) {
  if (!book) return null
  const entries = Array.isArray(book.entries) ? book.entries : []
  return {
    name: String(book.name || '角色世界书'),
    entryCount: entries.length,
    enabledEntryCount: entries.filter(entry => entry.enabled !== false).length,
    constantEntryCount: entries.filter(entry => entry.enabled !== false && entry.constant).length,
    regexEntryCount: entries.filter(entry => entry.enabled !== false && entry.use_regex && !entry.constant).length,
    scanDepth: Number(book.scan_depth) || null,
    tokenBudget: Number(book.token_budget) || null
  }
}

export async function inspectCharacterCard(input, options = {}) {
  const limits = mergeCharacterImportLimits(options.limits)
  const source = await readCharacterInput(input)
  if (!/\.png$/i.test(source.name)) throw importError('invalid_character_extension', '角色卡文件扩展名必须是 .png')
  if (source.bytes.byteLength > limits.maxPngBytes) throw importError('character_png_too_large', '角色卡 PNG 不能超过 50 MB')

  const png = readPngChunks(source.bytes, { maxChunks: limits.maxChunks })
  const metadata = selectedMetadata(png.textChunks)
  const decoded = decodeCharacterPayload(metadata.chunk.textBytes, { maxJsonBytes: limits.maxJsonBytes })
  const normalized = normalizeCharacterCard(decoded.payload, { maxTextFieldCharacters: limits.maxTextFieldCharacters })
  const avatarBytes = createDisplayPngBytes(png)
  const resolved = resolveCardAssets(normalized.card, png.textChunks, avatarBytes, { limits })
  const unsafeExtensions = findUnsafeExtensions(normalized.card.data.extensions)
  const worldBook = summarizeWorldBook(normalized.card.data.character_book)
  const warnings = [...normalized.warnings]
  if (metadata.duplicateCount) warnings.push({ code: 'duplicate_metadata', message: `检测到 ${metadata.duplicateCount + 1} 份相同 ${metadata.keyword} 元数据` })
  if (resolved.unresolvedAssets.length) warnings.push({ code: 'remote_assets_not_downloaded', message: `${resolved.unresolvedAssets.length} 个远程资源不会自动下载` })
  if (worldBook?.regexEntryCount) warnings.push({ code: 'regex_entries_deferred', message: `${worldBook.regexEntryCount} 条正则世界书规则首版不会自动激活` })
  if (unsafeExtensions.length) warnings.push({ code: 'unsafe_extensions_disabled', message: '卡片包含脚本或高级扩展，导入后保持禁用' })

  return {
    previewVersion: 1,
    source: {
      name: source.name,
      byteSize: source.bytes.byteLength,
      width: png.width,
      height: png.height,
      hash: bytesToHex(sha256(source.bytes)),
      metadataKeyword: metadata.keyword,
      jsonBytes: decoded.jsonBytes
    },
    character: {
      name: normalized.card.data.name,
      description: normalized.card.data.description,
      creator: normalized.card.data.creator,
      characterVersion: normalized.card.data.character_version,
      tags: normalized.card.data.tags,
      sourceVersion: normalized.sourceVersion,
      greetingCount: 1 + normalized.card.data.alternate_greetings.length,
      avatarDataUrl: bytesToDataUrl(avatarBytes, 'image/png')
    },
    worldBook,
    assets: resolved.assets.map(({ dataUrl, ...asset }) => asset),
    totalAssetBytes: resolved.totalBytes,
    unsafeExtensions,
    requiresSensitiveExtensionConfirmation: unsafeExtensions.length > 0,
    warnings,
    cardV3: normalized.card,
    commitData: {
      avatarDataUrl: bytesToDataUrl(avatarBytes, 'image/png'),
      assets: resolved.assets
    }
  }
}

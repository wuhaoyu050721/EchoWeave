import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '../character-import/binary.js'
import { worldBookImportError } from './errors.js'
import { normalizeWorldBook } from './normalizeWorldBook.js'
import { readWorldBookInput } from './readWorldBookInput.js'
import { mergeWorldBookImportLimits } from './types.js'

export async function inspectWorldBook(input, options = {}) {
  const limits = mergeWorldBookImportLimits(options.limits)
  const source = await readWorldBookInput(input)
  if (!/\.json$/i.test(source.name)) throw worldBookImportError('invalid_world_book_extension', '世界书文件扩展名必须是 .json')
  if (source.bytes.byteLength > limits.maxJsonBytes) throw worldBookImportError('world_book_json_too_large', '世界书 JSON 不能超过 5 MB')
  let payload
  try {
    payload = JSON.parse(source.text.replace(/^\uFEFF/, ''))
  } catch (error) {
    throw worldBookImportError('invalid_world_book_json', '世界书 JSON 解析失败', { cause: error })
  }
  const normalized = normalizeWorldBook(payload, { fileName: source.name, limits })
  const enabledEntries = normalized.data.entries.filter(entry => entry.enabled)
  return {
    previewVersion: 1,
    source: {
      name: source.name,
      byteSize: source.bytes.byteLength,
      hash: bytesToHex(sha256(source.bytes)),
      format: normalized.sourceFormat
    },
    worldBook: {
      name: normalized.data.name,
      description: normalized.data.description,
      entryCount: normalized.data.entries.length,
      enabledEntryCount: enabledEntries.length,
      constantEntryCount: enabledEntries.filter(entry => entry.constant).length,
      keywordEntryCount: enabledEntries.filter(entry => !entry.constant).length,
      regexEntryCount: enabledEntries.filter(entry => entry.use_regex && !entry.constant).length,
      scanDepth: normalized.data.scan_depth,
      tokenBudget: normalized.data.token_budget
    },
    unsafeExtensions: normalized.unsafeExtensions,
    requiresSensitiveExtensionConfirmation: normalized.unsafeExtensions.length > 0,
    warnings: normalized.warnings,
    commitData: { data: normalized.data }
  }
}

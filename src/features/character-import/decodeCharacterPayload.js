import { asciiBytesToString, decodeBase64Strict } from './binary.js'
import { importError } from './errors.js'
import { CHARACTER_IMPORT_LIMITS } from './types.js'

export function decodeCharacterPayload(textBytes, { maxJsonBytes = CHARACTER_IMPORT_LIMITS.maxJsonBytes } = {}) {
  const encoded = asciiBytesToString(textBytes)
  const jsonBytes = decodeBase64Strict(encoded, { label: '角色卡元数据' })
  if (jsonBytes.byteLength > maxJsonBytes) {
    throw importError('character_json_too_large', `角色 JSON 不能超过 ${Math.floor(maxJsonBytes / 1024 / 1024)} MB`)
  }

  let jsonText
  try {
    jsonText = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes)
  } catch (error) {
    throw importError('invalid_character_utf8', '角色卡元数据不是有效 UTF-8', { cause: error })
  }

  let payload
  try {
    payload = JSON.parse(jsonText)
  } catch (error) {
    throw importError('invalid_character_json', '角色卡元数据不是有效 JSON', { cause: error })
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw importError('invalid_character_payload', '角色卡 JSON 顶层必须是对象')
  }
  return { payload, jsonBytes: jsonBytes.byteLength }
}

import { importError } from './errors.js'

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_VALUES = new Int16Array(128).fill(-1)
for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
  BASE64_VALUES[BASE64_ALPHABET.charCodeAt(index)] = index
}

export function toUint8Array(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  throw importError('invalid_input', '角色卡输入必须是文件或二进制数据')
}

export async function readCharacterInput(input) {
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    const bytes = toUint8Array(input)
    return { bytes, name: 'character-card.png', mimeType: 'image/png', size: bytes.byteLength }
  }
  if (input?.nativePrepared?.dataUrl) {
    const parsed = decodeDataUrl(input.nativePrepared.dataUrl)
    return {
      bytes: parsed.bytes,
      name: String(input.name || 'character-card.png'),
      mimeType: String(input.type || parsed.mimeType || 'image/png'),
      size: Number(input.size) || parsed.bytes.byteLength
    }
  }
  if (typeof input?.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await input.arrayBuffer())
    return {
      bytes,
      name: String(input.name || 'character-card.png'),
      mimeType: String(input.type || 'image/png'),
      size: Number(input.size) || bytes.byteLength
    }
  }
  if (typeof input?.dataUrl === 'string') {
    const parsed = decodeDataUrl(input.dataUrl)
    return {
      bytes: parsed.bytes,
      name: String(input.name || 'character-card.png'),
      mimeType: String(input.type || parsed.mimeType || 'image/png'),
      size: parsed.bytes.byteLength
    }
  }
  throw importError('invalid_input', '无法读取所选角色卡文件')
}

function decodedBase64Length(value) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  return (value.length / 4) * 3 - padding
}

export function decodeBase64Strict(value, { label = 'Base64 数据' } = {}) {
  const source = String(value ?? '')
  if (!source || source.length % 4 !== 0) {
    throw importError('invalid_base64', `${label}长度无效`)
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(source) || source.slice(0, -2).includes('=')) {
    throw importError('invalid_base64', `${label}包含非法字符`)
  }
  const output = new Uint8Array(decodedBase64Length(source))
  let outputIndex = 0
  for (let index = 0; index < source.length; index += 4) {
    const first = BASE64_VALUES[source.charCodeAt(index)]
    const second = BASE64_VALUES[source.charCodeAt(index + 1)]
    const thirdCharacter = source[index + 2]
    const fourthCharacter = source[index + 3]
    const third = thirdCharacter === '=' ? 0 : BASE64_VALUES[source.charCodeAt(index + 2)]
    const fourth = fourthCharacter === '=' ? 0 : BASE64_VALUES[source.charCodeAt(index + 3)]
    if (first < 0 || second < 0 || third < 0 || fourth < 0) {
      throw importError('invalid_base64', `${label}包含非法字符`)
    }
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth
    if (outputIndex < output.length) output[outputIndex++] = (combined >> 16) & 0xff
    if (outputIndex < output.length) output[outputIndex++] = (combined >> 8) & 0xff
    if (outputIndex < output.length) output[outputIndex++] = combined & 0xff
  }
  return output
}

export function encodeBase64(bytes) {
  const input = toUint8Array(bytes)
  const parts = []
  for (let index = 0; index < input.length; index += 3) {
    const first = input[index]
    const hasSecond = index + 1 < input.length
    const hasThird = index + 2 < input.length
    const second = hasSecond ? input[index + 1] : 0
    const third = hasThird ? input[index + 2] : 0
    const combined = (first << 16) | (second << 8) | third
    parts.push(
      BASE64_ALPHABET[(combined >> 18) & 63],
      BASE64_ALPHABET[(combined >> 12) & 63],
      hasSecond ? BASE64_ALPHABET[(combined >> 6) & 63] : '=',
      hasThird ? BASE64_ALPHABET[combined & 63] : '='
    )
  }
  return parts.join('')
}

export function asciiBytesToString(bytes) {
  const input = toUint8Array(bytes)
  const chunks = []
  for (let index = 0; index < input.length; index += 8192) {
    chunks.push(String.fromCharCode(...input.subarray(index, index + 8192)))
  }
  return chunks.join('')
}

export function bytesToDataUrl(bytes, mimeType = 'application/octet-stream') {
  return `data:${mimeType};base64,${encodeBase64(bytes)}`
}

export function decodeDataUrl(value) {
  const match = /^data:([^;,]+)?;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value ?? ''))
  if (!match) throw importError('invalid_data_url', '资源 Data URI 无效')
  return {
    mimeType: match[1] || 'application/octet-stream',
    bytes: decodeBase64Strict(match[2], { label: 'Data URI' })
  }
}

export function concatBytes(parts) {
  const inputs = parts.map(toUint8Array)
  const output = new Uint8Array(inputs.reduce((total, item) => total + item.byteLength, 0))
  let offset = 0
  for (const input of inputs) {
    output.set(input, offset)
    offset += input.byteLength
  }
  return output
}

export function bytesToHex(bytes) {
  return Array.from(toUint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_DECODE_TABLE = new Int16Array(128).fill(-1)
for (let index = 0; index < BASE64_ALPHABET.length; index += 1) {
  BASE64_DECODE_TABLE[BASE64_ALPHABET.charCodeAt(index)] = index
}
export const MAX_GENERATED_IMAGE_BYTES = 12 * 1024 * 1024
export const MAX_GENERATED_IMAGE_PIXELS = 25 * 1024 * 1024
export const MAX_GENERATED_IMAGE_OUTPUTS = 6
const MAX_IMAGE_HEADER_BYTES = 2 * 1024 * 1024

function normalizedMimeType(value, fallback = 'image/png') {
  const mimeType = String(value ?? '').trim().toLowerCase().split(';')[0]
  return /^image\/[a-z0-9.+-]+$/.test(mimeType) ? mimeType : fallback
}

function extensionForMimeType(mimeType) {
  return ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif'
  })[mimeType] || 'png'
}

function mimeTypeFromDataUrl(value) {
  return /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(String(value ?? ''))?.[1]?.toLowerCase() || ''
}

function normalizeBase64(value) {
  const encoded = String(value ?? '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!encoded || !/^[a-z0-9+/]+={0,2}$/i.test(encoded)) return ''
  const unpadded = encoded.replace(/=+$/, '')
  if (unpadded.length % 4 === 1) return ''
  return unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '=')
}

function normalizeImageDataUrl(value) {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i.exec(String(value ?? ''))
  if (!match) return ''
  const encoded = normalizeBase64(match[1])
  if (!encoded) return ''
  return `data:${normalizedMimeType(mimeTypeFromDataUrl(value))};base64,${encoded}`
}

function base64ByteLength(value) {
  const encoded = normalizeBase64(value)
  if (!encoded) return 0
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding)
}

function dataUrlByteLength(value) {
  const separator = String(value ?? '').indexOf(',')
  return separator < 0 ? 0 : base64ByteLength(String(value).slice(separator + 1))
}

function base64PrefixToBytes(value, maxBytes = MAX_IMAGE_HEADER_BYTES) {
  const encoded = normalizeBase64(value)
  if (!encoded) return new Uint8Array()
  const byteLength = Math.min(base64ByteLength(encoded), Math.max(0, Number(maxBytes) || 0))
  const bytes = new Uint8Array(byteLength)
  let target = 0
  for (let offset = 0; offset < encoded.length && target < byteLength; offset += 4) {
    const first = BASE64_DECODE_TABLE[encoded.charCodeAt(offset)] ?? -1
    const second = BASE64_DECODE_TABLE[encoded.charCodeAt(offset + 1)] ?? -1
    const third = encoded[offset + 2] === '=' ? 0 : (BASE64_DECODE_TABLE[encoded.charCodeAt(offset + 2)] ?? -1)
    const fourth = encoded[offset + 3] === '=' ? 0 : (BASE64_DECODE_TABLE[encoded.charCodeAt(offset + 3)] ?? -1)
    if (first < 0 || second < 0 || third < 0 || fourth < 0) return new Uint8Array()
    bytes[target] = (first << 2) | (second >> 4)
    target += 1
    if (target < byteLength && encoded[offset + 2] !== '=') {
      bytes[target] = ((second & 15) << 4) | (third >> 2)
      target += 1
    }
    if (target < byteLength && encoded[offset + 3] !== '=') {
      bytes[target] = ((third & 3) << 6) | fourth
      target += 1
    }
  }
  return bytes
}

function uint16BigEndian(bytes, offset) {
  return bytes[offset] * 0x100 + bytes[offset + 1]
}

function uint16LittleEndian(bytes, offset) {
  return bytes[offset] + bytes[offset + 1] * 0x100
}

function uint24LittleEndian(bytes, offset) {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000
}

function uint32BigEndian(bytes, offset) {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3]
}

function bytesMatch(bytes, offset, expected) {
  if (offset < 0 || offset + expected.length > bytes.length) return false
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false
  }
  return true
}

function jpegDimensions(bytes) {
  if (!bytesMatch(bytes, 0, [0xff, 0xd8])) return null
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ])
  let offset = 2
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 1 >= bytes.length) break
    const segmentLength = uint16BigEndian(bytes, offset)
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break
    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      const height = uint16BigEndian(bytes, offset + 3)
      const width = uint16BigEndian(bytes, offset + 5)
      return width && height ? { width, height } : null
    }
    offset += segmentLength
  }
  return null
}

export function readImageDimensions(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array()
  if (bytes.length < 10) return null

  if (bytesMatch(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && bytes.length >= 24) {
    const width = uint32BigEndian(bytes, 16)
    const height = uint32BigEndian(bytes, 20)
    return width && height ? { width, height } : null
  }
  if (bytesMatch(bytes, 0, [0x47, 0x49, 0x46, 0x38])) {
    const width = uint16LittleEndian(bytes, 6)
    const height = uint16LittleEndian(bytes, 8)
    return width && height ? { width, height } : null
  }
  const jpeg = jpegDimensions(bytes)
  if (jpeg) return jpeg
  if (!bytesMatch(bytes, 0, [0x52, 0x49, 0x46, 0x46]) || !bytesMatch(bytes, 8, [0x57, 0x45, 0x42, 0x50])) {
    return null
  }
  if (bytesMatch(bytes, 12, [0x56, 0x50, 0x38, 0x58]) && bytes.length >= 30) {
    return {
      width: uint24LittleEndian(bytes, 24) + 1,
      height: uint24LittleEndian(bytes, 27) + 1
    }
  }
  if (bytesMatch(bytes, 12, [0x56, 0x50, 0x38, 0x4c]) && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + ((bytes[21] | (bytes[22] << 8)) & 0x3fff),
      height: 1 + (((bytes[22] >> 6) | (bytes[23] << 2) | (bytes[24] << 10)) & 0x3fff)
    }
  }
  if (bytesMatch(bytes, 12, [0x56, 0x50, 0x38, 0x20]) && bytes.length >= 30 && bytesMatch(bytes, 23, [0x9d, 0x01, 0x2a])) {
    return {
      width: uint16LittleEndian(bytes, 26) & 0x3fff,
      height: uint16LittleEndian(bytes, 28) & 0x3fff
    }
  }
  return null
}

export function assertGeneratedImageLimits(value, {
  maxBytes = MAX_GENERATED_IMAGE_BYTES,
  maxPixels = MAX_GENERATED_IMAGE_PIXELS
} = {}) {
  const bytes = value instanceof Uint8Array
    ? value
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array()
  const dimensions = readImageDimensions(bytes)
  if (bytes.byteLength > maxBytes || (dimensions && dimensions.width * dimensions.height > maxPixels)) {
    const error = new Error(
      bytes.byteLength > maxBytes
        ? '生成图片超过 12 MB，已停止保存'
        : '生成图片超过 2500 万像素，已停止保存'
    )
    error.name = 'GeneratedImageLimitError'
    error.code = bytes.byteLength > maxBytes ? 'generated_image_too_large' : 'generated_image_pixels_too_large'
    error.byteSize = bytes.byteLength
    error.width = dimensions?.width || null
    error.height = dimensions?.height || null
    throw error
  }
  return dimensions
}

function imageUrlFrom(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return value.url || value.uri || ''
  return ''
}

function isHttpImageUrl(value) {
  return /^https?:\/\/[^\s]+$/i.test(String(value ?? '').trim())
}

function resolveHttpImageUrl(value, baseUrl = '') {
  const candidate = String(value ?? '').trim()
  if (isHttpImageUrl(candidate)) return candidate
  if (!candidate || /\s/.test(candidate)) return ''

  const base = String(baseUrl ?? '').trim()
  const baseMatch = /^(https?):\/\/([^\s/?#]+)(\/[^?#]*)?/i.exec(base)
  if (!baseMatch) return ''
  if (candidate.startsWith('//')) return `${baseMatch[1]}:${candidate}`

  if (typeof globalThis.URL === 'function') {
    try {
      const resolved = new globalThis.URL(candidate, base.endsWith('/') ? base : `${base}/`).toString()
      if (isHttpImageUrl(resolved)) return resolved
    } catch (_) {}
  }

  if (candidate.startsWith('/')) return `${baseMatch[1]}://${baseMatch[2]}${candidate}`
  if (candidate.startsWith('../')) return ''
  return `${base.replace(/\/+$/, '')}/${candidate.replace(/^\.\//, '')}`
}

function looksLikeImageObject(value) {
  if (!value || typeof value !== 'object') return false
  const type = String(value.type ?? '').toLowerCase()
  return Boolean(
    type.includes('image') ||
    value.b64_json ||
    value.b64Json ||
    value.base64 ||
    value.image_base64 ||
    value.imageBase64 ||
    value.dataUrl ||
    value.data_url ||
    value.image_url ||
    value.imageUrl ||
    value.output_url ||
    value.outputUrl ||
    value.inlineData ||
    value.inline_data ||
    value.image ||
    value.source?.type === 'base64'
  )
}

export function normalizeImageOutput(value, index = 0, {
  assumeImage = false,
  baseUrl = '',
  maxBytes = MAX_GENERATED_IMAGE_BYTES,
  maxPixels = MAX_GENERATED_IMAGE_PIXELS
} = {}) {
  if (!value) return null
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.startsWith('data:image/')) value = { dataUrl: text }
    else if (resolveHttpImageUrl(text, baseUrl)) value = { url: text }
    else if (assumeImage && normalizeBase64(text)) value = { base64: text }
    else return null
  }
  if (typeof value !== 'object' || (!assumeImage && !looksLikeImageObject(value))) return null

  const source = value.source && typeof value.source === 'object' ? value.source : {}
  const inlineData = (value.inlineData ?? value.inline_data) && typeof (value.inlineData ?? value.inline_data) === 'object'
    ? (value.inlineData ?? value.inline_data)
    : {}
  const embeddedImage = value.image && typeof value.image === 'object' ? value.image : {}
  const type = String(value.type ?? '').toLowerCase()
  const resultValue = String(value.result ?? '').trim()
  const resultBase64 = type.includes('image') && !resultValue.startsWith('http') && !resultValue.startsWith('data:image/')
    ? value.result
    : ''
  const imageValue = typeof value.image === 'string' ? value.image.trim() : ''
  const imageBase64 = assumeImage && imageValue && !imageValue.startsWith('http') && !imageValue.startsWith('data:image/')
    ? imageValue
    : ''
  const base64 = normalizeBase64(
    value.b64_json || value.b64Json || value.base64 || value.image_base64 || value.imageBase64 ||
    resultBase64 || imageBase64 || inlineData.data || embeddedImage.base64 || embeddedImage.data || source.data || ''
  )
  let dataUrl = String(value.dataUrl ?? value.data_url ?? '').trim()
  const nestedUrl = imageUrlFrom(value.image_url ?? value.imageUrl)
  const directUrl = String(value.url ?? value.uri ?? value.output_url ?? value.outputUrl ?? '').trim()
  const resultUrl = type.includes('image') ? imageUrlFrom(value.result) : ''
  const candidateUrl = nestedUrl || directUrl || imageUrlFrom(value.image) || imageUrlFrom(embeddedImage) || resultUrl || imageUrlFrom(source)
  if (!dataUrl && String(candidateUrl).startsWith('data:image/')) dataUrl = String(candidateUrl)

  const sourceMimeType = value.mimeType ?? value.mime_type ?? value.media_type ?? inlineData.mimeType ?? inlineData.mime_type ?? embeddedImage.mimeType ?? embeddedImage.mime_type ?? source.media_type
  const mimeType = normalizedMimeType(sourceMimeType || mimeTypeFromDataUrl(dataUrl))
  if (!dataUrl && base64) dataUrl = `data:${mimeType};base64,${base64}`
  if (dataUrl) {
    dataUrl = normalizeImageDataUrl(dataUrl)
    if (!dataUrl) return null
  }

  const sourceUrl = !dataUrl ? resolveHttpImageUrl(candidateUrl, baseUrl) : ''
  if (!dataUrl && !sourceUrl) return null
  const name = String(value.name ?? '').trim() || `generated-image-${index + 1}.${extensionForMimeType(mimeType)}`
  const byteSize = Math.max(0, Number(value.byteSize ?? value.byte_size) || dataUrlByteLength(dataUrl))
  const dataUrlBase64 = dataUrl ? dataUrl.slice(dataUrl.indexOf(',') + 1) : ''
  const actualDimensions = dataUrlBase64
    ? readImageDimensions(base64PrefixToBytes(dataUrlBase64))
    : null
  const width = actualDimensions?.width || Math.max(0, Number(value.width) || 0) || null
  const height = actualDimensions?.height || Math.max(0, Number(value.height) || 0) || null
  if (byteSize > maxBytes || (width && height && width * height > maxPixels)) return null

  return {
    kind: 'image',
    name,
    mimeType,
    byteSize,
    dataUrl: dataUrl || null,
    sourceUrl: sourceUrl || null,
    textContent: null,
    width,
    height,
    generated: true,
    revisedPrompt: String(value.revised_prompt ?? value.revisedPrompt ?? '').trim() || null
  }
}

export function extractImageOutputs(payload, { baseUrl = '' } = {}) {
  const outputs = []
  const fingerprints = new Set()
  const inspected = new Set()
  const add = (value, assumeImage = false) => {
    if (outputs.length >= MAX_GENERATED_IMAGE_OUTPUTS) return
    const normalized = normalizeImageOutput(value, outputs.length, { assumeImage, baseUrl })
    if (!normalized) return
    const fingerprint = normalized.dataUrl || normalized.sourceUrl
    if (!fingerprint || fingerprints.has(fingerprint)) return
    fingerprints.add(fingerprint)
    outputs.push(normalized)
  }
  const inspectText = (content, depth) => {
    const text = String(content ?? '').trim()
    if (!text) return
    const patterns = [
      /!\[[^\]]*\]\(\s*(data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/_=-]+|https?:\/\/[^\s)]+)\s*\)/gi,
      /<img\b[^>]*\bsrc=["'](data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/_=-]+|https?:\/\/[^"']+)["'][^>]*>/gi
    ]
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) add(match[1], true)
    }
    if (depth < 6 && ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']')))) {
      try { inspectEnvelope(JSON.parse(text), depth + 1) } catch (_) {}
    }
  }
  const inspectContent = (content, depth) => {
    if (typeof content === 'string') {
      inspectText(content, depth)
      return
    }
    const parts = Array.isArray(content) ? content : content && typeof content === 'object' ? [content] : []
    for (const part of parts) {
      add(part)
      if (typeof part?.text === 'string') inspectText(part.text, depth)
      if (part?.content && part.content !== content) inspectContent(part.content, depth + 1)
    }
  }
  const inspectImageCollection = (collection, depth) => {
    const values = Array.isArray(collection) ? collection : collection === undefined || collection === null ? [] : [collection]
    for (const value of values) {
      add(value, true)
      if (value && typeof value === 'object') inspectEnvelope(value, depth + 1)
    }
  }
  const inspectEnvelope = (value, depth = 0) => {
    if (depth > 6 || value === null || value === undefined) return
    if (typeof value === 'string') {
      inspectText(value, depth)
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) inspectEnvelope(item, depth + 1)
      return
    }
    if (typeof value !== 'object' || inspected.has(value)) return
    inspected.add(value)
    add(value)

    if (Array.isArray(value.data)) inspectImageCollection(value.data, depth)
    else if (value.data && typeof value.data === 'object') inspectEnvelope(value.data, depth + 1)
    for (const key of ['images', 'artifacts', 'predictions']) inspectImageCollection(value[key], depth)

    const output = Array.isArray(value.output) ? value.output : value.output ? [value.output] : []
    for (const item of output) {
      add(item)
      inspectEnvelope(item, depth + 1)
    }
    for (const choice of Array.isArray(value.choices) ? value.choices : []) {
      add(choice?.delta)
      add(choice?.message)
      inspectContent(choice?.delta?.content, depth + 1)
      inspectContent(choice?.message?.content, depth + 1)
      inspectImageCollection(choice?.delta?.images, depth)
      inspectImageCollection(choice?.message?.images, depth)
    }
    for (const candidate of Array.isArray(value.candidates) ? value.candidates : []) {
      inspectContent(candidate?.content?.parts ?? candidate?.content, depth + 1)
      inspectImageCollection(candidate?.images, depth)
    }
    inspectContent(value.content, depth + 1)

    for (const key of ['result', 'response']) {
      const nested = value[key]
      if (nested && typeof nested === 'object') inspectEnvelope(nested, depth + 1)
      else if (typeof nested === 'string' && (/^https?:\/\//i.test(nested) || nested.startsWith('data:image/'))) add(nested, true)
    }
    if (value.image !== undefined) add(value.image, true)
  }

  inspectEnvelope(payload)
  return outputs
}

function bytesToBase64Fallback(bytes) {
  let encoded = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0
    encoded += BASE64_ALPHABET[first >> 2]
    encoded += BASE64_ALPHABET[((first & 3) << 4) | (second >> 4)]
    encoded += index + 1 < bytes.length ? BASE64_ALPHABET[((second & 15) << 2) | (third >> 6)] : '='
    encoded += index + 2 < bytes.length ? BASE64_ALPHABET[third & 63] : '='
  }
  return encoded
}

export function bytesToDataUrl(value, mimeType = 'image/png') {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value ?? 0)
  if (!bytes.length) return ''
  let encoded = ''
  if (typeof globalThis.btoa === 'function') {
    const chunks = []
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
    }
    encoded = globalThis.btoa(chunks.join(''))
  } else {
    encoded = bytesToBase64Fallback(bytes)
  }
  return `data:${normalizedMimeType(mimeType)};base64,${encoded}`
}

export function imageAttachmentSource(attachment) {
  const dataUrl = String(attachment?.dataUrl ?? '')
  if (dataUrl.startsWith('data:image/')) return dataUrl
  const sourceUrl = String(attachment?.sourceUrl ?? '')
  return isHttpImageUrl(sourceUrl) ? sourceUrl : ''
}

export function hasValidImageAttachmentSource(attachment) {
  return Boolean(imageAttachmentSource(attachment))
}

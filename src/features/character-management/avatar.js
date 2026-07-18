import { bytesToDataUrl, decodeDataUrl } from '../character-import/binary.js'
import { readPngChunks } from '../character-import/png/readPngChunks.js'
import { asCharacterManagementError, characterManagementError } from './errors.js'

export const CHARACTER_AVATAR_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 40 * 1024 * 1024,
  maxPngChunks: 2048
})

export const DEFAULT_CHARACTER_AVATAR_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const MIME_TYPE_ALIASES = Object.freeze({
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg'
})

const EXTENSION_BY_MIME_TYPE = Object.freeze({
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
})

function normalizedMimeType(value) {
  const mimeType = String(value ?? '').trim().toLowerCase()
  return MIME_TYPE_ALIASES[mimeType] || mimeType
}

function mergedLimits(overrides = {}) {
  const limits = { ...CHARACTER_AVATAR_LIMITS }
  for (const key of Object.keys(limits)) {
    if (overrides[key] === undefined) continue
    const value = Number(overrides[key])
    if (!Number.isFinite(value) || value < 0) {
      throw characterManagementError('invalid_avatar_limits', `头像限制 ${key} 无效`)
    }
    limits[key] = value
  }
  return limits
}

function hasBytes(bytes, expected, offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value)
}

function readUint16BigEndian(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readUint16LittleEndian(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readUint24LittleEndian(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function readUint32LittleEndian(bytes, offset) {
  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  ) >>> 0
}

function detectedMimeType(bytes) {
  if (hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (hasBytes(bytes, [0xff, 0xd8])) return 'image/jpeg'
  if (hasBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || hasBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif'
  if (hasBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && hasBytes(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  return ''
}

function jpegDimensions(bytes) {
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
  ])
  let offset = 2
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    if (offset >= bytes.length) break
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const length = readUint16BigEndian(bytes, offset)
    if (length < 2 || offset + length > bytes.length) break
    if (startOfFrameMarkers.has(marker)) {
      if (length < 7) break
      return {
        width: readUint16BigEndian(bytes, offset + 5),
        height: readUint16BigEndian(bytes, offset + 3)
      }
    }
    offset += length
  }
  throw characterManagementError('invalid_avatar_image', 'JPEG 头像缺少有效尺寸信息')
}

function gifDimensions(bytes) {
  if (bytes.length < 10) throw characterManagementError('invalid_avatar_image', 'GIF 头像数据已截断')
  return {
    width: readUint16LittleEndian(bytes, 6),
    height: readUint16LittleEndian(bytes, 8)
  }
}

function webpDimensions(bytes) {
  if (bytes.length < 20) throw characterManagementError('invalid_avatar_image', 'WebP 头像数据已截断')
  const declaredSize = readUint32LittleEndian(bytes, 4) + 8
  if (declaredSize > bytes.length) throw characterManagementError('invalid_avatar_image', 'WebP 头像数据已截断')

  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
    const length = readUint32LittleEndian(bytes, offset + 4)
    const dataOffset = offset + 8
    if (dataOffset + length > bytes.length) break
    if (type === 'VP8X' && length >= 10) {
      return {
        width: readUint24LittleEndian(bytes, dataOffset + 4) + 1,
        height: readUint24LittleEndian(bytes, dataOffset + 7) + 1
      }
    }
    if (type === 'VP8L' && length >= 5 && bytes[dataOffset] === 0x2f) {
      return {
        width: 1 + bytes[dataOffset + 1] + ((bytes[dataOffset + 2] & 0x3f) << 8),
        height: 1 + (bytes[dataOffset + 2] >> 6) + (bytes[dataOffset + 3] << 2) + ((bytes[dataOffset + 4] & 0x0f) << 10)
      }
    }
    if (
      type === 'VP8 ' && length >= 10 &&
      hasBytes(bytes, [0x9d, 0x01, 0x2a], dataOffset + 3)
    ) {
      return {
        width: readUint16LittleEndian(bytes, dataOffset + 6) & 0x3fff,
        height: readUint16LittleEndian(bytes, dataOffset + 8) & 0x3fff
      }
    }
    offset = dataOffset + length + (length % 2)
  }
  throw characterManagementError('invalid_avatar_image', 'WebP 头像缺少有效尺寸信息')
}

function imageDimensions(bytes, mimeType, limits) {
  if (mimeType === 'image/png') {
    const parsed = readPngChunks(bytes, { maxChunks: limits.maxPngChunks })
    return { width: parsed.width, height: parsed.height }
  }
  if (mimeType === 'image/jpeg') return jpegDimensions(bytes)
  if (mimeType === 'image/gif') return gifDimensions(bytes)
  if (mimeType === 'image/webp') return webpDimensions(bytes)
  throw characterManagementError('unsupported_avatar_type', '头像仅支持 PNG、JPEG、GIF 或 WebP 图片')
}

function validateDimensions(width, height, limits) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw characterManagementError('invalid_avatar_dimensions', '头像图片尺寸无效')
  }
  if (width > limits.maxWidth || height > limits.maxHeight || width * height > limits.maxPixels) {
    throw characterManagementError(
      'avatar_dimensions_exceeded',
      `头像尺寸不能超过 ${limits.maxWidth} x ${limits.maxHeight}，且总像素不能超过 ${limits.maxPixels}`,
      { details: { width, height, limits } }
    )
  }
}

export function imageExtensionForMimeType(mimeType) {
  return EXTENSION_BY_MIME_TYPE[normalizedMimeType(mimeType)] || 'bin'
}

export function validateCharacterAvatar(input, { limits: limitOverrides = {} } = {}) {
  const dataUrl = typeof input === 'string' ? input : input?.dataUrl
  const sourceName = typeof input === 'object' ? String(input?.name || '').trim() : ''
  if (!dataUrl) throw characterManagementError('missing_avatar_data_url', '头像缺少图片 Data URL')

  const limits = mergedLimits(limitOverrides)
  try {
    const decoded = decodeDataUrl(dataUrl)
    const declaredMimeType = normalizedMimeType(decoded.mimeType)
    const actualMimeType = detectedMimeType(decoded.bytes)
    if (!actualMimeType) throw characterManagementError('invalid_avatar_image', '头像数据不是受支持的图片')
    if (declaredMimeType !== actualMimeType) {
      throw characterManagementError('avatar_mime_mismatch', '头像 Data URL 类型与实际图片格式不一致', {
        details: { declaredMimeType, actualMimeType }
      })
    }
    if (decoded.bytes.byteLength < 1 || decoded.bytes.byteLength > limits.maxBytes) {
      throw characterManagementError('avatar_file_too_large', `头像图片不能超过 ${limits.maxBytes} 字节`)
    }
    const dimensions = imageDimensions(decoded.bytes, actualMimeType, limits)
    validateDimensions(dimensions.width, dimensions.height, limits)
    return {
      dataUrl: bytesToDataUrl(decoded.bytes, actualMimeType),
      bytes: decoded.bytes,
      byteSize: decoded.bytes.byteLength,
      mimeType: actualMimeType,
      extension: imageExtensionForMimeType(actualMimeType),
      width: dimensions.width,
      height: dimensions.height,
      sourceName
    }
  } catch (error) {
    throw asCharacterManagementError(error, {
      code: 'invalid_avatar_data_url',
      message: '头像图片 Data URL 无效'
    })
  }
}

export async function ensurePngCharacterAvatar(input, {
  convertAvatarToPng = null,
  limits = {}
} = {}) {
  const avatar = validateCharacterAvatar(input, { limits })
  if (avatar.mimeType === 'image/png') return avatar
  if (typeof convertAvatarToPng !== 'function') {
    throw characterManagementError(
      'avatar_png_conversion_required',
      '当前头像不是 PNG，导出角色卡前需要由平台图片适配器转换为 PNG',
      { details: { mimeType: avatar.mimeType, width: avatar.width, height: avatar.height } }
    )
  }

  let converted
  try {
    converted = await convertAvatarToPng({ ...avatar })
  } catch (error) {
    throw characterManagementError('avatar_png_conversion_failed', '头像转换为 PNG 失败', { cause: error })
  }
  const png = validateCharacterAvatar(converted, { limits })
  if (png.mimeType !== 'image/png') {
    throw characterManagementError('avatar_png_conversion_failed', '平台图片适配器未返回 PNG Data URL')
  }
  return png
}

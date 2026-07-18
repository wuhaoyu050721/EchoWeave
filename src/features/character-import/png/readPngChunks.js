import { concatBytes, toUint8Array } from '../binary.js'
import { importError } from '../errors.js'
import { CARD_ASSET_KEYWORD_PREFIX, CARD_METADATA_KEYWORDS, CHARACTER_IMPORT_LIMITS } from '../types.js'

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const CRC_TABLE = new Uint32Array(256)

for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  CRC_TABLE[index] = value >>> 0
}

function readUint32(bytes, offset) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  ) >>> 0
}

function crc32(bytes, start, end) {
  let crc = 0xffffffff
  for (let index = start; index < end; index += 1) crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunkType(bytes, offset) {
  let result = ''
  for (let index = 0; index < 4; index += 1) {
    const value = bytes[offset + index]
    if (!((value >= 65 && value <= 90) || (value >= 97 && value <= 122))) {
      throw importError('invalid_png_chunk_type', 'PNG 包含非法 chunk 类型')
    }
    result += String.fromCharCode(value)
  }
  return result
}

function parseTextChunk(data) {
  const separator = data.indexOf(0)
  if (separator < 1 || separator > 79) throw importError('invalid_png_text', 'PNG tEXt chunk 缺少有效关键字分隔符')
  let keyword = ''
  for (let index = 0; index < separator; index += 1) keyword += String.fromCharCode(data[index])
  return { keyword, textBytes: data.subarray(separator + 1) }
}

export function readPngChunks(input, { maxChunks = CHARACTER_IMPORT_LIMITS.maxChunks } = {}) {
  const bytes = toUint8Array(input)
  if (bytes.length < PNG_SIGNATURE.length + 12) throw importError('truncated_png', 'PNG 文件已截断')
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) throw importError('invalid_png_signature', '所选文件不是有效 PNG')
  }

  const chunks = []
  const textChunks = []
  let offset = PNG_SIGNATURE.length
  let sawImageData = false
  let sawEnd = false
  while (offset < bytes.length) {
    if (chunks.length >= maxChunks) throw importError('too_many_png_chunks', `PNG chunk 数量超过 ${maxChunks}`)
    if (offset + 12 > bytes.length) throw importError('truncated_png_chunk', 'PNG chunk 头部已截断')
    const length = readUint32(bytes, offset)
    const end = offset + 12 + length
    if (end > bytes.length || end < offset) throw importError('truncated_png_chunk', 'PNG chunk 数据已截断')
    const type = chunkType(bytes, offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const expectedCrc = readUint32(bytes, dataEnd)
    const actualCrc = crc32(bytes, offset + 4, dataEnd)
    if (actualCrc !== expectedCrc) {
      throw importError('invalid_png_crc', `PNG ${type} chunk 的 CRC 校验失败`, { details: { type, offset } })
    }
    if (!chunks.length && (type !== 'IHDR' || length !== 13)) throw importError('invalid_png_header', 'PNG 必须以 IHDR chunk 开始')
    if (type === 'IDAT') sawImageData = true
    if (type === 'IEND' && length !== 0) throw importError('invalid_png_end', 'PNG IEND chunk 长度无效')

    const chunk = { type, length, data: bytes.subarray(dataStart, dataEnd), start: offset, end, crc: expectedCrc }
    if (type === 'tEXt') {
      Object.assign(chunk, parseTextChunk(chunk.data))
      textChunks.push(chunk)
    }
    chunks.push(chunk)
    offset = end
    if (type === 'IEND') {
      sawEnd = true
      break
    }
  }

  if (!sawImageData) throw importError('missing_png_image', 'PNG 不包含图像数据')
  if (!sawEnd) throw importError('missing_png_end', 'PNG 缺少 IEND chunk')
  if (offset !== bytes.length) throw importError('png_trailing_data', 'PNG IEND 后存在多余数据')

  const header = chunks[0].data
  const width = readUint32(header, 0)
  const height = readUint32(header, 4)
  if (!width || !height) throw importError('invalid_png_dimensions', 'PNG 图像尺寸无效')
  return { bytes, chunks, textChunks, width, height }
}

export function createDisplayPngBytes(parsed) {
  const keptChunks = parsed.chunks.filter(chunk => {
    if (chunk.type !== 'tEXt') return true
    return !CARD_METADATA_KEYWORDS.includes(chunk.keyword) && !chunk.keyword.startsWith(CARD_ASSET_KEYWORD_PREFIX)
  })
  return concatBytes([
    PNG_SIGNATURE,
    ...keptChunks.map(chunk => parsed.bytes.subarray(chunk.start, chunk.end))
  ])
}

export function pngCrc32ForTest(bytes, start = 0, end = toUint8Array(bytes).length) {
  return crc32(toUint8Array(bytes), start, end)
}

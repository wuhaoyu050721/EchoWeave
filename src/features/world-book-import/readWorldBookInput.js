import { encodeUtf8 } from '../../core/text-encoding-polyfill.js'
import { worldBookImportError } from './errors.js'

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (error) {
    throw worldBookImportError('invalid_world_book_utf8', '世界书必须使用有效的 UTF-8 编码', { cause: error })
  }
}

function byteInput(input) {
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  return null
}

export async function readWorldBookInput(input) {
  const directBytes = byteInput(input)
  if (directBytes) {
    return { name: 'world-book.json', text: decodeUtf8(directBytes), bytes: directBytes }
  }
  if (typeof input === 'string') {
    const bytes = encodeUtf8(input)
    return { name: 'world-book.json', text: input, bytes }
  }
  if (typeof input?.nativePrepared?.textContent === 'string') {
    const text = input.nativePrepared.textContent
    return {
      name: String(input.name || 'world-book.json'),
      text,
      bytes: encodeUtf8(text)
    }
  }
  if (typeof input?.arrayBuffer === 'function') {
    const bytes = new Uint8Array(await input.arrayBuffer())
    return {
      name: String(input.name || 'world-book.json'),
      text: decodeUtf8(bytes),
      bytes
    }
  }
  if (typeof input?.text === 'function') {
    const text = await input.text()
    return {
      name: String(input.name || 'world-book.json'),
      text,
      bytes: encodeUtf8(text)
    }
  }
  throw worldBookImportError('invalid_world_book_input', '无法读取所选世界书文件')
}

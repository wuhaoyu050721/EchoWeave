import { runtimeGlobal } from './legacy-runtime-polyfill.js'

function encodeCodePoint(bytes, codePoint) {
  if (codePoint <= 0x7f) {
    bytes.push(codePoint)
  } else if (codePoint <= 0x7ff) {
    bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
  } else if (codePoint <= 0xffff) {
    bytes.push(
      0xe0 | (codePoint >> 12),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f)
    )
  } else {
    bytes.push(
      0xf0 | (codePoint >> 18),
      0x80 | ((codePoint >> 12) & 0x3f),
      0x80 | ((codePoint >> 6) & 0x3f),
      0x80 | (codePoint & 0x3f)
    )
  }
}

export function encodeUtf8(value) {
  const input = String(value ?? '')
  const bytes = []

  for (let index = 0; index < input.length; index += 1) {
    const first = input.charCodeAt(index)
    let codePoint = first

    if (first >= 0xd800 && first <= 0xdbff) {
      const second = input.charCodeAt(index + 1)
      if (second >= 0xdc00 && second <= 0xdfff) {
        codePoint = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00)
        index += 1
      } else {
        codePoint = 0xfffd
      }
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      codePoint = 0xfffd
    }

    encodeCodePoint(bytes, codePoint)
  }

  return Uint8Array.from(bytes)
}

function toUint8Array(input) {
  if (input === undefined || input === null) return new Uint8Array()
  if (input instanceof Uint8Array) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  }
  throw new TypeError('ArrayBuffer or typed array expected')
}

function appendCodePoint(output, codePoint) {
  if (codePoint <= 0xffff) return output + String.fromCharCode(codePoint)
  const adjusted = codePoint - 0x10000
  return output + String.fromCharCode(
    0xd800 + (adjusted >> 10),
    0xdc00 + (adjusted & 0x3ff)
  )
}

function copyBytes(bytes) {
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return copy
}

function joinBytes(first, second) {
  if (!first.length) return second
  if (!second.length) return first
  const joined = new Uint8Array(first.length + second.length)
  joined.set(first)
  joined.set(second, first.length)
  return joined
}

export class Utf8TextEncoder {
  get encoding() {
    return 'utf-8'
  }

  encode(value = '') {
    return encodeUtf8(value)
  }
}

export class Utf8TextDecoder {
  constructor(label = 'utf-8', options = {}) {
    const normalized = String(label || 'utf-8').toLowerCase().replace(/[_\s]/g, '-')
    if (!['utf-8', 'utf8', 'unicode-1-1-utf-8'].includes(normalized)) {
      throw new RangeError(`Unsupported encoding: ${label}`)
    }
    this.encoding = 'utf-8'
    this.fatal = Boolean(options.fatal)
    this.ignoreBOM = Boolean(options.ignoreBOM)
    this.pending = new Uint8Array()
    this.bomHandled = false
  }

  decode(input, options = {}) {
    const stream = Boolean(options.stream)
    const bytes = joinBytes(this.pending, toUint8Array(input))
    this.pending = new Uint8Array()
    let output = ''
    let index = 0

    const invalid = () => {
      if (this.fatal) throw new TypeError('Invalid UTF-8 sequence')
      output += '\ufffd'
    }

    while (index < bytes.length) {
      const first = bytes[index]
      let needed = 0
      let codePoint = 0
      let minimum = 0

      if (first <= 0x7f) {
        codePoint = first
      } else if (first >= 0xc2 && first <= 0xdf) {
        needed = 1
        codePoint = first & 0x1f
        minimum = 0x80
      } else if (first >= 0xe0 && first <= 0xef) {
        needed = 2
        codePoint = first & 0x0f
        minimum = 0x800
      } else if (first >= 0xf0 && first <= 0xf4) {
        needed = 3
        codePoint = first & 0x07
        minimum = 0x10000
      } else {
        invalid()
        index += 1
        continue
      }

      if (index + needed >= bytes.length) {
        if (stream) {
          this.pending = copyBytes(bytes.subarray(index))
        } else {
          invalid()
        }
        index = bytes.length
        break
      }

      let valid = true
      for (let offset = 1; offset <= needed; offset += 1) {
        const continuation = bytes[index + offset]
        if ((continuation & 0xc0) !== 0x80) {
          valid = false
          break
        }
        codePoint = (codePoint << 6) | (continuation & 0x3f)
      }

      if (!valid || codePoint < minimum || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        invalid()
        index += 1
        continue
      }

      if (!this.bomHandled) {
        this.bomHandled = true
        if (codePoint === 0xfeff && !this.ignoreBOM) {
          index += needed + 1
          continue
        }
      }
      output = appendCodePoint(output, codePoint)
      index += needed + 1
    }

    if (!stream) {
      this.pending = new Uint8Array()
      this.bomHandled = false
    }
    return output
  }
}

export function installTextEncodingPolyfill(target = runtimeGlobal) {
  if (typeof target.TextEncoder !== 'function') target.TextEncoder = Utf8TextEncoder
  if (typeof target.TextDecoder !== 'function') target.TextDecoder = Utf8TextDecoder
  return target
}

installTextEncodingPolyfill()

function resolveGlobalScope() {
  if (typeof globalThis === 'object' && globalThis) return globalThis
  if (typeof self === 'object' && self) return self
  if (typeof window === 'object' && window) return window
  if (typeof global === 'object' && global) return global
  try {
    return Function('return this')()
  } catch {
    return {}
  }
}

function defineValue(target, key, value) {
  if (!target) return
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      writable: true,
      value
    })
  } catch {
    target[key] = value
  }
}

function defineMissingMethod(target, key, method) {
  if (!target || typeof target[key] === 'function') return
  defineValue(target, key, method)
}

function toLength(value) {
  const number = Number(value)
  if (!number || number < 0 || Number.isNaN(number)) return 0
  return Math.min(Math.floor(number), Number.MAX_SAFE_INTEGER || 0x1fffffffffffff)
}

function objectEntries(value) {
  const source = Object(value)
  return Object.keys(source).map(key => [key, source[key]])
}

function objectValues(value) {
  const source = Object(value)
  return Object.keys(source).map(key => source[key])
}

function addEntry(target, entry) {
  if (entry === null || (typeof entry !== 'object' && typeof entry !== 'function')) {
    throw new TypeError('Object.fromEntries requires entry objects')
  }
  try {
    Object.defineProperty(target, entry[0], {
      configurable: true,
      enumerable: true,
      writable: true,
      value: entry[1]
    })
  } catch {
    target[entry[0]] = entry[1]
  }
}

function objectFromEntries(iterable) {
  if (iterable === null || iterable === undefined) {
    throw new TypeError('Object.fromEntries requires an iterable')
  }
  const result = {}
  const iteratorMethod = typeof Symbol === 'function' && Symbol.iterator
    ? iterable[Symbol.iterator]
    : null
  if (typeof iteratorMethod === 'function') {
    const iterator = iteratorMethod.call(iterable)
    while (true) {
      const next = iterator.next()
      if (next.done) break
      addEntry(result, next.value)
    }
    return result
  }
  const length = toLength(iterable.length)
  for (let index = 0; index < length; index += 1) addEntry(result, iterable[index])
  return result
}

function arrayIncludes(searchElement, fromIndex = 0) {
  if (this === null || this === undefined) throw new TypeError('Array.includes called on null or undefined')
  const source = Object(this)
  const length = toLength(source.length)
  if (!length) return false
  let index = Number(fromIndex) || 0
  index = index >= 0 ? Math.floor(index) : Math.max(length + Math.ceil(index), 0)
  for (; index < length; index += 1) {
    const value = source[index]
    if (value === searchElement || (value !== value && searchElement !== searchElement)) return true
  }
  return false
}

function arrayFlatMap(callback, thisArg) {
  if (this === null || this === undefined) throw new TypeError('Array.flatMap called on null or undefined')
  if (typeof callback !== 'function') throw new TypeError('Array.flatMap callback must be a function')
  const source = Object(this)
  const length = toLength(source.length)
  const result = []
  for (let index = 0; index < length; index += 1) {
    if (!(index in source)) continue
    const mapped = callback.call(thisArg, source[index], index, source)
    if (!Array.isArray(mapped)) {
      result.push(mapped)
      continue
    }
    for (let childIndex = 0; childIndex < mapped.length; childIndex += 1) {
      if (childIndex in mapped) result.push(mapped[childIndex])
    }
  }
  return result
}

function paddingFor(input, maxLength, fillString) {
  const targetLength = toLength(maxLength)
  const required = targetLength - input.length
  if (required <= 0) return ''
  const filler = fillString === undefined ? ' ' : String(fillString)
  if (!filler) return ''
  let padding = filler
  while (padding.length < required) padding += padding
  return padding.slice(0, required)
}

function stringPadStart(maxLength, fillString) {
  const input = String(this)
  return paddingFor(input, maxLength, fillString) + input
}

function stringPadEnd(maxLength, fillString) {
  const input = String(this)
  return input + paddingFor(input, maxLength, fillString)
}

export function installLegacyRuntimePolyfills(target = resolveGlobalScope()) {
  if (typeof target.globalThis !== 'object' || !target.globalThis) {
    defineValue(target, 'globalThis', target)
  }
  defineMissingMethod(target.Object, 'entries', objectEntries)
  defineMissingMethod(target.Object, 'values', objectValues)
  defineMissingMethod(target.Object, 'fromEntries', objectFromEntries)
  defineMissingMethod(target.Array?.prototype, 'includes', arrayIncludes)
  defineMissingMethod(target.Array?.prototype, 'flatMap', arrayFlatMap)
  defineMissingMethod(target.String?.prototype, 'padStart', stringPadStart)
  defineMissingMethod(target.String?.prototype, 'padEnd', stringPadEnd)
  return target
}

export const runtimeGlobal = resolveGlobalScope()

installLegacyRuntimePolyfills(runtimeGlobal)

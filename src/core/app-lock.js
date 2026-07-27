import { randomBytes } from '@noble/ciphers/utils.js'
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { encodeUtf8 } from './text-encoding-polyfill.js'

const APP_LOCK_VERSION = 1
const APP_LOCK_ITERATIONS = 120000
const PIN_PATTERN = /^\d{4,8}$/

function bytesToBase64(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value) {
  try {
    const binary = atob(String(value || ''))
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  } catch {
    return new Uint8Array()
  }
}

function nativeRandomBytes(byteLength) {
  const registered = globalThis.__aiChatNativeApis?.aiChatSecureRandom
  const nativeRandom = typeof registered === 'function'
    ? registered
    : typeof uni !== 'undefined' && typeof uni.aiChatSecureRandom === 'function'
      ? value => uni.aiChatSecureRandom(value)
      : null
  if (!nativeRandom) return randomBytes(byteLength)
  const bytes = base64ToBytes(nativeRandom(byteLength))
  if (bytes.length !== byteLength) throw new Error('设备安全随机数不可用')
  return bytes
}

function validatePin(pin) {
  const value = String(pin ?? '')
  if (!PIN_PATTERN.test(value)) throw new Error('PIN 必须是 4-8 位数字')
  return value
}

function isValidBase64Bytes(value, byteLength) {
  return typeof value === 'string' && base64ToBytes(value).length === byteLength
}

export function isAppLockRecord(value) {
  return value?.version === APP_LOCK_VERSION &&
    value?.kdf?.name === 'PBKDF2' &&
    value?.kdf?.hash === 'SHA-256' &&
    value?.kdf?.iterations === APP_LOCK_ITERATIONS &&
    isValidBase64Bytes(value?.kdf?.salt, 16) &&
    isValidBase64Bytes(value?.pinHash, 32)
}

async function derivePinHash(pin, salt) {
  return pbkdf2Async(sha256, encodeUtf8(validatePin(pin)), salt, {
    c: APP_LOCK_ITERATIONS,
    dkLen: 32,
    asyncTick: 8
  })
}

export async function createAppLockRecord(pin, { random = nativeRandomBytes } = {}) {
  const normalizedPin = validatePin(pin)
  const salt = random(16)
  if (!(salt instanceof Uint8Array) || salt.length !== 16) throw new Error('应用锁随机盐无效')
  const pinHash = await derivePinHash(normalizedPin, salt)
  return {
    version: APP_LOCK_VERSION,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: APP_LOCK_ITERATIONS,
      salt: bytesToBase64(salt)
    },
    pinHash: bytesToBase64(pinHash)
  }
}

export async function verifyAppLockPin(pin, record) {
  if (!isAppLockRecord(record) || !PIN_PATTERN.test(String(pin ?? ''))) return false
  const expected = base64ToBytes(record.pinHash)
  const actual = await derivePinHash(String(pin), base64ToBytes(record.kdf.salt))
  let difference = expected.length ^ actual.length
  for (let index = 0; index < Math.max(expected.length, actual.length); index += 1) {
    difference |= (expected[index] || 0) ^ (actual[index] || 0)
  }
  actual.fill(0)
  return difference === 0
}

export function normalizeAppLockSetting(value) {
  const record = value?.appLock
  const enabled = Boolean(value?.appLockEnabled && isAppLockRecord(record))
  return { enabled, record: enabled ? record : null }
}

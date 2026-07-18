import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { encodeUtf8 } from './text-encoding-polyfill.js'

const ITERATIONS = 210000
const AAD = encodeUtf8('ai-chat-cloud-backup-v1')

function bytesToBase64(bytes) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function resolveNativeRandom() {
  const registered = globalThis.__aiChatNativeApis?.aiChatSecureRandom
  if (typeof registered === 'function') return registered
  if (typeof uni !== 'undefined' && typeof uni.aiChatSecureRandom === 'function') {
    return byteLength => uni.aiChatSecureRandom(byteLength)
  }
  return null
}

function secureRandomBytes(byteLength) {
  const nativeRandom = resolveNativeRandom()
  if (!nativeRandom) return randomBytes(byteLength)

  const encoded = nativeRandom(byteLength)
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new Error('Native secure random result is invalid')
  }
  const bytes = base64ToBytes(encoded)
  if (bytes.length !== byteLength) {
    throw new Error('Native secure random byte length is invalid')
  }
  return bytes
}

function validatePassword(password) {
  const value = String(password ?? '')
  if (value.length < 12) throw new Error('同步密码至少需要 12 个字符')
  return value
}

function validateEnvelope(envelope) {
  const valid = envelope?.version === 1 &&
    envelope?.kdf?.name === 'PBKDF2' &&
    envelope?.kdf?.hash === 'SHA-256' &&
    envelope?.kdf?.iterations === ITERATIONS &&
    typeof envelope?.kdf?.salt === 'string' && envelope.kdf.salt.length > 0 &&
    envelope?.cipher?.name === 'AES-GCM' &&
    typeof envelope?.cipher?.iv === 'string' && envelope.cipher.iv.length > 0 &&
    typeof envelope?.cipher?.ciphertext === 'string' && envelope.cipher.ciphertext.length > 0
  if (!valid) throw new Error('云端备份加密格式无效')
}

async function deriveKey(password, salt) {
  return pbkdf2Async(sha256, encodeUtf8(password), salt, {
    c: ITERATIONS,
    dkLen: 32,
    asyncTick: 8
  })
}

export async function encryptCloudBackup(payload, password) {
  const normalizedPassword = validatePassword(password)
  const salt = secureRandomBytes(16)
  const iv = secureRandomBytes(12)
  const key = await deriveKey(normalizedPassword, salt)
  try {
    const plaintext = encodeUtf8(JSON.stringify(payload))
    const ciphertext = gcm(key, iv, AAD).encrypt(plaintext)
    return {
      version: 1,
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: ITERATIONS,
        salt: bytesToBase64(salt)
      },
      cipher: {
        name: 'AES-GCM',
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(ciphertext)
      }
    }
  } finally {
    key.fill(0)
  }
}

export async function decryptCloudBackup(envelope, password) {
  validateEnvelope(envelope)
  const normalizedPassword = validatePassword(password)
  const salt = base64ToBytes(envelope.kdf.salt)
  const iv = base64ToBytes(envelope.cipher.iv)
  const ciphertext = base64ToBytes(envelope.cipher.ciphertext)
  const key = await deriveKey(normalizedPassword, salt)
  try {
    const plaintext = gcm(key, iv, AAD).decrypt(ciphertext)
    return JSON.parse(new TextDecoder().decode(plaintext))
  } catch {
    throw new Error('同步密码错误或云端备份无法解密')
  } finally {
    key.fill(0)
  }
}

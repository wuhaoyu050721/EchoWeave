import { gcm } from '@noble/ciphers/aes.js'
import { randomBytes } from '@noble/ciphers/utils.js'
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { encodeUtf8 } from './text-encoding-polyfill.js'
import { canonicalSyncJson, CLOUD_SYNC_PROTOCOL_VERSION } from './cloud-sync-protocol.js'

export const CLOUD_SYNC_KDF_ITERATIONS = 210000

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

function bytesToHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
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
  const bytes = base64ToBytes(nativeRandom(byteLength))
  if (bytes.length !== byteLength) throw new Error('Native secure random byte length is invalid')
  return bytes
}

function normalizePassword(password) {
  const value = String(password ?? '')
  if (value.length < 12) throw new Error('Sync password must contain at least 12 characters')
  return value
}

function validateContext(context) {
  const entityType = String(context?.entityType ?? '')
  const entityId = String(context?.entityId ?? '')
  const operation = String(context?.operation ?? '')
  const updatedAt = Number(context?.updatedAt)
  if (!entityType || !entityId || !['upsert', 'delete'].includes(operation) || !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    throw new Error('Sync encryption context is invalid')
  }
  return { protocolVersion: CLOUD_SYNC_PROTOCOL_VERSION, entityType, entityId, operation, updatedAt }
}

function validateEnvelope(envelope) {
  const valid = envelope?.version === CLOUD_SYNC_PROTOCOL_VERSION &&
    envelope?.kdf?.name === 'PBKDF2' &&
    envelope?.kdf?.hash === 'SHA-256' &&
    envelope?.kdf?.iterations === CLOUD_SYNC_KDF_ITERATIONS &&
    typeof envelope?.kdf?.salt === 'string' && envelope.kdf.salt.length > 0 &&
    envelope?.cipher?.name === 'AES-GCM' &&
    typeof envelope?.cipher?.iv === 'string' && envelope.cipher.iv.length > 0 &&
    typeof envelope?.cipher?.ciphertext === 'string' && envelope.cipher.ciphertext.length > 0
  if (!valid) throw new Error('Encrypted sync record format is invalid')
}

async function deriveKey(password, salt) {
  return pbkdf2Async(sha256, encodeUtf8(password), salt, {
    c: CLOUD_SYNC_KDF_ITERATIONS,
    dkLen: 32,
    asyncTick: 8
  })
}

function additionalData(context) {
  return encodeUtf8(`ai-chat-sync-record-v1\n${canonicalSyncJson(validateContext(context))}`)
}

export function hashSyncValue(value) {
  return bytesToHex(sha256(encodeUtf8(canonicalSyncJson(value))))
}

export async function createCloudSyncCipherSession(password, { salt = '', randomBytesFn = secureRandomBytes } = {}) {
  const normalizedPassword = normalizePassword(password)
  const encryptionSalt = salt || bytesToBase64(randomBytesFn(16))
  const keys = new Map()

  async function keyFor(encodedSalt) {
    if (!keys.has(encodedSalt)) keys.set(encodedSalt, await deriveKey(normalizedPassword, base64ToBytes(encodedSalt)))
    return keys.get(encodedSalt)
  }

  await keyFor(encryptionSalt)

  return {
    salt: encryptionSalt,

    async encrypt(plaintext, context) {
      const iv = randomBytesFn(12)
      const key = await keyFor(encryptionSalt)
      const ciphertext = gcm(key, iv, additionalData(context)).encrypt(encodeUtf8(JSON.stringify(plaintext)))
      return {
        version: CLOUD_SYNC_PROTOCOL_VERSION,
        kdf: {
          name: 'PBKDF2',
          hash: 'SHA-256',
          iterations: CLOUD_SYNC_KDF_ITERATIONS,
          salt: encryptionSalt
        },
        cipher: {
          name: 'AES-GCM',
          iv: bytesToBase64(iv),
          ciphertext: bytesToBase64(ciphertext)
        }
      }
    },

    async decrypt(envelope, context) {
      validateEnvelope(envelope)
      try {
        const key = await keyFor(envelope.kdf.salt)
        const plaintext = gcm(
          key,
          base64ToBytes(envelope.cipher.iv),
          additionalData(context)
        ).decrypt(base64ToBytes(envelope.cipher.ciphertext))
        return JSON.parse(new TextDecoder().decode(plaintext))
      } catch {
        throw new Error('Sync password is incorrect or an encrypted record was tampered with')
      }
    },

    close() {
      for (const key of keys.values()) key.fill(0)
      keys.clear()
    }
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createCloudSyncCipherSession,
  hashSyncValue
} from '../src/core/cloud-sync-crypto.js'
import { createSyncPlaintext } from '../src/core/cloud-sync-protocol.js'

function deterministicRandom() {
  let counter = 0
  return length => {
    counter += 1
    return Uint8Array.from({ length }, (_, index) => (counter * 31 + index) % 256)
  }
}

test('encrypts every sync record in a separate authenticated envelope', async () => {
  const password = 'sync password secret'
  const session = await createCloudSyncCipherSession(password, { randomBytesFn: deterministicRandom() })
  const context = {
    entityType: 'messages',
    entityId: 'message-1',
    operation: 'upsert',
    updatedAt: 1_800_000_000_000
  }
  const plaintext = createSyncPlaintext({ ...context, value: { id: 'message-1', content: 'private text' } })

  const first = await session.encrypt(plaintext, context)
  const second = await session.encrypt(plaintext, context)

  assert.notEqual(first.cipher.iv, second.cipher.iv)
  assert.notEqual(first.cipher.ciphertext, second.cipher.ciphertext)
  assert.equal(JSON.stringify(first).includes('private text'), false)
  assert.deepEqual(await session.decrypt(first, context), plaintext)
  await assert.rejects(
    session.decrypt(first, { ...context, entityId: 'message-2' }),
    /tampered/
  )

  const wrongPassword = await createCloudSyncCipherSession('different password secret', { salt: session.salt })
  await assert.rejects(wrongPassword.decrypt(first, context), /incorrect|tampered/)
  wrongPassword.close()
  session.close()
})

test('hashes equivalent JSON records canonically without exposing the value', () => {
  const left = { z: 1, nested: { b: true, a: 'secret' } }
  const right = { nested: { a: 'secret', b: true }, z: 1 }

  assert.equal(hashSyncValue(left), hashSyncValue(right))
  assert.match(hashSyncValue(left), /^[a-f0-9]{64}$/)
  assert.equal(hashSyncValue(left).includes('secret'), false)
})

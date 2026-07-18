import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptCloudBackup, encryptCloudBackup } from '../src/core/cloud-backup-crypto.js'

const payload = {
  formatVersion: 1,
  providers: [{ id: 'p1', name: '接口' }],
  conversations: [{ id: 'c1', title: '历史记录' }],
  messages: [{ id: 'm1', conversationId: 'c1', content: '你好' }],
  settings: {}
}

test('encrypts and decrypts a versioned cloud backup envelope', async () => {
  const envelope = await encryptCloudBackup(payload, 'a strong sync password')

  assert.equal(envelope.version, 1)
  assert.deepEqual(envelope.kdf, {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: 210000,
    salt: envelope.kdf.salt
  })
  assert.equal(envelope.cipher.name, 'AES-GCM')
  assert.equal(JSON.stringify(envelope).includes('历史记录'), false)
  assert.deepEqual(await decryptCloudBackup(envelope, 'a strong sync password'), payload)
})

test('uses a unique salt and IV for every backup', async () => {
  const first = await encryptCloudBackup(payload, 'a strong sync password')
  const second = await encryptCloudBackup(payload, 'a strong sync password')

  assert.notEqual(first.kdf.salt, second.kdf.salt)
  assert.notEqual(first.cipher.iv, second.cipher.iv)
  assert.notEqual(first.cipher.ciphertext, second.cipher.ciphertext)
})

test('uses the packaged Android secure-random bridge when available', async () => {
  const originalApis = globalThis.__aiChatNativeApis
  const calls = []
  let fill = 0
  globalThis.__aiChatNativeApis = {
    ...originalApis,
    aiChatSecureRandom(byteLength) {
      calls.push(byteLength)
      fill += 1
      return Buffer.alloc(byteLength, fill).toString('base64')
    }
  }

  try {
    const envelope = await encryptCloudBackup(payload, 'a strong sync password')
    assert.deepEqual(calls, [16, 12])
    assert.equal(Buffer.from(envelope.kdf.salt, 'base64').byteLength, 16)
    assert.equal(Buffer.from(envelope.cipher.iv, 'base64').byteLength, 12)
    assert.deepEqual(await decryptCloudBackup(envelope, 'a strong sync password'), payload)
  } finally {
    if (originalApis === undefined) delete globalThis.__aiChatNativeApis
    else globalThis.__aiChatNativeApis = originalApis
  }
})

test('rejects malformed bytes returned by the native secure-random bridge', async () => {
  const originalApis = globalThis.__aiChatNativeApis
  globalThis.__aiChatNativeApis = {
    ...originalApis,
    aiChatSecureRandom: () => 'AA=='
  }

  try {
    await assert.rejects(
      encryptCloudBackup(payload, 'a strong sync password'),
      /Native secure random byte length/
    )
  } finally {
    if (originalApis === undefined) delete globalThis.__aiChatNativeApis
    else globalThis.__aiChatNativeApis = originalApis
  }
})

test('rejects malformed envelopes and a wrong sync password', async () => {
  await assert.rejects(encryptCloudBackup(payload, 'short'), /同步密码/)
  await assert.rejects(decryptCloudBackup({ version: 2 }, 'a strong sync password'), /备份加密格式/)
  const envelope = await encryptCloudBackup(payload, 'a strong sync password')
  await assert.rejects(decryptCloudBackup(envelope, 'the wrong sync password'), /同步密码错误|无法解密/)
})

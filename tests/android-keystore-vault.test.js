import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { AndroidKeystoreVault } from '../src/platform/app/android-keystore-vault.js'

function createNativeApi() {
  let counter = 0
  return {
    aiChatKeystoreReady: () => true,
    aiChatKeystoreEncrypt(value) {
      counter += 1
      return JSON.stringify({
        version: 1,
        algorithm: 'AES-GCM',
        iv: `iv-${counter}`,
        ciphertext: Buffer.from(String(value)).toString('base64')
      })
    },
    aiChatKeystoreDecrypt(recordJson) {
      const record = JSON.parse(recordJson)
      return Buffer.from(record.ciphertext, 'base64').toString()
    }
  }
}

test('initializes and round-trips ciphertext through the native bridge', async () => {
  const vault = new AndroidKeystoreVault({ nativeApi: createNativeApi() })
  await vault.init()
  const first = await vault.encryptString('你好 Android')
  const second = await vault.encryptString('你好 Android')

  assert.equal(first.algorithm, 'AES-GCM')
  assert.notEqual(first.iv, second.iv)
  assert.equal(await vault.decryptString(first), '你好 Android')
})

test('rejects missing APIs and malformed native ciphertext', async () => {
  await assert.rejects(new AndroidKeystoreVault({ nativeApi: {} }).init(), /Keystore/)

  const vault = new AndroidKeystoreVault({
    nativeApi: {
      aiChatKeystoreReady: () => true,
      aiChatKeystoreEncrypt: () => '{"version":2}',
      aiChatKeystoreDecrypt: () => ''
    }
  })
  await vault.init()
  await assert.rejects(vault.encryptString('bad'), /密文格式/)
  assert.equal(await vault.decryptString(null), '')
})

test('UTS source uses AndroidKeyStore AES-GCM and native secure randomness', async () => {
  const [source, interfaceSource, packageSource, mainSource] = await Promise.all([
    readFile(new URL('../uni_modules/ai-chat-keystore/utssdk/app-android/index.uts', import.meta.url), 'utf8'),
    readFile(new URL('../uni_modules/ai-chat-keystore/utssdk/interface.uts', import.meta.url), 'utf8'),
    readFile(new URL('../uni_modules/ai-chat-keystore/package.json', import.meta.url), 'utf8'),
    readFile(new URL('../main.js', import.meta.url), 'utf8')
  ])

  assert.match(source, /AndroidKeyStore/)
  assert.match(source, /KeyGenParameterSpec/)
  assert.match(source, /AES\/GCM\/NoPadding/)
  assert.match(source, /getIV\(\)/)
  assert.match(source, /GCM_TAG_BITS\s*:\s*Int\s*=\s*128/)
  assert.match(source, /\.setBlockModes\(KeyProperties\.BLOCK_MODE_GCM\)/)
  assert.match(source, /\.setEncryptionPaddings\(KeyProperties\.ENCRYPTION_PADDING_NONE\)/)
  assert.match(source, /import JSONObject from 'org\.json\.JSONObject'/)
  assert.match(source, /new JSONObject\(recordJson\)/)
  assert.match(source, /import SecureRandom from 'java\.security\.SecureRandom'/)
  assert.match(source, /new SecureRandom\(\)/)
  assert.match(source, /random\.nextBytes\(bytes\)/)
  assert.doesNotMatch(source, /JSON\.parse\(recordJson\) as CipherRecord/)
  assert.doesNotMatch(source, /SecretKeySpec|hardcoded|0123456789abcdef/)
  for (const api of ['aiChatKeystoreReady', 'aiChatKeystoreEncrypt', 'aiChatKeystoreDecrypt', 'aiChatSecureRandom']) {
    assert.match(packageSource, new RegExp(api))
    assert.match(interfaceSource, new RegExp(api))
    assert.match(mainSource, new RegExp(api))
  }
})

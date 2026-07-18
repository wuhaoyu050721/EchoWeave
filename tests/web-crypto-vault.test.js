import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbRepository } from '../src/platform/browser/indexeddb-repository.js'
import { WebCryptoVault } from '../src/platform/browser/web-crypto-vault.js'

async function createVault() {
  const repository = new IndexedDbRepository({
    indexedDB: new IDBFactory(),
    databaseName: `vault-${webcrypto.randomUUID()}`
  })
  await repository.init()
  const vault = new WebCryptoVault({ repository, crypto: webcrypto })
  await vault.init()
  return { repository, vault }
}

test('encrypts Unicode without storing plaintext and decrypts it', async () => {
  const { vault } = await createVault()
  const plaintext = 'sk-test-不要明文保存'
  const encrypted = await vault.encryptString(plaintext)

  assert.equal(JSON.stringify(encrypted).includes(plaintext), false)
  assert.equal(await vault.decryptString(encrypted), plaintext)
})

test('uses a unique IV for every encryption', async () => {
  const { vault } = await createVault()
  const first = await vault.encryptString('same')
  const second = await vault.encryptString('same')

  assert.notEqual(first.iv, second.iv)
  assert.notEqual(first.ciphertext, second.ciphertext)
})

test('reuses the persisted non-extractable device key', async () => {
  const { repository, vault } = await createVault()
  const encrypted = await vault.encryptString('persistent')
  const nextVault = new WebCryptoVault({ repository, crypto: webcrypto })
  await nextVault.init()

  assert.equal(await nextVault.decryptString(encrypted), 'persistent')
  const key = await repository.getSecret('device-aes-gcm-key')
  assert.equal(key.extractable, false)
})

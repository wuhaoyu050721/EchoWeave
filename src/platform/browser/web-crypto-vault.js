function bytesToBase64(bytes) {
  let binary = ''
  for (const value of bytes) {
    binary += String.fromCharCode(value)
  }
  return btoa(binary)
}

function base64ToBytes(value) {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export class WebCryptoVault {
  constructor({ repository, crypto = globalThis.crypto } = {}) {
    if (!repository || !crypto?.subtle) {
      throw new Error('WebCryptoVault 需要仓储和 Web Crypto 支持')
    }
    this.repository = repository
    this.crypto = crypto
    this.key = null
  }

  async init() {
    this.key = await this.repository.getSecret('device-aes-gcm-key')
    if (!this.key) {
      this.key = await this.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      )
      await this.repository.setSecret('device-aes-gcm-key', this.key)
    }
    return this
  }

  async encryptString(value) {
    if (!this.key) {
      throw new Error('加密仓库尚未初始化')
    }
    const iv = this.crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(String(value ?? ''))
    const ciphertext = await this.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, plaintext)
    return {
      version: 1,
      algorithm: 'AES-GCM',
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext))
    }
  }

  async decryptString(record) {
    if (!record) {
      return ''
    }
    if (!this.key) {
      throw new Error('加密仓库尚未初始化')
    }
    if (record.version !== 1 || record.algorithm !== 'AES-GCM') {
      throw new Error('不支持的本地密文格式')
    }
    const plaintext = await this.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
      this.key,
      base64ToBytes(record.ciphertext)
    )
    return new TextDecoder().decode(plaintext)
  }
}

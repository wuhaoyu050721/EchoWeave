const REQUIRED_APIS = [
  'aiChatKeystoreReady',
  'aiChatKeystoreEncrypt',
  'aiChatKeystoreDecrypt'
]

function isCipherRecord(record) {
  return Boolean(
    record &&
    record.version === 1 &&
    record.algorithm === 'AES-GCM' &&
    typeof record.iv === 'string' &&
    record.iv.length > 0 &&
    typeof record.ciphertext === 'string' &&
    record.ciphertext.length > 0
  )
}

function parseCipherRecord(value) {
  let record = value
  if (typeof value === 'string') {
    try {
      record = JSON.parse(value)
    } catch {
      throw new Error('Keystore 密文格式无效')
    }
  }

  if (!isCipherRecord(record)) {
    throw new Error('Keystore 密文格式无效')
  }
  return record
}

export class AndroidKeystoreVault {
  constructor({ nativeApi }) {
    this.nativeApi = nativeApi
    this.initialized = false
  }

  async init() {
    const missingApi = REQUIRED_APIS.find(name => typeof this.nativeApi?.[name] !== 'function')
    if (missingApi) {
      throw new Error(`Android Keystore 接口不可用: ${missingApi}`)
    }
    if (this.nativeApi.aiChatKeystoreReady() !== true) {
      throw new Error('Android Keystore 初始化失败')
    }
    this.initialized = true
  }

  async encryptString(value) {
    this.#assertInitialized()
    return parseCipherRecord(this.nativeApi.aiChatKeystoreEncrypt(String(value)))
  }

  async decryptString(record) {
    if (record == null) return ''
    this.#assertInitialized()
    const plaintext = this.nativeApi.aiChatKeystoreDecrypt(JSON.stringify(parseCipherRecord(record)))
    if (typeof plaintext !== 'string') {
      throw new Error('Android Keystore 解密结果无效')
    }
    return plaintext
  }

  #assertInitialized() {
    if (!this.initialized) {
      throw new Error('Android Keystore 尚未初始化')
    }
  }
}

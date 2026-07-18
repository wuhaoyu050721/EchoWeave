const SYNC_PASSWORD_KEY = 'cloud-sync-password'

export class CloudSyncCredentialStore {
  constructor({ repository, vault } = {}) {
    if (!repository?.getSecret || !repository?.setSecret || !vault?.encryptString || !vault?.decryptString) {
      throw new Error('CloudSyncCredentialStore 需要 repository 和 vault')
    }
    this.repository = repository
    this.vault = vault
  }

  async load() {
    const encrypted = await this.repository.getSecret(SYNC_PASSWORD_KEY)
    return encrypted ? this.vault.decryptString(encrypted) : ''
  }

  async save(password, { allowReplace = false } = {}) {
    const value = String(password ?? '')
    if (value.length < 12) throw new Error('同步密码至少需要 12 个字符')
    const existing = await this.load()
    if (existing && existing !== value && !allowReplace) {
      const error = new Error('当前版本不支持直接更换增量同步密码，请继续使用原密码')
      error.code = 'sync_password_change_unsupported'
      throw error
    }
    await this.repository.setSecret(SYNC_PASSWORD_KEY, await this.vault.encryptString(value))
  }

  async clear() {
    await this.repository.setSecret(SYNC_PASSWORD_KEY, null)
  }
}

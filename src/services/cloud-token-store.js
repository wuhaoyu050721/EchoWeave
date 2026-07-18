const SESSION_KEY = 'cloud-auth-session'

export class CloudTokenStore {
  constructor({ repository, vault } = {}) {
    if (!repository?.getSecret || !repository?.setSecret || !vault?.encryptString || !vault?.decryptString) {
      throw new Error('CloudTokenStore 需要 repository 和 vault')
    }
    this.repository = repository
    this.vault = vault
  }

  async load() {
    const encrypted = await this.repository.getSecret(SESSION_KEY)
    if (!encrypted) return null
    return JSON.parse(await this.vault.decryptString(encrypted))
  }

  async save(session) {
    const encrypted = await this.vault.encryptString(JSON.stringify(session))
    await this.repository.setSecret(SESSION_KEY, encrypted)
    return session
  }

  async clear() {
    await this.repository.setSecret(SESSION_KEY, null)
  }
}

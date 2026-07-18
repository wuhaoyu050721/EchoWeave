export const CLOUD_SYNC_STATE_VERSION = 1

function emptyState() {
  return {
    version: CLOUD_SYNC_STATE_VERSION,
    cursor: 0,
    encryptionSalt: '',
    manifest: {},
    pending: []
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function scopeKey(accountId) {
  const scope = String(accountId ?? '').trim()
  if (!scope || scope.length > 128) throw new Error('Cloud sync account id is invalid')
  return `cloud-sync-state-v1:${encodeURIComponent(scope)}`
}

function normalizeState(value) {
  if (!value) return emptyState()
  if (value.version !== CLOUD_SYNC_STATE_VERSION || !Number.isSafeInteger(value.cursor) || value.cursor < 0) {
    throw new Error('Stored cloud sync state is invalid')
  }
  if (!value.manifest || typeof value.manifest !== 'object' || Array.isArray(value.manifest) || !Array.isArray(value.pending)) {
    throw new Error('Stored cloud sync state is invalid')
  }
  return {
    version: CLOUD_SYNC_STATE_VERSION,
    cursor: value.cursor,
    encryptionSalt: String(value.encryptionSalt ?? ''),
    manifest: clone(value.manifest),
    pending: clone(value.pending)
  }
}

export class CloudSyncStateStore {
  constructor({ repository } = {}) {
    if (!repository?.getSecret || !repository?.setSecret) {
      throw new Error('CloudSyncStateStore requires repository secret storage')
    }
    this.repository = repository
  }

  async load(accountId) {
    return normalizeState(await this.repository.getSecret(scopeKey(accountId)))
  }

  async save(accountId, state) {
    const normalized = normalizeState(state)
    await this.repository.setSecret(scopeKey(accountId), normalized)
    return normalized
  }

  async clear(accountId) {
    await this.repository.setSecret(scopeKey(accountId), null)
  }
}

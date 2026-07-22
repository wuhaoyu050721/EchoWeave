import { normalizeCloudBaseUrl, resolveCloudRequestBaseUrl } from '../core/cloud-base-url.js'

function parseResponse(response) {
  if (!response?.text) return null
  try {
    return JSON.parse(response.text)
  } catch {
    throw new Error('云端服务返回了无效 JSON')
  }
}

function normalizeJsonExportBackup(backup) {
  if (!backup || typeof backup !== 'object') return backup
  if ([1, 2, 3].includes(Number(backup.formatVersion))) return backup
  if ([1, 2, 3].includes(Number(backup.cloudFormatVersion))) {
    const { cloudFormatVersion, ...rest } = backup
    return { formatVersion: Number(cloudFormatVersion), ...rest }
  }
  if (Array.isArray(backup.characters) || Array.isArray(backup.worldBooks) || Array.isArray(backup.characterAssets)) {
    return { formatVersion: 3, ...backup }
  }
  if (Array.isArray(backup.attachments)) return { formatVersion: 2, ...backup }
  return { formatVersion: 1, ...backup }
}

const tokenStoreMutationQueues = new WeakMap()

function enqueueTokenStoreMutation(tokenStore, operation) {
  const previous = tokenStoreMutationQueues.get(tokenStore) ?? Promise.resolve()
  const result = previous.catch(() => {}).then(operation)
  tokenStoreMutationQueues.set(tokenStore, result.catch(() => {}))
  return result
}

function sessionAccountScope(session) {
  const baseUrl = normalizeCloudBaseUrl(session?.cloud_base_url)
  const accountId = String(session?.user?.id ?? '').trim()
  return baseUrl && accountId ? `${baseUrl}\n${accountId}` : ''
}

function sameSession(left, right) {
  if (!left || !right || sessionAccountScope(left) !== sessionAccountScope(right)) return false
  const leftToken = String(left.refresh_token || left.access_token || '')
  const rightToken = String(right.refresh_token || right.access_token || '')
  return Boolean(leftToken) && leftToken === rightToken
}

function sessionChangedError() {
  const error = new Error('Cloud account session changed while the request was running')
  error.code = 'cloud_session_changed'
  return error
}

function saveSession(tokenStore, session) {
  return enqueueTokenStoreMutation(tokenStore, () => tokenStore.save(session))
}

function replaceSessionIfCurrent(tokenStore, expected, replacement) {
  return enqueueTokenStoreMutation(tokenStore, async () => {
    const current = await tokenStore.load()
    if (!sameSession(current, expected)) return false
    await tokenStore.save(replacement)
    return true
  })
}

function clearSessionIfCurrent(tokenStore, expected) {
  return enqueueTokenStoreMutation(tokenStore, async () => {
    const current = await tokenStore.load()
    if (!sameSession(current, expected)) return false
    await tokenStore.clear()
    return true
  })
}

export class CloudApiClient {
  constructor({ baseUrl, transport, tokenStore } = {}) {
    if (!transport?.request) throw new Error('CloudApiClient 需要 HTTP transport')
    if (!tokenStore?.load || !tokenStore?.save || !tokenStore?.clear) {
      throw new Error('CloudApiClient 需要 tokenStore')
    }
    this.baseUrl = normalizeCloudBaseUrl(baseUrl)
    if (!/^https?:\/\//i.test(this.baseUrl)) throw new Error('云端服务地址无效')
    this.requestBaseUrl = resolveCloudRequestBaseUrl(this.baseUrl)
    this.transport = transport
    this.tokenStore = tokenStore
    this.boundAccountScope = ''
    this.refreshFlight = null
  }

  async register(credentials) {
    const session = await this.#request('/api/v1/auth/register', { method: 'POST', body: credentials })
    const scopedSession = { ...session, cloud_base_url: this.baseUrl }
    this.#assertSessionScope(scopedSession)
    await saveSession(this.tokenStore, scopedSession)
    return scopedSession
  }

  async login(credentials) {
    const session = await this.#request('/api/v1/auth/login', { method: 'POST', body: credentials })
    const scopedSession = { ...session, cloud_base_url: this.baseUrl }
    this.#assertSessionScope(scopedSession)
    await saveSession(this.tokenStore, scopedSession)
    return scopedSession
  }

  async updateUsername(username) {
    const result = await this.#request('/api/v1/profile', {
      method: 'PUT',
      body: { username },
      auth: true
    })
    const session = await this.tokenStore.load()
    this.#assertSessionScope(session)
    const nextSession = { ...session, user: result.user }
    if (!await replaceSessionIfCurrent(this.tokenStore, session, nextSession)) throw sessionChangedError()
    return nextSession
  }

  async logout() {
    const session = await this.tokenStore.load()
    try {
      if (session?.access_token) {
        await this.#request('/api/v1/auth/logout', {
          method: 'POST',
          body: { refresh_token: session.refresh_token || '' },
          auth: true,
          retry: false
        })
      }
    } finally {
      if (session) await clearSessionIfCurrent(this.tokenStore, session)
    }
  }

  async uploadBackup({ deviceId, envelope }) {
    const result = await this.#request('/api/v1/backup', {
      method: 'PUT',
      body: { device_id: deviceId, envelope },
      auth: true
    })
    return result.backup
  }

  async getBackupMetadata() {
    const result = await this.#request('/api/v1/backup/meta', { auth: true })
    return result.backup
  }

  async downloadBackup() {
    const result = await this.#request('/api/v1/backup', { auth: true })
    return result.envelope
  }

  async deleteBackup() {
    await this.#request('/api/v1/backup', { method: 'DELETE', auth: true })
  }

  async pushSyncBatch({ protocolVersion = 1, deviceId, mutations } = {}) {
    return this.#request('/api/v1/sync/push', {
      method: 'POST',
      body: {
        protocol_version: protocolVersion,
        device_id: deviceId,
        mutations
      },
      auth: true
    })
  }

  async pullSyncPage({ protocolVersion = 1, cursor = 0, limit = 100 } = {}) {
    return this.#request('/api/v1/sync/pull', {
      method: 'POST',
      body: {
        protocol_version: protocolVersion,
        cursor,
        limit
      },
      auth: true
    })
  }

  async uploadJsonExport(backup) {
    const normalizedBackup = normalizeJsonExportBackup(backup)
    const result = await this.#request('/api/v1/json-exports', {
      method: 'POST',
      body: { backup: normalizedBackup },
      auth: true
    })
    const downloadUrl = String(result?.export?.download_url ?? '').trim()
    this.#jsonExportPath(downloadUrl)
    return { ...result.export, download_url: downloadUrl }
  }

  async downloadJsonExport(downloadUrl) {
    return this.#request(this.#jsonExportPath(downloadUrl))
  }

  #refresh(session) {
    const key = `${sessionAccountScope(session)}\n${String(session?.refresh_token ?? '')}`
    if (this.refreshFlight?.key === key) return this.refreshFlight.promise
    const promise = this.#performRefresh(session).finally(() => {
      if (this.refreshFlight?.promise === promise) this.refreshFlight = null
    })
    this.refreshFlight = { key, promise }
    return promise
  }

  async #performRefresh(session) {
    try {
      const refreshed = await this.#request('/api/v1/auth/refresh', {
        method: 'POST',
        body: { refresh_token: session.refresh_token },
        retry: false
      })
      const nextSession = { ...session, ...refreshed }
      this.#assertSessionScope(nextSession)
      if (!await replaceSessionIfCurrent(this.tokenStore, session, nextSession)) throw sessionChangedError()
      return nextSession
    } catch (error) {
      if (error?.code !== 'cloud_session_changed') {
        await clearSessionIfCurrent(this.tokenStore, session)
      }
      throw error
    }
  }

  async #request(path, { method = 'GET', body, auth = false, retry = true, authSession = null } = {}) {
    const session = auth ? (authSession || await this.tokenStore.load()) : null
    if (auth && session?.access_token) this.#assertSessionScope(session)
    if (auth && !session?.access_token) throw new Error('请先登录云端账号')
    if (
      auth &&
      session?.cloud_base_url &&
      normalizeCloudBaseUrl(session.cloud_base_url) !== normalizeCloudBaseUrl(this.baseUrl)
    ) {
      const error = new Error('当前登录会话属于其他云端服务器，请先退出登录')
      error.code = 'cloud_session_server_mismatch'
      throw error
    }
    const headers = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`

    try {
      const response = await this.transport.request({
        url: `${this.requestBaseUrl}${path}`,
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      return parseResponse(response)
    } catch (error) {
      if (auth && retry && error?.status === 401 && session?.refresh_token) {
        const current = await this.tokenStore.load()
        if (sessionAccountScope(current) !== sessionAccountScope(session)) throw sessionChangedError()
        const nextSession = sameSession(current, session) ? await this.#refresh(session) : current
        return this.#request(path, { method, body, auth: true, retry: false, authSession: nextSession })
      }
      if (error?.status === 413) {
        if (path.startsWith('/api/v1/sync')) {
          const mappedError = new Error('Sync batch exceeds the server size limit')
          mappedError.name = 'CloudApiError'
          mappedError.status = 413
          mappedError.code = 'sync_batch_too_large'
          mappedError.cause = error
          throw mappedError
        }
        const isJsonExport = path.startsWith('/api/v1/json-exports')
        const mappedError = new Error(isJsonExport ? '云端 JSON 超过 100 MB 上限' : '云端备份超过 100 MB 上限')
        mappedError.name = 'CloudApiError'
        mappedError.status = 413
        mappedError.code = isJsonExport ? 'json_export_too_large' : 'backup_too_large'
        mappedError.cause = error
        throw mappedError
      }
      throw error
    }
  }

  #assertSessionScope(session) {
    const scope = sessionAccountScope(session)
    if (!scope) {
      const error = new Error('Cloud session is missing its server or immutable account id')
      error.code = 'cloud_session_scope_missing'
      throw error
    }
    if (normalizeCloudBaseUrl(session.cloud_base_url) !== normalizeCloudBaseUrl(this.baseUrl)) {
      const error = new Error('Cloud session belongs to another server')
      error.code = 'cloud_session_server_mismatch'
      throw error
    }
    if (this.boundAccountScope && this.boundAccountScope !== scope) throw sessionChangedError()
    this.boundAccountScope = scope
    return scope
  }

  #jsonExportPath(downloadUrl) {
    const value = String(downloadUrl ?? '').trim()
    const marker = '/api/v1/json-exports/'
    const markerIndex = value.indexOf(marker)
    const linkBaseUrl = markerIndex > 0 ? value.slice(0, markerIndex) : ''
    if (resolveCloudRequestBaseUrl(linkBaseUrl) !== this.requestBaseUrl) {
      throw new Error('请输入当前云端服务器生成的 JSON 链接')
    }
    const token = value.slice(markerIndex + marker.length)
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('云端 JSON 链接无效')
    return `/api/v1/json-exports/${token}`
  }
}

import assert from 'node:assert/strict'
import test from 'node:test'
import { ModelHttpError } from '../src/core/model-http-error.js'
import { CloudApiClient } from '../src/services/cloud-api-client.js'

function createTokenStore(initial = null) {
  let session = initial
  return {
    load: async () => session,
    save: async value => { session = value },
    clear: async () => { session = null },
    current: () => session
  }
}

function createSession(tokens = {}, user = { id: 1, email: 'user@example.com' }) {
  return {
    user,
    cloud_base_url: 'https://cloud.example.com',
    ...tokens
  }
}

function createTransport(handler) {
  const calls = []
  return {
    calls,
    async request(options) {
      calls.push(options)
      return handler(options, calls.length)
    }
  }
}

test('registers, stores the session, and builds versioned API URLs', async () => {
  const tokenStore = createTokenStore()
  const transport = createTransport(async () => ({
    status: 201,
    headers: {},
    text: JSON.stringify({ user: { id: 1 }, access_token: 'access', refresh_token: 'refresh' })
  }))
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com/', transport, tokenStore })

  const session = await client.register({ email: 'user@example.com', password: 'long password' })

  assert.equal(transport.calls[0].url, 'https://cloud.example.com/api/v1/auth/register')
  assert.equal(transport.calls[0].method, 'POST')
  assert.deepEqual(JSON.parse(transport.calls[0].body), { email: 'user@example.com', password: 'long password' })
  assert.equal(tokenStore.current(), session)
})

test('uses canonical HTTPS for a legacy server without changing its stored account scope', async () => {
  const legacyBaseUrl = 'http://118.145.98.165:8018'
  const tokenStore = createTokenStore()
  const transport = createTransport(async () => ({
    status: 200,
    headers: {},
    text: JSON.stringify({ user: { id: 1 }, access_token: 'access', refresh_token: 'refresh' })
  }))
  const client = new CloudApiClient({ baseUrl: legacyBaseUrl, transport, tokenStore })

  const session = await client.login({ email: 'user@example.com', password: 'long password' })

  assert.equal(client.baseUrl, legacyBaseUrl)
  assert.equal(transport.calls[0].url, 'https://www.surtr.cn:8018/api/v1/auth/login')
  assert.equal(session.cloud_base_url, legacyBaseUrl)
})

test('uploads and downloads backups with bearer authorization', async () => {
  const tokenStore = createTokenStore(createSession({ access_token: 'access', refresh_token: 'refresh' }))
  const transport = createTransport(async options => ({
    status: 200,
    headers: {},
    text: options.method === 'GET' ? JSON.stringify({ envelope: { version: 1 } }) : JSON.stringify({ backup: { version: 1 } })
  }))
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  await client.uploadBackup({ deviceId: 'device-a', envelope: { version: 1 } })
  assert.deepEqual(await client.downloadBackup(), { version: 1 })

  assert.equal(transport.calls[0].headers.Authorization, 'Bearer access')
  assert.deepEqual(JSON.parse(transport.calls[0].body), { device_id: 'device-a', envelope: { version: 1 } })
})

test('updates the username and persists it in the encrypted session store', async () => {
  const initial = {
    user: { id: 1, email: 'user@example.com', username: 'Old name' },
    cloud_base_url: 'https://cloud.example.com',
    access_token: 'access',
    refresh_token: 'refresh'
  }
  const tokenStore = createTokenStore(initial)
  const transport = createTransport(async () => ({
    status: 200,
    headers: {},
    text: JSON.stringify({ user: { id: 1, email: 'user@example.com', username: '新用户名' } })
  }))
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  const session = await client.updateUsername('新用户名')

  assert.equal(transport.calls[0].url, 'https://cloud.example.com/api/v1/profile')
  assert.equal(transport.calls[0].method, 'PUT')
  assert.equal(transport.calls[0].headers.Authorization, 'Bearer access')
  assert.deepEqual(JSON.parse(transport.calls[0].body), { username: '新用户名' })
  assert.equal(session.user.username, '新用户名')
  assert.equal(tokenStore.current(), session)
})

test('maps HTTP 413 to a clear backup size error', async () => {
  const tokenStore = createTokenStore(createSession({ access_token: 'access', refresh_token: 'refresh' }))
  const transport = createTransport(async () => {
    throw new ModelHttpError('Payload Too Large', { status: 413, code: 'http_error' })
  })
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  await assert.rejects(
    client.uploadBackup({ deviceId: 'device-a', envelope: { version: 1 } }),
    error => {
      assert.equal(error.code, 'backup_too_large')
      assert.equal(error.message, '云端备份超过 100 MB 上限')
      return true
    }
  )
})

test('uploads a JSON export and downloads it from the returned public link', async () => {
  const token = 'a'.repeat(43)
  const downloadUrl = `https://cloud.example.com/api/v1/json-exports/${token}`
  const backup = { formatVersion: 2, providers: [], conversations: [], messages: [], attachments: [], settings: {} }
  const tokenStore = createTokenStore(createSession({ access_token: 'access', refresh_token: 'refresh' }))
  const transport = createTransport(async options => ({
    status: options.method === 'POST' ? 201 : 200,
    headers: {},
    text: options.method === 'POST'
      ? JSON.stringify({ export: { download_url: downloadUrl, byte_size: 128 } })
      : JSON.stringify(backup)
  }))
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  const uploaded = await client.uploadJsonExport(backup)
  const downloaded = await client.downloadJsonExport(uploaded.download_url)

  assert.equal(uploaded.download_url, downloadUrl)
  assert.deepEqual(downloaded, backup)
  assert.equal(transport.calls[0].method, 'POST')
  assert.equal(transport.calls[0].headers.Authorization, 'Bearer access')
  assert.deepEqual(JSON.parse(transport.calls[0].body), { backup })
  assert.equal(transport.calls[1].url, downloadUrl)
  assert.equal(transport.calls[1].headers.Authorization, undefined)
})

test('normalizes JSON exports that are missing formatVersion before upload', async () => {
  const tokenStore = createTokenStore(createSession({ access_token: 'access', refresh_token: 'refresh' }))
  const transport = createTransport(async options => ({
    status: 201,
    headers: {},
    text: JSON.stringify({ export: { download_url: 'https://cloud.example.com/api/v1/json-exports/' + 'b'.repeat(43), byte_size: 128 } })
  }))
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })
  const backup = { providers: [], conversations: [], messages: [], attachments: [], settings: {} }

  await client.uploadJsonExport(backup)

  const sent = JSON.parse(transport.calls[0].body).backup
  assert.equal(sent.formatVersion, 2)
  assert.deepEqual(sent.attachments, [])
})

test('infers JSON backup format 4 when group conversation fields are present', async () => {
  const tokenStore = createTokenStore(createSession({ access_token: 'access', refresh_token: 'refresh' }))
  const transport = createTransport(async () => ({
    status: 201,
    headers: {},
    text: JSON.stringify({ export: { download_url: 'https://cloud.example.com/api/v1/json-exports/' + 'g'.repeat(43), byte_size: 128 } })
  }))
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  await client.uploadJsonExport({
    providers: [],
    conversations: [{ id: 'group-1', conversationKind: 'group', participants: [] }],
    messages: [],
    attachments: [],
    characters: [],
    worldBooks: [],
    characterAssets: [],
    settings: {}
  })

  assert.equal(JSON.parse(transport.calls[0].body).backup.formatVersion, 4)
})

test('infers JSON backup format 5 when provider group members are present', async () => {
  const tokenStore = createTokenStore(createSession({ access_token: 'access', refresh_token: 'refresh' }))
  const transport = createTransport(async () => ({
    status: 201,
    headers: {},
    text: JSON.stringify({ export: { download_url: 'https://cloud.example.com/api/v1/json-exports/' + 'p'.repeat(43), byte_size: 128 } })
  }))
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  await client.uploadJsonExport({
    providers: [{ id: 'provider-1' }],
    conversations: [{
      id: 'group-1',
      conversationKind: 'group',
      participants: [{ memberKind: 'provider', providerProfileId: 'provider-1' }]
    }],
    messages: [],
    attachments: [],
    characters: [],
    worldBooks: [],
    characterAssets: [],
    settings: {}
  })

  assert.equal(JSON.parse(transport.calls[0].body).backup.formatVersion, 5)
})

test('rejects malformed or foreign JSON export links before requesting them', async () => {
  const tokenStore = createTokenStore()
  const transport = createTransport(async () => {
    throw new Error('transport should not be called')
  })
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  await assert.rejects(client.downloadJsonExport('https://other.example.com/api/v1/json-exports/' + 'a'.repeat(43)), /当前云端服务器/)
  await assert.rejects(client.downloadJsonExport('https://cloud.example.com/api/v1/json-exports/short'), /链接无效/)
  assert.equal(transport.calls.length, 0)
})

test('accepts legacy EchoWeave JSON links and downloads them over canonical HTTPS', async () => {
  const token = 'c'.repeat(43)
  const backup = { formatVersion: 3, providers: [], conversations: [], messages: [], attachments: [], settings: {} }
  const tokenStore = createTokenStore()
  const transport = createTransport(async () => ({
    status: 200,
    headers: {},
    text: JSON.stringify(backup)
  }))
  const client = new CloudApiClient({ baseUrl: 'https://www.surtr.cn:8018', transport, tokenStore })

  const downloaded = await client.downloadJsonExport(`http://118.145.98.165:8018/api/v1/json-exports/${token}`)

  assert.deepEqual(downloaded, backup)
  assert.equal(transport.calls[0].url, `https://www.surtr.cn:8018/api/v1/json-exports/${token}`)
})

test('maps oversized JSON exports separately from encrypted account backups', async () => {
  const tokenStore = createTokenStore(createSession({ access_token: 'access' }))
  const transport = createTransport(async () => {
    throw new ModelHttpError('Payload Too Large', { status: 413, code: 'http_error' })
  })
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  await assert.rejects(
    client.uploadJsonExport({ formatVersion: 2 }),
    error => error.code === 'json_export_too_large' && /云端 JSON/.test(error.message)
  )
})

test('rotates tokens once after an access-token 401 and retries the request', async () => {
  const tokenStore = createTokenStore(createSession({ access_token: 'expired', refresh_token: 'refresh-1' }))
  const transport = createTransport(async options => {
    if (options.url.endsWith('/auth/refresh')) {
      return { status: 200, headers: {}, text: JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2' }) }
    }
    if (options.headers.Authorization === 'Bearer expired') {
      const error = new Error('expired')
      error.status = 401
      throw error
    }
    return { status: 200, headers: {}, text: JSON.stringify({ backup: { version: 1 } }) }
  })
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  const metadata = await client.getBackupMetadata()

  assert.equal(metadata.version, 1)
  assert.equal(transport.calls.length, 3)
  assert.equal(transport.calls[2].headers.Authorization, 'Bearer access-2')
  assert.equal(tokenStore.current().refresh_token, 'refresh-2')
})

test('clears the session when refresh fails', async () => {
  const tokenStore = createTokenStore(createSession({ access_token: 'expired', refresh_token: 'bad-refresh' }))
  const transport = createTransport(async options => {
    const error = new Error(options.url.endsWith('/auth/refresh') ? 'refresh failed' : 'expired')
    error.status = 401
    throw error
  })
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  await assert.rejects(client.getBackupMetadata(), /refresh failed/)
  assert.equal(tokenStore.current(), null)
  assert.equal(transport.calls.length, 2)
})

test('coalesces concurrent refreshes and preserves the rotated session', async () => {
  const tokenStore = createTokenStore(createSession({ access_token: 'expired', refresh_token: 'refresh-1' }))
  let refreshCalls = 0
  const transport = createTransport(async options => {
    if (options.url.endsWith('/auth/refresh')) {
      refreshCalls += 1
      await new Promise(resolve => setImmediate(resolve))
      return {
        status: 200,
        headers: {},
        text: JSON.stringify({ access_token: 'access-2', refresh_token: 'refresh-2' })
      }
    }
    if (options.headers.Authorization === 'Bearer expired') {
      const error = new Error('expired')
      error.status = 401
      throw error
    }
    return { status: 200, headers: {}, text: JSON.stringify({ backup: { version: 1 } }) }
  })
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  const [left, right] = await Promise.all([client.getBackupMetadata(), client.getBackupMetadata()])

  assert.equal(left.version, 1)
  assert.equal(right.version, 1)
  assert.equal(refreshCalls, 1)
  assert.equal(tokenStore.current().refresh_token, 'refresh-2')
})

test('an old refresh cannot overwrite or clear a newly logged-in account', async () => {
  const accountA = createSession(
    { access_token: 'expired-a', refresh_token: 'refresh-a' },
    { id: 'account-a', email: 'a@example.com' }
  )
  const tokenStore = createTokenStore(accountA)
  let releaseRefresh
  let markRefreshStarted
  const refreshStarted = new Promise(resolve => { markRefreshStarted = resolve })
  const clientA = new CloudApiClient({
    baseUrl: 'https://cloud.example.com',
    tokenStore,
    transport: createTransport(async options => {
      if (options.url.endsWith('/auth/refresh')) {
        markRefreshStarted()
        await new Promise(resolve => { releaseRefresh = resolve })
        return {
          status: 200,
          headers: {},
          text: JSON.stringify({ access_token: 'new-a', refresh_token: 'new-refresh-a' })
        }
      }
      const error = new Error('expired')
      error.status = 401
      throw error
    })
  })
  const clientB = new CloudApiClient({
    baseUrl: 'https://cloud.example.com',
    tokenStore,
    transport: createTransport(async () => ({
      status: 200,
      headers: {},
      text: JSON.stringify({
        user: { id: 'account-b', email: 'b@example.com' },
        access_token: 'access-b',
        refresh_token: 'refresh-b'
      })
    }))
  })

  const staleRequest = clientA.getBackupMetadata()
  await refreshStarted
  const sessionB = await clientB.login({ email: 'b@example.com', password: 'long password' })
  releaseRefresh()

  await assert.rejects(staleRequest, error => error.code === 'cloud_session_changed')
  assert.equal(tokenStore.current().user.id, 'account-b')
  assert.equal(tokenStore.current().refresh_token, 'refresh-b')
  assert.equal(sessionB.user.id, 'account-b')
})

test('rejects unscoped legacy sessions before sending a bearer token', async () => {
  const tokenStore = createTokenStore({
    user: { id: 'legacy' },
    access_token: 'legacy-access',
    refresh_token: 'legacy-refresh'
  })
  const transport = createTransport(async () => {
    throw new Error('transport must not be called')
  })
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore })

  await assert.rejects(client.getBackupMetadata(), error => error.code === 'cloud_session_scope_missing')
  assert.equal(transport.calls.length, 0)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { CloudApiClient } from '../src/services/cloud-api-client.js'

function tokenStore() {
  return {
    load: async () => ({
      user: { id: 'account-1' },
      access_token: 'access',
      refresh_token: 'refresh',
      cloud_base_url: 'https://cloud.example.com'
    }),
    save: async value => value,
    clear: async () => {}
  }
}

test('sends authenticated sync push and paginated pull requests', async () => {
  const calls = []
  const transport = {
    request: async options => {
      calls.push(options)
      return {
        status: 200,
        headers: {},
        text: JSON.stringify(options.url.endsWith('/push')
          ? { protocol_version: 1, server_cursor: 1, results: [] }
          : { protocol_version: 1, changes: [], next_cursor: 7, has_more: false, server_cursor: 7 })
      }
    }
  }
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore: tokenStore() })
  const mutation = {
    mutation_id: 'mutation-1',
    entity_type: 'settings',
    entity_id: 'appearance',
    operation: 'upsert',
    updated_at_ms: 1,
    envelope: { version: 1 }
  }

  await client.pushSyncBatch({ deviceId: 'device-a', mutations: [mutation] })
  const page = await client.pullSyncPage({ cursor: 5, limit: 2 })

  assert.equal(calls[0].url, 'https://cloud.example.com/api/v1/sync/push')
  assert.equal(calls[1].url, 'https://cloud.example.com/api/v1/sync/pull')
  assert.equal(calls[0].headers.Authorization, 'Bearer access')
  assert.deepEqual(JSON.parse(calls[0].body), {
    protocol_version: 1,
    device_id: 'device-a',
    mutations: [mutation]
  })
  assert.deepEqual(JSON.parse(calls[1].body), { protocol_version: 1, cursor: 5, limit: 2 })
  assert.equal(page.next_cursor, 7)
})

test('maps oversized sync batches independently from full backups', async () => {
  const transport = {
    request: async () => {
      const error = new Error('too large')
      error.status = 413
      throw error
    }
  }
  const client = new CloudApiClient({ baseUrl: 'https://cloud.example.com', transport, tokenStore: tokenStore() })

  await assert.rejects(
    client.pushSyncBatch({ deviceId: 'device-a', mutations: [] }),
    error => error.code === 'sync_batch_too_large' && error.status === 413
  )
})

test('never sends a bearer token to a different configured cloud server', async () => {
  let called = false
  const transport = { request: async () => { called = true } }
  const scopedTokenStore = {
    load: async () => ({
      user: { id: 'account-1' },
      access_token: 'access',
      refresh_token: 'refresh',
      cloud_base_url: 'https://first.example.com/'
    }),
    save: async value => value,
    clear: async () => {}
  }
  const client = new CloudApiClient({
    baseUrl: 'https://second.example.com',
    transport,
    tokenStore: scopedTokenStore
  })

  await assert.rejects(
    client.pullSyncPage(),
    error => error.code === 'cloud_session_server_mismatch'
  )
  assert.equal(called, false)
})

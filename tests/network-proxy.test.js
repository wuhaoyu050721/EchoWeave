import assert from 'node:assert/strict'
import test from 'node:test'
import {
  NETWORK_PROXY_MODE_MANUAL,
  NETWORK_PROXY_MODE_SMART,
  NETWORK_PROXY_SETTING_KEY,
  normalizeNetworkProxySetting,
  normalizeNetworkProxyUrl,
  readNetworkProxySetting
} from '../src/core/network-proxy.js'

test('normalizes browser proxy addresses and defaults a bare host to HTTP', () => {
  assert.equal(normalizeNetworkProxyUrl('127.0.0.1:7897'), 'http://127.0.0.1:7897')
  assert.equal(normalizeNetworkProxyUrl('http://127.0.0.1:7897/'), 'http://127.0.0.1:7897')
  assert.equal(normalizeNetworkProxyUrl('https://proxy.example:8443'), 'https://proxy.example:8443')
  assert.throws(() => normalizeNetworkProxyUrl('socks5://127.0.0.1:7897'), /HTTP 或 HTTPS/)
  assert.throws(() => normalizeNetworkProxyUrl('http://user:pass@127.0.0.1:7897'), /用户凭据/)
  assert.throws(() => normalizeNetworkProxyUrl('http://127.0.0.1:7897/proxy'), /路径/)
})

test('normalizes and reads the persisted proxy setting', async () => {
  assert.deepEqual(normalizeNetworkProxySetting({ enabled: true, url: '127.0.0.1:7897' }), {
    enabled: true,
    mode: NETWORK_PROXY_MODE_MANUAL,
    url: 'http://127.0.0.1:7897'
  })
  assert.deepEqual(normalizeNetworkProxySetting({ enabled: true, url: '' }), {
    enabled: false,
    mode: NETWORK_PROXY_MODE_MANUAL,
    url: ''
  })
  assert.deepEqual(normalizeNetworkProxySetting({ enabled: true, mode: NETWORK_PROXY_MODE_SMART }), {
    enabled: true,
    mode: NETWORK_PROXY_MODE_SMART,
    url: ''
  })

  const calls = []
  const setting = await readNetworkProxySetting({
    async getSetting(key, fallback) {
      calls.push({ key, fallback })
      return { enabled: true, url: 'http://127.0.0.1:7897/' }
    }
  })
  assert.deepEqual(setting, {
    enabled: true,
    mode: NETWORK_PROXY_MODE_MANUAL,
    url: 'http://127.0.0.1:7897'
  })
  assert.deepEqual(calls, [{ key: NETWORK_PROXY_SETTING_KEY, fallback: null }])
})

test('normalizes proxy URLs when the runtime has no URL constructor', () => {
  const originalUrl = globalThis.URL
  try {
    globalThis.URL = undefined
    assert.equal(normalizeNetworkProxyUrl('http://127.0.0.1:7897/'), 'http://127.0.0.1:7897')
    assert.equal(normalizeNetworkProxyUrl('http://[::1]:7897'), 'http://[::1]:7897')
    assert.throws(() => normalizeNetworkProxyUrl('http://user@127.0.0.1:7897'), /凭据/)
    assert.throws(() => normalizeNetworkProxyUrl('http://127.0.0.1:70000'), /无效/)
  } finally {
    globalThis.URL = originalUrl
  }
})

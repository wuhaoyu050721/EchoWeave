import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  NETWORK_PROXY_MODE_MANUAL,
  NETWORK_PROXY_MODE_SMART,
  NETWORK_PROXY_SETTING_KEY,
  normalizeNetworkProxySetting,
  normalizeNetworkProxyUrl
} from '../src/core/network-proxy.js'
import { createAndroidNetworkProxy } from '../src/platform/app/android-network-proxy.js'

const pageSource = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
const dependencies = {
  NETWORK_PROXY_MODE_MANUAL,
  NETWORK_PROXY_MODE_SMART,
  NETWORK_PROXY_SETTING_KEY,
  normalizeNetworkProxySetting,
  normalizeNetworkProxyUrl
}

function readPageMethods(startMarker, endMarker) {
  const start = pageSource.indexOf(startMarker)
  const end = pageSource.indexOf(endMarker, start)
  assert.ok(start >= 0 && end > start, `page methods must exist between ${startMarker} and ${endMarker}`)
  return new Function(...Object.keys(dependencies), `return ({ ${pageSource.slice(start, end)} })`)(...Object.values(dependencies))
}

const methods = readPageMethods('clearNetworkProxyDetection() {', 'async toggleCharacterStatus() {')
const computed = readPageMethods('networkProxyIsAndroid() {', 'characterStatusSettingLabel() {')
const phoneProxyUrl = 'http://127.0.0.1:7890'

function createSettingsPage({
  setting = { enabled: true, mode: NETWORK_PROXY_MODE_MANUAL, url: phoneProxyUrl },
  nativeApi = { aiChatDetectHttpProxy: async () => phoneProxyUrl },
  writeError = null
} = {}) {
  let persisted = normalizeNetworkProxySetting(setting)
  const writes = []
  const toasts = []
  const networkProxy = createAndroidNetworkProxy({ nativeApi })
  const repository = {
    async getSetting(key) {
      assert.equal(key, NETWORK_PROXY_SETTING_KEY)
      return { ...persisted }
    },
    async setSetting(key, value) {
      assert.equal(key, NETWORK_PROXY_SETTING_KEY)
      writes.push({ ...value })
      if (writeError) throw writeError
      persisted = { ...value }
    }
  }
  const page = {
    services: { platform: { runtime: 'app-android' }, repository, networkProxy },
    networkProxyEnabled: persisted.enabled,
    networkProxyMode: persisted.mode,
    networkProxySavedUrl: persisted.url,
    networkProxyUrl: persisted.url,
    networkProxySaving: false,
    networkProxyError: '',
    networkProxyDetecting: false,
    networkProxyDetectedUrl: '',
    networkProxyDetectionFailed: false,
    networkProxyDetectionTimedOut: false,
    networkProxyDetectionRevision: 0,
    networkProxyNativeAvailable: networkProxy.nativeAvailable,
    showToast(message) { toasts.push(message) },
    ...methods
  }
  for (const [name, getter] of Object.entries(computed)) {
    Object.defineProperty(page, name, { get() { return getter.call(this) } })
  }
  return { page, writes, toasts, networkProxy, readSetting: () => ({ ...persisted }) }
}

function assertActiveManualSetting(fixture, url = phoneProxyUrl) {
  assert.deepEqual(fixture.readSetting(), { enabled: true, mode: NETWORK_PROXY_MODE_MANUAL, url })
  assert.equal(fixture.page.networkProxyEnabled, true)
  assert.equal(fixture.page.networkProxyMode, NETWORK_PROXY_MODE_MANUAL)
  assert.equal(fixture.page.networkProxySavedUrl, url)
  assert.equal(fixture.page.networkProxySettingLabel, url)
}

test('a failed manual save keeps the effective address and releases the saving state', async () => {
  const fixture = createSettingsPage({ writeError: new Error('storage write failed') })
  fixture.page.networkProxyUrl = 'http://127.0.0.1:7897'

  await fixture.page.saveNetworkProxySettings()

  assertActiveManualSetting(fixture)
  assert.equal(fixture.page.networkProxySaving, false)
  assert.match(fixture.page.networkProxyError, /storage write failed/)
  assert.equal(fixture.page.networkProxyUrl, 'http://127.0.0.1:7897')
  assert.equal(fixture.writes.length, 1)
  assert.deepEqual(fixture.toasts, [])
  assert.deepEqual(await fixture.networkProxy.getProxyRoute(fixture.readSetting()), { proxyUrl: phoneProxyUrl, allowDirectFallback: false })
})

for (const invalidUrl of ['http://127.0.0.1:bad-port', 'socks5://127.0.0.1:7890', 'https://127.0.0.1:7890']) {
  test(`Android rejects ${invalidUrl} without replacing the active manual proxy`, async () => {
    const fixture = createSettingsPage()
    fixture.page.networkProxyUrl = invalidUrl

    await fixture.page.saveNetworkProxySettings()

    assertActiveManualSetting(fixture)
    assert.equal(fixture.writes.length, 0)
    assert.equal(fixture.page.networkProxySaving, false)
    assert.ok(fixture.page.networkProxyError)
    assert.equal(fixture.page.networkProxyUrl, invalidUrl)
    assert.equal(await fixture.networkProxy.getProxyUrl(fixture.readSetting()), phoneProxyUrl)
  })
}

test('turning off ignores an invalid draft, preserves manual mode, and reuses the saved address when enabled', async () => {
  let detections = 0
  const fixture = createSettingsPage({ nativeApi: { aiChatDetectHttpProxy: async () => { detections += 1; return phoneProxyUrl } } })
  fixture.page.networkProxyUrl = 'invalid://draft'

  await fixture.page.toggleNetworkProxy()

  assert.deepEqual(fixture.readSetting(), { enabled: false, mode: NETWORK_PROXY_MODE_MANUAL, url: phoneProxyUrl })
  assert.equal(fixture.page.networkProxyEnabled, false)
  assert.equal(fixture.page.networkProxySavedUrl, phoneProxyUrl)
  assert.equal(fixture.page.networkProxyUrl, 'invalid://draft')
  assert.equal(fixture.page.networkProxyError, '')
  assert.equal(fixture.page.networkProxySaving, false)
  assert.equal(await fixture.networkProxy.getProxyUrl(fixture.readSetting()), '')

  await fixture.page.toggleNetworkProxy()

  assertActiveManualSetting(fixture)
  assert.equal(fixture.page.networkProxySaving, false)
  assert.equal(detections, 0)
})

test('opening or refreshing disabled smart settings never invokes native detection', async () => {
  let detections = 0
  const fixture = createSettingsPage({
    setting: { enabled: false, mode: NETWORK_PROXY_MODE_SMART, url: '' },
    nativeApi: { aiChatDetectHttpProxy: async () => { detections += 1; return phoneProxyUrl } }
  })

  assert.equal(await fixture.page.refreshNetworkProxyDetection(), '')
  assert.equal(await fixture.page.refreshNetworkProxyDetection(), '')

  assert.equal(detections, 0)
  assert.equal(fixture.page.networkProxyDetecting, false)
  assert.equal(fixture.page.networkProxyDetectionRevision, 0)
  assert.equal(fixture.networkProxy.getDetectionState().pending, false)
  assert.equal(fixture.writes.length, 0)
  assert.match(fixture.page.networkProxyDetectionLabel, /开关已关闭/)
})

test('manual mode without native detection still shows its active address without claiming the detection API is required', async () => {
  const fixture = createSettingsPage({ nativeApi: null })

  assert.equal(await fixture.page.refreshNetworkProxyDetection(), '')

  assertActiveManualSetting(fixture)
  assert.equal(fixture.page.networkProxyNativeAvailable, false)
  assert.equal(fixture.page.networkProxyDetecting, false)
  assert.equal(fixture.page.networkProxyModeLabel, '手机手动代理')
  assert.match(fixture.page.networkProxyDetectionLabel, /已启用手动地址：http:\/\/127\.0\.0\.1:7890/)
  assert.doesNotMatch(fixture.page.networkProxyDetectionLabel, /缺少原生代理检测接口|重新云打包/)
  assert.equal(await fixture.networkProxy.getProxyUrl(fixture.readSetting()), phoneProxyUrl)
})

for (const action of ['disable', 'manual']) {
  test(`a late smart detection cannot overwrite settings after ${action}`, async () => {
    let finishDetection
    let detections = 0
    const nativeResult = new Promise(resolve => { finishDetection = resolve })
    const fixture = createSettingsPage({
      setting: { enabled: true, mode: NETWORK_PROXY_MODE_SMART, url: '' },
      nativeApi: { aiChatDetectHttpProxy: () => { detections += 1; return nativeResult } }
    })
    const detecting = fixture.page.refreshNetworkProxyDetection()
    await Promise.resolve()
    assert.equal(detections, 1)
    assert.equal(fixture.page.networkProxyDetecting, true)
    assert.equal(fixture.networkProxy.getDetectionState().pending, true)

    if (action === 'disable') await fixture.page.toggleNetworkProxy()
    else {
      fixture.page.networkProxyUrl = 'http://127.0.0.1:7897'
      await fixture.page.saveNetworkProxySettings()
    }
    const saved = fixture.readSetting()
    assert.equal(fixture.page.networkProxySaving, false)
    assert.equal(fixture.page.networkProxyDetecting, false)
    assert.equal(fixture.networkProxy.getDetectionState().pending, false)

    finishDetection(phoneProxyUrl)
    assert.equal(await detecting, '')
    await new Promise(resolve => setImmediate(resolve))

    assert.deepEqual(fixture.readSetting(), saved)
    assert.equal(fixture.writes.length, 1)
    assert.equal(fixture.page.networkProxyEnabled, action === 'manual')
    assert.equal(fixture.page.networkProxyMode, action === 'manual' ? NETWORK_PROXY_MODE_MANUAL : NETWORK_PROXY_MODE_SMART)
    assert.equal(fixture.page.networkProxySavedUrl, saved.url)
    assert.equal(fixture.page.networkProxyDetectedUrl, '')
    assert.equal(fixture.page.networkProxyDetectionFailed, false)
    assert.equal(fixture.page.networkProxyDetectionTimedOut, false)
    assert.equal(fixture.networkProxy.getDetectionState().url, '')
    assert.equal(await fixture.networkProxy.getProxyUrl(saved), action === 'manual' ? 'http://127.0.0.1:7897' : '')
  })
}

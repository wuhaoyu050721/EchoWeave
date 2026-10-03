import { readMainPageSource } from './helpers/read-main-page.js'
import assert from 'node:assert/strict'
import test from 'node:test'

const source = await readMainPageSource()

test('settings exposes a persistent proxy configuration page for browser and Android', () => {
  assert.match(source, /data-testid="network-proxy-settings-entry"[^>]*@click="openNetworkProxySettings\(ui\)"/)
  assert.match(source, /ui\.settingsView === 'network-proxy'/)
  assert.match(source, /data-testid="network-proxy-settings-page"/)
  assert.match(source, /data-testid="network-proxy-toggle" role="switch"/)
  assert.match(source, /@click="toggleNetworkProxy"/)
  assert.match(source, /data-testid="network-proxy-smart-help"/)
  assert.match(source, /NETWORK_PROXY_MODE_SMART/)
  assert.match(source, /Clash Meta/)
  assert.match(source, /TUN\/VPN/)
  assert.match(source, /v-model="networkProxyUrl"/)
  assert.match(source, /readNetworkProxySetting\(this\.services\.repository\)/)
  assert.match(source, /setSetting\(NETWORK_PROXY_SETTING_KEY, setting\)/)
  assert.match(source, /http:\/\/127\.0\.0\.1:7890/)
})

test('Android keeps the detected proxy and detection failures visible instead of always claiming no port', () => {
  assert.match(source, /data-testid="network-proxy-status">\{\{ networkProxyDetectionLabel \}\}/)
  assert.match(source, /data-testid="network-proxy-detect"[^>]*@click="refreshNetworkProxyDetection"/)
  assert.match(source, /'ui\.settingsView'\(value\) \{\s*if \(value === 'network-proxy' && this\.networkProxyEnabled && this\.networkProxyIsSmart\) this\.refreshNetworkProxyDetection\(\)/)
  assert.match(source, /networkProxyNativeAvailable === false\) return '当前安装包缺少原生代理检测接口/)
  assert.match(source, /已自动发现本机代理：\$\{this\.networkProxyDetectedUrl\}/)
  assert.doesNotMatch(source, /this\.networkProxyUrl = this\.networkProxyIsAndroid \? '' : networkProxy\.url/)
})

test('Android can fall back to a manual proxy address when smart detection finds nothing', () => {
  assert.match(source, /data-testid="network-proxy-save"/)
  assert.doesNotMatch(source, /v-if="!networkProxyIsAndroid" class="network-proxy-save-button"/)
  assert.match(source, /data-testid="network-proxy-tips"/)
  assert.match(source, /networkProxyIsAndroid\) return this\.networkProxyIsSmart \? '手机智能代理' : '手机手动代理'/)
  assert.match(source, /enabled: Boolean\(url\), mode: NETWORK_PROXY_MODE_MANUAL, url/)
  assert.match(source, /保存并使用此地址/)
  assert.match(source, /data-testid="network-proxy-smart-button"/)
  assert.doesNotMatch(source, /await this\.refreshNetworkProxyDetection\(\)/)
})

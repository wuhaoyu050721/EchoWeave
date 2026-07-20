import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('registers the diagnostics page and exposes a settings entry', async () => {
  const [pagesSource, indexSource] = await Promise.all([
    readFile(new URL('../pages.json', import.meta.url), 'utf8'),
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
  ])

  assert.match(pagesSource, /pages\/android-diagnostics\/index/)
  assert.match(indexSource, /Android 流式诊断/)
  assert.match(indexSource, /pages\/android-diagnostics\/index/)
  assert.match(indexSource, /openAndroidDiagnostics/)
})

test('diagnostics page is Android-only and never persists the API key', async () => {
  const source = await readFile(new URL('../pages/android-diagnostics/index.vue', import.meta.url), 'utf8')

  assert.match(source, /仅 Android App 支持流式诊断/)
  assert.match(source, /Android App · 未验证/)
  assert.match(source, /NativeStreamingTransport/)
  assert.match(source, /aiChatStreamRequest/)
  assert.match(source, /AndroidDiagnosticService/)
  assert.match(source, /preserveServiceIdentity\(new AndroidDiagnosticService/)
  assert.doesNotMatch(source, /setStorage|setSetting|localStorage|sessionStorage/)
})

test('diagnostics page includes start stop clear export and lifecycle cleanup', async () => {
  const source = await readFile(new URL('../pages/android-diagnostics/index.vue', import.meta.url), 'utf8')

  for (const label of ['开始诊断', '停止', '清空日志', '导出日志']) {
    assert.match(source, new RegExp(label))
  }
  assert.match(source, /onShow\s*\(/)
  assert.match(source, /onHide\s*\(/)
  assert.match(source, /onUnload\s*\(/)
  assert.match(source, /service\?\.stop\(\)/)
	assert.match(source, /getRuntimeDiagnosticLogStore\(\)/)
})

test('diagnostics page exposes OpenAI and Gemini protocol selection', async () => {
  const source = await readFile(new URL('../pages/android-diagnostics/index.vue', import.meta.url), 'utf8')

  assert.match(source, /接口格式/)
  assert.match(source, /PROVIDER_PROTOCOLS/)
  assert.match(source, /protocolType:\s*'openai-compatible'/)
  assert.match(source, /gemini-2\.5-flash/)
  assert.match(source, /class="diagnostic-protocol-control"/)
  assert.match(source, /@click="selectProtocol\(protocol\.id\)"/)
})

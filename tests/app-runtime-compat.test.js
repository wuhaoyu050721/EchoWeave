import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

test('App runtime source avoids Array.prototype.at', async () => {
  const sources = await Promise.all([
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/chat-service.js', import.meta.url), 'utf8')
  ])

  for (const source of sources) assert.doesNotMatch(source, /\.at\(/)
})

test('cloud backup format does not require structuredClone in older Android WebViews', async () => {
  const source = await readFile(new URL('../src/core/cloud-backup-format.js', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /structuredClone/)
  assert.match(source, /function cloneJson\(value\)/)
})

test('App runtime installs abort compatibility before loading Vue services', async () => {
  const [entrySource, chatService, diagnosticService] = await Promise.all([
    readFile(new URL('../main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/chat-service.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/android-diagnostic-service.js', import.meta.url), 'utf8')
  ])
  const polyfillImport = entrySource.indexOf("import './src/core/abort-controller-polyfill.js'")
  const appImport = entrySource.indexOf("import App from './App.vue'")

  assert.ok(polyfillImport >= 0 && polyfillImport < appImport)
  assert.match(chatService, /createAbortController\(\)/)
  assert.match(diagnosticService, /createAbortController\(\)/)
  assert.doesNotMatch(`${chatService}\n${diagnosticService}`, /new AbortController\(\)/)
})

test('App pages use bundled font icons instead of runtime SVG components', async () => {
  const [mainPage, diagnosticsPage, entrySource, previewEntry, iconStyles, appIconStyles, fontStats] = await Promise.all([
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../pages/android-diagnostics/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../main.js', import.meta.url), 'utf8'),
    readFile(new URL('../preview/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/app-icons.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/app-icons-app.css', import.meta.url), 'utf8').catch(() => ''),
    stat(new URL('../static/fonts/uniicons.ttf', import.meta.url)).catch(() => ({ size: 0 }))
  ])

  for (const source of [mainPage, diagnosticsPage]) {
    assert.doesNotMatch(source, /@lucide\/vue/)
    assert.match(source, /src\/components\/app-icons\.js/)
  }
  assert.match(entrySource, /src\/components\/app-icons\.css/)
  assert.match(entrySource, /src\/components\/app-icons-app\.css/)
  assert.match(previewEntry, /src\/components\/app-icons\.css/)
  assert.match(iconStyles, /url\(['"]\.\/uniicons\.ttf/)
  assert.doesNotMatch(iconStyles, /static\/fonts\/uniicons\.ttf/)
  assert.match(appIconStyles, /url\(['"]\.\/static\/fonts\/uniicons\.ttf/)
  assert.ok(fontStats.size > 0)
  assert.match(mainPage, /markRaw\(\{ MessageCircle, Contact, Server, Settings, Image, Camera, FileText \}\)/)
})

test('App icon bundle exposes every icon used by the pages', async () => {
  const source = await readFile(new URL('../src/components/app-icons.js', import.meta.url), 'utf8').catch(() => '')

  for (const icon of [
    'Activity', 'AlertCircle', 'ArrowLeft', 'Camera', 'Check', 'CheckCheck', 'ChevronDown',
    'ChevronRight', 'CircleHelp', 'ClipboardCopy', 'Cloud', 'Copy', 'Database', 'Download',
    'EyeOff', 'FileCog', 'FileText', 'History', 'Image', 'Import', 'Info', 'KeyRound',
    'LockKeyhole', 'Menu', 'MessageCircle', 'Mic', 'MoreVertical', 'Paperclip', 'Contact', 'Person', 'PersonAdd', 'Play', 'Plus', 'RefreshCw',
    'RotateCcw', 'Search', 'Send', 'Server', 'Settings', 'Square', 'ThumbsDown', 'ThumbsUp',
    'Trash2', 'Tune', 'Upload', 'X'
  ]) {
    assert.match(source, new RegExp(`export const ${icon}\\b`))
  }
})

test('provider logos use raster image assets in App views', async () => {
  const [pageSource, stateSource, logoSource] = await Promise.all([
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/ui-state.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/provider-logo.js', import.meta.url), 'utf8').catch(() => '')
  ])

  assert.match(pageSource, /ProviderLogo/)
  assert.match(pageSource, /<ProviderLogo[^>]+class="assistant-avatar provider-logo"[^>]+:src="activeAssistantAvatar"/)
  assert.match(pageSource, /<ProviderLogo[^>]+class="provider-logo provider-logo-large"[^>]+:src="provider\.logo/)
  assert.match(logoSource, /typeof plus/)
  assert.match(logoSource, /['"]image['"].*['"]img['"]/s)
  assert.doesNotMatch(pageSource, /providerLogoStyle/)
  assert.doesNotMatch(stateSource, /static\/providers\/[^'"\s]+\.svg/)
})

test('conversation and provider management use the shared App-rendered dialog layer', async () => {
	const [source, dialogSource] = await Promise.all([
		readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
		readFile(new URL('../src/components/app-dialog-layer.vue', import.meta.url), 'utf8')
	])
	const manageBlock = source.slice(source.indexOf('chooseConversationAction(conversation)'), source.indexOf('upsertMessage(message)'))
	const providerDeleteBlock = source.slice(source.indexOf('async deleteProvider(provider)'), source.indexOf('async selectConversationProvider(provider)'))

	assert.match(source, /function getUniApi\(\)/)
	assert.match(source, /<AppDialogLayer/)
	assert.match(manageBlock, /this\.conversationActionSheet/)
	assert.match(manageBlock, /this\.openAppDialog\(/)
	assert.match(manageBlock, /confirmAction\('删除会话'/)
	assert.doesNotMatch(manageBlock, /showActionSheet|showModal|\bwindow\.(?:prompt|confirm)\b/)
	assert.match(dialogSource, /data-testid="conversation-action-sheet"/)
	assert.match(dialogSource, /data-testid="app-dialog-input"/)
	assert.match(providerDeleteBlock, /await this\.confirmAction\('删除接口'/)
	assert.doesNotMatch(providerDeleteBlock, /\bwindow\.confirm\b/)
	assert.match(source, /confirmCloudAction\(content\)\s*\{\s*return this\.confirmAction\('云端备份', content\)/s)
})

test('both settings views wire the about application action', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
  const matches = source.match(/@click="showAboutApp"/g) || []

  assert.equal(matches.length, 2)
})

test('App JSON export writes text through plus.io before the browser Blob branch', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
  const exportBlock = source.slice(source.indexOf('async exportData()'), source.indexOf('chooseImportFile()'))

  assert.match(exportBlock, /typeof plus !== 'undefined'/)
  assert.match(exportBlock, /exportTextToDownloads\(\{ plusApi, fileName, content \}\)/)
  assert.match(exportBlock, /JSON 已保存到下载目录/)
  assert.ok(exportBlock.indexOf('exportTextToDownloads') < exportBlock.indexOf('new Blob'))
})

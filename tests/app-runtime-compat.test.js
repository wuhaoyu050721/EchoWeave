import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'
import { installLegacyRuntimePolyfills } from '../src/core/legacy-runtime-polyfill.js'

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
  const [entrySource, abortPolyfill, chatService, diagnosticService] = await Promise.all([
    readFile(new URL('../main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/core/abort-controller-polyfill.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/chat-service.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/android-diagnostic-service.js', import.meta.url), 'utf8')
  ])
  const polyfillImport = entrySource.indexOf("import './src/core/abort-controller-polyfill.js'")
  const appImport = entrySource.indexOf("import App from './App.vue'")

  assert.ok(polyfillImport >= 0 && polyfillImport < appImport)
  assert.match(abortPolyfill, /import \{ runtimeGlobal \} from '\.\/legacy-runtime-polyfill\.js'/)
  assert.doesNotMatch(abortPolyfill, /\bglobalThis\b/)
  assert.match(chatService, /createAbortController\(\)/)
  assert.match(diagnosticService, /createAbortController\(\)/)
  assert.doesNotMatch(`${chatService}\n${diagnosticService}`, /new AbortController\(\)/)
})

test('App runtime installs legacy WebView compatibility before every other entry import', async () => {
  const [entrySource, textEncodingPolyfill] = await Promise.all([
    readFile(new URL('../main.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/core/text-encoding-polyfill.js', import.meta.url), 'utf8')
  ])
  const legacyImport = entrySource.indexOf("import './src/core/legacy-runtime-polyfill.js'")
  const abortImport = entrySource.indexOf("import './src/core/abort-controller-polyfill.js'")
  const appImport = entrySource.indexOf("import App from './App.vue'")

  assert.equal(legacyImport, 0)
  assert.ok(legacyImport < abortImport && abortImport < appImport)
  assert.match(textEncodingPolyfill, /import \{ runtimeGlobal \} from '\.\/legacy-runtime-polyfill\.js'/)
  assert.doesNotMatch(textEncodingPolyfill, /\bglobalThis\b/)
})

test('legacy WebView compatibility fills only missing runtime APIs', () => {
  function LegacyArray() {}
  function LegacyString() {}
  function LegacyObject() {}
  LegacyArray.prototype = {}
  LegacyString.prototype = {}
  const target = {
    Array: LegacyArray,
    String: LegacyString,
    Object: LegacyObject
  }

  installLegacyRuntimePolyfills(target)

  assert.equal(target.globalThis, target)
  assert.deepEqual(target.Object.entries({ one: 1 }), [['one', 1]])
  assert.deepEqual(target.Object.values({ one: 1 }), [1])
  assert.deepEqual(target.Object.fromEntries([['one', 1], ['two', 2]]), { one: 1, two: 2 })
  assert.equal(target.Array.prototype.includes.call([1, Number.NaN], Number.NaN), true)
  assert.deepEqual(target.Array.prototype.flatMap.call([1, 2], value => [value, value * 2]), [1, 2, 2, 4])
  assert.equal(target.String.prototype.padStart.call('7', 3, '0'), '007')
  assert.equal(target.String.prototype.padEnd.call('7', 3, '0'), '700')

  const existing = () => 'existing'
  target.Array.prototype.flatMap = existing
  installLegacyRuntimePolyfills(target)
  assert.equal(target.Array.prototype.flatMap, existing)
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
    'LockKeyhole', 'Menu', 'MessageCircle', 'Mic', 'MoreVertical', 'Paperclip', 'Contact', 'Person', 'PersonAdd', 'Play', 'PlayOutline', 'Plus', 'RefreshCw',
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
  assert.match(pageSource, /<ProviderLogo[^>]+class="assistant-avatar provider-logo"[^>]+:src="messageAssistantAvatar\(message\)"/)
  assert.match(pageSource, /<ProviderLogo[^>]+class="provider-logo provider-logo-large"[^>]+:src="provider\.logo/)
  assert.match(logoSource, /typeof plus/)
  assert.match(logoSource, /['"]image['"].*['"]img['"]/s)
  assert.match(logoSource, /mode:\s*\{\s*type:\s*String,\s*default:\s*['"]aspectFill['"]/)
  assert.match(logoSource, /objectFit:\s*objectFitByMode\[props\.mode\]\s*\|\|\s*['"]cover['"]/)
  assert.match(logoSource, /fallbackSrc:\s*\{\s*type:\s*String,\s*default:\s*['"]\/static\/zhiyu-logo\.png['"]/)
  assert.match(logoSource, /resolvedSrc\.value\s*=\s*props\.fallbackSrc/)
  assert.doesNotMatch(pageSource, /<ProviderLogo[^>]+mode=['"]aspectFit['"]/)
  assert.match(pageSource, /\.provider-logo\s*\{[^}]*overflow:\s*hidden[^}]*object-fit:\s*cover/s)
  for (const className of ['assistant-avatar', 'provider-avatar-preview-image', 'provider-avatar-option-image', 'provider-avatar-preset-image']) {
    assert.match(pageSource, new RegExp(`\\.${className}\\s*\\{[^}]*padding:\\s*0`, 's'))
  }
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

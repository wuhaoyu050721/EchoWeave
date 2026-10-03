import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'
import * as icons from '../src/components/app-icons.js'
import { PROVIDER_PROTOCOLS, defaultProviderBaseUrl, getProviderProtocol } from '../src/core/provider-protocol.js'

const source = await readFile(new URL('../pages/android-diagnostics/index.vue', import.meta.url), 'utf8')
const script = parse(source).descriptor.script.content
  .replace(/\bimport\s+[\s\S]*?\s+from\s+['"][^'"]+['"]\s*/g, '')
  .replace('export default', 'return')

function createPage(environment = {}) {
  const dependencies = {
    ...icons, PROVIDER_PROTOCOLS, defaultProviderBaseUrl, getProviderProtocol,
	window: undefined, document: undefined, navigator: undefined, uni: undefined,
    ...environment
  }
  const options = new Function(...Object.keys(dependencies), script)(...Object.values(dependencies))
  const page = options.data()
  for (const [name, method] of Object.entries(options.methods)) page[name] = method.bind(page)
  for (const [name, getter] of Object.entries(options.computed)) Object.defineProperty(page, name, { get: () => getter.call(page) })
  page.showToast = message => { page.toastMessage = message }
  return page
}

function pendingDiagnostic(page) {
  let handlers, resolve, reject
  const transport = { starts: 0, stops: 0 }
  page.isAndroidApp = true
  page.service = {
    start(config, callbacks) {
      transport.starts += 1
      handlers = callbacks
      callbacks.onState({ ...page.summary, status: 'streaming' })
      return new Promise((success, failure) => { resolve = success; reject = failure })
    },
    stop() { transport.stops += 1; return true }
  }
  return { transport, get handlers() { return handlers }, resolve: value => resolve(value), reject: error => reject(error) }
}

test('reset keeps the cleared diagnostic state while a stopped request settles', async () => {
  const page = createPage()
  const pending = pendingDiagnostic(page)
  const run = page.startDiagnostic()
  pending.handlers.onDelta('old', 'old response')
  page.resetDiagnostic()
  assert.equal(pending.transport.stops, 1)
  assert.equal(page.summary.status, 'idle')
  assert.equal(page.output, '')
  assert.equal(page.canStart, false)
  await page.startDiagnostic()
  assert.equal(pending.transport.starts, 1)
  pending.handlers.onState({ status: 'aborted' })
  pending.handlers.onDelta('late', 'late response')
  pending.handlers.onLog([{ type: 'late' }])
  pending.resolve({ status: 'aborted' })
  await run
  assert.equal(page.summary.status, 'idle')
  assert.equal(page.output, '')
  assert.deepEqual(page.logs, [])
  assert.equal(page.requestPending, false)
  assert.equal(page.canStart, true)
})

test('a late rejection after reset cannot turn the cleared page into a failure', async () => {
  const page = createPage()
  const pending = pendingDiagnostic(page)
  const run = page.startDiagnostic()
  page.resetDiagnostic()
  pending.reject(new Error('stopped request'))
  await run
  assert.equal(page.summary.status, 'idle')
  assert.equal(page.summary.errorMessage, '')
  assert.equal(page.requestPending, false)
})

test('normal diagnostic completion still shows received content, logs, and summary', async () => {
  const page = createPage()
  const pending = pendingDiagnostic(page)
  const run = page.startDiagnostic()
  pending.handlers.onDelta('正文', '正文')
  pending.handlers.onLog([{ type: 'chunk', bytes: 8 }])
  pending.resolve({ status: 'completed', chunkCount: 1 })
  await run
  assert.equal(page.output, '正文')
  assert.equal(page.summary.status, 'completed')
  assert.equal(page.summary.chunkCount, 1)
  assert.deepEqual(page.logs, [{ type: 'chunk', bytes: 8 }])
  assert.equal(page.requestPending, false)
})

test('leaving the page stops once, removes key visibility, and rejects late page updates', async () => {
  const removed = []
  const page = createPage({ document: { removeEventListener: (...args) => removed.push(args) } })
  const lifecycle = []
  page.addLifecycleLog = (...args) => lifecycle.push(args)
  const pending = pendingDiagnostic(page)
  page.form.apiKey = 'test-only-key'
  page.showApiKey = true
  page.headerMenuOpen = true
  const run = page.startDiagnostic()
  page.disposeDiagnostics()
  page.disposeDiagnostics()
  pending.handlers.onDelta('late', 'late response')
  pending.resolve({ status: 'completed' })
  await run
  assert.equal(pending.transport.stops, 1)
  assert.equal(page.form.apiKey, '')
  assert.equal(page.showApiKey, false)
  assert.equal(page.headerMenuOpen, false)
  assert.equal(page.output, '')
  assert.equal(lifecycle.length, 1)
  assert.equal(removed.length, 1)
  assert.equal(removed[0][0], 'keydown')
})

test('diagnostic back keeps native navigation and explicitly returns the browser to settings', () => {
  let backs = 0
  const nativePage = createPage({ uni: { navigateBack() { backs += 1 } } })
  nativePage.goBack()
  assert.equal(backs, 1)
  const location = { pathname: '/preview/', href: '/preview/?page=pages/android-diagnostics/index' }
  const browserPage = createPage({ window: { location } })
  browserPage.headerMenuOpen = true
  browserPage.goBack()
  assert.equal(location.href, '/preview/?tab=settings')
  assert.equal(browserPage.headerMenuOpen, false)
})

test('Escape closes an open menu without intercepting unrelated keyboard input', () => {
  const page = createPage()
  let prevented = 0
  page.headerMenuOpen = true
  page.handlePageKeydown({ key: 'Enter', preventDefault() { prevented += 1 } })
  assert.equal(page.headerMenuOpen, true)
  page.handlePageKeydown({ key: 'Escape', preventDefault() { prevented += 1 } })
  assert.equal(page.headerMenuOpen, false)
  assert.equal(prevented, 1)
})

test('export reports denied or unavailable clipboard access instead of failing silently', async () => {
  const page = createPage({ navigator: { clipboard: { async writeText() { throw new Error('denied') } } } })
  page.logStore = { exportData: () => ({ entries: [] }) }
  page.headerMenuOpen = true
  await page.exportLogsFromMenu()
  assert.equal(page.headerMenuOpen, false)
  assert.match(page.toastMessage, /复制失败/)
  const unsupported = createPage()
  unsupported.logStore = page.logStore
  await unsupported.exportLogs()
  assert.match(unsupported.toastMessage, /无法复制日志/)
})

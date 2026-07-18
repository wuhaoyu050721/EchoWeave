import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function loadPolyfill() {
  try {
    return await import('../src/core/text-encoding-polyfill.js')
  } catch {
    return null
  }
}

test('installs UTF-8 TextEncoder and TextDecoder when the runtime omits them', async () => {
  const polyfill = await loadPolyfill()
  assert.ok(polyfill, 'text encoding polyfill module is missing')

  const runtime = {}
  polyfill.installTextEncodingPolyfill(runtime)

  const value = 'AI chat: \u4f60\u597d \ud83d\ude00'
  const bytes = new runtime.TextEncoder().encode(value)
  assert.equal(new runtime.TextDecoder().decode(bytes), value)
})

test('decodes split UTF-8 sequences and supports fatal validation', async () => {
  const polyfill = await loadPolyfill()
  assert.ok(polyfill, 'text encoding polyfill module is missing')

  const runtime = {}
  polyfill.installTextEncodingPolyfill(runtime)
  const bytes = new runtime.TextEncoder().encode('\u4f60A')
  const decoder = new runtime.TextDecoder('utf-8', { fatal: true })

  assert.equal(decoder.decode(bytes.subarray(0, 2), { stream: true }), '')
  assert.equal(decoder.decode(bytes.subarray(2), { stream: true }), '\u4f60A')
  assert.equal(decoder.decode(), '')
  assert.throws(
    () => new runtime.TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.of(0xc3, 0x28)),
    /UTF-8/
  )
})

test('cloud backup initialization does not require a global TextEncoder', async () => {
  const polyfill = await loadPolyfill()
  const source = await readFile(new URL('../src/core/cloud-backup-crypto.js', import.meta.url), 'utf8')

  assert.equal(typeof polyfill?.encodeUtf8, 'function')
  assert.doesNotMatch(source, /@noble\/hashes\/utils\.js/)
  assert.match(source, /import \{ encodeUtf8 \} from ['"]\.\/text-encoding-polyfill\.js['"]/)
})

test('loads the text encoding compatibility layer before the Vue application', async () => {
  const source = await readFile(new URL('../main.js', import.meta.url), 'utf8')
  const polyfillImport = source.indexOf("import './src/core/text-encoding-polyfill.js'")
  const appImport = source.indexOf("import App from './App.vue'")

  assert.ok(polyfillImport >= 0, 'main.js must import the text encoding polyfill')
  assert.ok(polyfillImport < appImport, 'the polyfill must run before App.vue dependencies')
})

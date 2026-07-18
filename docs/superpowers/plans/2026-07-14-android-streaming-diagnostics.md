# Android Streaming Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent Android streaming diagnostics page that tests `uni.request` chunk callbacks, SSE parsing, abort behavior, lifecycle events, and redacted diagnostic export without changing the browser chat transport.

**Architecture:** Keep the existing OpenAI-compatible URL builder and `OpenAISseParser`. Add a testable App transport that receives the `uni` API through dependency injection, a small diagnostic session service that owns state and abort behavior, and a memory-only redacted log store. The page consumes these units and is reachable from Settings through `uni.navigateTo`.

**Tech Stack:** uni-app Vue 3, JavaScript ES modules, `uni.request`, Node test runner, existing Lucide Vue icons.

## Global Constraints

- The API key must never be persisted, logged, or included in exported diagnostics.
- H5 must remain buildable and must not execute Android-only request APIs.
- Only one diagnostic request may run at a time.
- Late chunks after abort may be logged as metadata but must not update parsed output.
- The browser chat transport and current page layout must remain unchanged.
- Simulator and physical-device streaming remain marked unverified until the user runs them.
- This workspace is not a Git repository, so commit steps are recorded but cannot be executed.

---

### Task 1: Memory-Only Redacted Diagnostic Log

**Files:**
- Create: `src/core/diagnostic-log.js`
- Test: `tests/diagnostic-log.test.js`

**Interfaces:**
- Produces: `createDiagnosticLogStore({ now, maxEntries, maxDetailLength })`
- Produces: store methods `add(type, detail)`, `clear()`, `entries()`, and `exportData(metadata)`
- Consumes: secrets passed to `add` as `detail.secrets`; secrets are used only for redaction and are never stored

- [ ] **Step 1: Write the failing tests**

```js
test('redacts API keys and bearer tokens from entries and exports', () => {
  const store = createDiagnosticLogStore({ now: () => 1000 })
  store.add('request', { message: 'Bearer secret-key', secrets: ['secret-key'] })
  assert.equal(JSON.stringify(store.entries()).includes('secret-key'), false)
  assert.equal(JSON.stringify(store.exportData()).includes('secret-key'), false)
})

test('limits retained entries and detail length', () => {
  const store = createDiagnosticLogStore({ now: () => 1000, maxEntries: 2, maxDetailLength: 8 })
  store.add('one', { message: '123456789' })
  store.add('two', { message: 'second' })
  store.add('three', { message: 'third' })
  assert.deepEqual(store.entries().map((entry) => entry.type), ['two', 'three'])
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/diagnostic-log.test.js`

Expected: FAIL because `src/core/diagnostic-log.js` does not exist.

- [ ] **Step 3: Implement the minimal log store**

```js
export function createDiagnosticLogStore({ now = Date.now, maxEntries = 500, maxDetailLength = 240 } = {}) {
  let items = []
  const redact = (value, secrets = []) => {
    let text = String(value ?? '').replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    for (const secret of secrets.filter(Boolean)) text = text.split(String(secret)).join('[REDACTED]')
    return text.slice(0, maxDetailLength)
  }
  return {
    add(type, detail = {}) {
      const { secrets = [], ...safeDetail } = detail
      const normalized = Object.fromEntries(Object.entries(safeDetail).map(([key, value]) => [key, typeof value === 'string' ? redact(value, secrets) : value]))
      items = [...items, { timestamp: now(), type, ...normalized }].slice(-maxEntries)
    },
    clear() { items = [] },
    entries() { return items.map((item) => ({ ...item })) },
    exportData(metadata = {}) { return { version: 1, exportedAt: new Date(now()).toISOString(), metadata, entries: this.entries() } }
  }
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `node --test tests/diagnostic-log.test.js`

Expected: 2 tests pass.

### Task 2: Testable `uni.request` Chunk Transport

**Files:**
- Create: `src/platform/app/uni-request-diagnostic-transport.js`
- Test: `tests/uni-request-diagnostic-transport.test.js`

**Interfaces:**
- Consumes: constructor `{ uniApi }`
- Produces: `request({ url, method, headers, body, timeout, signal, onChunk, onLateChunk, onHeaders })`
- Returns: `Promise<{ statusCode, headers }>`

- [ ] **Step 1: Write failing transport tests**

```js
test('enables chunked arraybuffer requests and forwards bytes', async () => {
  let options
  let chunkListener
  const uniApi = { request(value) { options = value; return { onChunkReceived(fn) { chunkListener = fn }, abort() {} } } }
  const transport = new UniRequestDiagnosticTransport({ uniApi })
  const pending = transport.request({ url: 'https://example.com/v1/chat/completions', method: 'POST', body: '{}', onChunk: (bytes) => chunks.push([...bytes]) })
  chunkListener({ data: new Uint8Array([1, 2]).buffer })
  options.success({ statusCode: 200, header: {} })
  await pending
  assert.equal(options.enableChunked, true)
  assert.equal(options.responseType, 'arraybuffer')
})

test('aborts through AbortSignal and ignores late content callbacks', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(transport.request({ url: 'https://example.com', signal: controller.signal }), /停止/)
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/uni-request-diagnostic-transport.test.js`

Expected: FAIL because the transport module does not exist.

- [ ] **Step 3: Implement the transport**

The implementation must:

```js
const task = this.uniApi.request({
  url,
  method,
  header: headers,
  data: body,
  timeout,
  responseType: 'arraybuffer',
  enableChunked: true,
  success,
  fail
})
```

It must reject with code `chunk_callback_unsupported` when `task.onChunkReceived` is unavailable, convert `ArrayBuffer` and typed-array payloads to `Uint8Array`, call `task.abort()` when the signal aborts, and route post-abort chunks only to `onLateChunk`.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `node --test tests/uni-request-diagnostic-transport.test.js`

Expected: transport tests pass.

### Task 3: Diagnostic Session Service

**Files:**
- Create: `src/services/android-diagnostic-service.js`
- Test: `tests/android-diagnostic-service.test.js`

**Interfaces:**
- Consumes: `{ transport, logStore, now }`
- Produces: `start({ baseUrl, apiKey, model, prompt, timeout }, handlers)`
- Produces: `stop()` and `isRunning()`
- Handlers: `onState(state)`, `onDelta(delta, fullText)`, and `onLog(entries)`

- [ ] **Step 1: Write failing service tests**

Cover these behaviors with real `OpenAISseParser` bytes:

```js
test('builds an OpenAI request and streams parsed deltas', async () => {
  await service.start({ baseUrl: 'https://example.com', apiKey: 'secret', model: 'demo', prompt: '你好' }, handlers)
  assert.equal(request.url, 'https://example.com/v1/chat/completions')
  assert.equal(request.headers.Authorization, 'Bearer secret')
  assert.equal(JSON.parse(request.body).stream, true)
  assert.equal(fullText, '你好')
})

test('stops once and prevents late chunks from changing output', async () => {
  const pending = service.start(config, handlers)
  assert.equal(service.stop(), true)
  assert.equal(service.stop(), false)
  await pending
  assert.equal(lastState.status, 'aborted')
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/android-diagnostic-service.test.js`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement session state and SSE wiring**

The service owns one `AbortController`, records start/first-chunk/end timestamps, counts chunks and bytes, creates `OpenAISseParser`, and emits states using exactly these statuses:

```js
const statuses = ['idle', 'connecting', 'streaming', 'completed', 'aborted', 'failed']
```

The request body is:

```js
JSON.stringify({
  model,
  messages: [{ role: 'user', content: prompt }],
  stream: true
})
```

Parser errors produce `failed`; user abort produces `aborted`; `[DONE]` produces `completed`. All log calls that mention request configuration pass `secrets: [apiKey]`.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `node --test tests/android-diagnostic-service.test.js`

Expected: service tests pass.

### Task 4: Independent Diagnostics Page and Settings Entry

**Files:**
- Create: `pages/android-diagnostics/index.vue`
- Modify: `pages.json`
- Modify: `pages/index/index.vue`
- Test: `tests/android-diagnostics-ui.test.js`

**Interfaces:**
- Settings calls `uni.navigateTo({ url: '/pages/android-diagnostics/index' })` only when available.
- The diagnostics page creates `UniRequestDiagnosticTransport`, `createDiagnosticLogStore`, and `AndroidDiagnosticService` only for App builds.

- [ ] **Step 1: Write failing source-level UI tests**

```js
test('registers the diagnostics page and exposes a settings entry', async () => {
  const pages = JSON.parse(stripJsonComments(await readFile('pages.json', 'utf8')))
  assert.ok(pages.pages.some((page) => page.path === 'pages/android-diagnostics/index'))
  assert.match(indexSource, /Android 流式诊断/)
  assert.match(indexSource, /pages\/android-diagnostics\/index/)
})

test('diagnostics page warns on H5 and never persists the API key', async () => {
  assert.match(source, /仅 Android App 支持流式诊断/)
  assert.doesNotMatch(source, /setStorage|setSetting|localStorage/)
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/android-diagnostics-ui.test.js`

Expected: FAIL because the page and entry do not exist.

- [ ] **Step 3: Implement the page**

The page includes:

- Custom header with back icon and title `Android 流式诊断`.
- Runtime badge `仅 Android App 支持流式诊断` or `Android App · 未验证`.
- Inputs for base URL, API key, model, prompt, and timeout.
- Start, stop, clear, and export controls.
- Summary fields for status, first chunk, duration, chunks, bytes, events, and finish reason.
- Streaming output preview and timestamped log list.
- `onShow`, `onHide`, and `onUnload` lifecycle log entries; unload also calls `service.stop()`.
- Export through `uni.downloadFile` is not required. Use an H5 `Blob` only when available; otherwise copy redacted JSON through `uni.setClipboardData`.

- [ ] **Step 4: Run focused UI and service tests**

Run: `node --test tests/android-diagnostics-ui.test.js tests/android-diagnostic-service.test.js tests/uni-request-diagnostic-transport.test.js tests/diagnostic-log.test.js`

Expected: all diagnostics tests pass.

### Task 5: Full Verification

**Files:**
- Verify all files changed above.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests pass with zero failures, cancellations, or skipped tests.

- [ ] **Step 2: Build the browser preview**

Run: `npm run build`

Expected: Vite production build completes and emits `dist-preview/preview/index.html`.

- [ ] **Step 3: Compile with the HBuilderX App compiler**

Run the bundled HBuilderX `uni.js build -p app` command with `UNI_INPUT_DIR` set to the project and a temporary `UNI_OUTPUT_DIR`.

Expected: `DONE Build complete.` and exit code 0.

- [ ] **Step 4: Record runtime limitation**

Report that the only installed Android emulator uses 16 KB pages and the HBuilder standard base cannot load on it. Do not claim chunk streaming, abort, or lifecycle behavior has been validated on Android hardware.

# Browser Local Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Version C browser preview into a working OpenAI-compatible local chat app with streaming, encrypted IndexedDB persistence, provider management, conversation management, and JSON backup.

**Architecture:** Keep the current Vue page layout and route UI actions through application services. Protocol, transport, persistence, and encryption use explicit interfaces so Android can later replace browser adapters without changing chat orchestration.

**Tech Stack:** Vue 3, Vite, Node test runner, Fetch/ReadableStream, IndexedDB, Web Crypto AES-GCM, Playwright.

## Completion Status

- [x] Tasks 1-7 implemented and verified on 2026-07-13.
- [x] Unit tests: 50 passed, 0 failed.
- [x] Browser functional QA: 27 checks passed at 390 x 844.
- [x] Production build completed successfully.
- The detailed unchecked boxes below are the original execution record and expected red/green sequence, retained for implementation context.

## Global Constraints

- Preserve the existing four-screen Version C layout and 390 x 844 mobile geometry.
- Browser preview uses `/__ai_proxy`; Android will not use this proxy.
- Never log, export, snapshot, or persist API keys or system prompts as plaintext.
- The browser implementation is not described as equivalent to Android Keystore or `plus.sqlite`.
- No PHP, MySQL, registration, cloud backup, or multi-device sync in this plan.
- Use OpenAI-compatible Chat Completions and `/models`; retain protocol extension points.
- The workspace is not a Git repository, so commit steps are not applicable.

---

### Task 1: Provider URL Rules And SSE Parser

**Files:**
- Create: `src/core/provider-url.js`
- Create: `src/core/sse-parser.js`
- Create: `tests/provider-url.test.js`
- Create: `tests/sse-parser.test.js`

**Interfaces:**
- Produces: `normalizeOpenAIBaseUrl(input)`, `buildOpenAIEndpoint(baseUrl, path)`, `OpenAISseParser` with `feed(bytes)` and `finish()`.

- [ ] **Step 1: Write failing provider URL tests**

```js
test('normalizes root and v1 base URLs', () => {
  assert.equal(normalizeOpenAIBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1')
  assert.equal(normalizeOpenAIBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1')
})

test('rejects complete chat endpoints', () => {
  assert.throws(() => normalizeOpenAIBaseUrl('https://example.com/v1/chat/completions'))
})
```

- [ ] **Step 2: Run URL tests and verify missing-module failure**

Run: `node --test tests/provider-url.test.js`
Expected: FAIL because `src/core/provider-url.js` does not exist.

- [ ] **Step 3: Implement URL normalization**

Use `URL`, require `http:` or `https:`, reject credentials/query/hash and `/chat/completions`, trim trailing slashes, and append `/v1` unless the path already ends in `/v1`.

- [ ] **Step 4: Run URL tests and verify pass**

Run: `node --test tests/provider-url.test.js`
Expected: all URL tests pass.

- [ ] **Step 5: Write failing byte-stream SSE tests**

```js
test('parses split UTF-8, multiple events, and done', () => {
  const deltas = []
  let done = false
  const parser = new OpenAISseParser({ onDelta: value => deltas.push(value), onDone: () => { done = true } })
  const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n')
  parser.feed(bytes.slice(0, bytes.length - 5))
  parser.feed(bytes.slice(bytes.length - 5))
  parser.finish()
  assert.deepEqual(deltas, ['你好'])
  assert.equal(done, true)
})
```

- [ ] **Step 6: Run SSE tests and verify missing-module failure**

Run: `node --test tests/sse-parser.test.js`
Expected: FAIL because `src/core/sse-parser.js` does not exist.

- [ ] **Step 7: Implement and verify SSE parsing**

Implement streaming `TextDecoder`, CRLF/LF line handling, multi-line `data:`, JSON delta extraction, finish reason, `[DONE]`, and post-done chunk suppression.

Run: `node --test tests/sse-parser.test.js`
Expected: all SSE tests pass.

### Task 2: Context Construction And Backup Format

**Files:**
- Create: `src/core/chat-context.js`
- Create: `src/core/backup-format.js`
- Create: `tests/chat-context.test.js`
- Create: `tests/backup-format.test.js`

**Interfaces:**
- Produces: `buildChatContext({ messages, systemPrompt, maxMessages, maxCharacters })`, `createBackup(data)`, and `prepareImport(payload, idFactory)`.

- [ ] **Step 1: Write failing context tests**

Test that completed assistants and non-empty interrupted assistants are included, failed/generating/empty cancelled assistants are excluded, newest messages survive truncation, and system prompt remains first.

- [ ] **Step 2: Run context tests and verify failure**

Run: `node --test tests/chat-context.test.js`
Expected: FAIL because the context module is missing.

- [ ] **Step 3: Implement context construction and verify pass**

Build request messages shaped as `{ role, content }`, filter statuses, apply newest-first limits, then restore chronological order.

Run: `node --test tests/chat-context.test.js`
Expected: all context tests pass.

- [ ] **Step 4: Write failing backup tests**

Test `formatVersion: 1`, secret field exclusion, unsupported-version rejection, and conversation/message ID remapping on import.

- [ ] **Step 5: Implement backup helpers and verify pass**

`createBackup` returns metadata and non-sensitive records. `prepareImport` validates all records before returning remapped entities and never mutates input.

Run: `node --test tests/backup-format.test.js`
Expected: all backup tests pass.

### Task 3: Encrypted IndexedDB Repository

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/platform/browser/indexeddb-repository.js`
- Create: `src/platform/browser/web-crypto-vault.js`
- Create: `tests/indexeddb-repository.test.js`
- Create: `tests/web-crypto-vault.test.js`

**Interfaces:**
- Produces: `IndexedDbRepository`, `WebCryptoVault`.
- Repository methods: `init`, provider CRUD, conversation CRUD, message CRUD/pair creation, settings get/set, secret get/set, backup read/import, and `recoverGeneratingMessages`.
- Vault methods: `init`, `encryptString(value)`, `decryptString(record)`.

- [ ] **Step 1: Install test-only IndexedDB runtime**

Run: `npm install --save-dev fake-indexeddb`
Expected: dependency added without audit failure blocking installation.

- [ ] **Step 2: Write failing repository tests**

Use `fake-indexeddb` to verify schema creation, user/assistant pair insertion, message ordering, cascade deletion, settings, secrets, and generating-to-interrupted recovery.

- [ ] **Step 3: Run repository tests and verify missing-module failure**

Run: `node --test tests/indexeddb-repository.test.js`
Expected: FAIL because the repository module is missing.

- [ ] **Step 4: Implement repository and verify pass**

Create IndexedDB version 1 with stores `meta`, `providers`, `conversations`, `messages`, `settings`, and `secrets`; add message indexes for `conversationId` and `[conversationId, sequence]`.

Run: `node --test tests/indexeddb-repository.test.js`
Expected: all repository tests pass.

- [ ] **Step 5: Write failing vault tests**

Verify ciphertext does not contain plaintext, decrypt restores Unicode, and two encryptions use different IVs.

- [ ] **Step 6: Implement vault and verify pass**

Generate a non-extractable AES-GCM 256-bit `CryptoKey`, persist it through repository secrets, and encode IV/ciphertext as base64.

Run: `node --test tests/web-crypto-vault.test.js`
Expected: all vault tests pass.

### Task 4: Proxy, Transport, And OpenAI Provider

**Files:**
- Create: `src/platform/browser/proxy-rules.js`
- Create: `src/platform/browser/browser-fetch-transport.js`
- Create: `src/providers/openai-provider.js`
- Modify: `vite.config.js`
- Create: `tests/proxy-rules.test.js`
- Create: `tests/browser-fetch-transport.test.js`
- Create: `tests/openai-provider.test.js`

**Interfaces:**
- Produces: `validateProxyTarget`, `BrowserFetchTransport.request(options)`, `OpenAIProvider.listModels(profile)`, `OpenAIProvider.streamChat(profile, request, handlers)`.

- [ ] **Step 1: Write failing proxy safety tests**

Test allowed HTTP(S) targets and rejection of credentials, file URLs, proxy recursion, and malformed targets.

- [ ] **Step 2: Implement proxy rules and verify pass**

Run: `node --test tests/proxy-rules.test.js`
Expected: all proxy tests pass.

- [ ] **Step 3: Write failing transport/provider tests**

Use injected fake `fetch` responses to verify model parsing, Authorization header behavior, streamed byte delivery, abort propagation, Chat Completions payload, and normalized HTTP errors.

- [ ] **Step 4: Implement transport and provider**

Transport posts through `/__ai_proxy` with the target in `x-ai-target-url`; provider sends `stream: true`, model, messages, and Bearer authentication only when a key exists.

- [ ] **Step 5: Add Vite streaming proxy middleware**

Validate target, forward method/body/allowed headers with Node `fetch`, stream response chunks to the browser, and omit hop-by-hop headers.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/proxy-rules.test.js tests/browser-fetch-transport.test.js tests/openai-provider.test.js`
Expected: all transport and provider tests pass.

### Task 5: Provider And Chat Application Services

**Files:**
- Create: `src/services/provider-service.js`
- Create: `src/services/chat-service.js`
- Create: `src/services/backup-service.js`
- Create: `src/app/create-browser-services.js`
- Create: `tests/provider-service.test.js`
- Create: `tests/chat-service.test.js`
- Create: `tests/backup-service.test.js`

**Interfaces:**
- Produces: `ProviderService`, `ChatService`, `BackupService`, `createBrowserServices()`.
- Chat callbacks: `onMessage(message)`, `onConversation(conversation)`, `onState({ generating, requestId })`.

- [ ] **Step 1: Write failing ProviderService tests**

Verify new API keys are encrypted, blank edit keys preserve existing ciphertext, returned forms expose only `hasApiKey`, connection tests persist status, and models cache is updated.

- [ ] **Step 2: Implement ProviderService and verify pass**

Run: `node --test tests/provider-service.test.js`
Expected: all provider service tests pass.

- [ ] **Step 3: Write failing ChatService lifecycle tests**

Use in-memory repository/provider fakes to verify send pair creation, streaming updates, completion, stop, failure, title generation, retry relation, and double-send rejection.

- [ ] **Step 4: Implement ChatService and verify pass**

Persist after 500 ms or 200 characters, abort via `AbortController`, and guarantee final status persistence in `finally` paths.

Run: `node --test tests/chat-service.test.js`
Expected: all chat lifecycle tests pass.

- [ ] **Step 5: Write and pass BackupService tests**

Verify export excludes encrypted fields and import writes only after complete validation.

Run: `node --test tests/backup-service.test.js`
Expected: all backup service tests pass.

### Task 6: Connect Real State To Version C UI

**Files:**
- Modify: `pages/index/index.vue`
- Modify: `src/ui-state.js`
- Modify: `tests/ui-state.test.js`

**Interfaces:**
- Consumes: `createBrowserServices()` and all application services.
- Produces: fully interactive existing four-screen UI.

- [ ] **Step 1: Extend failing UI state tests**

Add tests for active conversation/provider selection, generating guard, provider form initialization, and conversation summaries.

- [ ] **Step 2: Run UI state tests and verify failure**

Run: `node --test tests/ui-state.test.js`
Expected: FAIL for missing helpers.

- [ ] **Step 3: Implement state helpers and verify pass**

Keep helpers pure and independent from browser APIs.

- [ ] **Step 4: Replace static records with service-backed data**

On mount initialize repository/vault, recover interrupted messages, seed one editable default OpenAI profile only when empty, and load persisted state.

- [ ] **Step 5: Wire provider functions**

Implement add/edit/save/delete, password input, model loading, model selection, connection status, and visible validation errors.

- [ ] **Step 6: Wire chat and conversation functions**

Render persisted messages, send on button/keyboard, stream text, stop, retry, new conversation, search, rename, delete, and current provider/model selection.

- [ ] **Step 7: Wire settings and backup functions**

Persist system prompt switch and encrypted value; add import/export action modal with a hidden file input and browser download.

- [ ] **Step 8: Preserve visual geometry**

Reuse existing layout classes and add only overlays, inline status/error elements, dynamic message classes, and disabled states.

- [ ] **Step 9: Run unit tests and production build**

Run: `npm test`
Expected: 0 failures.

Run: `npm run build`
Expected: exit code 0.

### Task 7: Browser Functional And Visual Verification

**Files:**
- Modify: `design-qa.md`
- Create: `.codex-runtime/screens/functional-conversations.png`
- Create: `.codex-runtime/screens/functional-chat.png`
- Create: `.codex-runtime/screens/functional-providers.png`
- Create: `.codex-runtime/screens/functional-settings.png`

**Interfaces:**
- Consumes: running Vite preview and mock SSE endpoint behavior.
- Produces: verified persistence, streaming, stopping, provider editing, backup actions, console health, and unchanged layout evidence.

- [ ] **Step 1: Restart the Vite server**

Run: `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`
Expected: preview responds at `http://127.0.0.1:4173/preview/`.

- [ ] **Step 2: Exercise mock streaming flow**

Intercept or serve a local OpenAI-compatible `/models` and `/chat/completions` response. Verify provider save/test, message growth, stop behavior, retry, and no duplicate send.

- [ ] **Step 3: Verify persistence and encryption**

Reload the page and confirm records remain. Inspect IndexedDB record shapes and confirm the known test key/prompt plaintext does not appear in stored provider/settings records.

- [ ] **Step 4: Verify management flows**

Test new/search/rename/delete conversation, provider delete guard, system prompt toggle, JSON export, and JSON import validation.

- [ ] **Step 5: Capture four 390 x 844 screenshots**

Capture the same four Version C states and compare against the prior accepted screenshots. Fix any new P0/P1/P2 layout regression.

- [ ] **Step 6: Final verification**

Run: `npm test`
Expected: 0 failures.

Run: `npm run build`
Expected: exit code 0.

Confirm browser console has no relevant errors and update `design-qa.md` with functional verification evidence.

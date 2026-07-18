# Fetch Provider Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated provider-form button that fetches `/models` from current unsaved values without persisting the provider.

**Architecture:** `ProviderService.fetchModels(form)` resolves a temporary request profile and keeps secrets behind the service boundary. A pure UI-state helper applies returned models, while the existing Vue provider page owns loading and error presentation.

**Tech Stack:** Vue 3, Vite, Node test runner, IndexedDB test doubles, Fetch, Playwright.

## Completion Status

- [x] ProviderService temporary model discovery implemented without persistence.
- [x] Form model-state helper implemented and tested.
- [x] Provider action button implemented and verified at 390 x 844.
- [x] Unit tests: 55 passed, 0 failed.
- [x] Browser QA: 13 checks passed.
- [x] Production build completed successfully.

## Global Constraints

- Fetching models must not write provider changes to IndexedDB.
- Existing providers with a blank key field reuse their encrypted stored key.
- A non-empty temporary form key overrides the stored key for that request only.
- Preserve a non-empty default model; select the first returned model only when the default is empty.
- Keep the existing Version C layout and 390 x 844 geometry.
- The workspace is not a Git repository, so commit steps are omitted.

---

### Task 1: Temporary Provider Model Discovery

**Files:**
- Modify: `tests/provider-service.test.js`
- Modify: `src/services/provider-service.js`

**Interfaces:**
- Consumes: `normalizeOpenAIBaseUrl(input)`, `repository.getProvider(id)`, `vault.decryptString(record)`, `provider.listModels(profile)`.
- Produces: `ProviderService.fetchModels(form): Promise<string[]>`.

- [ ] **Step 1: Write failing tests for unsaved model discovery**

Add tests that capture the temporary profile and repository writes:

```js
test('fetches models from unsaved form values without persisting the provider', async () => {
  const { repository, service } = await setup()
  let writes = 0
  const originalSave = repository.saveProvider.bind(repository)
  repository.saveProvider = async (...args) => {
    writes += 1
    return originalSave(...args)
  }
  let profile
  service.provider.listModels = async (value) => {
    profile = value
    return ['model-b', 'model-a']
  }

  const models = await service.fetchModels({
    name: 'Unsaved',
    baseUrl: 'http://127.0.0.1:4319',
    apiKey: 'temporary-key',
    defaultModel: 'manual-model'
  })

  assert.deepEqual(models, ['model-b', 'model-a'])
  assert.equal(profile.baseUrl, 'http://127.0.0.1:4319/v1')
  assert.equal(profile.apiKey, 'temporary-key')
  assert.equal(writes, 0)
})

test('reuses the stored encrypted key when an edit form key is blank', async () => {
  const { service } = await setup()
  await service.saveProvider({
    name: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: 'stored-key', defaultModel: 'gpt-test'
  })
  let profile
  service.provider.listModels = async (value) => {
    profile = value
    return ['gpt-test']
  }

  await service.fetchModels({ id: 'provider-1', baseUrl: 'https://example.com/v1', apiKey: '' })

  assert.equal(profile.baseUrl, 'https://example.com/v1')
  assert.equal(profile.apiKey, 'stored-key')
})

test('uses a temporary edit key instead of the stored key', async () => {
  const { service } = await setup()
  await service.saveProvider({
    name: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: 'stored-key', defaultModel: 'gpt-test'
  })
  let profile
  service.provider.listModels = async (value) => {
    profile = value
    return ['gpt-test']
  }

  await service.fetchModels({
    id: 'provider-1', baseUrl: 'https://example.com/v1', apiKey: 'temporary-edit-key'
  })

  assert.equal(profile.apiKey, 'temporary-edit-key')
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/provider-service.test.js`

Expected: FAIL because `service.fetchModels` is not defined.

- [ ] **Step 3: Implement the temporary request profile**

Add to `ProviderService`:

```js
  async fetchModels(form) {
    const existing = form?.id ? await this.repository.getProvider(form.id) : null
    const temporaryKey = String(form?.apiKey ?? '').trim()
    const apiKey = temporaryKey || (
      existing?.encryptedApiKey
        ? await this.vault.decryptString(existing.encryptedApiKey)
        : ''
    )
    return this.provider.listModels({
      id: form?.id ?? null,
      protocolType: 'openai-compatible',
      baseUrl: normalizeOpenAIBaseUrl(form?.baseUrl),
      apiKey,
      defaultModel: String(form?.defaultModel ?? '').trim()
    })
  }
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/provider-service.test.js`

Expected: all ProviderService tests pass.

### Task 2: Apply Returned Models To Form State

**Files:**
- Modify: `tests/ui-state.test.js`
- Modify: `src/ui-state.js`

**Interfaces:**
- Consumes: provider form shaped as `{ defaultModel: string, modelsCache: string[] }`.
- Produces: `applyFetchedModels(form, models)`.

- [ ] **Step 1: Write failing form-state tests**

Import `applyFetchedModels` and add:

```js
test('applies fetched models without replacing a non-empty default', () => {
  const form = createProviderForm({ defaultModel: 'manual-model' })
  applyFetchedModels(form, ['model-a', 'model-b'])
  assert.equal(form.defaultModel, 'manual-model')
  assert.deepEqual(form.modelsCache, ['model-a', 'model-b'])
})

test('selects the first fetched model when the default is empty', () => {
  const form = createProviderForm({ defaultModel: '' })
  applyFetchedModels(form, ['model-a', 'model-b'])
  assert.equal(form.defaultModel, 'model-a')
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/ui-state.test.js`

Expected: FAIL because `applyFetchedModels` is not exported.

- [ ] **Step 3: Implement the pure state helper**

Add to `src/ui-state.js`:

```js
export function applyFetchedModels(form, models) {
  const nextModels = Array.isArray(models) ? [...models] : []
  form.modelsCache = nextModels
  if (!String(form.defaultModel ?? '').trim() && nextModels.length) {
    form.defaultModel = nextModels[0]
  }
  return form
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/ui-state.test.js`

Expected: all UI-state tests pass.

### Task 3: Provider Form Button And Browser Verification

**Files:**
- Modify: `pages/index/index.vue`
- Verify: `http://127.0.0.1:4173/preview/`

**Interfaces:**
- Consumes: `providerService.fetchModels(form)`, `applyFetchedModels(form, models)`.
- Produces: visible `获取模型列表` action with loading, success, and failure states.

- [ ] **Step 1: Wire page state and handler**

Import `applyFetchedModels`, add `providerLoadingModels: false`, include it in `providerBusy`, and add:

```js
async fetchProviderModels() {
  this.providerLoadingModels = true
  this.errorMessage = ''
  try {
    const models = await this.services.providerService.fetchModels(this.providerForm)
    applyFetchedModels(this.providerForm, models)
    this.showToast(`已获取 ${models.length} 个模型`)
  } catch (error) {
    this.handleError(error, '获取模型列表失败')
  } finally {
    this.providerLoadingModels = false
  }
}
```

- [ ] **Step 2: Add the button without changing page structure**

Replace the provider action row with:

```vue
<view class="test-row">
  <view class="provider-actions">
    <button class="test-button" :disabled="providerBusy" @click="fetchProviderModels">
      {{ providerLoadingModels ? '获取中...' : '获取模型列表' }}
    </button>
    <button class="test-button" :disabled="providerBusy" @click="testConnection">
      {{ providerTesting ? '测试中...' : '测试连接' }}
    </button>
  </view>
  <view class="test-success" :class="{ visible: connectionStatus === 'success' }"><text>连接成功</text><Check :size="15" /></view>
  <text v-if="connectionStatus === 'failed'" class="test-error">连接失败</text>
</view>
```

Add a stable action group:

```css
.provider-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
```

- [ ] **Step 3: Run all automated tests**

Run: `npm test`

Expected: 55 tests pass, 0 fail.

- [ ] **Step 4: Run production build**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 5: Verify the rendered flow with Playwright**

The flow under test is: provider tab -> edit unsaved base URL/key -> click `获取模型列表` -> dropdown contains `mock-chat` and `mock-reasoning` -> unsaved form values remain -> provider record in IndexedDB remains unchanged.

Use `http://127.0.0.1:4173/preview/` at 390 x 844. Confirm:

```text
page title = AI 对话应用
button text transitions 获取模型列表 -> 获取中... -> 获取模型列表
toast = 已获取 2 个模型
default-model dropdown contains mock-chat and mock-reasoning
no provider repository write occurs before Save
no Vite overlay, console warning, console error, or page error
the two action buttons fit on one row without overlap
```

- [ ] **Step 6: Capture final mobile evidence**

Save the focused provider screenshot to `.codex-runtime/screens/fetch-models-provider.png` and compare the action-row geometry with the accepted Version C provider screen.

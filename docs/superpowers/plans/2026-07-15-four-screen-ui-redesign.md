# Four-Screen UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the conversations, providers, settings overview, and settings details states to match the supplied blue mobile reference while preserving every existing service and interaction.

**Architecture:** Keep the four target states inside `pages/index/index.vue` so existing methods and service bindings remain intact. Add pure settings-view transitions to `src/ui-state.js`, restructure only the target templates, and replace the current monochrome page tokens with a reference-matched blue visual system.

**Tech Stack:** Vue 3, uni-app, Vite browser preview, local App font icons, PNG provider logos, Node test runner, Android HBuilderX runtime.

## Global Constraints

- Only redesign conversations, providers, settings overview, and settings details.
- Preserve the conversations page layout; change only its visual treatment.
- Do not redesign chat or `pages/android-diagnostics/index.vue`.
- Do not change repositories, encryption, cloud APIs, backup formats, provider protocols, or database schemas.
- Keep the native phone status bar; do not add a simulated status bar.
- Use solid `#1F6FCB` headers, not gradients.
- Cards use at most `8px` corner radii.
- Keep local font icons and raster provider logos; do not reintroduce runtime SVG components.
- Verify at browser viewport `390 x 844` and on the available Android emulator.
- The workspace is not a Git repository, so commit steps are omitted.

---

### Task 1: Settings View State

**Files:**
- Modify: `tests/ui-state.test.js`
- Modify: `src/ui-state.js`

**Interfaces:**
- Produces: `openSettingsDetails(state): void`.
- Produces: `closeSettingsDetails(state): void`.
- Extends: `createInitialUiState()` with `settingsView: 'overview'`.
- Extends: `selectTab(state, tab)` so entering settings resets to the overview.

- [ ] **Step 1: Write failing state-transition tests**

Import `openSettingsDetails` and `closeSettingsDetails` in `tests/ui-state.test.js`, then add:

```js
test('settings opens details and returns to overview', () => {
  const state = createInitialUiState()

  selectTab(state, 'settings')
  assert.equal(state.settingsView, 'overview')

  openSettingsDetails(state)
  assert.equal(state.screen, 'settings')
  assert.equal(state.activeTab, 'settings')
  assert.equal(state.settingsView, 'details')

  closeSettingsDetails(state)
  assert.equal(state.settingsView, 'overview')
})

test('re-entering settings always starts at overview', () => {
  const state = createInitialUiState()
  openSettingsDetails(state)

  selectTab(state, 'providers')
  selectTab(state, 'settings')

  assert.equal(state.settingsView, 'overview')
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/ui-state.test.js`

Expected: FAIL because `openSettingsDetails`, `closeSettingsDetails`, and `settingsView` do not exist.

- [ ] **Step 3: Implement settings-view transitions**

Add `settingsView: 'overview'` to `createInitialUiState()`. Add:

```js
export function openSettingsDetails(state) {
  state.activeTab = 'settings'
  state.screen = 'settings'
  state.settingsView = 'details'
}

export function closeSettingsDetails(state) {
  state.settingsView = 'overview'
}
```

Update `selectTab` after assigning `screen`:

```js
if (tab === 'settings') state.settingsView = 'overview'
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/ui-state.test.js`

Expected: all UI-state tests pass.

### Task 2: Four-Screen Structure Guard

**Files:**
- Create: `tests/four-screen-ui.test.js`
- Modify: `pages/index/index.vue`

**Interfaces:**
- Consumes: `openSettingsDetails(state)` and `closeSettingsDetails(state)`.
- Produces template states identified by `.conversations-view`, `.providers-view`, `.settings-overview`, and `.settings-details`.

- [ ] **Step 1: Write the failing source-structure test**

Create `tests/four-screen-ui.test.js`:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('main page exposes the four approved reference states', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  for (const className of [
    'conversations-view', 'providers-view', 'provider-card', 'provider-form-card',
    'settings-overview', 'settings-details', 'cloud-backup-card', 'settings-detail-header'
  ]) {
    assert.match(source, new RegExp(className))
  }

  assert.match(source, /ui\.settingsView === 'overview'/)
  assert.match(source, /openSettingsDetails\(ui\)/)
  assert.match(source, /closeSettingsDetails\(ui\)/)
  assert.match(source, /#1F6FCB/i)
  assert.doesNotMatch(source, /linear-gradient|radial-gradient/)
})
```

- [ ] **Step 2: Run the structure test and verify RED**

Run: `node --test tests/four-screen-ui.test.js`

Expected: FAIL because the approved view classes and settings-detail state are absent.

- [ ] **Step 3: Mark the conversations view without changing its hierarchy**

Change the conversations root template to:

```vue
<template v-if="ui.screen === 'conversations'">
  <view class="screen-view conversations-view">
    <view class="screen-header reference-header conversations-header">
      <text class="screen-title">会话</text>
      <button class="icon-button" aria-label="刷新会话" @click="loadConversations"><RefreshCw :size="19" /></button>
    </view>
    <view class="search-box"><input v-model="searchQuery" placeholder="搜索会话" /><Search :size="19" /></view>
    <scroll-view class="conversation-list" scroll-y>
      <view v-if="!filteredConversations.length" class="empty-state"><text>暂无会话</text></view>
      <button v-for="conversation in filteredConversations" :key="conversation.id" class="conversation-row" :data-conversation-id="conversation.id" @click="openChat(conversation.id)">
        <view class="row-icon"><component :is="iconMap[conversation.icon]" :size="20" /></view>
        <view class="conversation-copy"><view class="row-title-line"><text class="row-title">{{ conversation.title }}</text><text class="row-time">{{ conversation.time }}</text></view><text class="row-preview">{{ conversation.preview }}</text></view>
        <MoreVertical class="row-menu" :size="17" @click.stop="manageConversation(conversation)" />
      </button>
    </scroll-view>
    <button class="floating-add" aria-label="新建会话" @click="addConversation"><Plus :size="26" /></button>
  </view>
</template>
```

The wrapper becomes a fixed-height flex column; existing search, list rows, and floating action behavior remain unchanged.

- [ ] **Step 4: Rebuild the providers view hierarchy**

Use this structure around the existing bindings and handlers:

```vue
<template v-else-if="ui.screen === 'providers'">
  <view class="screen-view providers-view">
    <view class="screen-header reference-header provider-header">
      <text class="screen-title">接口</text>
      <button class="header-command" @click="addProvider"><Plus :size="16" /><text>添加接口</text></button>
    </view>
    <scroll-view class="provider-screen reference-scroll" scroll-y>
      <view class="provider-list">
        <button v-for="provider in providerItems" :key="provider.id" class="provider-card" :class="{ selected: provider.id === ui.activeProviderId }" @click="selectProvider(provider.id)">
          <image class="provider-logo provider-logo-large" :src="provider.logo || '/static/providers/openai.png'" mode="aspectFit" />
          <view class="provider-copy">
            <text class="provider-name">{{ provider.name }}</text>
            <text class="provider-url">{{ provider.baseUrl }}</text>
            <text class="provider-model">默认模型：{{ provider.defaultModel }}</text>
          </view>
          <view class="provider-selection"><Check v-if="provider.id === ui.activeProviderId" :size="17" /></view>
          <MoreVertical v-if="provider.id !== ui.activeProviderId" :size="18" @click.stop="deleteProvider(provider)" />
        </button>
      </view>
      <text class="content-section-label">{{ providerForm.id ? '编辑接口' : '添加接口' }}</text>
      <view class="provider-form provider-form-card">
        <label class="form-row"><text>名称</text><input v-model="providerForm.name" placeholder="接口名称" /></label>
        <label class="form-row"><text>基础地址</text><input v-model="providerForm.baseUrl" placeholder="https://example.com/v1" /></label>
        <label class="form-row"><text>API 密钥</text><view class="password-field"><input v-model="providerForm.apiKey" :type="showApiKey ? 'text' : 'password'" :placeholder="providerForm.hasApiKey ? '已安全保存，留空不修改' : '可留空'" /><button aria-label="显示或隐藏密钥" @click="showApiKey = !showApiKey"><EyeOff :size="16" /></button></view></label>
        <label class="form-row"><text>默认模型</text><select v-model="providerForm.defaultModel" class="select-field"><option v-if="!providerForm.modelsCache.includes(providerForm.defaultModel)" :value="providerForm.defaultModel">{{ providerForm.defaultModel || '手动输入' }}</option><option v-for="model in providerForm.modelsCache" :key="model" :value="model">{{ model }}</option></select></label>
        <label class="form-row"><text>手动模型</text><input v-model="providerForm.defaultModel" placeholder="例如 gpt-4o-mini" /></label>
        <view class="provider-form-actions">
          <button class="secondary-button" :disabled="providerBusy" @click="fetchProviderModels">{{ providerLoadingModels ? '获取中...' : '获取模型列表' }}</button>
          <button class="secondary-button" :disabled="providerBusy" @click="testConnection">{{ providerTesting ? '测试中...' : '测试连接' }}</button>
          <button class="primary-button" :disabled="providerBusy" @click="saveProvider">保存</button>
        </view>
        <view class="connection-result"><view class="test-success" :class="{ visible: connectionStatus === 'success' }"><Check :size="15" /><text>连接成功</text></view><text v-if="connectionStatus === 'failed'" class="test-error">连接失败</text></view>
      </view>
    </scroll-view>
  </view>
</template>
```

- [ ] **Step 5: Run the production build as a template check**

Run: `npm run build`

Expected: exit code 0 with no Vue template errors.

### Task 3: Settings Overview And Details

**Files:**
- Modify: `pages/index/index.vue`
- Test: `tests/four-screen-ui.test.js`

**Interfaces:**
- Consumes: the existing system-prompt, local-data, import/export, cloud, app-lock, diagnostics, update, and feedback methods.
- Produces: overview-to-details and details-to-overview interactions without a new route.

- [ ] **Step 1: Import and expose the settings transition helpers**

Add `ArrowLeft` to the local icon import and component registration. Import `openSettingsDetails` and `closeSettingsDetails` from `src/ui-state.js`, then expose them under `methods` using their imported names. Change page data from `cloudOpen: false` to `cloudOpen: true` so the overview initially matches the approved expanded reference state.

- [ ] **Step 2: Build the settings overview header and primary card**

Use:

```vue
<view v-if="ui.settingsView === 'overview'" class="screen-view settings-overview">
  <view class="screen-header reference-header settings-header">
    <text class="screen-title">设置</text>
    <button class="icon-button" aria-label="打开设置详情" @click="openSettingsDetails(ui)"><MoreVertical :size="19" /></button>
  </view>
  <scroll-view class="settings-screen reference-scroll" scroll-y>
    <view class="settings-card settings-primary-card">
      <button class="settings-row" @click="systemPromptOpen = !systemPromptOpen"><view class="settings-icon"><FileCog :size="19" /></view><view class="settings-copy"><text>系统提示词</text><text>设置默认提示词，每次请求自动发送</text></view><ChevronRight :size="18" /></button>
      <view v-if="systemPromptOpen" class="prompt-editor"><view class="prompt-controls"><text>启用</text><button class="toggle" :class="{ enabled: systemPromptEnabled }" @click="systemPromptEnabled = !systemPromptEnabled"><view class="toggle-thumb" /></button></view><textarea v-model="systemPrompt" placeholder="输入系统提示词" /><button class="primary-button prompt-save" @click="saveSystemPrompt">保存</button></view>
      <button class="settings-row" @click="showLocalDataInfo"><view class="settings-icon"><Database :size="19" /></view><view class="settings-copy"><text>本地数据</text><text>{{ storageLabel }} 本地优先存储</text></view><ChevronRight :size="18" /></button>
      <button class="settings-row" @click="backupMenuOpen = true"><view class="settings-icon"><Import :size="19" /></view><view class="settings-copy"><text>导入与导出</text><text>导出会话与非敏感配置</text></view><ChevronRight :size="18" /></button>
      <button class="settings-row" @click="cloudOpen = !cloudOpen"><view class="settings-icon"><Cloud :size="19" /></view><view class="settings-copy"><text>云端备份</text><text>{{ cloudConnected ? (cloudSession.user?.email || cloudForm.email || '已登录') : '本地模式，不会自动上传' }}</text></view><ChevronRight :size="18" /></button>
    </view>
  </scroll-view>
</view>
```

Insert the Task 3 cloud card and safety preview blocks immediately before this overview scroll view's closing `</scroll-view>`.

- [ ] **Step 3: Build the dedicated cloud backup card**

Move the existing cloud form and actions into:

```vue
<view v-if="cloudOpen" class="settings-card cloud-backup-card">
  <view class="cloud-card-heading">
    <view class="settings-icon cloud-status-icon"><Cloud :size="20" /></view>
    <view class="settings-copy"><text>云端备份</text><text>{{ cloudConnected ? (cloudSession.user?.email || cloudForm.email || '已登录') : '登录后自动加密备份' }}</text></view>
    <view v-if="cloudConnected" class="enabled-status"><i /><text>已启用</text></view>
  </view>
  <label class="cloud-field"><text>服务器</text><input v-model="cloudForm.baseUrl" :disabled="cloudBusy" placeholder="https://cloud.example.com" /></label>
  <label class="cloud-field"><text>邮箱</text><input v-model="cloudForm.email" :disabled="cloudBusy || cloudConnected" placeholder="name@example.com" /></label>
  <label v-if="!cloudConnected" class="cloud-field"><text>登录密码</text><input v-model="cloudForm.password" :disabled="cloudBusy" type="password" placeholder="至少 12 个字符" /></label>
  <label v-else class="cloud-field"><text>同步密码</text><view class="password-field"><input v-model="cloudForm.syncPassword" :disabled="cloudBusy" type="password" placeholder="用于加密云端备份" /><EyeOff :size="16" /></view></label>
  <view v-if="cloudConnected" class="cloud-auto-row"><view><text>自动备份</text><text>{{ cloudBackupStatus || '前台每 3 分钟检查一次' }}</text></view><button class="toggle" :class="{ enabled: autoBackupEnabled }" :disabled="cloudBusy" @click="toggleAutoBackup"><view class="toggle-thumb" /></button></view>
  <view v-if="!cloudConnected" class="cloud-actions"><button class="secondary-button" :disabled="cloudBusy" @click="registerCloud">注册</button><button class="primary-button" :disabled="cloudBusy" @click="loginCloud">登录</button></view>
  <view v-else class="cloud-actions cloud-actions-wrap"><button class="secondary-button" :disabled="cloudBusy" @click="uploadCloudBackup">立即备份</button><button class="secondary-button" :disabled="cloudBusy" @click="restoreCloudBackup">从云端恢复</button><button class="danger-button" :disabled="cloudBusy" @click="deleteCloudBackup">删除云端备份</button><button class="logout-button" :disabled="cloudBusy" @click="logoutCloud">退出登录</button></view>
</view>
```

Keep every existing `v-model`, `disabled`, and click handler unchanged.

- [ ] **Step 4: Add the safety preview entry**

At the bottom of the overview scroll area, add:

```vue
<text class="settings-section-label">安全</text>
<view class="settings-card settings-preview-card">
  <button class="settings-row" @click="openSettingsDetails(ui)"><view class="settings-icon"><KeyRound :size="19" /></view><view class="settings-copy"><text>API 密钥管理</text><text>使用 {{ encryptionLabel }} 加密后保存</text></view><ChevronRight :size="18" /></button>
</view>
```

- [ ] **Step 5: Build settings details**

Use:

```vue
<view v-else class="screen-view settings-details">
  <view class="screen-header reference-header settings-detail-header">
    <button class="icon-button header-back" aria-label="返回设置概览" @click="closeSettingsDetails(ui)"><ArrowLeft :size="21" /></button>
    <text class="screen-title">设置</text>
  </view>
  <scroll-view class="settings-screen reference-scroll" scroll-y>
    <text class="settings-section-label">安全</text>
    <view class="settings-card">
      <button class="settings-row" @click="goToTab('providers')"><view class="settings-icon"><KeyRound :size="19" /></view><view class="settings-copy"><text>API 密钥管理</text><text>使用 {{ encryptionLabel }} 加密后保存</text></view><ChevronRight :size="18" /></button>
      <button class="settings-row" data-testid="app-lock" @click="toggleLock"><view class="settings-icon"><LockKeyhole :size="19" /></view><view class="settings-copy"><text>应用锁</text><text>当前版本保存开关状态</text></view><view class="toggle" :class="{ enabled: ui.appLockEnabled }"><view class="toggle-thumb" /></view></button>
    </view>
    <text class="settings-section-label">应用信息</text>
    <view class="settings-card">
      <button class="settings-row" @click="openAndroidDiagnostics"><view class="settings-icon"><Activity :size="19" /></view><view class="settings-copy"><text>Android 流式诊断</text><text>验证流式分块、停止和生命周期</text></view><ChevronRight :size="18" /></button>
      <button class="settings-row"><view class="settings-icon"><Info :size="19" /></view><view class="settings-copy"><text>关于应用</text><text>版本 1.0.0 · {{ aboutLabel }}</text></view><ChevronRight :size="18" /></button>
      <button class="settings-row" @click="showToast('当前已是最新开发版本')"><view class="settings-icon"><RefreshCw :size="19" /></view><view class="settings-copy"><text>检查更新</text><text>当前已是最新版本</text></view><ChevronRight :size="18" /></button>
      <button class="settings-row" @click="showToast('反馈功能将在服务端版本接入')"><view class="settings-icon"><CircleHelp :size="19" /></view><view class="settings-copy"><text>帮助与反馈</text><text>使用问题与问题反馈</text></view><ChevronRight :size="18" /></button>
    </view>
  </scroll-view>
</view>
```

- [ ] **Step 6: Run state, structure, and build verification**

Run: `node --test tests/ui-state.test.js tests/four-screen-ui.test.js`

Expected: all focused tests pass.

Run: `npm run build`

Expected: exit code 0.

### Task 4: Reference-Matched Visual System

**Files:**
- Modify: `pages/index/index.vue`
- Test: `tests/four-screen-ui.test.js`

**Interfaces:**
- Consumes the Task 2 and Task 3 class names.
- Produces stable `360px` and `390px` mobile layouts with fixed headers/navigation and scrollable content.

- [ ] **Step 1: Replace page tokens**

Set the app tokens to:

```css
.app-shell {
  --page: #f5f7fa;
  --card: #ffffff;
  --text: #172033;
  --muted: #758196;
  --border: #dce3ec;
  --soft: #f0f3f7;
  --soft-strong: #e8f1fd;
  --accent: #1f6fcb;
  --accent-strong: #155db6;
  --success: #36b52a;
  --danger: #e5484d;
}
```

- [ ] **Step 2: Style common headers, view shells, scroll areas, and bottom navigation**

Apply solid blue reference headers and stable content geometry:

```css
.screen-view { position: relative; display: flex; flex: 1; min-height: 0; flex-direction: column; }
.reference-header { height: 56px; padding: 0 16px; background: var(--accent); color: #fff; }
.reference-header .screen-title { font-size: 19px; font-weight: 700; }
.reference-header .icon-button, .header-command { color: #fff; }
.reference-scroll { flex: 1; min-height: 0; background: var(--page); }
.bottom-nav { height: 64px; background: #fff; }
.nav-item { color: #657184; }
.nav-item.active { color: var(--accent); }
```

- [ ] **Step 3: Recolor conversations without changing layout**

Keep the existing dimensions and use:

```css
.conversations-view .search-box { background: #eef2f7; }
.conversations-view .conversation-list { padding-top: 8px; background: var(--page); }
.conversations-view .conversation-row { margin-bottom: 8px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: #fff; box-shadow: 0 2px 8px rgba(29, 55, 90, 0.05); }
.conversations-view .row-icon { background: var(--soft-strong); color: var(--accent); }
.conversations-view .floating-add { background: var(--accent); }
```

- [ ] **Step 4: Style providers to match the reference**

Use compact white cards and stacked fields:

```css
.provider-screen { padding: 14px 12px 88px; }
.provider-list { padding: 0; }
.provider-card { display: flex; align-items: center; width: 100%; min-height: 88px; padding: 13px; border: 1px solid var(--border); border-radius: 8px; background: #fff; box-shadow: 0 2px 8px rgba(29, 55, 90, 0.06); }
.provider-selection { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: #fff; }
.content-section-label { display: block; margin: 18px 2px 8px; font-size: 13px; color: #526077; }
.provider-form-card { padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: #fff; }
.provider-form-card .form-row { display: flex; align-items: stretch; flex-direction: column; gap: 6px; margin-bottom: 11px; }
.provider-form-actions { display: grid; grid-template-columns: 1fr 1fr auto; gap: 7px; }
.primary-button { background: var(--accent); color: #fff; }
.secondary-button { background: var(--soft); color: var(--accent-strong); }
```

- [ ] **Step 5: Style settings cards, cloud controls, detail groups, and toggles**

Use:

```css
.settings-screen { padding: 12px 10px 88px; }
.settings-card { border: 1px solid var(--border); border-radius: 8px; background: #fff; box-shadow: 0 2px 8px rgba(29, 55, 90, 0.05); }
.settings-row { min-height: 61px; padding: 10px 12px; }
.settings-icon { color: var(--accent); }
.cloud-backup-card { margin-top: 10px; padding: 12px; }
.cloud-card-heading { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.enabled-status { display: flex; align-items: center; gap: 5px; color: var(--success); font-size: 11px; }
.enabled-status i { width: 7px; height: 7px; border-radius: 50%; background: var(--success); }
.cloud-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.toggle.enabled { background: var(--accent); }
.settings-detail-header { justify-content: flex-start; gap: 8px; }
```

- [ ] **Step 6: Verify responsive constraints**

At `360px` and `390px`, confirm provider actions wrap or remain readable, settings labels do not overlap trailing icons, cloud buttons remain inside the card, and fixed navigation does not cover the final row.

### Task 5: Functional And Visual QA

**Files:**
- Modify: `design-qa.md`
- Create outside source control: browser and emulator screenshots for all four states.

**Interfaces:**
- Consumes the completed four-screen implementation.
- Produces test, build, interaction, screenshot, and comparison evidence.

- [ ] **Step 1: Run complete automated verification**

Run: `npm test`

Expected: all tests pass with zero failures.

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 2: Start or reuse the browser preview**

Use the existing Vite preview at `http://127.0.0.1:4173/preview/`, or start the configured browser development command on the next free port. Verify no framework overlay and no relevant console errors.

- [ ] **Step 3: Exercise the four-state flow**

The flow under test is: conversations -> providers -> settings overview -> settings details -> back to settings overview.

Verify provider selection and editing still populate the form, model and connection buttons respond, settings details opens and closes, app lock toggles, cloud actions retain disabled/loading states, and bottom navigation remains active and stable.

- [ ] **Step 4: Capture browser screenshots**

Capture each target state at `390 x 844` with equivalent data visible to the reference. Ensure no horizontal overflow, clipped controls, or overlapping fixed elements.

- [ ] **Step 5: Compare with the reference and iterate**

Compare against `C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-93528754-ed2a-4af5-b4b1-a0c1cc3555ab.png`. Record findings in `design-qa.md`, fix every P0/P1/P2 mismatch, recapture, and repeat until the file says `final result: passed`.

- [ ] **Step 6: Verify Android when the emulator is available**

Cold-start the HBuilder app, navigate through the same four states, verify local font icons and PNG provider logos, inspect logcat for JavaScript errors, and capture final emulator screenshots. If no emulator is connected, report Android visual verification as blocked rather than inferred.

# Chat Reference Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the existing chat screen to match the supplied mobile reference, add completed-message double checks, and turn the lower-left plus button into a visual attachment menu.

**Architecture:** Keep chat lifecycle, persistence, provider, and SSE services unchanged. Add pure UI helpers for attachment actions and read-receipt visibility, then update the existing Vue page template, page-local state, and chat-specific CSS.

**Tech Stack:** Vue 3, Vite, Lucide Vue icons, Node test runner, Playwright.

## Completion Status

- [x] Read-receipt and attachment UI state implemented.
- [x] Chat template and placeholder attachment interactions implemented.
- [x] Reference-matched toolbar, message cards, generation dots, and composer implemented.
- [x] Unit tests: 57 passed, 0 failed.
- [x] Browser QA: 13 checks passed.
- [x] Design QA completed with no remaining P0, P1, or P2 findings.
- [x] Production build completed successfully.

## Global Constraints

- Preserve the working send, stream, stop, retry, model-selection, and conversation-management behavior.
- Do not modify message storage, backup format, encryption, provider protocol, or request payloads.
- The plus button opens attachment entries for `图片`, `拍照`, and `文件`; it must not open a picker or read files.
- Show a blue double check only for user messages whose existing status is `completed`.
- Match the supplied reference at 390 x 844 without horizontal scroll, clipped controls, or overlap.
- Continue using the installed Lucide Vue icon library.
- The workspace is not a Git repository, so commit steps are omitted.

---

### Task 1: Read Receipt And Attachment UI State

**Files:**
- Modify: `tests/ui-state.test.js`
- Modify: `src/ui-state.js`

**Interfaces:**
- Produces: `attachmentActions: Array<{ id: string, label: string, icon: string }>`.
- Produces: `isUserMessageRead(message): boolean`.

- [ ] **Step 1: Write failing UI-state tests**

Import `attachmentActions` and `isUserMessageRead`, then add:

```js
test('attachment actions expose image camera and file entry points', () => {
  assert.deepEqual(attachmentActions.map((item) => item.id), ['image', 'camera', 'file'])
  assert.deepEqual(attachmentActions.map((item) => item.label), ['图片', '拍照', '文件'])
})

test('shows read receipt only for completed user messages', () => {
  assert.equal(isUserMessageRead({ role: 'user', status: 'completed' }), true)
  assert.equal(isUserMessageRead({ role: 'user', status: 'failed' }), false)
  assert.equal(isUserMessageRead({ role: 'assistant', status: 'completed' }), false)
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/ui-state.test.js`

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement the pure UI helpers**

Add to `src/ui-state.js`:

```js
export const attachmentActions = [
  { id: 'image', label: '图片', icon: 'Image' },
  { id: 'camera', label: '拍照', icon: 'Camera' },
  { id: 'file', label: '文件', icon: 'FileText' }
]

export function isUserMessageRead(message) {
  return message?.role === 'user' && message?.status === 'completed'
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/ui-state.test.js`

Expected: all UI-state tests pass.

### Task 2: Chat Template And Interaction Wiring

**Files:**
- Modify: `pages/index/index.vue`

**Interfaces:**
- Consumes: `attachmentActions`, `isUserMessageRead(message)`.
- Produces: `attachmentMenuOpen`, `toggleAttachmentMenu()`, `chooseAttachmentAction()`, and `toggleModelMenu()` page behavior.

- [ ] **Step 1: Add required icons and state imports**

Add `Camera`, `CheckCheck`, `FileText`, `History`, and `Image` to the Lucide import and component registration. Import `attachmentActions` and `isUserMessageRead` from `src/ui-state.js`, then expose them from page data:

```js
const iconMap = { MessageCircle, Server, Settings, Image, Camera, FileText }

data() {
  return {
    // existing fields
    attachmentActions,
    attachmentMenuOpen: false
  }
}
```

- [ ] **Step 2: Replace toolbar interactions**

Use `toggleModelMenu` for the selector and replace the security button with:

```vue
<button class="icon-button" aria-label="会话历史" @click="showToast('历史记录已保存在当前会话中')">
  <History :size="21" />
</button>
```

- [ ] **Step 3: Add read receipt and assistant footer structure**

Render user metadata with the helper:

```vue
<view class="message-meta user-message-meta">
  <text class="message-time">{{ formatMessageTime(message.updatedAt) }}</text>
  <CheckCheck v-if="isUserMessageRead(message)" class="read-receipt" :size="16" :stroke-width="2.2" />
</view>
```

For completed assistant messages, wrap actions and time in:

```vue
<view class="assistant-footer">
  <view class="message-actions">
    <button aria-label="复制" @click="copyMessage(message.content)"><Copy :size="17" /></button>
    <button aria-label="赞同"><ThumbsUp :size="17" /></button>
    <button aria-label="不赞同"><ThumbsDown :size="17" /></button>
    <button class="retry-action" @click="retryMessage(message.id)"><RotateCcw :size="15" /><text>重试</text></button>
  </view>
  <text class="assistant-time">{{ formatMessageTime(message.updatedAt) }}</text>
</view>
```

- [ ] **Step 4: Replace the generating spinner with animated dots**

Keep the stop action and use:

```vue
<view v-if="message.status === 'generating'" class="generation-status">
  <view class="generation-dots"><i /><i /><i /></view>
  <button class="stop-inline" @click="stopGeneration"><Square :size="12" fill="currentColor" /><text>停止生成</text></button>
</view>
```

- [ ] **Step 5: Replace the plus-button behavior and add the attachment popover**

Add a backdrop before the composer and use the new lower-left control:

```vue
<view v-if="attachmentMenuOpen" class="attachment-backdrop" @click="attachmentMenuOpen = false" />
<view class="composer" :class="{ 'menu-open': attachmentMenuOpen }">
  <view v-if="attachmentMenuOpen" class="attachment-popover">
    <button v-for="action in attachmentActions" :key="action.id" class="attachment-action" :aria-label="action.label" @click="chooseAttachmentAction(action)">
      <component :is="iconMap[action.icon]" :size="20" />
      <text>{{ action.label }}</text>
    </button>
  </view>
  <button class="composer-add" aria-label="添加附件" @click="toggleAttachmentMenu"><Plus :size="23" /></button>
  <textarea v-model="draftMessage" auto-height placeholder="输入消息..." @focus="attachmentMenuOpen = false" @keydown.enter.exact.prevent="sendMessage" />
  <!-- existing send/stop button -->
</view>
```

- [ ] **Step 6: Add menu lifecycle methods**

Add:

```js
isUserMessageRead,
toggleModelMenu() {
  this.attachmentMenuOpen = false
  this.modelMenuOpen = !this.modelMenuOpen
},
toggleAttachmentMenu() {
  this.modelMenuOpen = false
  this.attachmentMenuOpen = !this.attachmentMenuOpen
},
chooseAttachmentAction() {
  this.attachmentMenuOpen = false
  this.showToast('将在后续版本支持')
}
```

Set `attachmentMenuOpen = false` inside `openChat`, `backToConversations`, `goToTab`, `addConversation`, and before `chatService.send()` in `sendMessage`.

- [ ] **Step 7: Run the production build as a template check**

Run: `npm run build`

Expected: exit code 0 with no Vue template errors.

### Task 3: Reference-Matched Chat Styling

**Files:**
- Modify: `pages/index/index.vue`

**Interfaces:**
- Consumes: the Task 2 chat template classes.
- Produces: stable 390 x 844 chat layout matching the reference hierarchy.

- [ ] **Step 1: Restyle toolbar and model title**

Apply:

```css
.chat-toolbar {
  min-height: 58px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
}

.model-selector {
  min-width: 0;
  max-width: 238px;
  font-size: 16px;
  font-weight: 700;
}

.model-selector text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 2: Restyle user and assistant messages**

Apply the reference geometry:

```css
.chat-scroll { padding: 0 14px 18px; }
.message { margin-bottom: 18px; }
.message-bubble { max-width: 76%; padding: 12px 14px 10px; border-radius: 15px; }
.user-bubble { background: #f0f2ff; border-bottom-right-radius: 5px; }
.message-meta { display: flex; justify-content: flex-end; align-items: center; gap: 4px; margin-top: 6px; }
.read-receipt { color: #5b67f1; }
.message-assistant { gap: 12px; }
.assistant-avatar { width: 32px; height: 32px; }
.assistant-body {
  width: calc(100% - 44px);
  padding: 15px 14px 11px;
  border-radius: 15px;
  background: #fff;
  box-shadow: 0 5px 18px rgba(24, 30, 42, 0.055);
}
.assistant-footer { display: flex; align-items: flex-end; gap: 12px; margin-top: 4px; }
.message-actions { flex: 1; }
.assistant-time { font-size: 10px; color: var(--muted); flex: 0 0 auto; }
```

- [ ] **Step 3: Style animated generation dots**

Apply:

```css
.generation-dots { display: flex; align-items: center; gap: 5px; }
.generation-dots i { width: 7px; height: 7px; border-radius: 50%; background: #63b6a5; animation: dot-pulse 1.15s ease-in-out infinite; }
.generation-dots i:nth-child(2) { animation-delay: 0.16s; }
.generation-dots i:nth-child(3) { animation-delay: 0.32s; }
@keyframes dot-pulse { 0%, 70%, 100% { opacity: 0.35; transform: translateY(0); } 35% { opacity: 1; transform: translateY(-2px); } }
```

- [ ] **Step 4: Restyle composer and attachment menu**

Apply:

```css
.composer {
  position: relative;
  z-index: 8;
  align-items: center;
  gap: 9px;
  min-height: 66px;
  margin: 0 14px 10px;
  padding: 7px;
  border: 1px solid #d9def4;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 7px 20px rgba(31, 38, 59, 0.08);
}
.composer-add, .composer-stop { width: 43px; height: 43px; border-radius: 13px; }
.composer textarea { min-height: 43px; padding: 11px 12px; border-radius: 12px; background: #f3f4f8; }
.composer-stop { border-color: #5b61f3; background: #5b61f3; }
.attachment-backdrop { position: absolute; inset: 0; z-index: 7; background: transparent; }
.attachment-popover {
  position: absolute;
  left: 0;
  bottom: calc(100% + 10px);
  display: grid;
  grid-template-columns: repeat(3, 72px);
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 10px 28px rgba(22, 28, 41, 0.14);
}
.attachment-action { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 9px 6px; border-radius: 8px; font-size: 11px; }
```

- [ ] **Step 5: Verify compact mobile constraints**

Confirm the toolbar, longest attachment label, composer controls, user bubbles, and assistant cards remain inside 390 px with no horizontal scroll.

### Task 4: Functional And Visual QA

**Files:**
- Modify: `design-qa.md`
- Create: `.codex-runtime/screens/chat-reference-redesign.png`

**Interfaces:**
- Consumes: running Vite preview and local mock OpenAI-compatible SSE server.
- Produces: functional and visual evidence for the redesigned chat screen.

- [ ] **Step 1: Run complete automated verification**

Run: `npm test`

Expected: 57 tests pass, 0 fail.

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 2: Exercise the target browser flow**

The flow under test is: conversation list -> active chat -> open and close attachment menu -> choose each placeholder action -> send a user message -> see blue double check -> receive streaming dots and content -> stop another response -> preserve retry controls.

Use Playwright at `http://127.0.0.1:4173/preview/` with a 390 x 844 viewport. Confirm page identity, meaningful DOM, no Vite overlay, no console warnings/errors, and no page errors.

- [ ] **Step 3: Capture matching visual state**

Create `.codex-runtime/screens/chat-reference-redesign.png` with multiple user and assistant messages, completed double checks, assistant actions/timestamps, and the redesigned composer visible.

- [ ] **Step 4: Compare with the reference**

Compare the implementation screenshot against `C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-59c4e504-48fb-42df-814b-69573ce67d89.png`. Record layout, spacing, color, typography, and component-detail differences in `design-qa.md`.

- [ ] **Step 5: Fix blocking visual differences**

Fix every P0, P1, and P2 issue, recapture at 390 x 844, and repeat comparison until `design-qa.md` records `final result: passed` for this redesign.

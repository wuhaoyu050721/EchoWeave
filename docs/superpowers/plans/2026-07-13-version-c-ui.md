# Version C UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recreate the selected Version C Android AI chat UI in the existing uni-app Vue 3 project without changing its four-screen layout.

**Architecture:** A single Vue page owns the four visual states: conversation list, chat, provider management, and settings. Shared navigation and icon components keep dimensions stable. A Vite preview entry mounts the same uni-app page component for browser-based interaction and screenshot QA at 390 x 844.

**Tech Stack:** Vue 3, uni-app page SFC, Vite, lucide-vue-next, Node test runner, in-app Browser.

## Global Constraints

- Preserve the selected reference layout; color tokens may change, component placement may not.
- Verify at a 390 x 844 mobile viewport.
- Keep the bottom navigation visible on list, provider, and settings screens.
- Chat is entered from the conversation list and returns through the menu/back control.
- Use line icons from lucide-vue-next; do not draw custom SVG or CSS icons.
- This pass implements frontend state and interactions only, not SQLite, model API calls, authentication, or cloud sync.

---

### Task 1: Preview And State Test Harness

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `preview/index.html`
- Create: `preview/main.js`
- Create: `tests/ui-state.test.js`
- Create: `src/ui-state.js`

**Interfaces:**
- Produces: `createInitialUiState()`, `selectTab(state, tab)`, `openConversation(state, id)`, and `toggleAppLock(state)`.

- [ ] **Step 1: Write failing state tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createInitialUiState, openConversation, selectTab, toggleAppLock } from '../src/ui-state.js'

test('opens chat from a conversation without changing the selected bottom tab', () => {
  const state = createInitialUiState()
  openConversation(state, 'product-review')
  assert.equal(state.screen, 'chat')
  assert.equal(state.activeTab, 'conversations')
})

test('selecting provider screen leaves chat and activates provider tab', () => {
  const state = createInitialUiState()
  openConversation(state, 'product-review')
  selectTab(state, 'providers')
  assert.equal(state.screen, 'providers')
  assert.equal(state.activeTab, 'providers')
})

test('app lock toggle changes the visible setting state', () => {
  const state = createInitialUiState()
  toggleAppLock(state)
  assert.equal(state.appLockEnabled, true)
})
```

- [ ] **Step 2: Run tests and verify missing-module failure**

Run: `npm test`
Expected: FAIL because `src/ui-state.js` does not exist.

- [ ] **Step 3: Implement minimal state helpers**

Implement the four exported functions with the tab-to-screen map:

```js
const tabScreens = {
  conversations: 'conversations',
  providers: 'providers',
  settings: 'settings'
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `npm test`
Expected: 3 passing tests, 0 failures.

### Task 2: Four-Screen Version C Page

**Files:**
- Modify: `pages/index/index.vue`
- Modify: `pages.json`
- Modify: `App.vue`

**Interfaces:**
- Consumes: state helpers from `src/ui-state.js`.
- Produces: interactive conversation, chat, provider, and settings states.

- [ ] **Step 1: Add failing rendered-structure assertions**

Extend `tests/ui-state.test.js` with exported fixture checks for the required tab ids and conversation ids.

- [ ] **Step 2: Run tests and verify fixture failure**

Run: `npm test`
Expected: FAIL because fixtures are not exported.

- [ ] **Step 3: Implement the selected layout**

Build these fixed regions from the reference:

- conversation header, search field, seven conversation rows, floating add button, bottom navigation;
- chat toolbar, provider/model selector, alternating messages, interrupted state, composer;
- provider list, selected row, editing form, connection status, bottom navigation;
- settings groups, system prompt, local data, import/export, API key management, app lock, app information, bottom navigation.

- [ ] **Step 4: Add interactions**

- Conversation row opens chat.
- Chat menu returns to conversation list.
- Bottom navigation switches between the three main screens.
- Provider rows update the selected provider and edit form.
- Save button updates the visible provider name.
- App lock toggle changes state.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: all tests pass.

### Task 3: Reference Fidelity Styling

**Files:**
- Modify: `pages/index/index.vue`

**Interfaces:**
- Consumes: Version C DOM structure.
- Produces: 390 x 844 responsive mobile rendering matching the reference proportions.

- [ ] **Step 1: Define stable tokens**

Use CSS variables for page background, text, muted text, border, soft surface, accent, success, danger, and shadow.

- [ ] **Step 2: Match screen geometry**

Set stable heights for toolbar, search, rows, composer, and bottom nav. Use 16px horizontal page padding, 8px maximum card radius, thin separators, and restrained shadows.

- [ ] **Step 3: Match type hierarchy**

Use system sans-serif fonts, 22px page titles, 15-16px primary row text, 12-13px supporting text, and readable chat line height.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Vite build exits 0 with no compilation errors.

### Task 4: Browser Interaction And Screenshot QA

**Files:**
- Create: `design-qa.md`

**Interfaces:**
- Consumes: local Vite URL and selected reference image.
- Produces: screenshots for all four states and a passing design QA report.

- [ ] **Step 1: Start local server**

Run: `npm run dev -- --host 127.0.0.1 --port 4173 --strictPort`
Expected: local preview available at `http://127.0.0.1:4173/preview/`.

- [ ] **Step 2: Verify browser health**

Check page identity, meaningful DOM, no framework overlay, no relevant console errors, and visible mobile shell at 390 x 844.

- [ ] **Step 3: Exercise core navigation**

Test: conversation list -> open first conversation -> provider tab -> settings tab -> app lock toggle.

- [ ] **Step 4: Capture four screenshots**

Capture conversation, chat, provider, and settings states at 390 x 844.

- [ ] **Step 5: Compare against reference**

Score layout, spacing, typography, colors, and component details. Fix every P0/P1/P2 difference while preserving the selected layout.

- [ ] **Step 6: Write final QA report**

`design-qa.md` must cite the source image, implementation screenshots, viewport, interactions, console check, comparison history, and end with `final result: passed`.

### Task 5: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run unit tests**

Run: `npm test`
Expected: 0 failures.

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: exit code 0.

- [ ] **Step 3: Confirm QA gate**

Run: `Select-String -Path design-qa.md -Pattern '^final result: passed$'`
Expected: one exact match.

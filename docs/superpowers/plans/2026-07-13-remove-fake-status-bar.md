# Remove Fake Status Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the simulated phone status bar while preserving invisible native status-bar safe spacing for packaged uni-app builds.

**Architecture:** Delete the visual status row and its Lucide dependencies from the single Vue page. Move platform spacing responsibility to `.app-shell` through uni-app's `--status-bar-height` CSS variable.

**Tech Stack:** Vue 3, uni-app CSS variables, Vite, Node test runner, Playwright.

## Completion Status

- [x] Simulated status markup and icons removed.
- [x] Unused clock state and timer removed.
- [x] Native safe-area padding added.
- [x] Unit tests: 58 passed, 0 failed.
- [x] Browser QA: 15 checks passed.
- [x] Production build completed successfully.

## Global Constraints

- Do not draw time, signal, Wi-Fi, or battery UI.
- Keep `navigationStyle: "custom"` unchanged.
- Use `padding-top: var(--status-bar-height, 0px)` for native safe spacing.
- Browser preview must resolve the padding to 0 and start with the application toolbar/header.
- Do not change chat, attachment, provider, settings, persistence, or API behavior.
- The workspace is not a Git repository, so commit steps are omitted.

---

### Task 1: Remove Simulated Status UI

**Files:**
- Create: `tests/status-bar-source.test.js`
- Modify: `pages/index/index.vue`

**Interfaces:**
- Produces: an app shell with no visible status simulation and native-safe top padding.

- [ ] **Step 1: Write the failing source contract test**

Create:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

test('removes the simulated status bar and keeps native safe spacing', () => {
  assert.doesNotMatch(source, /class="status-bar"/)
  assert.doesNotMatch(source, /class="status-icons"/)
  assert.doesNotMatch(source, /\bBatteryFull\b|\bSignal\b|\bWifi\b/)
  assert.match(source, /padding-top:\s*var\(--status-bar-height,\s*0px\)/)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/status-bar-source.test.js`

Expected: FAIL because the simulated status markup and icons still exist.

- [ ] **Step 3: Remove template and icon dependencies**

Delete:

```vue
<view class="status-bar">
  <text>{{ currentTime }}</text>
  <view class="status-icons"><Signal ... /><Wifi ... /><BatteryFull ... /></view>
</view>
```

Remove `BatteryFull`, `Signal`, and `Wifi` from the Lucide import and `components` registration.

- [ ] **Step 4: Replace fake status CSS with native safe spacing**

Delete `.status-bar` and `.status-icons`. Add to `.app-shell`:

```css
padding-top: var(--status-bar-height, 0px);
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `node --test tests/status-bar-source.test.js`

Expected: 1 test passes.

### Task 2: Regression And Browser Verification

**Files:**
- Modify: `.codex-runtime/chat-redesign-qa.mjs`
- Modify: `design-qa.md`

**Interfaces:**
- Consumes: `http://127.0.0.1:4173/preview/` at 390 x 844.
- Produces: evidence that browser content starts at y=0 without simulated status content.

- [ ] **Step 1: Extend browser checks**

Add checks after page load:

```js
check('simulated status bar removed', await page.locator('.status-bar, .status-icons').count() === 0)
const firstHeaderTop = await page.locator('.screen-header').first().evaluate((node) => node.getBoundingClientRect().top)
check('browser header starts at top', firstHeaderTop === 0, String(firstHeaderTop))
```

After entering chat, require `layout.toolbar.top === 0` in the existing layout check.

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: 58 tests pass, 0 fail.

- [ ] **Step 3: Run production build**

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 4: Run browser QA and recapture**

Run: `node .codex-runtime/chat-redesign-qa.mjs`

Expected: 15 browser checks pass, no console warnings/errors, and the chat toolbar begins at y=0 in browser preview.

- [ ] **Step 5: Update visual QA**

Record the removed simulated row, native safe-area strategy, browser toolbar position, updated screenshot path, and `final result: passed` in `design-qa.md`.

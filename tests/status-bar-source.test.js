import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

test('removes the simulated status bar and keeps native safe spacing', () => {
  assert.doesNotMatch(source, /class="status-bar"/)
  assert.doesNotMatch(source, /class="status-icons"/)
  assert.doesNotMatch(source, /\bBatteryFull\b|\bSignal\b|\bWifi\b/)
  assert.match(source, /padding-top:\s*var\(--status-bar-height,\s*0px\)/)
  assert.match(source, /\.chat-toolbar\s*\{[^}]*top:\s*var\(--status-bar-height,\s*0px\)/s)
  assert.match(source, /\.model-popover\s*\{[^}]*top:\s*calc\(var\(--status-bar-height,\s*0px\)\s*\+\s*70px\)/s)
  assert.match(source, /\.error-banner\s*\{[^}]*top:\s*calc\(var\(--status-bar-height,\s*0px\)\s*\+\s*86px\)/s)
})

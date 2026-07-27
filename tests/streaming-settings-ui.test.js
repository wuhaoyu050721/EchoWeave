import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  STREAMING_SEGMENTED_DISPLAY_SETTING_KEY,
  STREAMING_SETTING_KEY,
  readStreamingEnabled,
  readStreamingSegmentedDisplayEnabled
} from '../src/core/streaming-setting.js'

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

test('settings exposes streaming as a persistent second-level toggle that defaults on', () => {
  assert.match(source, /data-testid="streaming-settings-entry"[^>]*@click="openStreamingSettings\(ui\)"/)
  assert.match(source, /methods:\s*\{[\s\S]*openStreamingSettings,/)
  assert.match(source, /ui\.settingsView === 'streaming'/)
  assert.match(source, /data-testid="streaming-settings-page"/)
  assert.match(source, /<text class="screen-title">流式传输<\/text>/)
  assert.match(source, /class="settings-detail-summary streaming-settings-summary"/)
  assert.match(source, /data-testid="streaming-toggle" role="switch" :aria-checked="streamingEnabled"/)
  assert.doesNotMatch(source, /data-testid="streaming-settings-entry"[^>]*role="switch"/)
  assert.match(source, /<text>流式传输<\/text>/)
  assert.match(source, /streamingEnabled: true/)
  assert.match(source, /streamingSettingLabel\(\)/)
  assert.match(source, /readStreamingEnabled\(this\.services\.repository\)/)
  assert.match(source, /setSetting\(STREAMING_SETTING_KEY, this\.streamingEnabled\)/)
  assert.match(source, /回答内容实时显示/)
  assert.match(source, /等待完整回答后显示/)
  assert.match(source, /v-if="streamingEnabled"[^>]*data-testid="streaming-segmented-toggle"/)
  assert.match(source, /:aria-checked="streamingSegmentedDisplay"/)
  assert.match(source, /<text>分段显示<\/text>/)
  assert.match(source, /完整段落逐条弹出，段落之间显示输入动画/)
  assert.match(source, /streamingSegmentedDisplay: false/)
  assert.match(source, /readStreamingSegmentedDisplayEnabled\(this\.services\.repository\)/)
  assert.match(source, /setSetting\(\s*STREAMING_SEGMENTED_DISPLAY_SETTING_KEY,\s*this\.streamingSegmentedDisplay/s)
  assert.match(source, /assistantShowsTyping\(message\)/)
  assert.match(source, /aria-label="对方正在输入"/)
  assert.match(source, /assistantVisibleSegments\(message\)/)
})

test('streaming preference treats only an explicit false value as disabled', async () => {
  const fallbacks = []
  const missingRepository = {
    async getSetting(key, fallback) {
      fallbacks.push({ key, fallback })
      return fallback
    }
  }
  assert.equal(await readStreamingEnabled(missingRepository), true)
  assert.deepEqual(fallbacks, [{ key: STREAMING_SETTING_KEY, fallback: true }])
  assert.equal(await readStreamingEnabled({ getSetting: async () => false }), false)
  assert.equal(await readStreamingEnabled({ getSetting: async () => true }), true)
})

test('segmented streaming display defaults off and requires an explicit enabled value', async () => {
  const fallbacks = []
  const repository = {
    async getSetting(key, fallback) {
      fallbacks.push({ key, fallback })
      return fallback
    }
  }

  assert.equal(await readStreamingSegmentedDisplayEnabled(repository), false)
  assert.deepEqual(fallbacks, [{
    key: STREAMING_SEGMENTED_DISPLAY_SETTING_KEY,
    fallback: false
  }])
  assert.equal(await readStreamingSegmentedDisplayEnabled({ getSetting: async () => true }), true)
  assert.equal(await readStreamingSegmentedDisplayEnabled({ getSetting: async () => false }), false)
})

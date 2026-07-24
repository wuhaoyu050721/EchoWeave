import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { STREAMING_SETTING_KEY, readStreamingEnabled } from '../src/core/streaming-setting.js'

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

test('settings exposes a persistent streaming toggle that defaults on', () => {
  assert.match(source, /data-testid="streaming-toggle" role="switch" :aria-checked="streamingEnabled"/)
  assert.match(source, /<text>流式传输<\/text>/)
  assert.match(source, /streamingEnabled: true/)
  assert.match(source, /streamingSettingLabel\(\)/)
  assert.match(source, /readStreamingEnabled\(this\.services\.repository\)/)
  assert.match(source, /setSetting\(STREAMING_SETTING_KEY, this\.streamingEnabled\)/)
  assert.match(source, /回答内容实时显示/)
  assert.match(source, /等待完整回答后显示/)
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

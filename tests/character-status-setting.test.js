import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  CHARACTER_STATUS_SETTING_KEY,
  readCharacterStatusEnabled
} from '../src/core/character-status-setting.js'

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

test('settings exposes character status as a persistent second-level toggle that defaults on', () => {
  assert.match(source, /data-testid="character-status-settings-entry"[^>]*@click="openCharacterStatusSettings\(ui\)"/)
  assert.match(source, /methods:\s*\{[\s\S]*openCharacterStatusSettings,/)
  assert.match(source, /ui\.settingsView === 'character-status'/)
  assert.match(source, /data-testid="character-status-settings-page"/)
  assert.match(source, /<text class="screen-title">角色状态栏<\/text>/)
  assert.match(source, /class="settings-detail-summary character-status-settings-summary"/)
  assert.match(source, /data-testid="character-status-toggle" role="switch" :aria-checked="characterStatusEnabled"/)
  assert.doesNotMatch(source, /data-testid="character-status-settings-entry"[^>]*role="switch"/)
  assert.match(source, /<text>角色状态栏<\/text>/)
  assert.match(source, /characterStatusEnabled: true/)
  assert.match(source, /readCharacterStatusEnabled\(this\.services\.repository\)/)
  assert.match(source, /setSetting\(CHARACTER_STATUS_SETTING_KEY, this\.characterStatusEnabled\)/)
  assert.match(source, /每轮返回并更新角色状态/)
  assert.match(source, /已关闭，仅返回对话正文/)
  assert.match(source, /if \(!this\.characterStatusEnabled\) return null/)
})

test('character status preference treats only an explicit false value as disabled', async () => {
  const fallbacks = []
  const repository = {
    async getSetting(key, fallback) {
      fallbacks.push({ key, fallback })
      return fallback
    }
  }

  assert.equal(await readCharacterStatusEnabled(repository), true)
  assert.deepEqual(fallbacks, [{ key: CHARACTER_STATUS_SETTING_KEY, fallback: true }])
  assert.equal(await readCharacterStatusEnabled({ getSetting: async () => false }), false)
  assert.equal(await readCharacterStatusEnabled({ getSetting: async () => true }), true)
})

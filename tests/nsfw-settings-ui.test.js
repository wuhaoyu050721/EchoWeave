import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

test('settings exposes a persistent NSFW second-level toggle that defaults off', () => {
  assert.match(source, /data-testid="nsfw-settings-entry"[^>]*@click="openNsfwSettings\(ui\)"/)
  assert.match(source, /ui\.settingsView === 'nsfw'/)
  assert.match(source, /<text class="screen-title">NSFW 设置<\/text>/)
	assert.match(source, /class="screen-view settings-details themed-settings-details nsfw-settings-details"/)
	assert.match(source, /class="settings-detail-summary nsfw-settings-summary"/)
	assert.match(source, /class="settings-card themed-settings-card"/)
  assert.match(source, /data-testid="nsfw-status-toggle" role="switch" :aria-checked="nsfwEnabled"/)
  assert.match(source, /nsfwEnabled: false/)
  assert.match(source, /const NSFW_SETTING_KEY = 'nsfwEnabled'/)
  assert.match(source, /getSetting\(NSFW_SETTING_KEY, false\)/)
  assert.match(source, /setSetting\(NSFW_SETTING_KEY, this\.nsfwEnabled\)/)
})

test('chat display filters private status through the NSFW setting only', () => {
  assert.match(source, /assistantStatusSectionsForDisplay\(this\.latestAssistantStatus, \{ showPrivate: this\.nsfwEnabled \}\)/)
  assert.match(source, /v-for="section in assistantStatusSections"/)
  assert.match(source, /displayContent: extracted\.content/)
  assert.match(source, /assistantStatus: extracted\.status/)
})

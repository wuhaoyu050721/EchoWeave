import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

test('system prompt editor is a themed second-level settings page', () => {
	assert.match(source, /data-testid="conversation-settings-entry"[^>]*@click="openConversationSettings\(ui\)"/)
	assert.match(source, /ui\.settingsView === 'conversation'/)
	assert.match(source, /data-testid="conversation-settings-page"/)
	assert.match(source, /data-testid="system-prompt-toggle" role="switch" :aria-checked="systemPromptEnabled"/)
	assert.match(source, /data-testid="system-prompt-input"/)
	assert.match(source, /data-testid="system-prompt-save"/)
	assert.match(source, /class="system-prompt-editor"/)
	assert.match(source, /class="screen-header settings-detail-header themed-settings-header"/)
	assert.doesNotMatch(source, /systemPromptOpen|toggleSystemPromptPanel/)
})

test('system prompt save keeps encrypted persistence and exposes a busy state', () => {
	assert.match(source, /systemPromptSaving: false/)
	assert.match(source, /this\.services\.vault\.encryptString\(normalizedPrompt\)/)
	assert.match(source, /setSetting\('systemPrompt', \{ enabled: this\.systemPromptEnabled, encryptedValue \}\)/)
	assert.match(source, /finally \{ this\.systemPromptSaving = false \}/)
	assert.match(source, /systemPromptSettingLabel\(\)/)
})

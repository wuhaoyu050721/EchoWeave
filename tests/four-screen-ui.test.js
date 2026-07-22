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
  assert.match(source, /#1f6fcb/i)
  assert.match(source, /\.provider-logo\s*\{[^}]*border-radius:\s*50%/s)
  const sourceWithoutOpacityMasks = source.replace(/(?:-webkit-)?mask-image:\s*linear-gradient\([^;]+;/g, '')
  assert.doesNotMatch(sourceWithoutOpacityMasks, /linear-gradient|radial-gradient/)
})

test('provider editor exposes automatic presets and App-compatible custom avatar selection', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(source, /class="provider-avatar-selector"/)
  assert.match(source, /v-for="preset in providerAvatarPresets"/)
  assert.match(source, /selectAutomaticProviderAvatar/)
  assert.match(source, /createProviderPresetAvatar/)
  assert.match(source, /图片会压缩后随接口保存/)
  assert.match(source, /nativeAttachmentPicker\.pick\('image', \{ maxCount: 1 \}\)/)
  assert.match(source, /ref="providerAvatarInput"[^>]*accept="image\/\*"/)
  assert.match(source, /handleProviderAvatarSelection/)
})

test('saved provider API keys stay masked until the user explicitly reveals them', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(source, /SAVED_API_KEY_MASK = '••••••••••••'/)
  assert.match(source, /:type="showApiKey \? 'text' : 'password'"/)
  assert.match(source, /:placeholder="providerApiKeyPlaceholder"/)
  assert.match(source, /@click\.stop="toggleProviderApiKeyVisibility"/)
  assert.match(source, /getApiKeyForEditing\(providerId\)/)
  assert.match(source, /apiKey: this\.providerApiKeyDirty \|\| !this\.providerForm\.hasApiKey/)
})

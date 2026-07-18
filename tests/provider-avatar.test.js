import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import test from 'node:test'

import {
  PROVIDER_AVATAR_PRESETS,
  createProviderCustomAvatar,
  createProviderPresetAvatar,
  detectProviderAvatarPreset,
  normalizeProviderAvatar,
  resolveProviderAvatarSource
} from '../src/core/provider-avatar.js'

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII='

test('auto-detects common provider brands from names URLs and model identifiers', () => {
  const cases = [
    [{ name: 'OpenAI', defaultModel: 'gpt-4o' }, 'openai'],
    [{ baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-4' }, 'grok'],
    [{ name: 'Anthropic', defaultModel: 'claude-sonnet-4' }, 'claude'],
    [{ baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2' }, 'kimi'],
    [{ defaultModel: 'deepseek-chat' }, 'deepseek'],
    [{ defaultModel: 'gemini-2.5-pro' }, 'gemini'],
    [{ modelsCache: ['qwen-max'] }, 'qwen'],
    [{ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', name: '豆包' }, 'doubao'],
    [{ baseUrl: 'http://127.0.0.1:11434', name: 'Ollama' }, 'ollama']
  ]

  for (const [provider, expected] of cases) {
    assert.equal(detectProviderAvatarPreset(provider).id, expected)
  }
  assert.equal(detectProviderAvatarPreset({ name: 'Unknown gateway' }).id, 'openai')
})

test('manual presets override automatic detection', () => {
  const provider = {
    name: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    avatar: createProviderPresetAvatar('claude')
  }

  assert.equal(resolveProviderAvatarSource(provider), '/static/providers/anthropic.png')
})

test('creates a bounded custom avatar and resolves its local data URL', () => {
  const avatar = createProviderCustomAvatar({
    kind: 'image',
    dataUrl: DATA_URL,
    mimeType: 'image/png',
    byteSize: 1,
    width: 1,
    height: 1
  }, () => '2026-07-18T00:00:00.000Z')

  assert.equal(avatar.mode, 'custom')
  assert.equal(avatar.updatedAt, '2026-07-18T00:00:00.000Z')
  assert.equal(resolveProviderAvatarSource({ avatar }), DATA_URL)
})

test('rejects malformed custom and unknown preset values in strict mode', () => {
  assert.throws(
    () => normalizeProviderAvatar({ mode: 'custom', dataUrl: 'https://example.com/avatar.png' }, { strict: true }),
    /头像图片无效/
  )
  assert.throws(
    () => normalizeProviderAvatar({ mode: 'preset', presetId: 'missing' }, { strict: true }),
    /头像不存在/
  )
  assert.equal(normalizeProviderAvatar({ mode: 'custom', dataUrl: 'broken' }).mode, 'auto')
})

test('ships every provider preset as an offline PNG asset', async () => {
  assert.deepEqual(PROVIDER_AVATAR_PRESETS.map(item => item.id), [
    'openai', 'grok', 'claude', 'kimi', 'deepseek', 'gemini', 'qwen', 'doubao', 'ollama'
  ])

  for (const preset of PROVIDER_AVATAR_PRESETS) {
    assert.match(preset.source, /^\/static\/providers\/[a-z]+\.png$/)
    await access(new URL(`..${preset.source}`, import.meta.url))
  }
})

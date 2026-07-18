import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGeminiEndpoint,
  buildGeminiModelEndpoint,
  buildOpenAIEndpoint,
  normalizeGeminiBaseUrl,
  normalizeOpenAIBaseUrl
} from '../src/core/provider-url.js'

test('normalizes root and v1 OpenAI-compatible base URLs', () => {
  assert.equal(normalizeOpenAIBaseUrl('https://api.openai.com'), 'https://api.openai.com/v1')
  assert.equal(normalizeOpenAIBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1')
  assert.equal(normalizeOpenAIBaseUrl('https://example.com/api'), 'https://example.com/api/v1')
})

test('normalizes HTTP endpoints when the runtime has no URL constructor', () => {
  const originalUrl = globalThis.URL
  try {
    globalThis.URL = undefined
    assert.equal(normalizeOpenAIBaseUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434/v1')
    assert.equal(normalizeOpenAIBaseUrl('http://[::1]:8080/openai'), 'http://[::1]:8080/openai/v1')
  } finally {
    globalThis.URL = originalUrl
  }
})

test('builds models and chat endpoints from a normalized base URL', () => {
  assert.equal(buildOpenAIEndpoint('https://example.com', 'models'), 'https://example.com/v1/models')
  assert.equal(
    buildOpenAIEndpoint('https://example.com/openai/v1', '/chat/completions'),
    'https://example.com/openai/v1/chat/completions'
  )
})

test('rejects unsupported or ambiguous base URLs', () => {
  assert.throws(() => normalizeOpenAIBaseUrl('file:///tmp/models'), /HTTP/)
  assert.throws(() => normalizeOpenAIBaseUrl('https://user@example.com'), /凭据/)
  assert.throws(() => normalizeOpenAIBaseUrl('https://example.com/v1?x=1'), /查询参数/)
  assert.throws(() => normalizeOpenAIBaseUrl('https://example.com/v1/chat/completions'), /基础地址/)
  assert.throws(() => normalizeOpenAIBaseUrl('https://example.com:70000/v1'), /URL/)
})

test('normalizes Gemini native base URLs and builds model actions', () => {
  assert.equal(
    normalizeGeminiBaseUrl('https://generativelanguage.googleapis.com'),
    'https://generativelanguage.googleapis.com/v1beta'
  )
  assert.equal(normalizeGeminiBaseUrl('https://example.com/google/v1/'), 'https://example.com/google/v1')
  assert.equal(buildGeminiEndpoint('https://example.com', 'models'), 'https://example.com/v1beta/models')
  assert.equal(
    buildGeminiModelEndpoint('https://example.com/v1beta', 'models/gemini-2.5-flash', 'streamGenerateContent', 'alt=sse'),
    'https://example.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse'
  )
})

test('rejects full Gemini model request URLs as base URLs', () => {
  assert.throws(
    () => normalizeGeminiBaseUrl('https://example.com/v1beta/models/gemini:streamGenerateContent'),
    /基础地址/
  )
})

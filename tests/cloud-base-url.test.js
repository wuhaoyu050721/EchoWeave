import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_CLOUD_BASE_URL,
  normalizeCloudBaseUrl,
  resolveCloudRequestBaseUrl
} from '../src/core/cloud-base-url.js'

test('normalizes cloud server URLs without changing unrelated servers', () => {
  assert.equal(normalizeCloudBaseUrl(' HTTPS://CLOUD.EXAMPLE/API/// '), 'https://cloud.example/API')
  assert.equal(resolveCloudRequestBaseUrl('https://cloud.example/api/'), 'https://cloud.example/api')
})

test('routes legacy EchoWeave cloud addresses directly to canonical HTTPS', () => {
  for (const legacy of [
    'http://118.145.98.165:8018/',
    'https://118.145.98.165:8018',
    'http://surtr.cn:8018',
    'https://surtr.cn:8018/',
    'http://www.surtr.cn:8018'
  ]) {
    assert.equal(resolveCloudRequestBaseUrl(legacy), DEFAULT_CLOUD_BASE_URL)
  }
})

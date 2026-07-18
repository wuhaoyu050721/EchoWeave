import assert from 'node:assert/strict'
import test from 'node:test'

import { ATTACHMENT_LIMITS } from '../src/core/attachment-policy.js'
import { createProfileAvatar, normalizeProfileAvatar } from '../src/core/profile-avatar.js'

const DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII='

test('creates and restores a bounded local profile avatar', () => {
  const avatar = createProfileAvatar({
    kind: 'image',
    dataUrl: DATA_URL,
    mimeType: 'image/png',
    byteSize: 1,
    width: 1,
    height: 1
  }, () => '2026-07-16T00:00:00.000Z')

  assert.equal(avatar.version, 1)
  assert.equal(avatar.dataUrl, DATA_URL)
  assert.equal(avatar.mimeType, 'image/png')
  assert.equal(avatar.width, 1)
  assert.equal(avatar.updatedAt, '2026-07-16T00:00:00.000Z')
  assert.deepEqual(normalizeProfileAvatar(avatar), avatar)
})

test('rejects remote, malformed, and oversized profile avatars', () => {
  assert.equal(normalizeProfileAvatar({ url: 'https://example.com/avatar.png' }), null)
  assert.equal(normalizeProfileAvatar({ dataUrl: 'data:image/png;base64,not-base64!' }), null)

  const encodedLength = Math.ceil(((ATTACHMENT_LIMITS.maxImageBytes + 1) * 4 / 3) / 4) * 4
  assert.equal(normalizeProfileAvatar({ dataUrl: `data:image/png;base64,${'A'.repeat(encodedLength)}` }), null)
})

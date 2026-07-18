import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ATTACHMENT_LIMITS,
  TEXT_ATTACHMENT_ACCEPT,
  classifyTextFile,
  formatAttachmentSize
} from '../src/core/attachment-policy.js'

test('defines the approved attachment limits', () => {
  assert.deepEqual(ATTACHMENT_LIMITS, {
    maxCount: 4,
    maxCombinedBytes: 8 * 1024 * 1024,
    maxImageBytes: 2 * 1024 * 1024,
    maxImageDimension: 1600,
    maxTextBytes: 200 * 1024,
    imageContextCost: 4000
  })
})

test('accepts supported text files and rejects binary documents', () => {
  assert.equal(classifyTextFile({ name: 'config.json', type: 'application/json' }), true)
  assert.equal(classifyTextFile({ name: '.env', type: '' }), true)
  assert.equal(classifyTextFile({ name: 'component.vue', type: '' }), true)
  assert.equal(classifyTextFile({ name: 'notes.unknown', type: 'text/plain' }), true)
  assert.equal(classifyTextFile({ name: 'report.pdf', type: 'application/pdf' }), false)
  assert.match(TEXT_ATTACHMENT_ACCEPT, /\.txt/)
  assert.match(TEXT_ATTACHMENT_ACCEPT, /application\/json/)
})

test('formats stable attachment sizes', () => {
  assert.equal(formatAttachmentSize(0), '0 B')
  assert.equal(formatAttachmentSize(1024), '1 KB')
  assert.equal(formatAttachmentSize(1536 * 1024), '1.5 MB')
})

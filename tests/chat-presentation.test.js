import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadChatMessageResources,
  mergeEarlierMessageWindow,
  splitAssistantReplySegments
} from '../src/app/chat-presentation.js'

test('reveals only complete assistant paragraphs while a segmented reply is streaming', () => {
  const content = '第一段已经说完。\n\n第二段还在输入'

  assert.deepEqual(
    splitAssistantReplySegments(content, { includeTrailing: false }),
    ['第一段已经说完。']
  )
  assert.deepEqual(
    splitAssistantReplySegments(content),
    ['第一段已经说完。', '第二段还在输入']
  )
})

test('splits long completed replies at natural sentence boundaries with a bounded count', () => {
  const sentence = `${'这是一段较长的角色回复'.repeat(10)}。`
  const segments = splitAssistantReplySegments(`${sentence}下一段继续。`, {
    minimumCharacters: 80,
    maximumSegments: 4
  })

  assert.equal(segments.length, 2)
  assert.equal(segments.join(''), `${sentence}下一段继续。`)
  assert.ok(splitAssistantReplySegments(
    Array.from({ length: 30 }, (_, index) => `第${index + 1}段。`).join('\n\n'),
    { maximumSegments: 6 }
  ).length <= 6)
})

test('loads only referenced chat attachments and avatars through bulk repository methods', async () => {
  const calls = []
  const repository = {
    getAttachments: async ids => {
      calls.push(['attachments', ids])
      return [
        { id: 'attachment-2', kind: 'text' },
        { id: 'attachment-1', kind: 'image', deletedAt: '2026-07-25T00:00:00.000Z' }
      ]
    },
    getCharacterAssets: async ids => {
      calls.push(['avatars', ids])
      return [{ id: 'avatar-1', dataUrl: 'data:image/png;base64,AA==' }]
    }
  }
  const resources = await loadChatMessageResources(repository, [
    { attachmentIds: ['attachment-2', 'attachment-1'], speakerAvatarAssetId: 'avatar-1' },
    { attachmentIds: ['attachment-2'], speakerAvatarAssetId: 'avatar-1' }
  ])

  assert.deepEqual(calls, [
    ['attachments', ['attachment-2', 'attachment-1']],
    ['avatars', ['avatar-1']]
  ])
  assert.deepEqual([...resources.attachmentsById.keys()], ['attachment-2'])
  assert.deepEqual([...resources.avatarsById.keys()], ['avatar-1'])
})

test('falls back to individual resource reads for older repositories', async () => {
  const repository = {
    getAttachment: async id => ({ id }),
    getCharacterAsset: async id => ({ id })
  }
  const resources = await loadChatMessageResources(repository, [{
    attachmentIds: ['attachment-1'],
    speakerAvatarAssetId: 'avatar-1'
  }])

  assert.equal(resources.attachmentsById.get('attachment-1').id, 'attachment-1')
  assert.equal(resources.avatarsById.get('avatar-1').id, 'avatar-1')
})

test('keeps a bounded 240-message window while browsing older history', () => {
  const current = Array.from({ length: 240 }, (_, index) => ({
    id: `message-${index + 61}`,
    sequence: index + 61
  }))
  const earlier = Array.from({ length: 60 }, (_, index) => ({
    id: `message-${index + 1}`,
    sequence: index + 1
  }))
  const merged = mergeEarlierMessageWindow(current, earlier, 240)

  assert.equal(merged.messages.length, 240)
  assert.equal(merged.messages[0].sequence, 1)
  assert.equal(merged.messages[239].sequence, 240)
  assert.equal(merged.trimmedNewer, true)

  const deduplicated = mergeEarlierMessageWindow(
    [{ id: 'message-2' }, { id: 'message-3' }],
    [{ id: 'message-1' }, { id: 'message-2' }],
    10
  )
  assert.deepEqual(deduplicated.messages.map(message => message.id), ['message-1', 'message-2', 'message-3'])
  assert.equal(deduplicated.trimmedNewer, false)
})

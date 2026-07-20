import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChatContext } from '../src/core/chat-context.js'

function message(id, role, content, status = 'completed') {
  return { id, role, content, status, sequence: Number(id.replace(/\D/g, '')) || 0 }
}

test('includes only message statuses that form a coherent context', () => {
  const result = buildChatContext({
    systemPrompt: '保持简洁',
    messages: [
      message('1', 'user', '问题一'),
      message('2', 'assistant', '答案一', 'completed'),
      message('3', 'assistant', '失败内容', 'failed'),
      message('4', 'assistant', '中断但有内容', 'interrupted'),
      message('5', 'assistant', '', 'interrupted'),
      message('6', 'assistant', '生成中', 'generating'),
      message('7', 'user', '问题二')
    ]
  })

  assert.deepEqual(result, [
    { role: 'system', content: '保持简洁' },
    { role: 'user', content: '问题一' },
    { role: 'assistant', content: '答案一' },
    { role: 'assistant', content: '中断但有内容' },
    { role: 'user', content: '问题二' }
  ])
})

test('keeps newest messages when count and character limits are exceeded', () => {
  const result = buildChatContext({
    systemPrompt: 'S',
    maxMessages: 2,
    maxCharacters: 7,
    messages: [
      message('1', 'user', 'old'),
      message('2', 'assistant', 'middle'),
      message('3', 'user', 'new')
    ]
  })

  assert.deepEqual(result, [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'new' }
  ])
})

test('omits an empty system prompt', () => {
  assert.deepEqual(buildChatContext({
    systemPrompt: '   ',
    messages: [message('1', 'user', 'hello')]
  }), [{ role: 'user', content: 'hello' }])
})

test('places post-history instructions after selected conversation messages', () => {
  assert.deepEqual(buildChatContext({
    systemPrompt: '角色设定',
    postHistoryPrompt: '最后指令',
    messages: [message('1', 'user', 'hello')]
  }), [
    { role: 'system', content: '角色设定' },
    { role: 'user', content: 'hello' },
    { role: 'system', content: '最后指令' }
  ])
})

test('adds a request-only turn instruction to the latest user message', () => {
  const messages = [
    message('1', 'user', '旧问题'),
    message('2', 'assistant', '旧回答'),
    message('3', 'user', '本轮问题')
  ]
  const result = buildChatContext({ messages, userTurnPrompt: '必须输出状态块' })

  assert.equal(result[0].content, '旧问题')
  assert.equal(result[2].content, '本轮问题\n\n必须输出状态块')
  assert.equal(messages[2].content, '本轮问题')
})

test('keeps attachment-only user messages with ordered attachment records', () => {
  const result = buildChatContext({
    messages: [{ id: 'm1', role: 'user', content: '', status: 'completed', sequence: 1, attachmentIds: ['a2', 'a1'] }],
    attachments: [
      { id: 'a1', messageId: 'm1', kind: 'text', textContent: 'hello' },
      { id: 'a2', messageId: 'm1', kind: 'image', dataUrl: 'data:image/jpeg;base64,AA==' }
    ]
  })

  assert.deepEqual(result, [{
    role: 'user',
    content: '',
    attachments: [
      { id: 'a2', messageId: 'm1', kind: 'image', dataUrl: 'data:image/jpeg;base64,AA==' },
      { id: 'a1', messageId: 'm1', kind: 'text', textContent: 'hello' }
    ]
  }])
})

test('trims old image messages as a whole but always keeps the newest attached message', () => {
  const oldImage = { id: 'a1', messageId: 'm1', kind: 'image', dataUrl: 'data:image/jpeg;base64,AA==' }
  const newestText = { id: 'a2', messageId: 'm2', kind: 'text', textContent: 'x'.repeat(500) }
  const messages = [
    { id: 'm1', role: 'user', content: 'old', status: 'completed', sequence: 1, attachmentIds: ['a1'] },
    { id: 'm2', role: 'user', content: '', status: 'completed', sequence: 2, attachmentIds: ['a2'] }
  ]

  const result = buildChatContext({ messages, attachments: [oldImage, newestText], maxCharacters: 100 })

  assert.equal(result.length, 1)
  assert.equal(result[0].attachments[0].id, 'a2')
})

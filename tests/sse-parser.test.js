import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAISseParser } from '../src/core/sse-parser.js'

function splitBytesInside(text, fragment) {
  const bytes = new TextEncoder().encode(text)
  const fragmentBytes = new TextEncoder().encode(fragment)
  const start = bytes.findIndex((value, index) =>
    fragmentBytes.every((fragmentValue, offset) => bytes[index + offset] === fragmentValue)
  )
  return [bytes.slice(0, start + 1), bytes.slice(start + 1)]
}

test('parses UTF-8 split across chunks and ignores chunks after done', () => {
  const deltas = []
  let doneCount = 0
  const parser = new OpenAISseParser({
    onDelta: (value) => deltas.push(value),
    onDone: () => { doneCount += 1 }
  })
  const input = 'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'
  const [first, second] = splitBytesInside(input, '你')

  parser.feed(first)
  parser.feed(second)
  parser.feed(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"迟到"}}]}\n\n'))
  parser.finish()

  assert.deepEqual(deltas, ['你好'])
  assert.equal(doneCount, 1)
})

test('parses multiple events in one chunk and reports finish reason', () => {
  const deltas = []
  const finishReasons = []
  const parser = new OpenAISseParser({
    onDelta: (value) => deltas.push(value),
    onFinishReason: (value) => finishReasons.push(value)
  })

  parser.feed(new TextEncoder().encode(
    'data: {"choices":[{"delta":{"content":"A"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"B"},"finish_reason":"stop"}]}\n\n'
  ))
  parser.finish()

  assert.deepEqual(deltas, ['A', 'B'])
  assert.deepEqual(finishReasons, ['stop'])
})

test('joins multi-line data fields before parsing JSON', () => {
  const rawEvents = []
  const parser = new OpenAISseParser({ onEvent: (value) => rawEvents.push(value) })

  parser.feed(new TextEncoder().encode('data: first\ndata: second\n\n'))
  parser.finish()

  assert.deepEqual(rawEvents, ['first\nsecond'])
})

test('surfaces malformed OpenAI JSON through onError', () => {
  const errors = []
  const parser = new OpenAISseParser({ onError: (error) => errors.push(error.message) })

  parser.feed(new TextEncoder().encode('data: {bad json}\n\n'))
  parser.finish()

  assert.equal(errors.length, 1)
  assert.match(errors[0], /SSE/)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('assistant feedback controls persist a reversible local message rating', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(source, /class="feedback-positive"[^>]+setMessageFeedback\(message,\s*'positive'\)/)
  assert.match(source, /class="feedback-negative"[^>]+setMessageFeedback\(message,\s*'negative'\)/)
  assert.match(source, /async setMessageFeedback\(message,\s*feedback\)/)
  assert.match(source, /repository\.saveMessage\(saved\)/)
  assert.match(source, /stored\.feedback === feedback \? null : feedback/)
})

test('update and feedback settings open real project destinations', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(source, /@click="openReleasePage"/)
  assert.match(source, /@click="openFeedbackPage"/)
  assert.doesNotMatch(source, /当前已是最新开发版本|反馈功能将在服务端版本接入/)
})

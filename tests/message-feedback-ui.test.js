import { readMainPageSource } from './helpers/read-main-page.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('assistant feedback controls persist a reversible local message rating', async () => {
  const source = await readMainPageSource()

  assert.match(source, /class="feedback-positive"[^>]+setMessageFeedback\(message,\s*'positive'\)/)
  assert.match(source, /class="feedback-negative"[^>]+setMessageFeedback\(message,\s*'negative'\)/)
  assert.match(source, /async setMessageFeedback\(message,\s*feedback\)/)
  assert.match(source, /repository\.saveMessage\(saved\)/)
  assert.match(source, /stored\.feedback === feedback \? null : feedback/)
})

test('update and feedback settings open real project destinations', async () => {
  const [source, information, metadata] = await Promise.all([
    readMainPageSource(),
    readFile(new URL('../src/components/settings-information.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/core/app-metadata.js', import.meta.url), 'utf8')
  ])

  assert.match(source, /@click="openSettingsInformation\('updates'\)"/)
  assert.match(source, /@click="openSettingsInformation\('help'\)"/)
  assert.match(source, /<SettingsInformation\s[^>]*@release="openReleasePage"[^>]*@feedback="openFeedbackPage"/)
  assert.match(information, /@click="\$emit\('release'\)"/)
  assert.match(information, /@click="\$emit\('feedback'\)"/)
  assert.match(source, /openReleasePage\(\)\s*\{\s*this\.openExternalUrl\(RELEASES_URL,/)
  assert.match(source, /openFeedbackPage\(\)\s*\{\s*this\.openExternalUrl\(FEEDBACK_URL,/)
  assert.match(metadata, /RELEASES_URL = 'https:\/\/github\.com\/wuhaoyu050721\/EchoWeave\/releases\/latest'/)
  assert.match(metadata, /FEEDBACK_URL = 'https:\/\/github\.com\/wuhaoyu050721\/EchoWeave\/issues\/new'/)
  assert.doesNotMatch(source, /当前已是最新开发版本|反馈功能将在服务端版本接入/)
})

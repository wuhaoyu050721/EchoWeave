import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

test('Android streaming plugin uses one keep-alive event callback without native dependencies', async () => {
  const [source, interfaceSource, packageSource] = await Promise.all([
    readFile(new URL('../uni_modules/ai-chat-streaming/utssdk/app-android/index.uts', import.meta.url), 'utf8'),
    readFile(new URL('../uni_modules/ai-chat-streaming/utssdk/interface.uts', import.meta.url), 'utf8'),
    readFile(new URL('../uni_modules/ai-chat-streaming/package.json', import.meta.url), 'utf8')
  ])

  assert.match(source, /@UTSJS\.keepAlive\s+export function onAiChatStreamEvent/)
  assert.match(source, /HttpURLConnection/)
  assert.match(source, /InputStream/)
  assert.match(source, /new Thread/)
  assert.match(source, /setConnectTimeout\(Math\.min\(timeout,\s*30000\)\.toInt\(\)\)/)
  assert.match(source, /setReadTimeout\(timeout\)/)
  assert.doesNotMatch(interfaceSource, /onChunk\s*\?:|success\s*\?:|fail\s*\?:/)
  assert.match(packageSource, /"onAiChatStreamEvent"/)
  await assert.rejects(access(new URL('../uni_modules/ai-chat-streaming/utssdk/app-android/AndroidManifest.xml', import.meta.url)))
})

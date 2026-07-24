import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createAppServices } from '../src/app/create-app-services.js'
import { createPlatformServices, createPlatformWorkspaceManager } from '../src/app/create-platform-services.js'
import { createNodePlusSqlite } from './helpers/node-plus-sqlite.js'

test('uses browser services when no App runtime is present', async () => {
  const browserServices = { platform: { runtime: 'browser' } }
  let appLoads = 0
  const createBrowser = async () => browserServices
  const loadApp = async () => {
    appLoads += 1
    return { createAppServices: async () => ({ platform: { runtime: 'app-android' } }) }
  }

  assert.equal(await createPlatformServices({ runtime: {}, createBrowser, loadApp }), browserServices)
  assert.equal(await createPlatformServices({ runtime: { uni: { request() {} } }, createBrowser, loadApp }), browserServices)
  assert.equal(appLoads, 0)
})

test('reports a packaged App without SQLite instead of falling back to browser storage', async () => {
  let browserLoads = 0
  await assert.rejects(
    createPlatformServices({
      runtime: { plus: {}, uni: { request() {} } },
      isPackagedApp: true,
      createBrowser: async () => { browserLoads += 1 }
    }),
    /SQLite/
  )
  assert.equal(browserLoads, 0)
})

test('waits for the native runtime when a packaged App mounts before plus is ready', async () => {
  const plusApi = { sqlite: {} }
  const uniApi = { request() {} }
  const appServices = { platform: { runtime: 'app-android' } }

  const result = await createPlatformServices({
    runtime: {},
    isPackagedApp: true,
    waitForRuntime: async () => ({ plus: plusApi, uni: uniApi }),
    createBrowser: async () => assert.fail('browser factory should not run'),
    loadApp: async () => ({
      createAppServices: async ({ plusApi: receivedPlus, uniApi: receivedUni }) => {
        assert.equal(receivedPlus, plusApi)
        assert.equal(receivedUni, uniApi)
        return appServices
      }
    })
  })

  assert.equal(result, appServices)
})

test('lazily creates App services when SQLite and uni.request are available', async () => {
  const plusApi = { sqlite: {} }
  const uniApi = { request() {} }
  const appServices = { platform: { runtime: 'app-android' } }
  let received

  const result = await createPlatformServices({
    runtime: { plus: plusApi, uni: uniApi },
    createBrowser: async () => assert.fail('browser factory should not run'),
    loadApp: async () => ({
      createAppServices: async (options) => {
        received = options
        return appServices
      }
    })
  })

  assert.equal(result, appServices)
  assert.deepEqual(received, { plusApi, uniApi })
})

test('creates a runtime-neutral browser workspace manager', async () => {
  const expected = { kind: 'browser-workspaces' }
  let received
  const result = await createPlatformWorkspaceManager({
    runtime: {},
    accountNamespace: 'https://cloud.example',
    createBrowserManager: async options => { received = options; return expected },
    createAppManager: async () => assert.fail('App manager should not run')
  })

  assert.equal(result, expected)
  assert.deepEqual(received, { accountNamespace: 'https://cloud.example' })
})

test('creates a runtime-neutral Android workspace manager', async () => {
  const plusApi = { sqlite: {} }
  const uniApi = { request() {} }
  const expected = { kind: 'app-workspaces' }
  let received
  const result = await createPlatformWorkspaceManager({
    runtime: { plus: plusApi, uni: uniApi },
    accountNamespace: 'https://cloud.example',
    createBrowserManager: async () => assert.fail('browser manager should not run'),
    createAppManager: async options => { received = options; return expected }
  })

  assert.equal(result, expected)
  assert.deepEqual(received, {
    accountNamespace: 'https://cloud.example',
    plusApi,
    uniApi
  })
})

test('App services persist through SQLite and encrypt provider keys through the native vault', async () => {
  let iv = 0
  const uniApi = {
    request() { return { abort() {} } },
    aiChatKeystoreReady: () => true,
    aiChatKeystoreEncrypt(value) {
      iv += 1
      return JSON.stringify({
        version: 1,
        algorithm: 'AES-GCM',
        iv: `iv-${iv}`,
        ciphertext: Buffer.from(value).toString('base64')
      })
    },
    aiChatKeystoreDecrypt(recordJson) {
      return Buffer.from(JSON.parse(recordJson).ciphertext, 'base64').toString()
    }
  }
  const services = await createAppServices({
    plusApi: { sqlite: createNodePlusSqlite() },
    uniApi
  })

  const saved = await services.providerService.saveProvider({
    name: 'Local App',
    baseUrl: 'https://example.com/v1',
    apiKey: 'secret-key',
    defaultModel: 'test-model'
  })
  const stored = await services.repository.getProvider(saved.id)

  assert.equal(stored.encryptedApiKey.algorithm, 'AES-GCM')
  assert.equal(typeof services.attachmentService.prepareFiles, 'function')
  assert.equal(typeof services.nativeAttachmentPicker.pick, 'function')
  assert.equal(typeof services.nativeBackupPicker.pick, 'function')
  assert.equal(typeof services.replyNotificationService.notifyReply, 'function')
  assert.equal(services.providerRouter.resolve({ protocolType: 'gemini' }), services.geminiProvider)
  assert.equal(services.providerRouter.resolve({}), services.openAIProvider)
  assert.equal(services.chatService.provider, services.providerRouter)
  assert.equal(await services.chatService.getStreamingEnabled(), true)
  await services.repository.setSetting('streamingEnabled', false)
  assert.equal(await services.chatService.getStreamingEnabled(), false)
  assert.equal((await services.providerService.getRequestProfile(saved.id)).apiKey, 'secret-key')
  assert.deepEqual(services.platform, {
    runtime: 'app-android',
    storage: 'SQLite',
    encryption: 'Android Keystore',
    about: 'Android 本地版'
  })
  await services.repository.close()
})

test('App chat streams through the registered native Android transport', async () => {
  let streamListener
  let nativeRequest
  const uniApi = {
    request() { return { abort() {} } },
    aiChatKeystoreReady: () => true,
    aiChatKeystoreEncrypt: value => JSON.stringify({
      version: 1,
      algorithm: 'AES-GCM',
      iv: 'test-iv',
      ciphertext: Buffer.from(value).toString('base64')
    }),
    aiChatKeystoreDecrypt: recordJson => Buffer.from(JSON.parse(recordJson).ciphertext, 'base64').toString(),
    onAiChatStreamEvent(callback) { streamListener = callback },
    aiChatStreamCancel() { return true },
    aiChatStreamRequest(options) {
      nativeRequest = options
      queueMicrotask(() => {
        const event = (eventType, fields = {}) => streamListener({ requestId: options.requestId, eventType, ...fields })
        event('headers', { statusCode: 200, headers: [{ name: 'Content-Type', value: 'text/event-stream' }] })
        event('chunk', {
          data: Buffer.from('data: {"choices":[{"delta":{"content":"Android "},"finish_reason":null}]}\n\n').toString('base64')
        })
        event('chunk', {
          data: Buffer.from('data: {"choices":[{"delta":{"content":"stream"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n').toString('base64')
        })
        event('success', { statusCode: 200, headers: [] })
      })
    }
  }
  const services = await createAppServices({
    plusApi: { sqlite: createNodePlusSqlite() },
    uniApi
  })
  const provider = await services.providerService.saveProvider({
    name: 'Native Mock',
    baseUrl: 'http://127.0.0.1:4321/v1',
    apiKey: '',
    defaultModel: 'mock-stream'
  })
  const conversation = await services.chatService.createConversation({
    providerProfileId: provider.id,
    providerNameSnapshot: provider.name,
    modelName: provider.defaultModel
  })

  const result = await services.chatService.send({ conversationId: conversation.id, content: 'test native stream' })

  assert.equal(result.status, 'completed')
  assert.equal(result.content, 'Android stream')
  assert.match(nativeRequest.url, /127\.0\.0\.1:4321\/v1\/chat\/completions$/)
  assert.equal(nativeRequest.timeout, 300000)
  assert.equal(JSON.parse(nativeRequest.body).stream, true)
  await services.repository.close()
})

test('App chat bypasses the native stream transport when streaming is disabled', async () => {
  let nativeStreamCalls = 0
  let uniRequest
  const uniApi = {
    request(options) {
      uniRequest = options
      queueMicrotask(() => options.success({
        statusCode: 200,
        header: { 'content-type': 'application/json' },
        data: JSON.stringify({
          choices: [{ message: { content: 'Android complete' }, finish_reason: 'stop' }]
        })
      }))
      return { abort() {} }
    },
    aiChatKeystoreReady: () => true,
    aiChatKeystoreEncrypt: value => JSON.stringify({
      version: 1,
      algorithm: 'AES-GCM',
      iv: 'non-stream-iv',
      ciphertext: Buffer.from(value).toString('base64')
    }),
    aiChatKeystoreDecrypt: recordJson => Buffer.from(JSON.parse(recordJson).ciphertext, 'base64').toString(),
    onAiChatStreamEvent() {},
    aiChatStreamCancel() { return true },
    aiChatStreamRequest() { nativeStreamCalls += 1 }
  }
  const services = await createAppServices({
    plusApi: { sqlite: createNodePlusSqlite() },
    uniApi
  })
  await services.repository.setSetting('streamingEnabled', false)
  const provider = await services.providerService.saveProvider({
    name: 'Non-stream Mock',
    baseUrl: 'http://127.0.0.1:4321/v1',
    apiKey: '',
    defaultModel: 'mock-complete'
  })
  const conversation = await services.chatService.createConversation({
    providerProfileId: provider.id,
    providerNameSnapshot: provider.name,
    modelName: provider.defaultModel
  })

  const result = await services.chatService.send({ conversationId: conversation.id, content: 'test complete response' })

  assert.equal(result.status, 'completed')
  assert.equal(result.content, 'Android complete')
  assert.equal(nativeStreamCalls, 0)
  assert.equal(uniRequest.enableChunked, false)
  assert.equal(uniRequest.responseType, 'text')
  assert.equal(JSON.parse(uniRequest.data).stream, false)
  await services.repository.close()
})

test('App chat routes Gemini profiles through the native Gemini SSE protocol', async () => {
  let streamListener
  let nativeRequest
  const uniApi = {
    request() { return { abort() {} } },
    aiChatKeystoreReady: () => true,
    aiChatKeystoreEncrypt: value => JSON.stringify({
      version: 1,
      algorithm: 'AES-GCM',
      iv: 'gemini-iv',
      ciphertext: Buffer.from(value).toString('base64')
    }),
    aiChatKeystoreDecrypt: recordJson => Buffer.from(JSON.parse(recordJson).ciphertext, 'base64').toString(),
    onAiChatStreamEvent(callback) { streamListener = callback },
    aiChatStreamCancel() { return true },
    aiChatStreamRequest(options) {
      nativeRequest = options
      queueMicrotask(() => {
        const event = (eventType, fields = {}) => streamListener({ requestId: options.requestId, eventType, ...fields })
        event('headers', { statusCode: 200, headers: [{ name: 'Content-Type', value: 'text/event-stream' }] })
        event('chunk', {
          data: Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"Gemini App"}]},"finishReason":"STOP"}]}\n\n').toString('base64')
        })
        event('success', { statusCode: 200, headers: [] })
      })
    }
  }
  const services = await createAppServices({
    plusApi: { sqlite: createNodePlusSqlite() },
    uniApi
  })
  const provider = await services.providerService.saveProvider({
    name: 'Gemini Native Mock',
    protocolType: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: 'google-key',
    defaultModel: 'gemini-2.5-flash'
  })
  const conversation = await services.chatService.createConversation({
    providerProfileId: provider.id,
    providerNameSnapshot: provider.name,
    modelName: provider.defaultModel
  })

  const result = await services.chatService.send({ conversationId: conversation.id, content: 'test Gemini native stream' })

  assert.equal(result.status, 'completed')
  assert.equal(result.content, 'Gemini App')
  assert.match(nativeRequest.url, /models\/gemini-2\.5-flash:streamGenerateContent\?alt=sse$/)
  assert.equal(nativeRequest.headers.find(header => header.name === 'x-goog-api-key')?.value, 'google-key')
  assert.deepEqual(JSON.parse(nativeRequest.body), {
    contents: [{ role: 'user', parts: [{ text: 'test Gemini native stream' }] }]
  })
  await services.repository.close()
})

test('main page uses the platform service factory', async () => {
  const [mainSource, pageSource, factorySource, appFactorySource, browserFactorySource] = await Promise.all([
    readFile(new URL('../main.js', import.meta.url), 'utf8'),
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/create-platform-services.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/create-app-services.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/create-browser-services.js', import.meta.url), 'utf8')
  ])
  assert.match(mainSource, /#ifdef APP-PLUS/)
  assert.match(mainSource, /__aiChatPackagedApp/)
  assert.match(mainSource, /from ['"]\.\/uni_modules\/ai-chat-keystore['"]/)
  assert.match(mainSource, /from ['"]\.\/uni_modules\/ai-chat-attachment-picker['"]/)
  assert.match(mainSource, /from ['"]\.\/uni_modules\/ai-chat-streaming['"]/)
  assert.match(mainSource, /__aiChatNativeApis/)
  assert.match(mainSource, /aiChatWriteDownloadFile/)
  assert.match(pageSource, /createPlatformServices/)
  assert.doesNotMatch(pageSource, /createBrowserServices/)
  assert.doesNotMatch(factorySource, /import\(['"]\.\/create-app-services\.js['"]\)/)
  assert.match(factorySource, /__aiChatPackagedApp/)
  assert.match(appFactorySource, /__aiChatNativeApis/)
  for (const api of ['aiChatKeystoreReady', 'aiChatKeystoreEncrypt', 'aiChatKeystoreDecrypt']) {
    assert.match(appFactorySource, new RegExp(`uni\\.${api}`))
  }
  assert.match(appFactorySource, /new AttachmentService/)
  assert.match(appFactorySource, /new NativeAttachmentPicker/)
  assert.match(appFactorySource, /new NativeBackupPicker/)
  assert.match(appFactorySource, /new NativeStreamingTransport/)
  assert.match(browserFactorySource, /new AttachmentService/)
})

test('Android package enables SQLite and cleartext HTTP for user-configured model endpoints', async () => {
  const manifestSource = await readFile(new URL('../manifest.json', import.meta.url), 'utf8')

  assert.match(manifestSource, /"SQLite"\s*:\s*\{\}/)
  assert.match(manifestSource, /"usesCleartextTraffic"\s*:\s*true/)
  assert.match(manifestSource, /android\.permission\.INTERNET/)
})

test('Android package declares only required permissions and optional camera hardware', async () => {
  const [manifestSource, pluginManifest] = await Promise.all([
    readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
    readFile(new URL('../uni_modules/ai-chat-attachment-picker/utssdk/app-android/AndroidManifest.xml', import.meta.url), 'utf8')
  ])

  assert.match(manifestSource, /"minSdkVersion"\s*:\s*23/)
  assert.match(manifestSource, /"abiFilters"\s*:\s*\[\s*"arm64-v8a"\s*,\s*"armeabi-v7a"\s*\]/)
  for (const permission of ['INTERNET', 'ACCESS_NETWORK_STATE', 'CAMERA', 'RECORD_AUDIO']) {
    assert.match(manifestSource, new RegExp(`android\\.permission\\.${permission}`))
  }
  assert.match(`${manifestSource}\n${pluginManifest}`, /WRITE_EXTERNAL_STORAGE[^>]+maxSdkVersion=\\?"28\\?"/)
  assert.equal(
    (`${manifestSource}\n${pluginManifest}`.match(/uses-permission[^\n>]+WRITE_EXTERNAL_STORAGE/g) || []).length,
    1
  )
  for (const permission of ['READ_PHONE_STATE', 'GET_ACCOUNTS', 'READ_LOGS', 'WRITE_SETTINGS', 'CHANGE_WIFI_STATE', 'MOUNT_UNMOUNT_FILESYSTEMS']) {
    assert.doesNotMatch(manifestSource, new RegExp(`android\\.permission\\.${permission}`))
  }
  assert.match(manifestSource, /android\.hardware\.camera\\?" android:required=\\?"false/)
  assert.match(manifestSource, /android\.hardware\.camera\.autofocus\\?" android:required=\\?"false/)
})

test('provider actions guard against an unavailable service container', async () => {
  const pageSource = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(pageSource, /providerBusy\(\)\s*\{\s*return !this\.ready/)
  assert.match(pageSource, /providerServiceOrThrow\(\)/)
  assert.match(pageSource, /initializationError/)
  assert.match(pageSource, /error-retry-button/)
  assert.doesNotMatch(pageSource, /this\.services\.providerService\.fetchModels/)
})

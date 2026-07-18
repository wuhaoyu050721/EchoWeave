import assert from 'node:assert/strict'
import test from 'node:test'

import { NativeAttachmentAdapter } from '../src/platform/app/native-attachment-adapter.js'
import { NativeAttachmentPicker } from '../src/platform/app/native-attachment-picker.js'
import { NativeBackupPicker } from '../src/platform/app/native-backup-picker.js'
import { NativeCharacterCardPicker } from '../src/platform/app/native-character-card-picker.js'
import { NativeWorldBookPicker } from '../src/platform/app/native-world-book-picker.js'
import { AttachmentService } from '../src/services/attachment-service.js'

function nativeImage() {
  return {
    name: 'photo.png',
    type: 'image/png',
    size: 512,
    nativePrepared: {
      dataUrl: 'data:image/jpeg;base64,AA==',
      mimeType: 'image/jpeg',
      byteSize: 128,
      width: 800,
      height: 600
    }
  }
}

function nativeText() {
  return {
    name: 'notes.txt',
    type: 'text/plain',
    size: 5,
    nativePrepared: { textContent: 'hello', byteSize: 5 }
  }
}

test('native adapter exposes prepared image and UTF-8 text bodies', async () => {
  const adapter = new NativeAttachmentAdapter()

  assert.deepEqual(await adapter.prepareImage(nativeImage()), {
    dataUrl: 'data:image/jpeg;base64,AA==',
    mimeType: 'image/jpeg',
    byteSize: 128,
    width: 800,
    height: 600
  })
  assert.deepEqual(await adapter.readUtf8Text(nativeText()), { textContent: 'hello', byteSize: 5 })
  await assert.rejects(adapter.prepareImage({}), /原生图片处理结果无效/)
})

test('native picker feeds selected files through the shared attachment service', async () => {
  const calls = []
  const uniApi = {
    aiChatPickAttachments(options) {
      calls.push(options)
      options.success({ files: [nativeImage(), nativeText()] })
    }
  }
  const attachmentService = new AttachmentService({ adapter: new NativeAttachmentAdapter() })
  const picker = new NativeAttachmentPicker({ uniApi, attachmentService })

  const prepared = await picker.pick('file', { existing: [] })

  assert.equal(calls[0].mode, 'file')
  assert.equal(calls[0].maxCount, 4)
  assert.deepEqual(prepared.map(item => item.kind), ['image', 'text'])
})

test('native picker treats cancellation as empty selection and maps native errors', async () => {
  const attachmentService = new AttachmentService({ adapter: new NativeAttachmentAdapter() })
  const cancelled = new NativeAttachmentPicker({
    uniApi: { aiChatPickAttachments: options => options.success({ files: [] }) },
    attachmentService
  })
  assert.deepEqual(await cancelled.pick('image'), [])

  const failed = new NativeAttachmentPicker({
    uniApi: { aiChatPickAttachments: options => options.fail({ errMsg: '系统文件选择失败' }) },
    attachmentService
  })
  await assert.rejects(failed.pick('file'), /系统文件选择失败/)
})

test('native picker allows avatar flows to request one image', async () => {
  let requestedCount = 0
  let requestedMode = ''
  const attachmentService = new AttachmentService({ adapter: new NativeAttachmentAdapter() })
  const picker = new NativeAttachmentPicker({
    uniApi: {
      aiChatPickAttachments(options) {
        requestedCount = options.maxCount
        requestedMode = options.mode
        options.success({ files: [nativeImage()] })
      }
    },
    attachmentService
  })

  const prepared = await picker.pick('image-file', { maxCount: 1 })

  assert.equal(requestedCount, 1)
  assert.equal(requestedMode, 'image-file')
  assert.equal(prepared.length, 1)
  assert.equal(prepared[0].kind, 'image')
})

test('native character-card picker separates file-manager and gallery sources', async () => {
  const card = {
    name: 'card.png', type: 'image/png', size: 8,
    nativePrepared: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png', byteSize: 8 }
  }
  const received = []
  const picker = new NativeCharacterCardPicker({
    uniApi: { aiChatPickAttachments: options => { received.push(options); options.success({ files: [card] }) } }
  })

  assert.equal(await picker.pick(), card)
  assert.equal(await picker.pick('gallery'), card)
  assert.equal(received[0].mode, 'character-card-file')
  assert.equal(received[1].mode, 'character-card-gallery')
  assert.equal(received[0].maxCount, 1)
  await assert.rejects(picker.pick('camera'), /来源/)
})

test('native world-book picker requests one strict JSON text file', async () => {
  const book = {
    name: 'book.json', type: 'application/json', size: 14,
    nativePrepared: { textContent: '{"entries":[]}', byteSize: 14 }
  }
  let received
  const picker = new NativeWorldBookPicker({
    uniApi: { aiChatPickAttachments: options => { received = options; options.success({ files: [book] }) } }
  })

  assert.equal(await picker.pick(), book)
  assert.equal(received.mode, 'world-book')
  assert.equal(received.maxCount, 1)
})

test('native backup picker requests one bounded JSON file without a WebView input', async () => {
  const backup = {
    name: 'ai-chat-backup.json', type: 'application/json', size: 32,
    nativePrepared: { textContent: '{"formatVersion":3}', byteSize: 32 }
  }
  let received
  const picker = new NativeBackupPicker({
    uniApi: { aiChatPickAttachments: options => { received = options; options.success({ files: [backup] }) } }
  })

  assert.equal(await picker.pick(), backup)
  assert.equal(received.mode, 'backup-json')
  assert.equal(received.maxCount, 1)
})

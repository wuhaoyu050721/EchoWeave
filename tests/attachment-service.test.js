import assert from 'node:assert/strict'
import test from 'node:test'
import { AttachmentService } from '../src/services/attachment-service.js'

function file(name, type, size = 10) {
  return { name, type, size }
}

test('prepares image and text attachments in selection order', async () => {
  const service = new AttachmentService({
    adapter: {
      prepareImage: async () => ({
        dataUrl: 'data:image/jpeg;base64,AA==', mimeType: 'image/jpeg', width: 800, height: 600, byteSize: 128
      }),
      readUtf8Text: async () => ({ textContent: 'hello', byteSize: 5 })
    }
  })

  const prepared = await service.prepareFiles([
    file('photo.png', 'image/png', 500),
    file('notes.txt', 'text/plain', 5)
  ])

  assert.deepEqual(prepared.map(item => item.kind), ['image', 'text'])
  assert.deepEqual(prepared.map(item => item.name), ['photo.png', 'notes.txt'])
  assert.equal(prepared[0].dataUrl, 'data:image/jpeg;base64,AA==')
  assert.equal(prepared[1].textContent, 'hello')
})

test('rejects invalid files before returning partial output', async () => {
  let imageCalls = 0
  const service = new AttachmentService({
    adapter: {
      prepareImage: async () => {
        imageCalls += 1
        return { dataUrl: 'data:image/jpeg;base64,AA==', mimeType: 'image/jpeg', width: 1, height: 1, byteSize: 1 }
      },
      readUtf8Text: async () => ({ textContent: 'text', byteSize: 4 })
    }
  })

  await assert.rejects(
    service.prepareFiles([file('photo.jpg', 'image/jpeg'), file('report.pdf', 'application/pdf')]),
    /不支持的文件类型/
  )
  assert.equal(imageCalls, 0)
})

test('rejects count, text size, empty text, image size, and combined size violations', async () => {
  const service = new AttachmentService({
    adapter: {
      prepareImage: async item => ({
        dataUrl: 'data:image/jpeg;base64,AA==', mimeType: 'image/jpeg', width: 1, height: 1, byteSize: item.preparedSize ?? 1
      }),
      readUtf8Text: async item => ({ textContent: item.text ?? 'text', byteSize: item.decodedSize ?? item.size })
    }
  })

  await assert.rejects(service.prepareFiles(Array.from({ length: 5 }, (_, index) => file(`${index}.txt`, 'text/plain'))), /最多选择 4 个附件/)
  await assert.rejects(service.prepareFiles([file('large.txt', 'text/plain', 200 * 1024 + 1)]), /文本文件不能超过 200 KB/)
  await assert.rejects(service.prepareFiles([{ ...file('empty.txt', 'text/plain'), text: '   ' }]), /文本文件不能为空/)
  await assert.rejects(service.prepareFiles([{ ...file('large.jpg', 'image/jpeg'), preparedSize: 2 * 1024 * 1024 + 1 }]), /图片不能超过 2 MB/)
  await assert.rejects(
    service.prepareFiles([{ ...file('one.jpg', 'image/jpeg'), preparedSize: 2 * 1024 * 1024 }], {
      existing: [{ byteSize: 7 * 1024 * 1024 }]
    }),
    /附件总大小不能超过 8 MB/
  )
})

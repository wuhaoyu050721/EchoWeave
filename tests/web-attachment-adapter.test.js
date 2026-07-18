import assert from 'node:assert/strict'
import test from 'node:test'
import { WebAttachmentAdapter } from '../src/platform/browser/web-attachment-adapter.js'

test('decodes UTF-8 text fatally and reports exact byte size', async () => {
  const bytes = new TextEncoder().encode('你好')
  const adapter = new WebAttachmentAdapter({
    readArrayBuffer: async () => bytes.buffer
  })

  assert.deepEqual(await adapter.readUtf8Text({}), { textContent: '你好', byteSize: bytes.byteLength })

  const invalid = new Uint8Array([0xff, 0xff])
  const invalidAdapter = new WebAttachmentAdapter({ readArrayBuffer: async () => invalid.buffer })
  await assert.rejects(invalidAdapter.readUtf8Text({}), /UTF-8/)
})

test('resizes images and lowers JPEG quality until the body fits', async () => {
  const qualityCalls = []
  const adapter = new WebAttachmentAdapter({
    readDataUrl: async () => 'data:image/png;base64,source',
    decodeImage: async () => ({ image: {}, width: 3200, height: 1600, hasTransparency: false }),
    createCanvas: (width, height) => ({ width, height, getContext: () => ({ drawImage() {} }) }),
    encodeCanvas: async (canvas, mimeType, quality) => {
      qualityCalls.push({ width: canvas.width, height: canvas.height, mimeType, quality })
      const byteSize = quality > 0.7 ? 3 * 1024 * 1024 : 1024
      return { dataUrl: 'data:image/jpeg;base64,AA==', byteSize }
    }
  })

  const result = await adapter.prepareImage({ type: 'image/png' }, { maxDimension: 1600, maxBytes: 2 * 1024 * 1024 })

  assert.equal(result.width, 1600)
  assert.equal(result.height, 800)
  assert.equal(result.mimeType, 'image/jpeg')
  assert.ok(qualityCalls.length > 1)
  assert.equal(qualityCalls[0].quality, 0.86)
  assert.ok(result.byteSize <= 2 * 1024 * 1024)
})

test('keeps transparent images as PNG and rejects oversized encoded output', async () => {
  const adapter = new WebAttachmentAdapter({
    readDataUrl: async () => 'data:image/png;base64,source',
    decodeImage: async () => ({ image: {}, width: 100, height: 100, hasTransparency: true }),
    createCanvas: (width, height) => ({ width, height, getContext: () => ({ drawImage() {} }) }),
    encodeCanvas: async () => ({ dataUrl: 'data:image/png;base64,AA==', byteSize: 3 * 1024 * 1024 })
  })

  await assert.rejects(
    adapter.prepareImage({ type: 'image/png' }, { maxDimension: 1600, maxBytes: 2 * 1024 * 1024 }),
    /压缩后仍超过 2 MB/
  )
})

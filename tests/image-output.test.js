import assert from 'node:assert/strict'
import test from 'node:test'
import { bytesToDataUrl, extractImageOutputs, imageAttachmentSource, normalizeImageOutput } from '../src/core/image-output.js'
import { OpenAISseParser } from '../src/core/sse-parser.js'

test('normalizes base64 and URL image outputs', () => {
  const outputs = extractImageOutputs({
    data: [
      { b64_json: 'AA==', revised_prompt: 'revised' },
      { url: 'https://cdn.example.com/generated.png' }
    ]
  })

  assert.equal(outputs.length, 2)
  assert.equal(outputs[0].dataUrl, 'data:image/png;base64,AA==')
  assert.equal(outputs[0].byteSize, 1)
  assert.equal(outputs[0].revisedPrompt, 'revised')
  assert.equal(outputs[1].sourceUrl, 'https://cdn.example.com/generated.png')
  assert.equal(imageAttachmentSource(outputs[1]), outputs[1].sourceUrl)
})

test('encodes binary image bodies as data URLs', () => {
  assert.equal(bytesToDataUrl(new Uint8Array([0, 1, 2]), 'image/webp'), 'data:image/webp;base64,AAEC')
  assert.equal(normalizeImageOutput({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA==' } })?.byteSize, 1)
  assert.equal(normalizeImageOutput({ b64_json: '[invalid]' }, 0, { assumeImage: true }), null)
  assert.equal(normalizeImageOutput('not-an-image'), null)
})

test('extracts common compatible image callback envelopes and relative URLs', () => {
  const outputs = extractImageOutputs({
    artifacts: [{ base64: 'AA', mime_type: 'image/png' }],
    choices: [{ message: { content: '完成：![preview](https://cdn.example.com/preview.png)' } }],
    candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/webp', data: 'AQI' } }] } }],
    result: { images: [{ output_url: '/files/final.webp', mime_type: 'image/webp' }] }
  }, { baseUrl: 'https://api.example.com/v1' })

  assert.equal(outputs.length, 4)
  assert.equal(outputs.some(image => image.dataUrl === 'data:image/png;base64,AA=='), true)
  assert.equal(outputs.some(image => image.dataUrl === 'data:image/webp;base64,AQI='), true)
  assert.equal(outputs.some(image => image.sourceUrl === 'https://cdn.example.com/preview.png'), true)
  assert.equal(outputs.some(image => image.sourceUrl === 'https://api.example.com/files/final.webp'), true)
})

test('extracts text and image callbacks from streamed content parts', () => {
  const deltas = []
  const images = []
  const parser = new OpenAISseParser({
    onDelta: delta => deltas.push(delta),
    onImage: image => images.push(image)
  })
  parser.feed(new TextEncoder().encode(
    'data: {"choices":[{"delta":{"content":[{"type":"text","text":"done"},{"type":"image_url","image_url":{"url":"data:image/png;base64,AA=="}}]}}]}\n\n' +
    'data: [DONE]\n\n'
  ))
  parser.finish()

  assert.deepEqual(deltas, ['done'])
  assert.equal(images.length, 1)
  assert.equal(images[0].dataUrl, 'data:image/png;base64,AA==')
})

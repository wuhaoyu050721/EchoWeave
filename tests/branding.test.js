import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

function pngDimensions(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  }
}

test('织语 branding is wired to the package, pages, and fallback avatars', async () => {
  const [manifest, pages, preview, mainPage, contacts] = await Promise.all([
    readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
    readFile(new URL('../pages.json', import.meta.url), 'utf8'),
    readFile(new URL('../preview/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/character-contacts.vue', import.meta.url), 'utf8')
  ])

  assert.match(manifest, /"name"\s*:\s*"织语"/)
  assert.match(pages, /"navigationBarTitleText"\s*:\s*"织语"/)
  assert.match(preview, /<title>织语<\/title>/)
  assert.match(mainPage, /class="screen-title">织语<\/text>/)
  assert.match(mainPage, /织语 · 版本 1\.0\.1/)
  for (const source of [mainPage, contacts]) {
    assert.match(source, /\/static\/zhiyu-logo\.png/)
    assert.doesNotMatch(source, /\/static\/logo\.png/)
  }
})

test('织语 logo and every Android density icon have the declared PNG dimensions', async () => {
  const manifest = await readFile(new URL('../manifest.json', import.meta.url), 'utf8')
  const logo = await readFile(new URL('../static/zhiyu-logo.png', import.meta.url))
  assert.deepEqual(pngDimensions(logo), { width: 1024, height: 1024 })

  const icons = {
    ldpi: 36,
    mdpi: 48,
    hdpi: 72,
    xhdpi: 96,
    xxhdpi: 144,
    xxxhdpi: 192
  }
  for (const [density, size] of Object.entries(icons)) {
    const relativePath = `unpackage/res/icons/${size}x${size}.png`
    assert.match(manifest, new RegExp(`"${density}"\\s*:\\s*"${relativePath.replaceAll('/', '\\/')}"`))
    const icon = await readFile(new URL(`../${relativePath}`, import.meta.url))
    assert.deepEqual(pngDimensions(icon), { width: size, height: size })
  }
})

test('织语 Android splash images use nine-patch assets at the HBuilderX density dimensions', async () => {
  const manifest = await readFile(new URL('../manifest.json', import.meta.url), 'utf8')
  assert.match(manifest, /"waiting"\s*:\s*false/)
  assert.match(manifest, /"androidStyle"\s*:\s*"default"/)

  const splashImages = {
    hdpi: [480, 762],
    xhdpi: [720, 1242],
    xxhdpi: [1080, 1882]
  }
  for (const [density, [width, height]] of Object.entries(splashImages)) {
    const relativePath = `unpackage/res/splash/android/echo-weave-${density}-${width}x${height}.9.png`
    assert.match(manifest, new RegExp(`"${density}"\\s*:\\s*"${relativePath.replaceAll('/', '\\/')}"`))
    const splash = await readFile(new URL(`../${relativePath}`, import.meta.url))
    assert.deepEqual(pngDimensions(splash), { width, height })
  }
})

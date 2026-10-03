import { readMainPageSource } from './helpers/read-main-page.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { APP_VERSION } from '../src/core/app-metadata.js'

function pngDimensions(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  }
}

test('织语 branding is wired to the package, pages, and fallback avatars', async () => {
  const [manifest, pages, preview, mainPage, contacts, packageSource, heading, information] = await Promise.all([
    readFile(new URL('../manifest.json', import.meta.url), 'utf8'),
    readFile(new URL('../pages.json', import.meta.url), 'utf8'),
    readFile(new URL('../preview/index.html', import.meta.url), 'utf8'),
    readMainPageSource(),
    readFile(new URL('../src/components/character-contacts.vue', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/main-page-heading.vue', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/settings-information.vue', import.meta.url), 'utf8')
  ])

  assert.match(manifest, /"name"\s*:\s*"织语"/)
  assert.match(pages, /"navigationBarTitleText"\s*:\s*"织语"/)
  assert.match(preview, /<title>织语<\/title>/)
  assert.match(heading, /class="paper-brand"><text>织语<\/text><text>EchoWeave<\/text>/)
  assert.match(mainPage, /import MainPageHeading from '..\/..\/src\/components\/main-page-heading.vue'/)
  for (const title of ['会话', '故事', '接口', '设置']) {
    assert.match(mainPage, new RegExp(`<MainPageHeading title="${title}"`))
  }
  assert.match(contacts, /<MainPageHeading title="联系人"/)
  assert.equal(APP_VERSION, JSON.parse(packageSource).version)
  assert.match(mainPage, /版本 \{\{ appVersion \}\}/)
  assert.match(mainPage, /appVersion:\s*APP_VERSION/)
  assert.match(mainPage, /<SettingsInformation\s[^>]*:version="appVersion"/)
  assert.match(information, /<text>应用版本<\/text><text>\{\{ version \|\| '未提供' \}\}<\/text>/)
  assert.match(information, /class="updates-version">\{\{ version \|\| '未提供' \}\}/)
  assert.doesNotMatch(mainPage, /版本 1\.0\.1/)
  for (const source of [mainPage, contacts]) {
    assert.match(source, /\/static\/zhiyu-logo\.png/)
    assert.doesNotMatch(source, /\/static\/logo\.png/)
  }
})

test('织语 logo and every Android density icon have the declared PNG dimensions', async () => {
  const manifest = await readFile(new URL('../manifest.json', import.meta.url), 'utf8')
  const logo = await readFile(new URL('../static/zhiyu-logo.png', import.meta.url))
  assert.deepEqual(pngDimensions(logo), { width: 512, height: 512 })
  assert.ok(logo.byteLength < 300 * 1024)

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

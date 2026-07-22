import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const pageUrl = new URL('../pages/index/index.vue', import.meta.url)

test('backup dialog exposes local and cloud save plus file and link import', async () => {
  const source = await readFile(pageUrl, 'utf8')

  for (const label of ['保存到本地', '保存到云端', '从本地文件导入', '链接导入', '云端下载链接']) {
    assert.match(source, new RegExp(label))
  }
  assert.match(source, /@click="exportData"/)
  assert.match(source, /@click="exportDataToCloud"/)
  assert.match(source, /@change="importData"/)
  assert.match(source, /@click="importDataFromLink"/)
})

test('cloud JSON transfer uses the configured login server and shared validated import path', async () => {
  const source = await readFile(pageUrl, 'utf8')

  assert.match(source, /import \{ DEFAULT_CLOUD_BASE_URL, normalizeCloudBaseUrl, resolveCloudRequestBaseUrl \}/)
  assert.match(source, /cloud\.apiClient\.uploadJsonExport\(data\)/)
  assert.match(source, /cloud\.apiClient\.downloadJsonExport\(downloadUrl\)/)
  assert.match(source, /applyImportedBackup\(payload\)/)
  assert.match(source, /this\.services\.backupService\.importData\(payload\)/)
})

test('cloud download links can be copied in both App and browser runtimes', async () => {
  const source = await readFile(pageUrl, 'utf8')

  assert.match(source, /uniApi\?\.setClipboardData/)
  assert.match(source, /globalThis\.navigator\?\.clipboard\?\.writeText/)
  assert.match(source, /copyCloudExportLink/)
})

test('local JSON import uses the native Android picker before the browser input fallback', async () => {
  const source = await readFile(pageUrl, 'utf8')
  const block = source.slice(source.indexOf('chooseImportFile()'), source.indexOf('async applyImportedBackup'))

  assert.match(block, /this\.services\?\.nativeBackupPicker/)
  assert.match(block, /this\.importNativeBackup\(\)/)
  assert.match(block, /this\.\$refs\.backupFile/)
  assert.ok(block.indexOf('nativeBackupPicker') < block.indexOf('$refs.backupFile'))
  assert.match(source, /async importNativeBackup\(\)/)
  assert.match(source, /file\.nativePrepared\?\.textContent/)
})

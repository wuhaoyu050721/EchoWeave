import assert from 'node:assert/strict'
import test from 'node:test'
import { cloudSettingsMethods } from '../src/app/cloud-settings-methods.js'

function createApp(apiClient = {}) {
  const app = {
    services: { backupService: { async exportText() { return { data: { sample: true }, byteSize: 20 } } } },
    cloudSession: { access_token: 'fixture' }, cloudConnected: true, backupBusy: false,
    jsonExports: [], jsonExportsLoading: false, jsonExportsRevision: 0,
    jsonExportsError: '', jsonExportRevokingId: null, cloudExportUrl: '', cloudExportId: null,
    backupTransferStatus: '', errorMessage: '', events: [], errors: [],
    async prepareCloudServices() { return { apiClient } },
    formatAttachmentSize(value) { return `${value} bytes` },
    addCloudDiagnostic(type) { this.events.push(type) },
    showToast(message) { this.events.push(message) },
    handleError(error) { this.errors.push(error.message) },
    cloudBackupFailureText() { return '上传失败' }
  }
  for (const name of ['refreshJsonExports', 'resetJsonShareState', 'revokeJsonShare', 'exportDataToCloud']) {
    app[name] = cloudSettingsMethods[name].bind(app)
  }
  return app
}

test('share metadata refresh failure keeps a successfully uploaded link and reports separate list error', async () => {
  const app = createApp({
    async uploadJsonExport() { return { id: 7, download_url: 'https://example.test/share/token', expires_at: 1900000000 } },
    async listJsonExports() { throw new Error('分享记录暂时不可用') }
  })
  await app.exportDataToCloud()
  assert.equal(app.cloudExportUrl, 'https://example.test/share/token')
  assert.equal(app.cloudExportId, 7)
  assert.match(app.backupTransferStatus, /已上传/)
  assert.equal(app.jsonExportsError, '分享记录暂时不可用')
  assert.deepEqual(app.errors, [])
  assert.equal(app.backupBusy, false)
})

test('workspace switch during metadata refresh prevents late upload status and busy-state writes', async () => {
  let finish
  const app = createApp({
    async uploadJsonExport() { return { id: 7, download_url: 'https://example.test/share/token', expires_at: 1900000000 } },
    listJsonExports() { return new Promise(resolve => { finish = resolve }) }
  })
  const pending = app.exportDataToCloud()
  while (!finish) await Promise.resolve()
  app.services = {}
  app.resetJsonShareState()
  app.backupBusy = true // A new operation belongs to the new account.
  finish([{ id: 7 }])
  await pending
  assert.equal(app.cloudExportUrl, '')
  assert.deepEqual(app.jsonExports, [])
  assert.equal(app.backupTransferStatus, '')
  assert.equal(app.backupBusy, true)
  assert.deepEqual(app.events, ['cloud_backup_start'])
})

test('revocation removes the selected share and immediately invalidates the displayed bearer link', async () => {
  const calls = []
  const app = createApp({ async revokeJsonExport(id) { calls.push(id) } })
  app.jsonExports = [{ id: '7' }, { id: 8 }]
  app.cloudExportId = '7'
  app.cloudExportUrl = 'https://example.test/share/token'
  await app.revokeJsonShare({ id: 7 })
  assert.deepEqual(calls, [7])
  assert.deepEqual(app.jsonExports, [{ id: 8 }])
  assert.equal(app.cloudExportUrl, '')
  assert.equal(app.jsonExportRevokingId, null)
})

test('post-upload refresh supersedes an older list request that was already in flight', async () => {
  let finishOldList
  let listCalls = 0
  const app = createApp({
    async uploadJsonExport() { return { id: 7, download_url: 'https://example.test/share/token', expires_at: 1900000000 } },
    listJsonExports() {
      listCalls += 1
      if (listCalls === 1) return new Promise(resolve => { finishOldList = resolve })
      return Promise.resolve([{ id: 7 }])
    }
  })
  const first = app.refreshJsonExports()
  while (!finishOldList) await Promise.resolve()
  await app.exportDataToCloud()
  finishOldList([])
  await first
  assert.equal(listCalls, 2)
  assert.deepEqual(app.jsonExports, [{ id: 7 }])
  assert.equal(app.jsonExportsLoading, false)
})

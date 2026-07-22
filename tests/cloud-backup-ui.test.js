import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('settings exposes account, incremental sync, and encrypted full-backup actions', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  for (const label of [
    '账号与云端', '用户名', '自动同步', '前台每 3 分钟增量同步',
    '注册', '登录', '立即同步', '完整备份', '从云端恢复',
    '删除完整备份', '退出登录'
  ]) {
    assert.match(source, new RegExp(label))
  }
  assert.match(source, /createCloudServices/)
  assert.match(source, /return preserveServiceIdentity\(createCloudServices\(\{/)
  assert.match(source, /import \{ DEFAULT_CLOUD_BASE_URL, normalizeCloudBaseUrl, resolveCloudRequestBaseUrl \}/)
  assert.match(source, /resolveCloudRequestBaseUrl\(configuredBaseUrl\)/)
  assert.match(source, /@click="openCloudModal"/)
  assert.match(source, /class="modal-backdrop cloud-modal-backdrop"/)
  assert.match(source, /aria-label="关闭账号与云端"/)
  assert.match(source, /maxlength="32"/)
  assert.match(source, /<text>\{\{ cloudConnected \? '用户名' : '本地用户名' \}\}<\/text><view class="cloud-username-editor">/)
  assert.doesNotMatch(source, /<label class="cloud-field"><text>用户名<\/text>/)
  assert.match(source, /@click\.stop="saveProfileUsername"/)
  assert.match(source, /saveLocalProfileName\(this\.services\?\.repository, this\.cloudForm\.username\)/)
  assert.match(source, /this\.showToast\('本地用户名已保存'\)/)
  assert.match(source, /apiClient\.updateUsername/)
  assert.match(source, /@click="syncCloudNow"/)
  assert.match(source, /v-model="cloudForm\.baseUrl" :disabled="cloudBusy \|\| cloudConnected"/)
  assert.match(source, /this\.cloudForm\.baseUrl = resolveCloudRequestBaseUrl\(configuredBaseUrl\)/)
  assert.match(source, /resolveCloudRequestBaseUrl\(sessionBaseUrl\) !== baseUrl/)
  assert.match(source, /const serviceBaseUrl = sessionBaseUrl \|\| baseUrl/)
  assert.match(source, /if \(this\.autoBackupEnabled\) \{[\s\S]+syncCoordinator\?\.startForeground\(\)/)
  assert.doesNotMatch(source, /v-if="cloudOpen" class="settings-card cloud-backup-card"/)
  assert.match(source, /\.cloud-modal\s*\{[^}]*max-height:\s*calc\(100% - 24px\)[^}]*overflow:\s*hidden/s)
  assert.match(source, /\.cloud-modal-content\s*\{[^}]*max-height:\s*min\(68vh, 560px\)[^}]*overflow-y:\s*auto/s)
  assert.match(source, /\.settings-screen\s*\{\s*padding:\s*12px 10px 0;/)
  assert.match(source, /\.navigation-scroll-tail\s*\{\s*height:\s*88px;/)
	assert.match(source, /<AppDialogLayer/)
	assert.match(source, /confirmCloudAction\(content\)\s*\{\s*return this\.confirmAction\('云端备份', content\)/s)
  assert.doesNotMatch(source, /setSetting\([^\n]+cloudPassword/)
  assert.doesNotMatch(source, /setSetting\([^\n]+syncPassword/)
})

test('incremental sync follows foreground and network lifecycle', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
  const lifecycle = source.slice(source.indexOf('onShow()'), source.indexOf('methods:'))
  const networkListener = source.slice(
    source.indexOf('\n\t\t\tbindNetworkSyncListener() {'),
    source.indexOf('\n\t\t\tunbindNetworkSyncListener() {')
  )

  assert.match(lifecycle, /onShow\(\)[\s\S]+syncCoordinator\?\.startForeground\(\)/)
  assert.match(lifecycle, /onHide\(\)[\s\S]+syncCoordinator\?\.stopForeground\(\)/)
  assert.match(networkListener, /onNetworkRestored\(\)/)
  assert.doesNotMatch(lifecycle, /trigger\('foreground'\)/)
})

test('waits for an active sync before replacing services or closing a workspace', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
  const stopHelper = source.slice(
    source.indexOf('async stopCloudActivityAndWait'),
    source.indexOf('\n\t\t\tbindNetworkSyncListener()')
  )
  const workspaceSwitches = source.slice(
    source.indexOf('async activateWorkspaceForSession'),
    source.indexOf('retryInitialization()')
  )
  const prepareCloud = source.slice(
    source.indexOf('async prepareCloudServices()'),
    source.indexOf('async cloudAuthenticate')
  )
  const authenticate = source.slice(
    source.indexOf('async cloudAuthenticate'),
    source.indexOf('registerCloud()')
  )
  const toggle = source.slice(
    source.indexOf('async toggleAutoBackup()'),
    source.indexOf('async syncCloudNow()')
  )
  const logout = source.slice(
    source.indexOf('async logoutCloud()'),
    source.indexOf('async exportData()')
  )
  const lifecycle = source.slice(source.indexOf('beforeUnmount()'), source.indexOf('methods:'))
  const cloudFactory = source.slice(
    source.indexOf('buildCloudServices(baseUrl)'),
    source.indexOf('async prepareCloudServices()')
  )

  assert.match(stopHelper, /waits\.push\(scheduler\.stopAndWait\(\)\)/)
  assert.match(stopHelper, /waits\.push\(coordinator\.stopAndWait\(\)\)/)
  assert.match(stopHelper, /await Promise\.all\(waits\)/)
  assert.match(workspaceSwitches, /await this\.stopCloudActivityAndWait\(previousCloud\)/)
  assert.match(workspaceSwitches, /beforeClose: \(\) => this\.stopCloudActivityAndWait\(previousCloud\)/)
  assert.match(prepareCloud, /await this\.stopCloudActivityAndWait\(\)[\s\S]+this\.cloudServices = this\.buildCloudServices\(serviceBaseUrl\)/)
  assert.match(authenticate, /await this\.stopCloudActivityAndWait\(\)[\s\S]+this\.cloudServices = this\.buildCloudServices\(baseUrl\)/)
  assert.match(toggle, /await this\.stopCloudActivityAndWait\(cloud\)/)
  assert.match(logout, /await this\.stopCloudActivityAndWait\(\)[\s\S]+apiClient\.logout\(\)/)
  assert.match(logout, /catch \(error\) \{[\s\S]+remoteLogoutError = error[\s\S]+await this\.activateLocalWorkspace\(\)/)
  assert.match(lifecycle, /await this\.stopCloudActivityAndWait\(\)[\s\S]+await this\.workspaceManager\.close\(\)/)
  assert.match(cloudFactory, /const accountId = String\(this\.cloudSession\?\.user\?\.id/)
  assert.match(cloudFactory, /getAccountId: async \(\) => accountId \|\| null/)
})

test('manual sync and full backup actions safely reuse the encrypted sync password after restart', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')
  const credentialBlock = source.slice(source.indexOf('async prepareIncrementalSyncCredential'), source.indexOf('async uploadCloudBackup()'))
  const syncBlock = source.slice(source.indexOf('async syncCloudNow()'), source.indexOf('async restoreCloudBackup()'))
  const uploadBlock = source.slice(source.indexOf('async uploadCloudBackup()'), source.indexOf('async toggleAutoBackup()'))
  const restoreBlock = source.slice(source.indexOf('async restoreCloudBackup()'), source.indexOf('confirmCloudAction(content)'))

  assert.match(credentialBlock, /const existing = await cloud\.credentialStore\.load\(\)/)
  assert.match(credentialBlock, /if \(entered\) await cloud\.credentialStore\.save\(entered\)/)
  assert.match(syncBlock, /prepareIncrementalSyncCredential\(cloud\)/)
  assert.match(syncBlock, /credential\?\.newlySaved/)
  assert.match(syncBlock, /syncCoordinator\.manualSync\(\)/)
  assert.match(uploadBlock, /this\.cloudForm\.syncPassword \|\| await cloud\.credentialStore\.load\(\)/)
  assert.match(restoreBlock, /this\.cloudForm\.syncPassword \|\| await cloud\.credentialStore\.load\(\)/)
  assert.match(uploadBlock, /if \(!syncPassword\) throw new Error\('请先输入同步密码'\)/)
  assert.match(restoreBlock, /if \(!syncPassword\) throw new Error\('请先输入同步密码'\)/)
  const logoutBlock = source.slice(source.indexOf('async logoutCloud()'), source.indexOf('async exportData()'))
  assert.doesNotMatch(logoutBlock, /credentialStore\.clear\(\)/)
})

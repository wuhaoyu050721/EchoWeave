import { createCloudServices } from './create-cloud-services.js'
import { preserveServiceIdentity } from './vue-service-container.js'
import { saveLocalProfileName, syncProfileNameFromCloudSession } from './create-character-instructions.js'
import { DEFAULT_CLOUD_BASE_URL, normalizeCloudBaseUrl, resolveCloudRequestBaseUrl } from '../core/cloud-base-url.js'
import { createJsonExportFileName, exportTextToDownloads } from '../platform/app/app-file-exporter.js'
function getUniApi() { return typeof uni !== 'undefined' ? uni : globalThis.uni }
function getBrowserWindow() { return typeof window !== 'undefined' ? window : null }

export const cloudSettingsMethods = {
			openBackupMenu() {
				this.errorMessage = ''
				this.backupTransferStatus = ''
				this.backupMenuOpen = true
				this.refreshJsonExports()
			},
			closeBackupMenu() {
				if (this.backupBusy) return
				this.backupMenuOpen = false
			},
			isCloudOnline() {
				return typeof navigator === 'undefined' || navigator.onLine !== false
			},
			async stopCloudActivityAndWait(cloud = this.cloudServices) {
				const waits = []
				const scheduler = cloud?.scheduler
				if (typeof scheduler?.stopAndWait === 'function') waits.push(scheduler.stopAndWait())
				else scheduler?.stop?.()
				const coordinator = cloud?.syncCoordinator
				if (typeof coordinator?.stopAndWait === 'function') waits.push(coordinator.stopAndWait())
				else coordinator?.stopForeground?.()
				await Promise.all(waits)
			},
			bindNetworkSyncListener() {
				if (this.networkSyncHandler) return
				const handler = status => {
					const connected = typeof status === 'object' ? status.isConnected !== false : true
					if (connected && this.autoBackupEnabled && this.cloudConnected) {
						this.cloudServices?.syncCoordinator?.onNetworkRestored().catch(() => {})
					}
				}
				const uniApi = getUniApi()
				if (typeof uniApi?.onNetworkStatusChange === 'function') {
					uniApi.onNetworkStatusChange(handler)
					this.networkSyncHandler = { type: 'uni', handler }
					return
				}
				const browserWindow = getBrowserWindow()
				browserWindow?.addEventListener?.('online', handler)
				this.networkSyncHandler = { type: 'browser', handler }
			},
			unbindNetworkSyncListener() {
				if (!this.networkSyncHandler) return
				const { type, handler } = this.networkSyncHandler
				if (type === 'uni') getUniApi()?.offNetworkStatusChange?.(handler)
				else getBrowserWindow()?.removeEventListener?.('online', handler)
				this.networkSyncHandler = null
			},
			async refreshAfterCloudSync() {
				await this.repairCharacterConversationLinks()
				await Promise.all([this.loadProviders(), this.loadCharacters(), this.loadWorldBooks(), this.loadConversations()])
				if (this.ui.screen === 'chat' && this.ui.activeConversationId) {
					await this.openChat(this.ui.activeConversationId)
				}
			},
			buildCloudServices(baseUrl) {
				const accountId = String(this.cloudSession?.user?.id ?? '').trim()
				return preserveServiceIdentity(createCloudServices({
					...this.services,
					baseUrl,
					getDeviceId: () => this.cloudDeviceId(),
					getAccountId: async () => accountId || null,
					isOnline: () => this.isCloudOnline(),
					onStatus: ({ state, completedAt }) => {
						if (state === 'uploading') this.cloudBackupStatus = '正在自动备份'
						if (state === 'failed') this.cloudBackupStatus = '自动备份失败，稍后重试'
						if (state === 'completed') this.cloudBackupStatus = `最近备份 ${this.formatMessageTime(completedAt)}`
					},
					onSyncStatus: ({ state, completedAt }) => {
						if (state === 'syncing') this.cloudBackupStatus = '正在同步'
						if (state === 'failed') this.cloudBackupStatus = '同步失败，稍后重试'
						if (state === 'completed') {
							this.cloudBackupStatus = `最近同步 ${this.formatMessageTime(completedAt)}`
							this.refreshAfterCloudSync().catch(error => this.handleError(error, '同步后刷新失败'))
						}
					}
				}))
			},
			async prepareCloudServices() {
				const configuredBaseUrl = normalizeCloudBaseUrl(this.cloudForm.baseUrl)
				const baseUrl = resolveCloudRequestBaseUrl(configuredBaseUrl)
				if (!baseUrl) throw new Error('请填写云端服务器地址')
				this.cloudForm.baseUrl = baseUrl
				const sessionBaseUrl = normalizeCloudBaseUrl(this.cloudSession?.cloud_base_url)
				if (sessionBaseUrl && resolveCloudRequestBaseUrl(sessionBaseUrl) !== baseUrl) {
					throw new Error('当前账号属于其他云端服务器，请先退出登录')
				}
				const serviceBaseUrl = sessionBaseUrl || baseUrl
				if (!this.cloudServices || this.cloudServices.apiClient.baseUrl !== serviceBaseUrl) {
					await this.stopCloudActivityAndWait()
					this.cloudServices = this.buildCloudServices(serviceBaseUrl)
					this.cloudSession = await this.cloudServices.tokenStore.load()
					await this.syncCloudUsernameFromSession()
				}
				await this.services.repository.setSetting('cloudConfig', { baseUrl, email: this.cloudForm.email.trim() })
				return this.cloudServices
			},
			async cloudAuthenticate(action) {
				this.cloudBusy = true; this.errorMessage = ''
				try {
					const email = this.cloudForm.email.trim()
					const username = this.cloudForm.username.trim()
					const cloud = await this.prepareCloudServices()
					const baseUrl = cloud.apiClient.baseUrl
					const credentials = { email, password: this.cloudForm.password }
					if (action === 'register') credentials.username = username
					const session = await cloud.apiClient[action](credentials)
					await this.activateWorkspaceForSession(session)
					this.cloudSession = session
					this.cloudForm.baseUrl = baseUrl
					this.cloudForm.email = email
					this.cloudForm.username = session.user?.username || username
					await this.services.repository.setSetting('cloudConfig', { baseUrl, email })
					await this.stopCloudActivityAndWait()
					this.cloudServices = this.buildCloudServices(baseUrl)
					await this.syncCloudUsernameFromSession()
					this.cloudForm.password = ''
					if (this.autoBackupEnabled) {
						this.cloudServices?.syncCoordinator?.startForeground().catch(error => {
							this.handleError(error, '登录后的自动同步启动失败')
						})
					}
					this.showToast(`${action === 'register' ? '注册成功' : '登录成功'}，已切换到独立账号空间`)
				} catch (error) { this.handleError(error, action === 'register' ? '注册失败' : '登录失败') }
				finally { this.cloudBusy = false }
			},
			registerCloud() { return this.cloudAuthenticate('register') },
			loginCloud() { return this.cloudAuthenticate('login') },
			async syncCloudUsernameFromSession() {
				if (!this.cloudSession) {
					this.profileName = String(await this.services?.repository?.getSetting?.('profileName', '') || '').trim()
					this.cloudForm.username = this.profileName
					return
				}
				this.cloudForm.username = this.cloudSession.user?.username || ''
				this.profileName = await syncProfileNameFromCloudSession(this.services?.repository, this.cloudSession)
			},
			async saveProfileUsername() {
				if (this.cloudBusy) return
				this.cloudBusy = true; this.errorMessage = ''
				try {
					if (this.cloudConnected) {
						const cloud = await this.prepareCloudServices()
						this.cloudSession = await cloud.apiClient.updateUsername(this.cloudForm.username.trim())
						await this.syncCloudUsernameFromSession()
						this.showToast('用户名已更新')
					} else {
						this.profileName = await saveLocalProfileName(this.services?.repository, this.cloudForm.username)
						this.cloudForm.username = this.profileName
						this.showToast('本地用户名已保存')
					}
				} catch (error) { this.handleError(error, this.cloudConnected ? '更新用户名失败' : '保存本地用户名失败') }
				finally { this.cloudBusy = false }
			},
			async cloudDeviceId() {
				let deviceId = await this.services.repository.getSetting('cloudDeviceId', '')
				if (!deviceId) {
					deviceId = globalThis.crypto?.randomUUID?.() || `device-${Date.now()}`
					await this.services.repository.setSetting('cloudDeviceId', deviceId)
				}
				return deviceId
			},
			async prepareIncrementalSyncCredential(cloud) {
				const entered = this.cloudForm.syncPassword
				const existing = await cloud.credentialStore.load()
				if (!entered && !existing) throw new Error('请先输入同步密码')
				if (entered) await cloud.credentialStore.save(entered)
				return { newlySaved: Boolean(entered && !existing) }
			},
			cloudBackupProgressText(progress = {}) {
				const bytes = Number(progress.byteSize || progress.estimatedUploadBytes) || 0
				const size = bytes > 0 ? `（${this.formatAttachmentSize(bytes)}）` : ''
				return ({
					estimating: '正在检查备份大小',
					estimated: `备份大小已估算${size}`,
					reading: `正在读取本地数据${size}`,
					encrypting: `正在加密备份${size}`,
					uploading: `正在上传备份${size}`,
					completed: `备份已上传${size}`,
					failed: `备份上传失败${size}`
				})[progress.stage] || `正在处理云端备份${size}`
			},
			cloudBackupFailureText(error, fallbackBytes = 0) {
				const bytes = Number(error?.backupByteSize || error?.byteSize || fallbackBytes) || 0
				const size = bytes > 0 ? `（${this.formatAttachmentSize(bytes)}）` : ''
				if (error?.code === 'backup_too_large') return `备份超过服务器上限${size}`
				if (error?.code === 'cloud_transfer_timeout') return `备份上传超时${size}`
				if (error?.code === 'network_error') return `备份上传网络中断${size}`
				if (error?.code === 'cloud_backup_server_error') return `服务器处理备份失败${size}`
				return `云端备份失败${size}`
			},
			addCloudDiagnostic(type, detail = {}) {
				try {
					this.services?.diagnosticLogStore?.add?.(type, detail)
				} catch (_) {}
			},
			async uploadCloudBackup() {
				this.cloudBusy = true; this.errorMessage = ''
				const startedAt = Date.now()
				let transferBytes = 0
				this.cloudBackupStatus = '正在检查备份大小'
				this.addCloudDiagnostic('cloud_backup_start', { operation: 'full_backup_upload' })
				try {
					const cloud = await this.prepareCloudServices()
					if (this.autoBackupEnabled && this.cloudForm.syncPassword) await cloud.credentialStore.save(this.cloudForm.syncPassword)
					const syncPassword = this.cloudForm.syncPassword || await cloud.credentialStore.load()
					if (!syncPassword) throw new Error('请先输入同步密码')
					const result = await cloud.cloudBackupService.upload({
						deviceId: await this.cloudDeviceId(),
						syncPassword,
						onProgress: progress => {
							transferBytes = Number(progress.byteSize || progress.estimatedUploadBytes) || transferBytes
							this.cloudBackupStatus = this.cloudBackupProgressText(progress)
							this.addCloudDiagnostic('cloud_backup_progress', {
								operation: 'full_backup_upload',
								stage: progress.stage,
								byteSize: transferBytes
							})
						}
					})
					transferBytes = Number(result?.byte_size) || transferBytes
					const size = transferBytes > 0 ? ` · ${this.formatAttachmentSize(transferBytes)}` : ''
					this.cloudBackupStatus = `最近备份 ${this.formatMessageTime(new Date().toISOString())}${size}`
					this.addCloudDiagnostic('cloud_backup_completed', {
						operation: 'full_backup_upload',
						byteSize: transferBytes,
						durationMs: Date.now() - startedAt
					})
					this.showToast('云端备份完成')
				}
				catch (error) {
					transferBytes = Number(error?.backupByteSize || error?.byteSize) || transferBytes
					this.cloudBackupStatus = this.cloudBackupFailureText(error, transferBytes)
					this.addCloudDiagnostic('cloud_backup_failed', {
						operation: 'full_backup_upload',
						byteSize: transferBytes,
						durationMs: Date.now() - startedAt,
						code: String(error?.code || ''),
						status: Number(error?.status) || 0,
						serverCode: String(error?.serverCode || ''),
						message: String(error?.message || '')
					})
					this.handleError(error, '云端备份失败')
				}
				finally { this.cloudBusy = false }
			},
			async toggleAutoBackup() {
				this.cloudBusy = true; this.errorMessage = ''
				const wasEnabled = this.autoBackupEnabled
				let cloud = null
				let credential = null
				try {
					cloud = await this.prepareCloudServices()
					if (this.autoBackupEnabled) {
						this.autoBackupEnabled = false
						await this.stopCloudActivityAndWait(cloud)
						this.cloudBackupStatus = ''
						await this.services.repository.setSetting('cloudAutoBackup', false)
						return
					}
					credential = await this.prepareIncrementalSyncCredential(cloud)
					await cloud.syncCoordinator?.startForeground()
					this.autoBackupEnabled = true
					await this.services.repository.setSetting('cloudAutoBackup', true)
				} catch (error) {
					if (wasEnabled) {
						this.autoBackupEnabled = true
						cloud?.syncCoordinator?.startForeground?.().catch(() => {})
					} else {
						await this.stopCloudActivityAndWait(cloud)
						this.autoBackupEnabled = false
						await this.services.repository.setSetting('cloudAutoBackup', false).catch(() => {})
						if (credential?.newlySaved) await cloud?.credentialStore?.clear?.().catch(() => {})
					}
					this.handleError(error, '自动同步设置失败')
				}
				finally { this.cloudBusy = false }
			},
			async syncCloudNow() {
				if (this.cloudBusy) return
				this.cloudBusy = true
				this.errorMessage = ''
				let cloud = null
				let credential = null
				try {
					cloud = await this.prepareCloudServices()
					credential = await this.prepareIncrementalSyncCredential(cloud)
					const result = await cloud.syncCoordinator.manualSync()
					if (result?.skipped) throw new Error(result.skipped === 'offline' ? '当前网络不可用' : '当前无法执行云端同步')
					await this.refreshAfterCloudSync()
					this.showToast(`同步完成：上传 ${result.pushed || 0}，接收 ${result.pulled || 0}`)
				} catch (error) {
					if (credential?.newlySaved) await cloud?.credentialStore?.clear?.().catch(() => {})
					this.handleError(error, '云端同步失败')
				}
				finally { this.cloudBusy = false }
			},
			async restoreCloudBackup() {
				if (!await this.confirmCloudAction('从云端恢复会复制历史记录到本机，是否继续？')) return
				this.cloudBusy = true; this.errorMessage = ''
				try {
					const cloud = await this.prepareCloudServices()
					const syncPassword = this.cloudForm.syncPassword || await cloud.credentialStore.load()
					if (!syncPassword) throw new Error('请先输入同步密码')
					const result = await cloud.cloudBackupService.restore({ syncPassword })
					await this.repairCharacterConversationLinks()
					await this.loadProfileAvatar()
					await this.loadProviders()
					await this.loadCharacters()
					await this.loadWorldBooks()
					await this.loadConversations()
					this.showToast(`已恢复 ${result.conversations} 个会话和 ${result.characters || 0} 个角色`)
				}
				catch (error) { this.handleError(error, '云端恢复失败') }
				finally { this.cloudBusy = false }
			},
			confirmCloudAction(content) {
				return this.confirmAction('云端备份', content)
			},
			async deleteCloudBackup() {
				if (!await this.confirmCloudAction('确定删除服务器上的完整备份吗？增量同步记录和本地数据不会删除。')) return
				this.cloudBusy = true; this.errorMessage = ''
				try {
					const cloud = await this.prepareCloudServices()
					await cloud.apiClient.deleteBackup()
					this.showToast('云端完整备份已删除')
				} catch (error) { this.handleError(error, '删除云端备份失败') }
				finally { this.cloudBusy = false }
			},
			async logoutCloud() {
				this.cloudBusy = true
				let remoteLogoutError = null
				try {
					await this.stopCloudActivityAndWait()
					try {
						await this.cloudServices?.apiClient.logout()
					} catch (error) {
						remoteLogoutError = error
					}
					await this.activateLocalWorkspace()
					this.cloudForm.password = ''
					this.cloudForm.syncPassword = ''
					this.cloudBackupStatus = ''
					this.showToast(remoteLogoutError ? '已退出本地，云端会话暂未撤销' : '已退出登录并返回本地空间')
				}
				catch (error) { this.handleError(error, '退出登录失败') }
				finally { this.cloudBusy = false }
			},
			async exportData() {
				if (this.backupBusy) return
				this.backupBusy = true
				this.errorMessage = ''
				try {
					const { content } = await this.services.backupService.exportText()
					const fileName = createJsonExportFileName()
					const plusApi = typeof plus !== 'undefined' ? plus : null
					if (plusApi?.io?.requestFileSystem) {
						await exportTextToDownloads({ plusApi, fileName, content })
						this.showToast('JSON 已保存到下载目录')
					} else {
						if (typeof Blob !== 'function' || typeof URL === 'undefined' || typeof document === 'undefined') {
							throw new Error('当前环境不支持文件导出')
						}
						const blob = new Blob([content], { type: 'application/json' })
						const url = URL.createObjectURL(blob)
						const anchor = document.createElement('a')
						anchor.href = url
						anchor.download = fileName
						anchor.click()
						URL.revokeObjectURL(url)
						this.showToast('导出完成')
					}
					this.backupMenuOpen = false
				} catch (error) {
					this.handleError(error, '导出失败')
				} finally {
					this.backupBusy = false
				}
			},
			resetJsonShareState() {
				this.backupBusy = false
				this.jsonExportsRevision += 1
				this.jsonExports = []
				this.jsonExportsLoading = false
				this.jsonExportsError = ''
				this.jsonExportRevokingId = null
				this.cloudExportUrl = ''
				this.cloudExportId = null
				this.cloudExportExpiresAt = null
				this.cloudImportUrl = ''
				this.backupTransferStatus = ''
			},
			formatJsonShareDate(value) {
				const date = new Date(typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) * 1000 : value)
				return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '未知时间'
			},
			async refreshJsonExports() {
				if (!this.cloudConnected) return
				const requestRevision = (this.jsonExportsRequestRevision || 0) + 1
				this.jsonExportsRequestRevision = requestRevision
				const revision = this.jsonExportsRevision
				const services = this.services
				this.jsonExportsLoading = true
				this.jsonExportsError = ''
				try {
					const cloud = await this.prepareCloudServices()
					const items = await cloud.apiClient.listJsonExports()
					if (services === this.services && revision === this.jsonExportsRevision && requestRevision === this.jsonExportsRequestRevision) this.jsonExports = items
				} catch (error) {
					if (services === this.services && revision === this.jsonExportsRevision && requestRevision === this.jsonExportsRequestRevision) this.jsonExportsError = error?.message || '分享记录加载失败，请重试'
				} finally {
					if (services === this.services && revision === this.jsonExportsRevision && requestRevision === this.jsonExportsRequestRevision) this.jsonExportsLoading = false
				}
			},
			async revokeJsonShare(item) {
				if (this.backupBusy || this.jsonExportRevokingId !== null) return
				const revision = this.jsonExportsRevision
				const services = this.services
				this.jsonExportRevokingId = item.id
				this.jsonExportsError = ''
				try {
					const cloud = await this.prepareCloudServices()
					if (services !== this.services || revision !== this.jsonExportsRevision) return
					await cloud.apiClient.revokeJsonExport(item.id)
					if (services !== this.services || revision !== this.jsonExportsRevision) return
					this.jsonExportsRequestRevision = (this.jsonExportsRequestRevision || 0) + 1
					this.jsonExportsLoading = false
					this.jsonExports = this.jsonExports.filter(share => String(share.id) !== String(item.id))
					if (String(this.cloudExportId) === String(item.id)) { this.cloudExportUrl = ''; this.cloudExportId = null; this.cloudExportExpiresAt = null }
					this.showToast('分享已撤销，原链接已失效')
				} catch (error) {
					if (services === this.services && revision === this.jsonExportsRevision) this.jsonExportsError = error?.message || '撤销失败，请重试'
				} finally {
					if (services === this.services && revision === this.jsonExportsRevision) this.jsonExportRevokingId = null
				}
			},
			async exportDataToCloud() {
				if (this.backupBusy) return
				this.backupBusy = true
				this.errorMessage = ''
				this.backupTransferStatus = '正在生成备份文件'
				const services = this.services
				const revision = this.jsonExportsRevision
				const startedAt = Date.now()
				let transferBytes = 0
				this.addCloudDiagnostic('cloud_backup_start', { operation: 'json_export_upload' })
				try {
					const cloud = await this.prepareCloudServices()
					if (!this.cloudSession?.access_token) throw new Error('请先在“账号与云端”登录')
					if (services !== this.services) return
					const { data, byteSize } = await services.backupService.exportText()
					if (services !== this.services) return
					transferBytes = Number(byteSize) || 0
					this.backupTransferStatus = `正在上传 ${this.formatAttachmentSize(transferBytes)}`
					const uploaded = await cloud.apiClient.uploadJsonExport(data)
					if (services !== this.services || revision !== this.jsonExportsRevision) return
					this.cloudExportUrl = uploaded.download_url
					this.cloudExportId = uploaded.id
					this.cloudExportExpiresAt = uploaded.expires_at
					await this.refreshJsonExports()
					if (services !== this.services || revision !== this.jsonExportsRevision) return
					this.backupTransferStatus = `已上传 ${this.formatAttachmentSize(Number(uploaded.byte_size) || transferBytes)}`
					this.addCloudDiagnostic('cloud_backup_completed', {
						operation: 'json_export_upload',
						byteSize: Number(uploaded.byte_size) || transferBytes,
						durationMs: Date.now() - startedAt
					})
					this.showToast('云端 JSON 已保存')
				} catch (error) {
					if (services !== this.services || revision !== this.jsonExportsRevision) return
					if (error && typeof error === 'object' &&
						!Number(error.backupByteSize) && transferBytes > 0) error.backupByteSize = transferBytes
					this.backupTransferStatus = this.cloudBackupFailureText(error, transferBytes)
					this.addCloudDiagnostic('cloud_backup_failed', {
						operation: 'json_export_upload',
						byteSize: transferBytes,
						durationMs: Date.now() - startedAt,
						code: String(error?.code || ''),
						status: Number(error?.status) || 0,
						message: String(error?.message || '')
					})
					this.handleError(error, '云端保存失败')
				} finally {
					if (services === this.services && revision === this.jsonExportsRevision) this.backupBusy = false
				}
			},
			chooseImportFile() {
				if (this.backupBusy) return
				if (this.services?.nativeBackupPicker) {
					this.importNativeBackup()
					return
				}
				this.$nextTick(() => {
					const target = this.$refs.backupFile
					const input = Array.isArray(target) ? target[0] : target
					if (input?.click) input.click()
					else this.handleError(new Error('当前环境无法打开备份文件选择器'), '导入失败')
				})
			},
			async importNativeBackup() {
				this.backupBusy = true
				this.errorMessage = ''
				try {
					const file = await this.services.nativeBackupPicker.pick()
					if (!file) return
					const text = file.nativePrepared?.textContent
					if (typeof text !== 'string') throw new Error('原生备份文件内容无效')
					const result = await this.applyImportedBackup(JSON.parse(text.replace(/^\uFEFF/, '')))
					this.backupMenuOpen = false
					this.showToast(`已导入 ${result.conversations} 个会话`)
				} catch (error) {
					this.handleError(error, '导入失败')
				} finally {
					this.backupBusy = false
				}
			},
			async applyImportedBackup(payload) {
				const result = await this.services.backupService.importData(payload)
				await this.repairCharacterConversationLinks()
				await this.loadProfileAvatar()
				await this.loadProviders()
				await this.loadCharacters()
				await this.loadWorldBooks()
				await this.loadConversations()
				return result
			},
			async importData(event) {
				const file = event.target.files?.[0]
				if (!file) return
				this.backupBusy = true
				this.errorMessage = ''
				try {
					const result = await this.applyImportedBackup(JSON.parse((await file.text()).replace(/^\uFEFF/, '')))
					this.backupMenuOpen = false
					this.showToast(`已导入 ${result.conversations} 个会话`)
				}
				catch (error) { this.handleError(error, '导入失败') }
				finally { this.backupBusy = false; event.target.value = '' }
			},
			async importDataFromLink() {
				if (this.backupBusy) return
				const downloadUrl = this.cloudImportUrl.trim()
				if (!downloadUrl) { this.showToast('请粘贴云端 JSON 链接'); return }
				this.backupBusy = true
				this.errorMessage = ''
				try {
					const cloud = await this.prepareCloudServices()
					const payload = await cloud.apiClient.downloadJsonExport(downloadUrl)
					const result = await this.applyImportedBackup(payload)
					this.backupMenuOpen = false
					this.showToast(`已从链接导入 ${result.conversations} 个会话`)
				} catch (error) {
					this.handleError(error, '链接导入失败')
				} finally {
					this.backupBusy = false
				}
			},
			writeClipboard(content) {
				const value = String(content ?? '')
				const uniApi = getUniApi()
				if (typeof uniApi?.setClipboardData === 'function') {
					return new Promise((resolve, reject) => uniApi.setClipboardData({ data: value, success: resolve, fail: reject }))
				}
				if (globalThis.navigator?.clipboard?.writeText) return globalThis.navigator.clipboard.writeText(value)
				return Promise.reject(new Error('当前环境不支持复制'))
			},
			async copyCloudExportLink() {
				try { await this.writeClipboard(this.cloudExportUrl); this.showToast('下载链接已复制') }
				catch (error) { this.handleError(error, '复制失败') }
			},
}

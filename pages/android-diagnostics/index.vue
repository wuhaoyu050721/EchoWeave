<template>
	<view class="diagnostic-shell">
		<view class="diagnostic-header">
			<button class="icon-button" aria-label="返回" @click="goBack"><ArrowLeft :size="22" /></button>
			<text class="header-title">设备与诊断</text>
			<button class="icon-button" :class="{ active: headerMenuOpen }" aria-label="诊断页菜单" :aria-expanded="headerMenuOpen" aria-controls="diagnostic-header-menu" @click="headerMenuOpen = !headerMenuOpen"><MoreVertical :size="20" /></button>
		</view>
		<view v-if="headerMenuOpen" class="header-menu-backdrop" aria-hidden="true" @click="headerMenuOpen = false" />
		<view v-if="headerMenuOpen" id="diagnostic-header-menu" class="header-menu">
			<button :disabled="!logs.length" @click="exportLogsFromMenu"><ClipboardCopy :size="17" /><text>导出日志</text></button>
			<button :disabled="!logs.length" @click="clearLogsFromMenu"><Trash2 :size="17" /><text>清空日志</text></button>
		</view>

		<scroll-view class="diagnostic-scroll" scroll-y>
			<view class="diagnostic-intro"><text>流式传输诊断</text><text>查看连接、响应和流式分块的实际状态。</text></view>
			<button class="runtime-overview" :class="{ supported: isAndroidApp }" @click="showToast(isAndroidApp ? '密钥仅保留在当前页面内存中' : '请使用 Android App 运行诊断')">
				<view class="runtime-icon"><LockKeyhole :size="21" /></view>
				<view class="runtime-copy">
					<text>{{ runtimeLabel }}</text>
					<text>{{ isAndroidApp ? '密钥只在本次诊断期间保留' : '请在 Android App 中打开此页面' }}</text>
				</view>
				<view class="runtime-state" :class="summary.status"><view /><text>{{ statusLabel }}</text></view>
			</button>

			<text class="section-label">请求配置</text>
			<view class="section-band config-section">
				<view class="field-row"><text class="field-label">接口格式</text><view class="diagnostic-protocol-control" role="group" aria-label="接口格式"><button v-for="protocol in protocols" :key="protocol.id" class="diagnostic-protocol-option" :class="{ active: form.protocolType === protocol.id }" :disabled="isRunning" :aria-pressed="form.protocolType === protocol.id" @click="selectProtocol(protocol.id)">{{ protocol.label }}</button></view></view>
				<label class="field-row"><text class="field-label">基础地址</text><view class="field-control"><Server :size="17" /><input v-model="form.baseUrl" :disabled="isRunning" aria-label="基础地址" placeholder="https://api.openai.com/v1" /></view></label>
				<label class="field-row"><text class="field-label">API 密钥</text><view class="field-control"><LockKeyhole :size="17" /><input v-model="form.apiKey" :disabled="isRunning" :type="showApiKey ? 'text' : 'password'" aria-label="API 密钥" autocomplete="off" placeholder="仅本次诊断使用" /><button :aria-label="showApiKey ? '隐藏密钥' : '显示密钥'" :aria-pressed="showApiKey" @click="showApiKey = !showApiKey"><EyeOff :size="17" /></button></view><text class="field-note">离开页面后自动清除，不会写入本地存储</text></label>
				<label class="field-row"><text class="field-label">模型</text><view class="field-control"><Database :size="17" /><input v-model="form.model" :disabled="isRunning" aria-label="模型" :placeholder="activeProtocol.modelPlaceholder.replace('例如 ', '')" /></view></label>
				<label class="field-row field-textarea"><view class="field-heading"><text class="field-label">测试提示词</text><text>{{ form.prompt.length }}/500</text></view><view class="textarea-field"><textarea v-model="form.prompt" :disabled="isRunning" aria-label="测试提示词" maxlength="500" placeholder="请回复一段包含中文的简短文本" /></view></label>
				<label class="field-row"><text class="field-label">请求超时</text><view class="number-field"><input v-model.number="form.timeout" :disabled="isRunning" aria-label="请求超时（毫秒）" type="number" /><text>ms</text></view></label>
				<view class="action-bar">
					<button class="primary-action" :class="{ running: isRunning }" :disabled="!isRunning && !canStart" @click="isRunning ? stopDiagnostic() : startDiagnostic()"><Square v-if="isRunning" :size="15" fill="currentColor" /><Play v-else :size="17" fill="currentColor" /><text>{{ isRunning ? '停止诊断' : '开始诊断' }}</text></button>
					<text class="action-note">{{ startHint }}</text>
					<view class="secondary-actions">
						<button class="secondary-action" @click="resetDiagnostic"><RotateCcw :size="17" /><text>重置状态</text></button>
						<button class="secondary-action" :disabled="!logs.length" aria-label="清空日志" @click="clearLogs"><Trash2 :size="17" /><text>清空日志</text></button>
					</view>
				</view>
			</view>

			<text class="section-label">运行状态</text>
			<view class="section-band summary-section">
				<view class="section-heading"><text class="section-title">状态摘要</text><text class="status-badge" :class="summary.status" role="status" aria-live="polite">{{ statusLabel }}</text></view>
				<view class="summary-grid">
					<view class="metric-card"><view class="metric-label"><Activity :size="18" /><text>首块耗时</text></view><view class="metric-reading"><strong>{{ metricValue(summary.firstChunkMs) }}</strong><text>ms</text></view></view>
					<view class="metric-card"><view class="metric-label"><History :size="18" /><text>总耗时</text></view><view class="metric-reading"><strong>{{ metricValue(summary.durationMs) }}</strong><text>ms</text></view></view>
					<view class="metric-card"><view class="metric-label"><Database :size="18" /><text>分块</text></view><view class="metric-reading"><strong>{{ summary.chunkCount }}</strong></view></view>
					<view class="metric-card"><view class="metric-label"><FileText :size="18" /><text>字节</text></view><view class="metric-reading"><strong>{{ summary.byteCount }}</strong><text>B</text></view></view>
					<view class="metric-card"><view class="metric-label"><Activity :size="18" /><text>SSE 事件</text></view><view class="metric-reading"><strong>{{ summary.eventCount }}</strong></view></view>
					<view class="metric-card"><view class="metric-label finish-label"><Check :size="18" /><text>结束原因</text></view><view class="metric-reading"><strong>{{ summary.finishReason || (summary.doneReceived ? '[DONE]' : '-') }}</strong></view></view>
				</view>
				<view v-if="summary.errorMessage" class="diagnostic-error" role="alert"><AlertCircle :size="16" /><text>{{ summary.errorMessage }}</text></view>
			</view>

			<text class="section-label">模型响应</text>
			<view class="section-band output-section">
				<text class="section-title">流式输出</text>
				<view class="output-preview" :class="{ 'has-output': output }"><text selectable>{{ output || outputPlaceholder }}</text></view>
			</view>

			<text class="section-label">运行记录</text>
			<view class="section-band log-section">
				<view class="section-heading"><view class="log-heading"><text class="section-title">诊断日志</text><text class="log-count">{{ logs.length }}</text></view><button class="inline-action" :disabled="!logs.length" @click="exportLogsFromMenu"><ClipboardCopy :size="16" /><text>导出</text></button></view>
				<text class="log-note">导出时会自动隐藏密钥等敏感信息</text>
				<view v-if="!logs.length" class="empty-log"><FileText :size="25" /><text>暂无日志</text><text>开始诊断后，运行记录会显示在这里</text></view>
				<view v-for="(entry, index) in logs" :key="`${entry.timestamp}-${index}`" class="log-row">
					<text class="log-time">{{ formatLogTime(entry.timestamp) }}</text>
					<text class="log-type">{{ entry.type }}</text>
					<text class="log-detail" selectable>{{ logDetail(entry) }}</text>
				</view>
			</view>
			<view class="diagnostic-scroll-tail" />
		</scroll-view>

		<view v-if="toastMessage" class="toast-message">{{ toastMessage }}</view>
	</view>
</template>

<script>
	import {
		Activity, AlertCircle, ArrowLeft, Check, ClipboardCopy, Database, EyeOff,
		FileText, History, LockKeyhole, MoreVertical, Play, RotateCcw, Server, Square, Trash2
	} from '../../src/components/app-icons.js'
	import { preserveServiceIdentity } from '../../src/app/vue-service-container.js'
	import { getRuntimeDiagnosticLogStore } from '../../src/core/runtime-diagnostic-log.js'
	import { PROVIDER_PROTOCOLS, defaultProviderBaseUrl, getProviderProtocol } from '../../src/core/provider-protocol.js'
	import { NativeStreamingTransport } from '../../src/platform/app/native-streaming-transport.js'
	import { AndroidDiagnosticService } from '../../src/services/android-diagnostic-service.js'

	function initialSummary() {
		return {
			status: 'idle', firstChunkMs: null, durationMs: 0, chunkCount: 0, byteCount: 0,
			eventCount: 0, lateChunkCount: 0, finishReason: null, doneReceived: false, errorMessage: ''
		}
	}

	function getUniApi() { return typeof uni !== 'undefined' ? uni : null }
	function getPlusApi() { return typeof plus !== 'undefined' ? plus : null }
	const DIAGNOSTIC_MODELS = { 'openai-compatible': 'gpt-4o-mini', gemini: 'gemini-2.5-flash' }
	function getNativeStreamingApi() {
		const registered = globalThis.__aiChatNativeApis
		if (
			typeof registered?.onAiChatStreamEvent === 'function' &&
			typeof registered?.aiChatStreamRequest === 'function' &&
			typeof registered?.aiChatStreamCancel === 'function'
		) return registered
		const uniApi = getUniApi()
		if (
			typeof uniApi?.onAiChatStreamEvent === 'function' &&
			typeof uniApi?.aiChatStreamRequest === 'function' &&
			typeof uniApi?.aiChatStreamCancel === 'function'
		) return uniApi
		return null
	}

	export default {
		components: {
			Activity, AlertCircle, ArrowLeft, Check, ClipboardCopy, Database, EyeOff,
			FileText, History, LockKeyhole, MoreVertical, Play, RotateCcw, Server, Square, Trash2
		},
		data() {
			return {
				isAndroidApp: false,
				protocols: PROVIDER_PROTOCOLS,
				headerMenuOpen: false,
				showApiKey: false,
				requestPending: false, diagnosticRunId: 0, diagnosticsDisposed: false,
				form: {
					protocolType: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini',
					prompt: '请回复一段包含中文的简短文本，用于测试流式输出。', timeout: 30000
				},
				summary: initialSummary(), output: '', logs: [], logStore: null, service: null,
				toastMessage: '', toastTimer: null
			}
		},
		computed: {
			activeProtocol() { return getProviderProtocol(this.form.protocolType) },
			runtimeLabel() {
				if (!this.isAndroidApp) return '仅 Android App 支持流式诊断'
				if (!this.service) return 'Android 原生流式模块未加载'
				if (this.summary.status === 'completed') return 'Android App · 流式已验证'
				if (this.summary.status === 'failed') return 'Android App · 验证失败'
				if (this.isRunning) return 'Android App · 验证中'
				return 'Android App · 未验证'
			},
			isRunning() { return ['connecting', 'streaming'].includes(this.summary.status) },
			canStart() {
				return this.isAndroidApp && Boolean(this.service) && !this.requestPending && !this.isRunning && Boolean(
					this.form.baseUrl.trim() && this.form.model.trim() && this.form.prompt.trim()
				)
			},
			startHint() {
				if (!this.isAndroidApp) return '浏览器仅可查看页面，请在 Android App 中开始诊断。'
				if (!this.service) return '原生流式模块尚未加载，请重新打开 App 后再试。'
				if (this.isRunning) return '诊断进行中，可随时停止本次请求。'
				if (this.requestPending) return '正在结束上一次请求，请稍候。'
				if (!this.canStart) return '请填写基础地址、模型和测试提示词。'
				return '将向填写的接口发送一次真实测试请求。'
			},
			outputPlaceholder() {
				if (this.isRunning) return '正在等待模型返回正文…'
				if (this.summary.status === 'completed') return '请求已结束，但没有返回正文。请结合状态摘要与日志排查。'
				if (this.summary.status === 'failed') return '本次请求未返回正文，请查看上方错误信息。'
				if (this.summary.status === 'aborted') return '请求已停止，尚未收到正文。'
				return '开始诊断后，模型返回的正文会显示在这里。'
			},
			statusLabel() {
				return ({
					idle: '未开始', connecting: '连接中', streaming: '接收中', completed: '已完成',
					aborted: '已停止', failed: '失败'
				})[this.summary.status] || this.summary.status
			}
		},
		onLoad() {
			this.initializeDiagnostics()
		},
		mounted() {
			if (typeof document !== 'undefined') document.addEventListener('keydown', this.handlePageKeydown)
			if (this.logStore) return
			this.initializeDiagnostics()
			if (typeof uni === 'undefined') this.addLifecycleLog('app_show', '页面进入前台')
		},
		onShow() {
			this.addLifecycleLog('app_show', '页面进入前台')
		},
		onHide() {
			this.addLifecycleLog('app_hide', '页面进入后台')
		},
		onUnload() {
			this.disposeDiagnostics()
		},
		beforeUnmount() {
			this.disposeDiagnostics()
		},
		methods: {
			handlePageKeydown(event) {
				if (event.key !== 'Escape' || !this.headerMenuOpen) return
				this.headerMenuOpen = false
				event.preventDefault()
			},
			disposeDiagnostics() {
				if (this.diagnosticsDisposed) return
				this.diagnosticsDisposed = true
				this.diagnosticRunId += 1
				this.service?.stop()
				this.form.apiKey = ''
				this.showApiKey = false
				this.headerMenuOpen = false
				this.addLifecycleLog('page_unload', '页面已卸载，请求已清理')
				clearTimeout(this.toastTimer)
				if (typeof document !== 'undefined') document.removeEventListener('keydown', this.handlePageKeydown)
			},
			selectProtocol(protocolType) {
				const selected = this.protocols.find(protocol => protocol.id === protocolType)
				if (!selected || selected.id === this.form.protocolType) return
				const previous = this.form.protocolType
				if (!this.form.baseUrl.trim() || this.form.baseUrl.trim() === defaultProviderBaseUrl(previous)) {
					this.form.baseUrl = defaultProviderBaseUrl(selected.id)
				}
				if (!this.form.model.trim() || this.form.model.trim() === DIAGNOSTIC_MODELS[previous]) {
					this.form.model = DIAGNOSTIC_MODELS[selected.id]
				}
				this.form.protocolType = selected.id
				this.summary = initialSummary()
				this.output = ''
			},
			initializeDiagnostics() {
				if (this.logStore) return
				const uniApi = getUniApi()
				const plusApi = getPlusApi()
				this.isAndroidApp = Boolean(uniApi?.request && String(plusApi?.os?.name || '').toLowerCase() === 'android')
				this.logStore = preserveServiceIdentity(getRuntimeDiagnosticLogStore())
				if (this.isAndroidApp) {
					const nativeApi = getNativeStreamingApi()
					if (nativeApi) {
						const transport = new NativeStreamingTransport({ nativeApi })
						this.service = preserveServiceIdentity(new AndroidDiagnosticService({ transport, logStore: this.logStore }))
					}
				}
				this.addLifecycleLog('page_load', this.runtimeLabel)
			},
			addLifecycleLog(type, message) {
				if (!this.logStore) return
				this.logStore.add(type, { message })
				this.logs = this.logStore.entries()
			},
			async startDiagnostic() {
				if (!this.canStart || !this.service) return
				const runId = ++this.diagnosticRunId
				this.requestPending = true
				this.output = ''
				this.summary = initialSummary()
				try {
					const result = await this.service.start({ ...this.form }, {
						onState: (state) => { if (runId === this.diagnosticRunId) this.summary = state },
						onDelta: (delta, fullText) => { if (runId === this.diagnosticRunId) this.output = fullText },
						onLog: (entries) => { if (runId === this.diagnosticRunId) this.logs = entries }
					})
					if (runId === this.diagnosticRunId) this.summary = result
				} catch (error) {
					if (runId !== this.diagnosticRunId) return
					this.summary = { ...initialSummary(), status: 'failed', errorMessage: error?.message || '无法开始诊断' }
					this.addLifecycleLog('request_failed', this.summary.errorMessage)
				} finally {
					this.requestPending = false
				}
			},
			stopDiagnostic() {
				if (this.service?.stop()) this.showToast('正在停止请求')
			},
			resetDiagnostic() {
				this.diagnosticRunId += 1
				this.service?.stop()
				this.summary = initialSummary()
				this.output = ''
				this.showToast('诊断状态已重置')
			},
			clearLogs() {
				this.logStore?.clear()
				this.logs = []
				this.showToast('日志已清空')
			},
			async exportLogs() {
				if (!this.logStore) return
				const payload = JSON.stringify(this.logStore.exportData({
					runtime: this.runtimeLabel,
					summary: this.summary
				}), null, 2)
				const uniApi = getUniApi()
				try {
					if (uniApi?.setClipboardData) {
						uniApi.setClipboardData({
							data: payload,
							success: () => this.showToast('脱敏日志已复制'),
							fail: () => this.showToast('复制失败，请重试')
						})
						return
					}
					if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
						await navigator.clipboard.writeText(payload)
						this.showToast('脱敏日志已复制')
						return
					}
					this.showToast('当前环境无法复制日志，请在 App 中重试')
				} catch {
					this.showToast('复制失败，请允许剪贴板访问后重试')
				}
			},
			async exportLogsFromMenu() {
				this.headerMenuOpen = false
				await this.exportLogs()
			},
			clearLogsFromMenu() {
				this.headerMenuOpen = false
				this.clearLogs()
			},
			goBack() {
				this.headerMenuOpen = false
				const uniApi = getUniApi()
				if (uniApi?.navigateBack) uniApi.navigateBack()
				else if (typeof window !== 'undefined') window.location.href = `${window.location.pathname}?tab=settings`
			},
			metricValue(value) { return value === null || value === undefined ? '-' : value },
			formatLogTime(timestamp) {
				const date = new Date(timestamp)
				return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
			},
			logDetail(entry) {
				const { timestamp, type, ...detail } = entry
				return Object.entries(detail).map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' · ')
			},
			showToast(message) {
				this.toastMessage = message
				clearTimeout(this.toastTimer)
				this.toastTimer = setTimeout(() => { this.toastMessage = '' }, 2200)
			}
		}
	}
</script>

<style scoped>
	* { box-sizing: border-box; }
	button, input, textarea { font: inherit; }
	button { margin: 0; padding: 0; border: 0; background: transparent; color: inherit; line-height: 1.4; cursor: pointer; }
	button::after { border: 0; }
	button:disabled { cursor: default; opacity: .5; }
	button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

	.diagnostic-shell {
		--text: #25232a;
		--muted: #706775;
		--border: #e5e0e7;
		--soft: #f4f0f6;
		--accent: #7850a0;
		--accent-soft: #eee8f4;
		--danger: #ab4655;
		--success: #367e65;
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100vh;
		height: 100dvh;
		padding-top: var(--status-bar-height, 0px);
		overflow: hidden;
		background: #f8f7f4;
		color: var(--text);
		font-family: 'Noto Sans SC', 'Noto Sans CJK SC', 'Microsoft YaHei', system-ui, sans-serif;
	}
	.diagnostic-header {
		z-index: 16;
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr) 44px;
		align-items: center;
		gap: 9px;
		min-height: 86px;
		padding: 19px 12px 16px;
		border-bottom: 1px solid var(--border);
		background: #f8f7f4;
		color: var(--text);
		flex: 0 0 auto;
	}
	.icon-button { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; color: var(--accent); transition: background-color 140ms ease, transform 140ms ease; }
	.icon-button:active, .icon-button.active { background: var(--accent-soft); }
	.diagnostic-header > .icon-button:first-child { background: var(--accent-soft); }
	.header-title { min-width: 0; text-align: left; font-size: 24px; line-height: 34px; font-weight: 750; letter-spacing: -.4px; }
	.header-menu-backdrop { position: absolute; inset: 0; z-index: 14; background: transparent; }
	.header-menu { position: absolute; top: calc(var(--status-bar-height, 0px) + 78px); right: 16px; z-index: 17; display: flex; flex-direction: column; width: 168px; padding: 6px; border: 1px solid var(--border); border-radius: 16px; background: #fffefd; box-shadow: 0 12px 32px rgba(58, 40, 68, .13); transform-origin: top right; animation: diagnostic-menu-in 150ms ease-out; }
	.header-menu button { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border-radius: 11px; font-size: 14px; text-align: left; }
	.header-menu button:active { background: var(--soft); }
	.header-menu button .app-icon { color: var(--accent); }
	.diagnostic-scroll { display: block; min-height: 0; padding: 14px 0 0; overflow-y: auto; overscroll-behavior-y: contain; -webkit-overflow-scrolling: touch; flex: 1; }
	.diagnostic-scroll-tail { height: calc(28px + env(safe-area-inset-bottom, 0px)); }
	.diagnostic-intro { display: flex; flex-direction: column; gap: 6px; padding: 8px 20px 20px; }
	.diagnostic-intro > text:first-child { font-size: 18px; font-weight: 650; line-height: 28px; }
	.diagnostic-intro > text:last-child { font-size: 13px; line-height: 1.6; color: var(--muted); }
	.runtime-overview { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; width: calc(100% - 40px); min-height: 90px; margin: 0 20px; padding: 16px; text-align: left; border: 1px solid var(--border); border-radius: 18px; background: #fffefd; }
	.runtime-icon { display: flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 14px; background: var(--accent-soft); color: var(--accent); flex: 0 0 auto; }
	.runtime-copy { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1; }
	.runtime-copy text:first-child { font-size: 14px; font-weight: 650; line-height: 1.5; }
	.runtime-copy text:last-child { font-size: 12px; line-height: 1.6; color: var(--muted); }
	.runtime-state { display: flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 20px; background: var(--soft); font-size: 11px; font-weight: 650; line-height: 1.5; color: var(--muted); white-space: nowrap; flex: 0 0 auto; }
	.runtime-state > view { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
	.runtime-state.connecting, .runtime-state.streaming, .status-badge.connecting, .status-badge.streaming { background: var(--accent-soft); color: var(--accent); }
	.runtime-state.connecting > view, .runtime-state.streaming > view { animation: diagnostic-status-pulse 1400ms ease-in-out infinite; }
	.runtime-state.completed, .status-badge.completed { background: #eaf4ed; color: var(--success); }
	.runtime-state.failed, .status-badge.failed { background: #faecee; color: var(--danger); }
	.section-label { display: block; padding: 24px 22px 10px; font-size: 13px; font-weight: 650; color: var(--muted); }
	.section-band { margin: 0 20px; padding: 18px; border: 1px solid var(--border); border-radius: 20px; background: #fffefd; }
	.config-section { padding-top: 3px; }
	.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
	.section-title { display: block; margin-bottom: 14px; font-size: 16px; font-weight: 700; line-height: 1.5; }
	.section-heading .section-title { margin-bottom: 0; }
	.field-row { display: flex; flex-direction: column; align-items: stretch; gap: 8px; margin-top: 18px; font-size: 14px; }
	.field-label { font-weight: 650; color: var(--text); }
	.field-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
	.field-heading > text:last-child, .field-note { font-size: 12px; font-weight: 400; color: var(--muted); }
	.field-note { line-height: 1.6; }
	.field-control, .number-field, .textarea-field { width: 100%; border: 1px solid var(--border); border-radius: 12px; background: #faf8fb; transition: border-color 140ms ease, box-shadow 140ms ease; }
	.field-control:focus-within, .number-field:focus-within, .textarea-field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(120, 80, 160, .09); }
	.field-control, .number-field { display: flex; align-items: center; min-height: 48px; padding: 0 12px; color: var(--muted); }
	.field-control input, .number-field input { min-width: 0; width: 0; height: 46px; padding: 0 10px; border: 0; outline: 0; background: transparent; font-size: 14px; font-weight: 400; color: var(--text); flex: 1; }
	input:disabled, textarea:disabled { opacity: .6; }
	.diagnostic-protocol-control { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3px; width: 100%; min-height: 48px; padding: 3px; border: 1px solid var(--border); border-radius: 14px; background: var(--soft); }
	.diagnostic-protocol-option { display: flex; align-items: center; justify-content: center; min-width: 44px; min-height: 44px; padding: 4px 6px; border-radius: 10px; font-size: 12px; font-weight: 650; color: var(--muted); transition: background-color 140ms ease, color 140ms ease; }
	.diagnostic-protocol-option.active { background: #fffefd; box-shadow: 0 2px 5px rgba(64, 38, 75, .07); color: var(--accent); }
	.field-control button { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin-right: -9px; border-radius: 10px; color: var(--accent); flex: 0 0 auto; }
	.field-control button:active { background: var(--accent-soft); }
	.textarea-field { position: relative; min-height: 126px; }
	.textarea-field textarea { display: block; width: 100%; min-height: 124px; padding: 12px; border: 0; outline: 0; background: transparent; font-size: 14px; font-weight: 400; line-height: 1.7; color: var(--text); resize: vertical; }
	.number-field { padding-right: 14px; font-size: 12px; font-weight: 400; }
	.number-field input { padding-left: 0; }
	.action-bar { display: flex; flex-direction: column; gap: 12px; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border); }
	.action-note { font-size: 12px; line-height: 1.65; color: var(--muted); text-align: center; }
	.secondary-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
	.primary-action, .secondary-action { display: flex; align-items: center; justify-content: center; gap: 7px; min-height: 46px; padding: 8px; border-radius: 14px; font-size: 14px; font-weight: 650; transition: background-color 140ms ease, transform 140ms ease; }
	.primary-action { background: var(--accent); color: #fff; }
	.primary-action.running { background: #ece3f2; color: #68418e; }
	.secondary-action { border: 1px solid var(--border); background: #fffefd; color: var(--muted); }
	.primary-action:active:not(:disabled), .secondary-action:active:not(:disabled) { transform: scale(.985); }
	.status-badge { padding: 6px 10px; border-radius: 20px; background: var(--soft); font-size: 12px; font-weight: 650; color: var(--muted); }
	.summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
	.metric-card { display: flex; flex-direction: column; justify-content: space-between; gap: 12px; min-width: 0; min-height: 96px; padding: 12px; border: 1px solid #ebe5ee; border-radius: 14px; background: #f8f5fa; }
	.metric-label, .metric-reading { display: flex; align-items: center; gap: 7px; min-width: 0; }
	.metric-label { font-size: 12px; color: var(--accent); }
	.metric-label > text { color: var(--muted); }
	.finish-label { color: var(--success); }
	.metric-reading { justify-content: space-between; font-size: 12px; color: var(--muted); }
	.metric-reading strong { display: block; min-width: 0; font-size: 22px; font-weight: 700; line-height: 1.2; letter-spacing: -.4px; overflow-wrap: anywhere; color: var(--text); }
	.metric-card:last-child .metric-reading strong { font-size: 16px; line-height: 1.4; letter-spacing: 0; }
	.diagnostic-error { display: flex; align-items: flex-start; gap: 8px; margin-top: 12px; padding: 12px; border-radius: 12px; background: #faecee; color: var(--danger); font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
	.diagnostic-error .app-icon { flex-shrink: 0; margin-top: 3px; }
	.output-preview { min-height: 120px; max-height: 300px; overflow-y: auto; padding: 14px; border: 1px solid var(--border); border-radius: 14px; background: #f8f5fa; font-size: 14px; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--muted); }
	.output-preview.has-output { color: var(--text); }
	.log-heading { display: flex; align-items: center; gap: 8px; }
	.log-count { min-width: 26px; padding: 3px 7px; border-radius: 20px; background: var(--soft); text-align: center; font-size: 12px; color: var(--muted); }
	.inline-action { display: flex; align-items: center; justify-content: center; gap: 5px; min-height: 44px; min-width: 66px; margin: -7px -5px -7px 0; padding: 5px; border-radius: 10px; font-size: 13px; color: var(--accent); }
	.inline-action:active:not(:disabled) { background: var(--accent-soft); }
	.log-note { display: block; margin: 8px 0 15px; font-size: 12px; line-height: 1.6; color: var(--muted); }
	.empty-log { display: flex; flex-direction: column; align-items: center; gap: 9px; padding: 22px 0; text-align: center; font-size: 13px; color: var(--muted); }
	.empty-log > text:last-child { font-size: 12px; line-height: 1.6; }
	.log-row { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px 12px; padding: 14px 0; border-top: 1px solid var(--border); font-size: 12px; line-height: 1.65; }
	.log-time { color: var(--muted); font-variant-numeric: tabular-nums; }
	.log-type { min-width: 0; font-weight: 650; text-align: right; overflow-wrap: anywhere; color: var(--accent); }
	.log-detail { grid-column: 1 / -1; min-width: 0; color: var(--muted); overflow-wrap: anywhere; white-space: pre-wrap; }
	.toast-message { position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom, 0px)); z-index: 20; width: max-content; max-width: calc(100% - 40px); padding: 11px 16px; border-radius: 14px; background: rgba(45, 35, 51, .94); color: #fff; font-size: 13px; line-height: 1.6; text-align: center; transform: translateX(-50%); }
	@keyframes diagnostic-menu-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: none; } }
	@keyframes diagnostic-status-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
	@media (max-width: 370px) {
		.diagnostic-header { padding-right: 10px; padding-left: 10px; }
		.diagnostic-intro { padding-right: 16px; padding-left: 16px; }
		.diagnostic-intro > text:first-child { font-size: 24px; }
		.runtime-overview { display: grid; grid-template-columns: 42px minmax(0, 1fr); width: calc(100% - 32px); margin-right: 16px; margin-left: 16px; padding: 14px; gap: 10px; }
		.runtime-state { grid-column: 2; justify-self: start; }
		.section-label { padding-left: 18px; }
		.section-band { margin-right: 16px; margin-left: 16px; padding-right: 14px; padding-left: 14px; }
		.metric-card { padding: 10px; }
		.metric-label { gap: 5px; font-size: 11px; }
	}
	@media (prefers-reduced-motion: reduce) {
		.icon-button, .diagnostic-protocol-option, .field-control, .number-field, .textarea-field, .primary-action, .secondary-action { transition: none; }
		.header-menu, .runtime-state.connecting > view, .runtime-state.streaming > view { animation: none; }
	}
</style>

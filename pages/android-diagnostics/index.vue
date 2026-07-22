<template>
	<view class="diagnostic-shell">
		<view class="diagnostic-header">
			<button class="icon-button" aria-label="返回" @click="goBack"><ArrowLeft :size="22" /></button>
			<text class="header-title">流式传输诊断</text>
			<button class="icon-button" aria-label="诊断页菜单" @click="headerMenuOpen = !headerMenuOpen"><MoreVertical :size="20" /></button>
		</view>
		<view v-if="headerMenuOpen" class="header-menu">
			<button @click="exportLogsFromMenu"><ClipboardCopy :size="17" /><text>导出日志</text></button>
			<button @click="clearLogsFromMenu"><Trash2 :size="17" /><text>清空日志</text></button>
		</view>

		<scroll-view class="diagnostic-scroll" scroll-y>
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
				<label class="field-row"><text class="field-label">基础地址</text><view class="field-control"><Server :size="17" /><input v-model="form.baseUrl" placeholder="https://api.openai.com/v1" /></view></label>
				<label class="field-row"><text class="field-label">API 密钥</text><view class="field-control"><LockKeyhole :size="17" /><input v-model="form.apiKey" :type="showApiKey ? 'text' : 'password'" placeholder="仅本次诊断使用" /><button aria-label="显示或隐藏密钥" @click="showApiKey = !showApiKey"><EyeOff :size="17" /></button></view><text class="field-note">离开页面后自动清除，不会写入本地存储</text></label>
				<label class="field-row"><text class="field-label">模型</text><view class="field-control"><Database :size="17" /><input v-model="form.model" :placeholder="activeProtocol.modelPlaceholder.replace('例如 ', '')" /><ChevronDown :size="17" /></view></label>
				<label class="field-row field-textarea"><view class="field-heading"><text class="field-label">测试提示词</text><text>{{ form.prompt.length }}/500</text></view><view class="textarea-field"><textarea v-model="form.prompt" maxlength="500" placeholder="请回复一段包含中文的简短文本" /></view></label>
				<label class="field-row"><text class="field-label">请求超时</text><view class="number-field"><input v-model.number="form.timeout" type="number" /><text>ms</text></view></label>
				<view class="action-bar">
					<button class="primary-action" :disabled="!isRunning && !canStart" @click="isRunning ? stopDiagnostic() : startDiagnostic()"><Square v-if="isRunning" :size="15" fill="currentColor" /><Play v-else :size="17" fill="currentColor" /><text>{{ isRunning ? '停止诊断' : '开始诊断' }}</text></button>
					<view class="secondary-actions">
						<button class="secondary-action" @click="resetDiagnostic"><RotateCcw :size="17" /><text>重置状态</text></button>
						<button class="secondary-action" aria-label="清空日志" @click="clearLogs"><Trash2 :size="17" /><text>清空日志</text></button>
					</view>
				</view>
			</view>

			<text class="section-label">运行状态</text>
			<view class="section-band summary-section">
				<view class="section-heading"><text class="section-title">状态摘要</text><text class="status-badge" :class="summary.status">{{ statusLabel }}</text></view>
				<view class="summary-grid">
					<view class="metric-card"><view class="metric-label"><Activity :size="18" /><text>首块耗时</text></view><view class="metric-reading"><strong>{{ metricValue(summary.firstChunkMs) }}</strong><text>ms</text></view></view>
					<view class="metric-card"><view class="metric-label"><History :size="18" /><text>总耗时</text></view><view class="metric-reading"><strong>{{ metricValue(summary.durationMs) }}</strong><text>ms</text></view></view>
					<view class="metric-card"><view class="metric-label"><Database :size="18" /><text>分块</text></view><view class="metric-reading"><strong>{{ summary.chunkCount }}</strong></view></view>
					<view class="metric-card"><view class="metric-label"><FileText :size="18" /><text>字节</text></view><view class="metric-reading"><strong>{{ summary.byteCount }}</strong><text>B</text></view></view>
					<view class="metric-card"><view class="metric-label"><Activity :size="18" /><text>SSE 事件</text></view><view class="metric-reading"><strong>{{ summary.eventCount }}</strong></view></view>
					<view class="metric-card"><view class="metric-label finish-label"><Check :size="18" /><text>结束原因</text></view><view class="metric-reading"><strong>{{ summary.finishReason || (summary.doneReceived ? '[DONE]' : '-') }}</strong></view></view>
				</view>
				<view v-if="summary.errorMessage" class="diagnostic-error"><AlertCircle :size="16" /><text>{{ summary.errorMessage }}</text></view>
			</view>

			<text class="section-label">模型响应</text>
			<view class="section-band output-section">
				<text class="section-title">流式输出</text>
				<view class="output-preview"><text>{{ output || '等待诊断输出...' }}</text></view>
			</view>

			<text class="section-label">运行记录</text>
			<view class="section-band log-section">
				<view class="section-heading"><text class="section-title">诊断日志</text><text class="log-count">{{ logs.length }}</text></view>
				<view v-if="!logs.length" class="empty-log">暂无日志</view>
				<view v-for="(entry, index) in logs" :key="`${entry.timestamp}-${index}`" class="log-row">
					<text class="log-time">{{ formatLogTime(entry.timestamp) }}</text>
					<text class="log-type">{{ entry.type }}</text>
					<text class="log-detail">{{ logDetail(entry) }}</text>
				</view>
			</view>
			<view class="diagnostic-scroll-tail" />
		</scroll-view>

		<view v-if="toastMessage" class="toast-message">{{ toastMessage }}</view>
	</view>
</template>

<script>
	import {
		Activity, AlertCircle, ArrowLeft, Check, ChevronDown, ClipboardCopy, Database, EyeOff,
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
			Activity, AlertCircle, ArrowLeft, Check, ChevronDown, ClipboardCopy, Database, EyeOff,
			FileText, History, LockKeyhole, MoreVertical, Play, RotateCcw, Server, Square, Trash2
		},
		data() {
			return {
				isAndroidApp: false,
				protocols: PROVIDER_PROTOCOLS,
				headerMenuOpen: false,
				showApiKey: false,
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
				return this.isAndroidApp && Boolean(this.service) && !this.isRunning && Boolean(
					this.form.baseUrl.trim() && this.form.model.trim() && this.form.prompt.trim()
				)
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
			this.service?.stop()
			this.addLifecycleLog('page_unload', '页面已卸载，请求已清理')
			clearTimeout(this.toastTimer)
		},
		methods: {
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
				this.output = ''
				this.summary = initialSummary()
				try {
					const result = await this.service.start({ ...this.form }, {
						onState: (state) => { this.summary = state },
						onDelta: (delta, fullText) => { this.output = fullText },
						onLog: (entries) => { this.logs = entries }
					})
					this.summary = result
				} catch (error) {
					this.summary = { ...initialSummary(), status: 'failed', errorMessage: error?.message || '无法开始诊断' }
					this.addLifecycleLog('request_failed', this.summary.errorMessage)
				}
			},
			stopDiagnostic() {
				if (this.service?.stop()) this.showToast('正在停止请求')
			},
			resetDiagnostic() {
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
				if (uniApi?.setClipboardData) {
					uniApi.setClipboardData({ data: payload, success: () => this.showToast('脱敏日志已复制') })
					return
				}
				if (typeof navigator !== 'undefined' && navigator.clipboard) {
					await navigator.clipboard.writeText(payload)
					this.showToast('脱敏日志已复制')
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
				else if (typeof history !== 'undefined') history.back()
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
	* {
		box-sizing: border-box;
	}

	button {
		margin: 0;
		padding: 0;
		border: 0;
		background: transparent;
		color: inherit;
		line-height: 1;
	}

	button::after {
		border: 0;
	}

	.diagnostic-shell {
		--text: #211b22;
		--muted: #777079;
		--border: #ebe6ec;
		--soft: #f5f2f6;
		--accent: #d43bc2;
		--accent-soft: #fbeefa;
		--danger: #c44352;
		--success: #278664;
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100vh;
		padding-top: var(--status-bar-height, 0px);
		overflow: hidden;
		background: #f3f3f5;
		color: var(--text);
		font-family: system-ui, sans-serif;
	}

	.diagnostic-header {
		display: grid;
		grid-template-columns: 40px minmax(0, 1fr) 40px;
		align-items: center;
		height: 56px;
		padding: 0 10px;
		border-bottom: 1px solid #eee9ef;
		background: #fff;
		color: var(--text);
		flex: 0 0 auto;
	}

	.icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 6px;
		color: #403940;
	}

	.header-title {
		min-width: 0;
		text-align: center;
		font-size: 17px;
		font-weight: 700;
	}

	.header-menu {
		position: absolute;
		top: calc(var(--status-bar-height, 0px) + 50px);
		right: 10px;
		z-index: 15;
		display: flex;
		flex-direction: column;
		width: 138px;
		padding: 6px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 10px 28px rgba(45, 29, 44, 0.14);
	}

	.header-menu button {
		display: flex;
		align-items: center;
		gap: 9px;
		height: 40px;
		padding: 0 10px;
		border-radius: 6px;
		font-size: 13px;
		color: var(--text);
	}

	.header-menu button:active {
		background: var(--soft);
	}

	.diagnostic-scroll {
		display: block;
		min-height: 0;
		padding: 14px 0 0;
		overflow-y: auto;
		flex: 1;
	}

	.diagnostic-scroll-tail {
		height: 64px;
	}

	.runtime-overview {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 86px;
		padding: 16px;
		text-align: left;
		border-top: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		background: #fff;
	}

	.runtime-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		border-radius: 8px;
		background: #fff5e8;
		color: #b66c12;
		flex: 0 0 auto;
	}

	.runtime-overview.supported .runtime-icon {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.runtime-copy {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
		flex: 1;
	}

	.runtime-copy text:first-child {
		font-size: 15px;
		font-weight: 700;
	}

	.runtime-copy text:last-child {
		font-size: 12px;
		line-height: 1.4;
		color: var(--muted);
	}

	.runtime-state {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		border-radius: 7px;
		background: #f6f3f6;
		font-size: 11px;
		font-weight: 700;
		color: var(--muted);
		white-space: nowrap;
		flex: 0 0 auto;
	}

	.runtime-state > view {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #aaa3ab;
	}

	.runtime-state.connecting,
	.runtime-state.streaming {
		background: var(--accent-soft);
		color: #a72b98;
	}

	.runtime-state.connecting > view,
	.runtime-state.streaming > view {
		background: var(--accent);
	}

	.runtime-state.completed {
		background: #ecf7f2;
		color: var(--success);
	}

	.runtime-state.completed > view {
		background: var(--success);
	}

	.runtime-state.failed {
		background: #fff0f1;
		color: var(--danger);
	}

	.runtime-state.failed > view {
		background: var(--danger);
	}

	.section-label {
		display: block;
		padding: 20px 16px 8px;
		font-size: 12px;
		font-weight: 650;
		color: #837b84;
	}

	.section-band {
		padding: 16px;
		border-top: 1px solid var(--border);
		border-bottom: 1px solid var(--border);
		background: #fff;
	}

	.config-section {
		padding-top: 4px;
		padding-bottom: 14px;
	}

	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.section-title {
		display: block;
		margin-bottom: 13px;
		font-size: 15px;
		font-weight: 700;
	}

	.section-heading .section-title {
		margin-bottom: 0;
	}

	.field-row {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
		margin-top: 14px;
		font-size: 13px;
	}

	.field-label {
		font-weight: 650;
		color: #403840;
	}

	.field-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.field-heading > text:last-child,
	.field-note {
		font-size: 11px;
		font-weight: 400;
		color: var(--muted);
	}

	.field-note {
		margin-top: -2px;
		line-height: 1.4;
	}

	.field-control,
	.number-field,
	.textarea-field {
		width: 100%;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: #fff;
	}

	.field-control,
	.number-field {
		display: flex;
		align-items: center;
		height: 48px;
		padding: 0 12px;
		color: var(--muted);
	}

	.field-control input,
	.number-field input {
		min-width: 0;
		height: 46px;
		padding: 0 10px;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 13px;
		font-weight: 400;
		color: var(--text);
		flex: 1;
	}

	.diagnostic-protocol-control {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 3px;
		width: 100%;
		height: 48px;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: #f3eff4;
	}

	.diagnostic-protocol-option {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		height: 40px;
		padding: 0 6px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 650;
		color: var(--muted);
	}

	.diagnostic-protocol-option.active {
		background: #fff;
		box-shadow: 0 1px 5px rgba(56, 31, 53, 0.12);
		color: var(--accent);
	}

	.field-control button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 38px;
		margin-right: -7px;
		flex: 0 0 auto;
	}

	.textarea-field {
		position: relative;
		min-height: 136px;
	}

	.textarea-field textarea {
		display: block;
		width: 100%;
		min-height: 134px;
		padding: 12px;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 13px;
		font-weight: 400;
		line-height: 1.55;
		resize: none;
	}

	.number-field {
		padding-right: 14px;
		font-size: 12px;
		font-weight: 400;
	}

	.action-bar {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 18px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	.secondary-actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.primary-action,
	.secondary-action {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		height: 46px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 700;
	}

	.primary-action {
		background: var(--accent);
		color: #fff;
	}

	.secondary-action {
		border: 1px solid var(--border);
		background: #faf8fa;
		color: #554c55;
	}

	.primary-action:disabled {
		opacity: 0.45;
	}

	.status-badge {
		padding: 6px 9px;
		border-radius: 6px;
		background: var(--soft);
		font-size: 11px;
		font-weight: 700;
	}

	.status-badge.streaming,
	.status-badge.connecting {
		background: var(--accent-soft);
		color: #a72b98;
	}

	.status-badge.completed {
		background: #ecf7f2;
		color: var(--success);
	}

	.status-badge.failed {
		background: #fff0ef;
		color: var(--danger);
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		margin-top: 14px;
	}

	.metric-card {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		min-width: 0;
		min-height: 84px;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: #faf8fa;
	}

	.metric-label,
	.metric-reading {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.metric-label {
		font-size: 12px;
		color: var(--accent);
	}

	.metric-label > text {
		color: var(--muted);
	}

	.finish-label {
		color: var(--success);
	}

	.metric-reading {
		justify-content: space-between;
		font-size: 11px;
		color: var(--muted);
	}

	.metric-reading strong {
		display: block;
		min-width: 0;
		overflow: hidden;
		font-size: 17px;
		font-weight: 700;
		color: var(--text);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.diagnostic-error {
		display: flex;
		gap: 7px;
		margin-top: 10px;
		padding: 10px;
		border-radius: 7px;
		background: #fff3f2;
		color: var(--danger);
		font-size: 11px;
		line-height: 1.4;
	}

	.output-preview {
		min-height: 104px;
		max-height: 220px;
		overflow-y: auto;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: #faf8fa;
		font-size: 12px;
		line-height: 1.55;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--muted);
	}

	.log-section {
		margin-bottom: 0;
	}

	.log-count {
		min-width: 28px;
		padding: 6px 8px;
		border-radius: 7px;
		background: var(--soft);
		text-align: center;
		font-size: 11px;
	}

	.empty-log {
		padding: 22px 0;
		text-align: center;
		font-size: 11px;
		color: var(--muted);
	}

	.log-row {
		display: grid;
		grid-template-columns: 64px 90px minmax(0, 1fr);
		gap: 8px;
		padding: 11px 0;
		border-top: 1px solid var(--border);
		font-size: 10px;
		line-height: 1.45;
	}

	.log-time {
		color: var(--muted);
	}

	.log-type {
		overflow: hidden;
		font-weight: 700;
		text-overflow: ellipsis;
	}

	.log-detail {
		min-width: 0;
		color: #5f5760;
		word-break: break-word;
	}

	.toast-message {
		position: fixed;
		left: 50%;
		bottom: 24px;
		z-index: 20;
		max-width: calc(100% - 40px);
		padding: 9px 12px;
		border-radius: 7px;
		background: rgba(20, 23, 25, 0.92);
		color: #fff;
		font-size: 12px;
		transform: translateX(-50%);
		white-space: nowrap;
	}

	@media (max-width: 370px) {
		.runtime-overview {
			gap: 9px;
			padding-right: 12px;
			padding-left: 12px;
		}

		.runtime-state {
			padding-right: 6px;
			padding-left: 6px;
		}

		.log-row {
			grid-template-columns: 54px 76px minmax(0, 1fr);
		}
	}
</style>

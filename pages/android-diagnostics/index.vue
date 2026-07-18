<template>
	<view class="diagnostic-shell">
		<view class="diagnostic-header">
			<button class="icon-button" aria-label="返回" @click="goBack"><ArrowLeft :size="22" /></button>
			<text class="header-title">Android 流式诊断</text>
			<view class="header-spacer" />
			<button class="icon-button" aria-label="诊断页菜单" @click="headerMenuOpen = !headerMenuOpen"><MoreVertical :size="20" /></button>
		</view>
		<view v-if="headerMenuOpen" class="header-menu">
			<button @click="exportLogsFromMenu"><ClipboardCopy :size="17" /><text>导出日志</text></button>
			<button @click="clearLogsFromMenu"><Trash2 :size="17" /><text>清空日志</text></button>
		</view>

		<scroll-view class="diagnostic-scroll" scroll-y>
			<view class="config-pane">
				<button class="runtime-banner" :class="{ supported: isAndroidApp }" @click="showToast(isAndroidApp ? '密钥仅保留在当前页面内存中' : '请使用 Android App 运行诊断')">
					<LockKeyhole :size="20" />
					<view class="runtime-copy">
						<text>{{ runtimeLabel }}</text>
						<text>{{ isAndroidApp ? 'API 密钥仅保存在当前页面内存中' : '请在 HBuilderX Android App 中打开此页面' }}</text>
					</view>
					<ChevronRight :size="18" />
				</button>

				<view class="section-block config-section">
					<text class="section-title">请求配置</text>
					<view class="field-row"><text>接口格式</text><view class="diagnostic-protocol-control" role="group" aria-label="接口格式"><button v-for="protocol in protocols" :key="protocol.id" class="diagnostic-protocol-option" :class="{ active: form.protocolType === protocol.id }" :disabled="isRunning" :aria-pressed="form.protocolType === protocol.id" @click="selectProtocol(protocol.id)">{{ protocol.label }}</button></view></view>
					<label class="field-row"><text>基础地址</text><view class="field-control"><input v-model="form.baseUrl" placeholder="https://api.openai.com/v1" /><Server :size="17" /></view></label>
					<label class="field-row"><text>API 密钥</text><view class="field-control"><input v-model="form.apiKey" :type="showApiKey ? 'text' : 'password'" placeholder="仅本次诊断使用" /><button aria-label="显示或隐藏密钥" @click="showApiKey = !showApiKey"><EyeOff :size="17" /></button></view></label>
					<label class="field-row"><text>模型</text><view class="field-control"><input v-model="form.model" :placeholder="activeProtocol.modelPlaceholder.replace('例如 ', '')" /><ChevronDown :size="17" /></view></label>
					<label class="field-row field-textarea"><text>测试提示词</text><view class="textarea-field"><textarea v-model="form.prompt" maxlength="500" placeholder="请回复一段包含中文的简短文本" /><text>{{ form.prompt.length }}/500</text></view></label>
					<label class="field-row"><text>超时</text><view class="number-field"><input v-model.number="form.timeout" type="number" /><text>ms</text></view></label>
				</view>

				<view class="action-bar">
					<button class="primary-action" :disabled="!isRunning && !canStart" @click="isRunning ? stopDiagnostic() : startDiagnostic()"><Square v-if="isRunning" :size="15" fill="currentColor" /><Play v-else :size="17" fill="currentColor" /><text>{{ isRunning ? '停止诊断' : '开始诊断' }}</text></button>
					<button class="secondary-action" @click="resetDiagnostic"><RotateCcw :size="17" /><text>重置</text></button>
					<button class="secondary-action" aria-label="清空日志" @click="clearLogs"><Trash2 :size="17" /><text>清空</text></button>
				</view>
			</view>

			<view class="section-block summary-section">
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

			<view class="section-block">
				<text class="section-title">流式输出</text>
				<view class="output-preview"><text>{{ output || '等待诊断输出...' }}</text></view>
			</view>

			<view class="section-block log-section">
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
		Activity, AlertCircle, ArrowLeft, Check, ChevronDown, ChevronRight, ClipboardCopy, Database, EyeOff,
		FileText, History, LockKeyhole, MoreVertical, Play, RotateCcw, Server, Square, Trash2
	} from '../../src/components/app-icons.js'
	import { preserveServiceIdentity } from '../../src/app/vue-service-container.js'
	import { createDiagnosticLogStore } from '../../src/core/diagnostic-log.js'
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
			Activity, AlertCircle, ArrowLeft, Check, ChevronDown, ChevronRight, ClipboardCopy, Database, EyeOff,
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
				this.logStore = preserveServiceIdentity(createDiagnosticLogStore())
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
		--text: #171b22;
		--muted: #647086;
		--border: #d7dee8;
		--soft: #f3f6fa;
		--accent: #1f6fcb;
		--danger: #b84038;
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100vh;
		padding-top: var(--status-bar-height, 0px);
		overflow: hidden;
		background: #f5f7fa;
		color: var(--text);
		font-family: system-ui, sans-serif;
	}

	.diagnostic-header {
		display: flex;
		align-items: center;
		height: 56px;
		padding: 0 10px;
		background: #1f6fcb;
		color: #fff;
		flex: 0 0 auto;
	}

	.icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 6px;
	}

	.header-title {
		margin-left: 18px;
		font-size: 18px;
		font-weight: 700;
	}

	.header-spacer {
		min-width: 0;
		flex: 1;
	}

	.header-menu {
		position: absolute;
		top: calc(var(--status-bar-height, 0px) + 48px);
		right: 10px;
		z-index: 15;
		display: flex;
		flex-direction: column;
		width: 138px;
		padding: 6px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 8px 22px rgba(28, 49, 76, 0.16);
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
		padding: 18px 10px 0;
		overflow-y: auto;
		flex: 1;
	}

	.diagnostic-scroll-tail {
		height: 64px;
	}

	.config-pane {
		min-height: calc(100vh - 86px);
	}

	.runtime-banner {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
		min-height: 78px;
		padding: 12px 14px;
		text-align: left;
		border: 1px solid #e0c99e;
		border-radius: 8px;
		background: #fff9ed;
		color: #6d4b1e;
	}

	.runtime-banner.supported {
		border-color: #b8d8cf;
		background: #eff8f5;
		color: #185c4b;
	}

	.runtime-copy {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
		flex: 1;
	}

	.runtime-copy text:first-child {
		font-size: 14px;
		font-weight: 700;
	}

	.runtime-copy text:last-child {
		font-size: 11px;
		line-height: 1.4;
		opacity: 0.82;
	}

	.section-block {
		margin-top: 15px;
		padding: 13px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 2px 7px rgba(31, 55, 86, 0.035);
	}

	.config-section {
		padding: 16px 13px;
	}

	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.section-title {
		display: block;
		margin-bottom: 12px;
		font-size: 16px;
		font-weight: 700;
	}

	.section-heading .section-title {
		margin-bottom: 0;
	}

	.field-row {
		display: grid;
		grid-template-columns: 88px minmax(0, 1fr);
		align-items: center;
		gap: 10px;
		margin-top: 12px;
		font-size: 13px;
		font-weight: 650;
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
		height: 50px;
		padding-right: 11px;
		color: var(--muted);
	}

	.field-control input,
	.number-field input {
		min-width: 0;
		height: 48px;
		padding: 0 12px;
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
		height: 50px;
		padding: 3px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: #edf1f6;
	}

	.diagnostic-protocol-option {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		height: 42px;
		padding: 0 6px;
		border-radius: 6px;
		font-size: 12px;
		font-weight: 650;
		color: var(--muted);
	}

	.diagnostic-protocol-option.active {
		background: #fff;
		box-shadow: 0 1px 4px rgba(31, 55, 86, 0.12);
		color: var(--accent);
	}

	.field-control button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 38px;
		flex: 0 0 auto;
	}

	.field-textarea {
		align-items: start;
	}

	.field-textarea > text {
		padding-top: 12px;
	}

	.textarea-field {
		position: relative;
		min-height: 190px;
	}

	.textarea-field textarea {
		display: block;
		width: 100%;
		min-height: 166px;
		padding: 12px 12px 28px;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 13px;
		font-weight: 400;
		line-height: 1.55;
		resize: none;
	}

	.textarea-field > text {
		position: absolute;
		right: 10px;
		bottom: 8px;
		font-size: 11px;
		font-weight: 400;
		color: var(--muted);
	}

	.number-field {
		padding-right: 12px;
		font-size: 12px;
		font-weight: 400;
	}

	.action-bar {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(0, 0.9fr) minmax(0, 0.9fr);
		gap: 9px;
		margin-top: 12px;
	}

	.primary-action,
	.secondary-action {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		height: 48px;
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
		background: #fff;
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
	.status-badge.completed {
		background: #e7f5f0;
		color: #17634f;
	}

	.status-badge.failed {
		background: #fff0ef;
		color: var(--danger);
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		margin-top: 13px;
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
		background: #f8fafc;
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
		color: #4f9f46;
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
		background: #f8fafc;
		font-size: 12px;
		line-height: 1.55;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--muted);
	}

	.log-section {
		margin-bottom: 28px;
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
		color: #536075;
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
		.field-row {
			grid-template-columns: 80px minmax(0, 1fr);
		}

		.log-row {
			grid-template-columns: 56px 78px minmax(0, 1fr);
		}
	}
</style>

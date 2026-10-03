<template>
	<view class="settings-information" :data-testid="`settings-information-${mode}`">
		<view class="information-header">
			<button class="information-back" aria-label="返回设置" @click="$emit('back')"><ArrowLeft :size="23" /></button>
			<text class="information-title">{{ pageTitle }}</text>
		</view>
		<scroll-view class="information-scroll" scroll-y>
			<view class="information-content">
				<template v-if="mode === 'storage'">
					<view class="information-intro"><text>你的记录，留在身边。</text><text>查看当前工作区的数据，并选择适合自己的备份方式。</text></view>
					<text class="information-section-label">当前工作区</text>
					<view class="storage-count-grid">
						<view v-for="item in storageItems" :key="item.key" class="storage-count-card" :class="{ wide: item.key === 'worldBooks' }">
							<view class="storage-count-label"><MessageCircle v-if="item.key === 'conversations'" :size="19" /><Contact v-else-if="item.key === 'characters'" :size="19" /><FileText v-else-if="item.key === 'stories'" :size="19" /><Server v-else-if="item.key === 'providers'" :size="19" /><Database v-else :size="19" /><text>{{ item.label }}</text></view>
							<text class="storage-count-value">{{ formatCount(stats[item.key]) }}</text>
						</view>
					</view>
					<view class="information-note"><Database :size="19" /><view><text>本地优先存储</text><text>对话和角色等数据保存在当前设备。{{ storageLabel ? `当前存储方式：${storageLabel}。` : '' }}这里展示记录数量，不代表占用空间。</text></view></view>
					<text class="information-section-label">备份与迁移</text>
					<view class="information-menu">
						<button class="information-row" @click="$emit('backup')"><view class="information-row-icon"><Download :size="21" /></view><view class="information-row-copy"><text>导入与导出</text><text>保存 JSON 文件，或从已有备份导入</text></view><ChevronRight :size="18" /></button>
						<button class="information-row" @click="$emit('cloud')"><view class="information-row-icon"><Cloud :size="21" /></view><view class="information-row-copy"><text>账号与云端</text><text>登录后管理同步和加密完整备份</text></view><ChevronRight :size="18" /></button>
					</view>
					<text class="information-footnote">清除应用数据或浏览器站点数据前，请先保存需要保留的记录。</text>
				</template>

				<template v-else-if="mode === 'about'">
					<view class="about-brand"><AppImage class="about-logo" src="/static/zhiyu-logo.png" alt="织语" mode="aspectFit" /><text class="about-name">织语</text><text class="about-english">EchoWeave</text><text class="about-description">与角色对话，续写属于你的故事。</text></view>
					<view class="information-facts"><view><text>应用版本</text><text>{{ version || '未提供' }}</text></view><view><text>运行环境</text><text>{{ platformLabel || '当前设备' }}</text></view><view><text>本地存储</text><text>{{ storageLabel || '未提供' }}</text></view></view>
					<text class="information-section-label">了解更多</text>
					<view class="information-menu">
						<button class="information-row" @click="$emit('release')"><view class="information-row-icon"><RefreshCw :size="21" /></view><view class="information-row-copy"><text>版本发布</text><text>查看发布说明与安装文件</text></view><ChevronRight :size="18" /></button>
						<button class="information-row" @click="$emit('feedback')"><view class="information-row-icon"><MessageCircle :size="21" /></view><view class="information-row-copy"><text>反馈与建议</text><text>在 GitHub 提交问题或改进建议</text></view><ChevronRight :size="18" /></button>
						<button class="information-row" @click="$emit('privacy')"><view class="information-row-icon"><LockKeyhole :size="21" /></view><view class="information-row-copy"><text>隐私与安全</text><text>管理应用锁与回复提醒</text></view><ChevronRight :size="18" /></button>
					</view>
				</template>

				<template v-else-if="mode === 'updates'">
					<view class="updates-current"><view class="updates-icon"><Download :size="32" /></view><text class="updates-eyebrow">当前安装版本</text><text class="updates-version">{{ version || '未提供' }}</text><text class="updates-platform">{{ platformLabel || '当前设备' }}</text></view>
					<view class="information-intro"><text>看看最近有什么新变化。</text><text>前往 GitHub 发布页查看最新发布的版本、更新说明和安装文件。</text></view>
					<button class="information-primary" @click="$emit('release')"><RefreshCw :size="19" /><text>前往发布页查看更新</text><ChevronRight :size="18" /></button>
					<text class="information-footnote">本页未联网检查版本，当前显示的是已安装版本。</text>
					<text class="information-section-label">更新前的准备</text>
					<view class="update-steps"><view><text class="update-step-number">1</text><text>保存需要保留的对话和角色记录。</text></view><view><text class="update-step-number">2</text><text>查看发布说明，确认支持的平台。</text></view><view><text class="update-step-number">3</text><text>按发布页的说明下载并安装。</text></view></view>
					<button class="information-secondary" @click="$emit('backup')"><Download :size="18" /><text>先备份我的记录</text></button>
				</template>

				<template v-else-if="mode === 'help'">
					<view class="information-intro"><text>遇到问题，一起理清。</text><text>先看看常见问题，也可以查看设备诊断或提交反馈。</text></view>
					<text class="information-section-label">常见问题</text>
					<view class="help-faq-list">
						<view v-for="item in helpItems" :key="item.id" class="help-faq-item" :class="{ expanded: expandedFaq === item.id }">
							<button class="help-faq-question" :aria-expanded="expandedFaq === item.id" :aria-controls="`settings-help-${item.id}`" @click="expandedFaq = expandedFaq === item.id ? '' : item.id"><text>{{ item.question }}</text><ChevronDown :size="18" /></button>
							<view v-if="expandedFaq === item.id" :id="`settings-help-${item.id}`" class="help-faq-answer"><text v-for="(paragraph, index) in item.answer" :key="index">{{ paragraph }}</text></view>
						</view>
					</view>
					<text class="information-section-label">需要进一步帮助</text>
					<view class="information-menu">
						<button class="information-row" @click="$emit('diagnostics')"><view class="information-row-icon"><Activity :size="21" /></view><view class="information-row-copy"><text>设备与诊断</text><text>在 Android App 检查连接与流式响应</text></view><ChevronRight :size="18" /></button>
						<button class="information-row" @click="$emit('feedback')"><view class="information-row-icon"><MessageCircle :size="21" /></view><view class="information-row-copy"><text>提交问题反馈</text><text>打开 GitHub，描述问题与复现步骤</text></view><ChevronRight :size="18" /></button>
					</view>
					<view class="information-note"><Info :size="19" /><view><text>让问题更容易定位</text><text>反馈时请附上应用版本、设备系统、接口协议和操作步骤。请勿填写 API 密钥、账号密码或私密对话正文。</text></view></view>
				</template>
			</view>
		</scroll-view>
	</view>
</template>

<script>
	import AppImage from './app-image.js'
	import { Activity, ArrowLeft, ChevronDown, ChevronRight, Cloud, Contact, Database, Download, FileText, Info, LockKeyhole, MessageCircle, RefreshCw, Server } from './app-icons.js'

	const TITLES = { storage: '数据与存储', about: '关于应用', updates: '检查更新', help: '帮助与反馈' }
	const STORAGE_ITEMS = [
		{ key: 'conversations', label: '会话' },
		{ key: 'characters', label: '角色' },
		{ key: 'stories', label: '故事' },
		{ key: 'providers', label: '接口' },
		{ key: 'worldBooks', label: '世界书' }
	]
	const HELP_ITEMS = [
		{ id: 'empty-reply', question: '只有头像，没有回复正文怎么办？', answer: [
			'先查看消息下方的状态和“响应详情”。收到响应数据，并不一定代表接口返回了可显示的正文；详情可以帮助区分没有收到数据、只有思考内容等情况。',
			'检查所选接口和模型，确认后再手动重试。Android App 也可以使用下方的“设备与诊断”检查流式响应。'
		] },
		{ id: 'continue', question: '续写和重试有什么区别？', answer: [
			'续写用于接着已有回复继续生成；重试会重新发起该轮回复。根据消息当前状态，界面会显示可用的操作。',
			'续写没有返回正文时，先查看该条消息的“响应详情”，再决定是否再次请求。'
		] },
		{ id: 'provider', question: '接口连接失败，应该检查哪里？', answer: [
			'在“接口”主页核对协议、服务器地址、API 密钥和模型名称，然后使用测试连接。',
			'如果使用代理，还需要在设置的“网络代理”中检查代理模式与地址。'
		] },
		{ id: 'backup', question: 'JSON 导出和加密备份有什么区别？', answer: [
			'“导入与导出”用于 JSON 文件迁移。云端 JSON 是明文分享，拿到链接的人可以读取；可在分享列表查看到期时间并提前撤销。',
			'“账号与云端”的完整备份会在本地加密后上传，恢复时需要相同的同步密码。'
		] },
		{ id: 'diagnostic', question: '为什么浏览器不能开始设备诊断？', answer: [
			'流式传输诊断依赖 Android App 的原生传输能力。浏览器可以查看诊断页面，实际诊断需要在 Android App 中运行。',
			'诊断页输入的 API 密钥仅保留在本次页面内存中，离开页面后清除。'
		] }
	]

	export default {
		name: 'SettingsInformation',
		components: { AppImage, Activity, ArrowLeft, ChevronDown, ChevronRight, Cloud, Contact, Database, Download, FileText, Info, LockKeyhole, MessageCircle, RefreshCw, Server },
		props: {
			mode: { type: String, required: true, validator: value => Object.prototype.hasOwnProperty.call(TITLES, value) },
			version: { type: String, default: '' },
			platformLabel: { type: String, default: '' },
			storageLabel: { type: String, default: '' },
			stats: { type: Object, default: () => ({}) }
		},
		emits: ['back', 'backup', 'cloud', 'release', 'feedback', 'diagnostics', 'privacy'],
		data() { return { expandedFaq: 'empty-reply', storageItems: STORAGE_ITEMS, helpItems: HELP_ITEMS } },
		computed: { pageTitle() { return TITLES[this.mode] || '设置' } },
		methods: {
			formatCount(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value).toLocaleString('zh-CN') : '—' }
		}
	}
</script>

<style scoped>
	.settings-information { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: #f8f7f4; color: #25232a; }
	.information-header { display: flex; align-items: center; gap: 9px; flex: 0 0 auto; min-height: 86px; padding: 19px 20px 16px 12px; border-bottom: 1px solid #e5e0e7; background: #f8f7f4; }
	.information-back { display: flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: #eee8f4; color: #7850a0; }
	.information-title { min-width: 0; font-size: 24px; font-weight: 750; line-height: 34px; letter-spacing: -.4px; }
	.information-scroll { display: block; flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
	.information-content { padding: 24px 20px calc(100px + env(safe-area-inset-bottom)); }
	.information-intro { display: flex; flex-direction: column; gap: 8px; margin-bottom: 25px; }
	.information-intro > text:first-child { font-size: 18px; font-weight: 700; line-height: 28px; }
	.information-intro > text:last-child { font-size: 14px; line-height: 24px; color: #706775; }
	.information-section-label { display: block; margin: 26px 0 13px; color: #706775; font-size: 13px; line-height: 20px; font-weight: 650; }
	.information-intro + .information-section-label { margin-top: 0; }
	.storage-count-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
	.storage-count-card { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 17px; border: 1px solid #e5e0e7; border-radius: 17px; background: #fff; }
	.storage-count-card.wide { grid-column: 1 / -1; flex-direction: row; align-items: center; justify-content: space-between; }
	.storage-count-label { display: flex; align-items: center; gap: 8px; font-size: 14px; line-height: 22px; color: #706775; }
	.storage-count-label .app-icon { color: #7850a0; }
	.storage-count-value { font-size: 30px; font-weight: 700; line-height: 36px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
	.storage-count-card.wide .storage-count-value { font-size: 24px; line-height: 30px; }
	.information-note { display: flex; align-items: flex-start; gap: 11px; margin-top: 20px; padding: 16px; border: 1px solid #e5e0e7; border-radius: 16px; background: #f1edf4; }
	.information-note > .app-icon { flex: 0 0 auto; margin-top: 2px; color: #7850a0; }
	.information-note > view { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
	.information-note > view > text:first-child { font-size: 14px; line-height: 22px; font-weight: 650; }
	.information-note > view > text:last-child { font-size: 13px; line-height: 23px; color: #706775; }
	.information-menu { overflow: hidden; border: 1px solid #e5e0e7; border-radius: 18px; background: #fff; }
	.information-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 82px; padding: 16px 14px; border: 0; border-radius: 0; background: #fff; text-align: left; color: #25232a; }
	.information-row + .information-row { border-top: 1px solid #e5e0e7; }
	.information-row-icon { display: flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 40px; height: 40px; border-radius: 13px; background: #eee8f4; color: #7850a0; }
	.information-row-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; gap: 5px; }
	.information-row-copy > text:first-child { font-size: 15px; font-weight: 650; line-height: 23px; }
	.information-row-copy > text:last-child { font-size: 12px; line-height: 20px; color: #706775; overflow-wrap: anywhere; }
	.information-row > .app-icon { flex: 0 0 auto; color: #94879c; }
	.information-footnote { display: block; margin-top: 14px; color: #706775; font-size: 12px; line-height: 22px; }
	.about-brand { display: flex; flex-direction: column; align-items: center; padding: 6px 0 27px; text-align: center; }
	.about-logo { display: block; width: 82px; height: 82px; margin-bottom: 15px; border: 1px solid #e5e0e7; border-radius: 24px; background: #fff; }
	.about-name { font-size: 26px; font-weight: 750; line-height: 36px; }
	.about-english { margin-top: 2px; font-size: 13px; line-height: 21px; letter-spacing: .5px; color: #7850a0; }
	.about-description { margin-top: 16px; color: #706775; font-size: 14px; line-height: 24px; }
	.information-facts { padding: 4px 16px; border: 1px solid #e5e0e7; border-radius: 17px; background: #fff; }
	.information-facts > view { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 14px 0; font-size: 13px; line-height: 22px; }
	.information-facts > view + view { border-top: 1px solid #e5e0e7; }
	.information-facts > view > text:first-child { flex: 0 0 auto; color: #706775; }
	.information-facts > view > text:last-child { min-width: 0; text-align: right; overflow-wrap: anywhere; }
	.updates-current { display: flex; align-items: center; flex-direction: column; padding: 6px 0 30px; }
	.updates-icon { display: flex; align-items: center; justify-content: center; width: 76px; height: 76px; margin-bottom: 20px; border-radius: 25px; background: #eee8f4; color: #7850a0; }
	.updates-eyebrow { color: #706775; font-size: 13px; line-height: 21px; }
	.updates-version { margin-top: 5px; font-size: 34px; font-weight: 750; line-height: 45px; }
	.updates-platform { margin-top: 5px; font-size: 12px; line-height: 21px; color: #706775; }
	.information-primary, .information-secondary { display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%; min-height: 48px; padding: 12px 14px; border: 1px solid transparent; border-radius: 14px; font-size: 14px; line-height: 24px; font-weight: 650; }
	.information-primary { background: #7850a0; color: #fff; }
	.information-secondary { margin-top: 20px; background: #fff; border-color: #e5e0e7; color: #7850a0; }
	.information-primary > .app-icon, .information-secondary > .app-icon { flex: 0 0 auto; }
	.update-steps { display: flex; flex-direction: column; gap: 16px; padding: 18px 16px; border: 1px solid #e5e0e7; border-radius: 17px; background: #fff; }
	.update-steps > view { display: flex; align-items: flex-start; gap: 12px; font-size: 14px; line-height: 25px; }
	.update-step-number { display: flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%; background: #eee8f4; color: #7850a0; font-size: 12px; font-weight: 700; }
	.help-faq-list { overflow: hidden; border: 1px solid #e5e0e7; border-radius: 17px; background: #fff; }
	.help-faq-item + .help-faq-item { border-top: 1px solid #e5e0e7; }
	.help-faq-question { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 66px; padding: 16px; border: 0; border-radius: 0; background: #fff; color: #25232a; font-size: 14px; line-height: 24px; font-weight: 650; text-align: left; }
	.help-faq-question > .app-icon { flex: 0 0 auto; color: #7850a0; transition: transform 160ms ease; }
	.help-faq-item.expanded .help-faq-question { color: #7850a0; }
	.help-faq-item.expanded .help-faq-question > .app-icon { transform: rotate(180deg); }
	.help-faq-answer { display: flex; flex-direction: column; gap: 12px; padding: 0 16px 18px; color: #706775; font-size: 14px; line-height: 25px; }
	.settings-information button { cursor: pointer; transition: background-color 140ms ease, opacity 140ms ease; }
	.settings-information button:active { opacity: .78; }
	.settings-information button:focus-visible { outline: 2px solid #7850a0; outline-offset: -3px; }
	@media (max-width: 350px) { .information-content { padding-left: 16px; padding-right: 16px; } .information-row { padding-left: 12px; padding-right: 12px; gap: 10px; } .storage-count-card { padding: 14px; } .information-header { padding-right: 16px; } }
	@media (prefers-reduced-motion: reduce) { .settings-information button, .help-faq-question > .app-icon { transition: none; } }
</style>

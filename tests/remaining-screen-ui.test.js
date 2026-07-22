import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('chat follows the Telegram-inspired wallpaper, compact header, and composer layout', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(source, /\.app-shell\.chat-active\s*\{[^}]*background-image:\s*url\(['"]\/static\/chat-wallpaper\.jpg['"]\)/s)
  assert.match(source, /\.chat-toolbar\s*\{[^}]*height:\s*62px[^}]*padding:\s*8px 6px[^}]*background:\s*transparent/s)
  assert.match(source, /\.chat-toolbar \.icon-button\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*border-radius:\s*50%[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.96\)/s)
  assert.match(source, /\.model-selector\s*\{[^}]*height:\s*44px[^}]*border-radius:\s*22px[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.96\)/s)
  assert.match(source, /\.empty-chat\s*\{[^}]*height:\s*min\(430px,\s*calc\(100%\s*-\s*34px\)\)/s)
  assert.match(source, /<MessageCircle\s+:size="40"/)
  assert.match(source, /data-testid="back-to-conversations"[^\n]*><ArrowLeft\s+:size="26"/)
  assert.match(source, /\.chat-more-icon\s*\{[^}]*transform:\s*rotate\(90deg\)/s)
  assert.doesNotMatch(source, /aria-label="会话历史"/)
  assert.match(source, /\.composer\s*\{[^}]*min-height:\s*56px[^}]*margin:\s*8px 7px max\(9px,\s*env\(safe-area-inset-bottom\)\)[^}]*border-radius:\s*28px/s)
  assert.match(source, /\.attachment-popover\s*\{[^}]*left:\s*0[^}]*right:\s*0[^}]*bottom:\s*calc\(100%\s*\+\s*10px\)[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)[^}]*min-height:\s*112px/s)
  assert.doesNotMatch(source, /class="status-bar"/)
})

test('chat content scrolls behind the floating toolbar and fades out at the top edge', async () => {
  const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

  assert.match(source, /\.chat-toolbar\s*\{[^}]*position:\s*absolute[^}]*top:\s*var\(--status-bar-height,\s*0px\)[^}]*left:\s*0[^}]*right:\s*0[^}]*z-index:\s*6/s)
  assert.match(source, /\.chat-scroll\s*\{[^}]*padding:\s*74px 11px 0[^}]*-webkit-overflow-scrolling:\s*touch[^}]*overscroll-behavior-y:\s*contain/s)
  assert.match(source, /-webkit-mask-image:\s*linear-gradient\(to bottom,\s*transparent 0,[^;]+#000 70px,\s*#000 100%\)/s)
  assert.match(source, /mask-image:\s*linear-gradient\(to bottom,\s*transparent 0,[^;]+#000 70px,\s*#000 100%\)/s)
})

test('Android diagnostics follows the themed two-column layout and preserves every action', async () => {
  const [source, previewSource] = await Promise.all([
    readFile(new URL('../pages/android-diagnostics/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../preview/main.js', import.meta.url), 'utf8')
  ])

	assert.match(source, /--accent:\s*#d43bc2/)
	assert.match(source, /\.diagnostic-header\s*\{[^}]*background:\s*#fff[^}]*color:\s*var\(--text\)/s)
  assert.match(source, /\.summary-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)
  for (const contract of ['header-menu', 'resetDiagnostic', 'showApiKey', '开始诊断', '停止诊断', '清空日志', '导出日志']) {
    assert.match(source, new RegExp(contract))
  }
  assert.match(previewSource, /android-diagnostics\/index\.vue/)
  assert.match(previewSource, /pages\/android-diagnostics\/index/)
  assert.doesNotMatch(source, /class="status-bar"/)
})

test('scroll padding is rendered as scrollable tail content instead of a fixed Android obstruction', async () => {
  const [mainSource, diagnosticsSource] = await Promise.all([
    readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../pages/android-diagnostics/index.vue', import.meta.url), 'utf8')
  ])

	assert.match(mainSource, /\.conversation-list\s*\{[^}]*padding:\s*0/s)
  assert.match(mainSource, /\.chat-scroll\s*\{[^}]*padding:\s*74px 11px 0/s)
  assert.match(mainSource, /\.provider-screen\s*\{[^}]*padding:\s*0/s)
  assert.match(mainSource, /\.settings-screen\s*\{[^}]*padding:\s*12px 10px 0/s)
  for (const tail of ['conversation-scroll-tail', 'chat-scroll-tail', 'navigation-scroll-tail']) {
    assert.match(mainSource, new RegExp(`class="${tail}"`))
  }

	assert.match(diagnosticsSource, /\.diagnostic-scroll\s*\{[^}]*padding:\s*14px 0 0/s)
	assert.match(diagnosticsSource, /class="diagnostic-scroll-tail"/)
})

test('provider management follows the white and magenta conversation style', async () => {
	const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

	assert.match(source, /class="screen-header provider-header"/)
	assert.match(source, /class="provider-add-button" aria-label="添加接口"/)
	assert.match(source, /class="provider-delete"[^>]*><Trash2\s+:size="18"/)
	assert.match(source, /接口要求时填写并保存/)
	assert.match(source, /catch \(error\) \{ this\.connectionStatus = 'failed'; this\.handleError\(error, '获取模型列表失败'\) \}/)
	assert.match(source, /class="provider-action-button"[^>]*><RefreshCw/)
	assert.match(source, /class="provider-save-button"/)
	assert.match(source, /\.providers-view\s*\{[^}]*--provider-accent:\s*#d43bc2[^}]*background:\s*#fff/s)
	assert.match(source, /\.provider-header\s*\{[^}]*height:\s*64px[^}]*background:\s*#fff/s)
	assert.match(source, /\.provider-card\s*\{[^}]*min-height:\s*78px[^}]*border:\s*0[^}]*background:\s*transparent/s)
	assert.match(source, /\.provider-editor\s*\{[^}]*border-top:\s*8px solid #f4f4f6/s)
	assert.match(source, /\.provider-form-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)
	assert.match(source, /\.provider-save-button\s*\{[^}]*height:\s*46px[^}]*background:\s*var\(--provider-accent\)/s)
	assert.match(source, /class="provider-navigation-fade"/)
	assert.match(source, /\.provider-navigation-fade\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*0[^}]*height:\s*96px[^}]*background:\s*#fff[^}]*pointer-events:\s*none/s)
	assert.match(source, /\.provider-screen \.navigation-scroll-tail\s*\{[^}]*height:\s*104px/s)
})

test('home follows the compact conversation list and floating navigation reference', async () => {
	const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

	assert.match(source, /<text class="screen-title">织语<\/text>/)
	assert.match(source, /aria-label="搜索会话"[^\n]*<Search\s+:size="26"/)
	assert.match(source, /aria-label="更多会话操作"[^\n]*<MoreVertical\s+:size="25"/)
	assert.match(source, /class="conversation-avatar"><ProviderLogo class="conversation-avatar-logo provider-logo"[^\n]*mode="aspectFill"/)
	assert.match(source, /class="row-time"[^\n]*@click\.stop="manageConversation\(conversation\)"/)
	assert.match(source, /class="home-action-menu"/)
	assert.match(source, />新建会话<\/text>/)
	assert.match(source, />刷新会话<\/text>/)
	assert.doesNotMatch(source, /class="floating-add"/)

	assert.match(source, /\.conversations-header\s*\{[^}]*height:\s*64px[^}]*background:\s*#fff/s)
	assert.match(source, /\.conversation-row\s*\{[^}]*min-height:\s*78px[^}]*background:\s*#fff/s)
	assert.match(source, /\.conversation-avatar\s*\{[^}]*width:\s*52px[^}]*height:\s*52px[^}]*border-radius:\s*50%[^}]*overflow:\s*hidden/s)
	assert.match(source, /\.conversation-avatar-logo\s*\{[^}]*width:\s*52px[^}]*height:\s*52px[^}]*padding:\s*0[^}]*background:\s*transparent/s)
	assert.match(source, /\.bottom-nav\s*\{[^}]*position:\s*absolute[^}]*left:\s*16px[^}]*right:\s*16px[^}]*height:\s*68px[^}]*border-radius:\s*34px/s)
	assert.match(source, /class="nav-indicator"[^>]*activeNavigationIndex \* 100/)
	assert.match(source, /activeNavigationIndex\(\)\s*\{[^}]*findIndex/s)
	assert.match(source, /\.nav-indicator\s*\{[^}]*width:\s*calc\(25% - 4\.5px\)[^}]*background:\s*#fff0fb[^}]*transition:\s*transform 280ms/s)
	assert.match(source, /\.nav-item\.active\s*\{[^}]*color:\s*#d43bc2/s)
	assert.doesNotMatch(source, /class="gesture-handle"/)
})

test('page and bottom navigation transitions are animated with reduced-motion support', async () => {
	const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

	assert.match(source, /\.screen-view\s*\{[^}]*animation:\s*page-switch-in 220ms/s)
	assert.match(source, /\.chat-toolbar,\s*\.chat-scroll,\s*\.composer\s*\{[^}]*animation:\s*page-switch-in 220ms/s)
	assert.match(source, /\.bottom-nav\s*\{[^}]*animation:\s*bottom-nav-enter 260ms/s)
	assert.match(source, /@keyframes page-switch-in/)
	assert.match(source, /@keyframes bottom-nav-enter/)
	assert.match(source, /@media \(prefers-reduced-motion:\s*reduce\)/)
})

test('new user and assistant message surfaces pop in once without replaying during streaming', async () => {
	const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

	assert.match(source, /class="user-message-stack" :class="\{ 'message-pop': animatedMessageIds\.includes\(message\.id\) \}" @animationend="finishMessageAnimation\(message\.id\)"/)
	assert.match(source, /class="assistant-message-stack" :class="\{ 'message-pop': animatedMessageIds\.includes\(message\.id\) \}" @animationend="finishMessageAnimation\(message\.id\)"/)
	assert.match(source, /this\.animatedMessageIds = \[\][^]*const messages = await this\.services\.repository\.listMessages/)
	assert.match(source, /if \(index === -1\) \{\s*this\.animatedMessageIds\.push\(next\.id\)\s*this\.messageItems\.push\(next\)/s)
	assert.match(source, /\.user-message-stack\.message-pop\s*\{[^}]*animation:\s*user-message-pop-in 260ms/s)
	assert.match(source, /\.assistant-message-stack\.message-pop\s*\{[^}]*animation:\s*assistant-message-pop-in 260ms/s)
	assert.match(source, /@keyframes user-message-pop-in/)
	assert.match(source, /@keyframes assistant-message-pop-in/)
	assert.match(source, /finishMessageAnimation\(messageId\)\s*\{\s*this\.animatedMessageIds = this\.animatedMessageIds\.filter/s)
})

test('provider model selection and chat auto-scroll use App-compatible controls', async () => {
	const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

	assert.match(source, /<picker class="select-field-picker"[^>]*:range="providerModelOptions"[^>]*@change="selectProviderModel"/)
	assert.match(source, /applyProviderModelSelection\(this\.providerForm, this\.providerModelOptions, event\?\.detail\?\.value\)/)
	assert.match(source, /addProvider\(\)[^\n]*defaultModel: ''/)
	assert.doesNotMatch(source, /<select\s+v-model="providerForm\.defaultModel"/)
	assert.match(source, /class="provider-protocol-control"[^>]*role="group"/)
	assert.match(source, /class="provider-protocol-option"[^>]*@click="selectProviderProtocol\(protocol\.id\)"/)
	assert.match(source, /PROVIDER_PROTOCOLS/)
	assert.match(source, /applyProviderProtocolSelection\(this\.providerForm, protocolType\)/)
	assert.match(source, /<scroll-view ref="chatScroll"[^>]*:scroll-into-view="chatScrollIntoView"/)
	assert.match(source, /:id="`chat-bottom-\$\{chatScrollRevision\}`" class="chat-scroll-tail"/)
	assert.match(source, /this\.chatScrollIntoView = `chat-bottom-\$\{revision\}`/)
})

test('settings overview follows the profile header and colorful single-list reference', async () => {
	const source = await readFile(new URL('../pages/index/index.vue', import.meta.url), 'utf8')

	assert.match(source, /class="settings-profile"/)
	assert.match(source, /class="settings-profile-avatar-wrap"[^>]*@click="openProfileAvatarMenu"/)
	assert.match(source, /class="settings-profile-avatar provider-logo"[^>]*:src="settingsProfileAvatarSource"/)
	assert.match(source, /class="settings-profile-camera"[^>]*>[\s\S]*<Camera\s+v-else\s+:size="19"/)
	assert.match(source, />从相册选择<\/text>/)
	assert.match(source, />拍照<\/text>/)
	assert.match(source, />恢复默认头像<\/text>/)
	assert.match(source, /nativeAttachmentPicker\.pick\(mode, \{ maxCount: 1 \}\)/)
	assert.match(source, /setSetting\(PROFILE_AVATAR_SETTING_KEY, avatar\)/)
	assert.match(source, /await this\.loadProfileAvatar\(\)/)
	assert.match(source, /aria-label="搜索设置"[^>]*@click="toggleSettingsSearch"/)
	assert.match(source, /class="settings-card settings-primary-card settings-menu-card"/)
	for (const label of ['对话设置', '账号与云端', '隐私与安全', '数据与存储', '导入与导出', '设备与诊断', '关于应用', '检查更新', '帮助与反馈']) {
		assert.match(source, new RegExp(`>${label}<`))
	}
	assert.match(source, /\.settings-overview\s*\{[^}]*--settings-surface:\s*#f3f3f5/s)
	assert.match(source, /\.settings-overview \.settings-screen\s*\{[^}]*padding:\s*0 12px/s)
	assert.match(source, /\.settings-profile-avatar\s*\{[^}]*width:\s*90px[^}]*height:\s*90px/s)
	assert.match(source, /\.settings-profile-avatar-wrap\s*\{[^}]*overflow:\s*visible/s)
	assert.match(source, /\.settings-profile-camera\s*\{[^}]*right:\s*0[^}]*bottom:\s*0[^}]*z-index:\s*1/s)
	assert.match(source, /\.settings-menu-card \.settings-row\s*\{[^}]*min-height:\s*58px[^}]*border-bottom:\s*0/s)
	assert.match(source, /\.settings-icon-orange\s*\{\s*background:\s*#f29a18/s)
	assert.doesNotMatch(source, /class="status-bar"/)
})

import { readMainPageSource } from './helpers/read-main-page.js'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('chat follows the Telegram-inspired wallpaper, compact header, and composer layout', async () => {
  const source = await readMainPageSource()

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
  const source = await readMainPageSource()

  assert.match(source, /\.chat-toolbar\s*\{[^}]*position:\s*absolute[^}]*top:\s*var\(--status-bar-height,\s*0px\)[^}]*left:\s*0[^}]*right:\s*0[^}]*z-index:\s*6/s)
  assert.match(source, /\.chat-scroll\s*\{[^}]*padding:\s*74px 11px 0[^}]*-webkit-overflow-scrolling:\s*touch[^}]*overscroll-behavior-y:\s*contain/s)
  assert.match(source, /-webkit-mask-image:\s*linear-gradient\(to bottom,\s*transparent 0,[^;]+#000 70px,\s*#000 100%\)/s)
  assert.match(source, /mask-image:\s*linear-gradient\(to bottom,\s*transparent 0,[^;]+#000 70px,\s*#000 100%\)/s)
})

test('Android diagnostics follows the paper two-column layout and preserves every action', async () => {
  const [source, previewSource] = await Promise.all([
    readFile(new URL('../pages/android-diagnostics/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../preview/main.js', import.meta.url), 'utf8')
  ])

	assert.match(source, /--accent:\s*#7850a0/)
	assert.match(source, /\.diagnostic-header\s*\{[^}]*background:\s*#f8f7f4[^}]*color:\s*var\(--text\)[^}]*flex:\s*0 0 auto/s)
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
    readMainPageSource(),
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

test('paper provider management keeps every editor action and scrollable navigation clearance', async () => {
	const [source, styles] = await Promise.all([
		readMainPageSource(),
		readFile(new URL('../src/styles/provider-redesign.css', import.meta.url), 'utf8')
	])

	assert.match(source, /class="screen-view providers-view paper-main-page"/)
	assert.match(source, /<MainPageHeading title="接口"/)
	assert.match(source, /class="paper-action" aria-label="添加接口"[^>]*@click="addProvider"/)
	assert.match(source, /<scroll-view class="provider-list-scroll" scroll-x>/)
	assert.match(source, /class="provider-card"[^>]*:aria-pressed="provider.id === ui.activeProviderId"[^>]*@click="selectProvider\(provider.id\)"/)
	assert.match(source, /class="provider-delete"[^>]*><Trash2\s+:size="18"/)
	assert.match(source, /接口要求时填写并保存/)
	assert.match(source, /catch \(error\) \{ this\.connectionStatus = 'failed'; this\.handleError\(error, '获取模型列表失败'\) \}/)
	assert.match(source, /class="provider-fetch-models"[^>]*:disabled="providerBusy"[^>]*@click="fetchProviderModels"/)
	assert.match(source, /class="provider-action-button"[^>]*:disabled="providerBusy"[^>]*@click="testConnection"/)
	assert.match(source, /class="provider-save-button"[^>]*:disabled="providerBusy"[^>]*@click="saveProvider"/)
	assert.match(source, /class="provider-avatar-selector"[^>]*@click="openProviderAvatarMenu"/)
	for (const field of ['name', 'baseUrl', 'apiKey', 'defaultModel']) {
		assert.match(source, new RegExp(`v-model="providerForm\\.${field}"`))
	}
	assert.match(styles, /\.providers-view\s*\{[^}]*--provider-accent:\s*var\(--paper-accent/s)
	assert.match(styles, /\.providers-view \.provider-list\s*\{[^}]*display:\s*flex[^}]*width:\s*max-content/s)
	assert.match(source, /\.provider-form-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s)
	assert.doesNotMatch(source, /class="provider-navigation-fade"/)
	assert.match(styles, /\.providers-view \.provider-screen \.navigation-scroll-tail\s*\{[^}]*height:\s*calc\([^;]*safe-area-inset-bottom/s)
})

test('paper home keeps searchable conversation actions and all five navigation destinations', async () => {
	const [source, styles, heading] = await Promise.all([
		readMainPageSource(),
		readFile(new URL('../src/styles/main-pages.css', import.meta.url), 'utf8'),
		readFile(new URL('../src/components/main-page-heading.vue', import.meta.url), 'utf8')
	])

	assert.match(heading, /class="paper-brand"><text>织语<\/text>/)
	assert.match(source, /<MainPageHeading title="会话"/)
	assert.match(source, /<input v-model="searchQuery"[^>]*aria-label="搜索会话"/)
	assert.match(source, /aria-label="更多会话操作"[^>]*:aria-expanded="homeMenuOpen"[^>]*@click="toggleHomeMenu"/)
	assert.match(source, /class="conversation-avatar"><ProviderLogo class="conversation-avatar-logo provider-logo"[^\n]*mode="aspectFill"/)
	assert.match(source, /class="row-time"[^\n]*@click\.stop="manageConversation\(conversation\)"/)
	assert.match(source, /class="home-action-menu"/)
	assert.match(source, />新建会话<\/text>/)
	assert.match(source, />刷新会话<\/text>/)
	assert.match(source, /class="conversation-create-group" @click="createGroupConversationFromMenu"/)
	assert.doesNotMatch(source, /class="floating-add"/)

	assert.match(styles, /\.app-shell \.bottom-nav\s*\{[^}]*left:\s*0;\s*right:\s*0;\s*bottom:\s*0[^}]*safe-area-inset-bottom/s)
	assert.match(source, /\.bottom-nav\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*1fr\)/s)
	assert.match(source, /v-for="item in navigationItems"[^>]*:data-tab="item.id"[^>]*:aria-current="ui.activeTab === item.id \? 'page' : undefined"[^>]*@click="goToTab\(item.id\)"/)
	assert.match(styles, /\.app-shell \.bottom-nav \.nav-item\.active\s*\{[^}]*background:\s*var\(--paper-soft\)/s)
	assert.doesNotMatch(source, /class="gesture-handle"/)
})

test('story tab exposes isolated character-card import and start-story entry points', async () => {
	const source = await readMainPageSource()

	assert.match(source, /v-show="ui\.screen === 'stories'" class="screen-view stories-view primary-tab-view paper-main-page"/)
	assert.match(source, /@click="openStoryCharacterCardPicker\('gallery'\)"/)
	assert.match(source, /@click="openStoryCharacterCardPicker\('file'\)"/)
	assert.match(source, /v-for="character in renderedStoryCharacters"/)
	assert.match(source, /@click="startStoryFromCharacter\(character\)"/)
	assert.match(source, /v-for="\(conversation, index\) in renderedStoryConversations"/)
	assert.match(source, /v-memo="\[conversation, index\]"/)
	assert.match(source, /@click="openChat\(conversation\.id\)"/)
	assert.match(source, /const conversations = this\.conversationItems\.filter\(item => item\?\.conversationKind !== 'story'\)/)
	assert.match(source, /storyConversations\(\)\s*\{[^}]*conversationKind === 'story'/s)
	assert.match(source, /commitCharacterImport\(this\.characterImportPreview,\s*\{[^]*characterScope:\s*'story'[^]*worldBookOverrides:/)
	assert.match(source, /createStoryConversation\(\{[^}]*characterId:\s*character\.id[^}]*providerProfileId:\s*provider\.id[^}]*modelName:\s*provider\.defaultModel/s)
	assert.match(source, /extractStoryMemory\(rawContent, \{ hideIncomplete: message\.status === 'generating' \}\)/)
	assert.match(source, /this\.canStoryContinue && !this\.draftMessage\.trim\(\)/)
	assert.match(source, /:hidden-scopes="\['story'\]"/)
})

test('chat motion is retained and new navigation feedback respects reduced motion', async () => {
	const [source, styles] = await Promise.all([
		readMainPageSource(),
		readFile(new URL('../src/styles/main-pages.css', import.meta.url), 'utf8')
	])

	assert.match(source, /\.screen-view,\s*\.primary-tab-view\s*\{[^}]*animation:\s*page-switch-in 220ms/s)
	assert.match(source, /\.chat-toolbar,\s*\.chat-scroll,\s*\.composer\s*\{[^}]*animation:\s*page-switch-in 220ms/s)
	assert.match(source, /@keyframes page-switch-in/)
	assert.match(source, /@media \(prefers-reduced-motion:\s*reduce\)/)
	assert.match(styles, /\.app-shell \.bottom-nav\s*\{[^}]*animation:\s*none/s)
	assert.match(styles, /\.app-shell \.bottom-nav \.nav-item\s*\{[^}]*transition:\s*background-color 140ms ease, color 140ms ease/s)
	assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.app-shell \.bottom-nav \.nav-item\s*\{\s*transition:\s*none/s)
})

test('new user and assistant message surfaces pop in once without replaying during streaming', async () => {
	const source = await readMainPageSource()

	assert.match(source, /class="user-message-stack" :class="\{ 'message-pop': animatedMessageIds\.includes\(message\.id\) \}" @animationend="finishMessageAnimation\(message\.id\)"/)
	assert.match(source, /class="assistant-message-stack" :class="\{ 'message-pop': animatedMessageIds\.includes\(message\.id\) \}" @animationend="finishMessageAnimation\(message\.id\)"/)
	assert.match(source, /this\.animatedMessageIds = \[\][^]*let \[page, savedStoryPosition, savedStoryBookmarks\] = await Promise\.all\(\[[^]*this\.readChatMessagePage\(conversationId\)/)
	assert.match(source, /if \(index === -1\) \{\s*this\.animatedMessageIds\.push\(next\.id\)[^]*this\.messageItems\.push\(next\)/s)
	assert.match(source, /\.user-message-stack\.message-pop\s*\{[^}]*animation:\s*user-message-pop-in 260ms/s)
	assert.match(source, /\.assistant-message-stack\.message-pop\s*\{[^}]*animation:\s*assistant-message-pop-in 260ms/s)
	assert.match(source, /@keyframes user-message-pop-in/)
	assert.match(source, /@keyframes assistant-message-pop-in/)
	assert.match(source, /finishMessageAnimation\(messageId\)\s*\{\s*this\.animatedMessageIds = this\.animatedMessageIds\.filter/s)
})

test('large chats render a bounded page and throttle streaming work', async () => {
	const source = await readMainPageSource()

	assert.match(source, /const CHAT_MESSAGE_PAGE_SIZE = 60/)
	assert.match(source, /const CHAT_VIRTUAL_MAX_ITEMS = 48/)
	assert.match(source, /repository\.listMessagePage\(conversationId, \{ beforeSequence, limit \}\)/)
	assert.match(source, /messageHistoryHasMore[^]*loadEarlierMessages/)
	assert.match(source, /加载更早消息/)
	assert.match(source, /@scroll="onChatScroll"/)
	assert.match(source, /v-for="message in virtualMessageItems"/)
	assert.match(source, /class="chat-virtual-spacer"[^>]*chatVirtualWindow\.topPadding/)
	assert.match(source, /class="chat-virtual-spacer"[^>]*chatVirtualWindow\.bottomPadding/)
	assert.match(source, /createVirtualMessageWindow\(this\.messageItems/)
	assert.match(source, /querySelectorAll\?\.\('\.chat-virtual-row\[data-chat-message-id\]'\)/)
	assert.match(source, /pending\.scrollTop <= CHAT_HISTORY_AUTO_LOAD_THRESHOLD[^]*this\.loadEarlierMessages\(\)/)
	assert.match(source, /const scrollSnapshot = this\.captureChatScrollSnapshot\(anchorId\)/)
	assert.match(source, /if \(!this\.restoreChatScrollSnapshot\(scrollSnapshot\)\)/)
	assert.match(source, /target\.scrollTop = \(Number\(target\.scrollTop\) \|\| 0\) \+ anchorTop - snapshot\.anchorTop/)
	assert.match(source, /STREAMING_RENDER_INTERVAL = 40/)
	assert.match(source, /message\.status === 'generating' && !statusParsingStarted/)
	assert.match(source, /if \(this\.chatScrollTimer\) return/)
	assert.match(source, /@touchmove\.passive="onChatTouchMove"/)
	assert.match(source, /@wheel\.passive="onChatWheel"/)
	assert.match(source, /cancelPendingChatScroll\(\)/)
	assert.match(source, /if \(!force && !this\.chatVirtualPinnedToBottom\) return/)
	assert.match(source, /revision !== this\.chatScrollRevision \|\| !this\.chatVirtualPinnedToBottom/)
	assert.doesNotMatch(source, /this\.services\.repository\.listMessages\(conversationId\)/)
})

test('primary tabs stay mounted and reuse bounded cached lists', async () => {
	const [source, contacts, providerLogo] = await Promise.all([
		readMainPageSource(),
		readFile(new URL('../src/components/character-contacts.vue', import.meta.url), 'utf8'),
		readFile(new URL('../src/components/provider-logo.js', import.meta.url), 'utf8')
	])
	const goToTab = source.match(/goToTab\(tab\)\s*\{([^]*?)\n\t\t\t\},/)?.[1] || ''
	const backToConversations = source.match(/backToConversations\(\)\s*\{([^]*?)\n\t\t\t\},/)?.[1] || ''

	assert.match(source, /v-show="ui\.screen === 'conversations'" class="screen-view conversations-view primary-tab-view paper-main-page"/)
	assert.match(source, /<CharacterContacts\s+v-show="ui\.screen === 'contacts'"\s+class="primary-tab-view"/)
	assert.match(source, /v-show="ui\.screen === 'stories'" class="screen-view stories-view primary-tab-view paper-main-page"/)
	assert.match(source, /const PRIMARY_LIST_BATCH_SIZE = 16/)
	assert.match(source, /v-for="conversation in renderedConversations"/)
	assert.match(source, /v-memo="\[conversation\]"/)
	assert.match(source, /:items="renderedCharacters"/)
	assert.match(source, /v-for="character in renderedStoryCharacters"/)
	assert.match(source, /repository\.listLatestMessages\(conversationIds\)/)
	assert.doesNotMatch(goToTab, /loadCharacters|loadWorldBooks|loadConversations/)
	assert.doesNotMatch(backToConversations, /loadConversations/)
	assert.match(contacts, /@scrolltolower="\$emit\('load-more'\)"/)
	assert.match(contacts, /v-memo="\[character\]"/)
	assert.match(contacts, /mode="aspectFill" lazy-load/)
	assert.match(providerLogo, /lazyLoad: \{ type: Boolean, default: false \}/)
	assert.match(providerLogo, /elementProps\['lazy-load'\] = true/)
	assert.match(providerLogo, /elementProps\.loading = 'lazy'/)
	assert.match(source, /\.conversation-row\s*\{[^}]*content-visibility:\s*auto/s)
	assert.match(contacts, /\.contact-row\s*\{[^}]*content-visibility:\s*auto/s)
})

test('provider model selection and chat auto-scroll use App-compatible controls', async () => {
	const source = await readMainPageSource()

	assert.match(source, /<picker class="select-field-picker"[^>]*:range="providerModelOptions"[^>]*@change="selectProviderModel"/)
	assert.match(source, /applyProviderModelSelection\(this\.providerForm, this\.providerModelOptions, event\?\.detail\?\.value\)/)
	assert.match(source, /data-testid="set-default-model"[^>]*:disabled="!canSetDefaultProviderModel"[^>]*@click="setDefaultProviderModel"/)
	assert.match(source, /providerServiceOrThrow\(\)\.setDefaultModel\(providerId, defaultModel\)/)
	assert.match(source, /createConversation\(\{ providerProfileId: provider\.id, providerNameSnapshot: provider\.name, modelName: provider\.defaultModel \}\)/)
	assert.match(source, /createCharacterConversation\(\{[^}]*modelName: provider\.defaultModel/s)
	assert.match(source, /createStoryConversation\(\{[^}]*modelName: provider\.defaultModel/s)
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

test('paper settings groups the real settings and preserves profile and support actions', async () => {
	const [source, styles, information] = await Promise.all([
		readMainPageSource(),
		readFile(new URL('../src/styles/settings-redesign.css', import.meta.url), 'utf8'),
		readFile(new URL('../src/components/settings-information.vue', import.meta.url), 'utf8')
	])

	assert.match(source, /<MainPageHeading title="设置"/)
	assert.match(source, /class="settings-profile"/)
	assert.match(source, /class="settings-profile-avatar-wrap"[^>]*@click="openProfileAvatarMenu"/)
	assert.match(source, /class="settings-profile-avatar provider-logo"[^>]*:src="settingsProfileAvatarSource"/)
	assert.match(source, /class="settings-profile-camera"[^>]*>[\s\S]*<Camera\s+v-else\s+:size="\d+"/)
	assert.match(source, /class="settings-profile-account" aria-label="账号与云端" @click="openCloudModal"/)
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
	for (const heading of ['对话体验', '连接与数据', '隐私与支持']) {
		assert.match(source, new RegExp(`class="settings-group-heading">${heading}<`))
	}
	for (const handler of ['openConversationSettings(ui)', 'openStreamingSettings(ui)', 'openCharacterStatusSettings(ui)', 'openNetworkProxySettings(ui)', 'openCloudModal', 'showLocalDataInfo', 'openBackupMenu', 'openSettingsDetails(ui)', 'openNsfwSettings(ui)', 'openAndroidDiagnostics', 'showAboutApp', "openSettingsInformation('updates')", "openSettingsInformation('help')"]) {
		assert.ok(source.includes(`@click="${handler}"`), `${handler} remains reachable`)
	}
	assert.match(source, /<SettingsInformation\s[^>]*@release="openReleasePage"[^>]*@feedback="openFeedbackPage"/)
	assert.match(information, /@click="\$emit\('release'\)"/)
	assert.match(information, /@click="\$emit\('feedback'\)"/)
	assert.match(source, /openReleasePage\(\)\s*\{\s*this\.openExternalUrl\(RELEASES_URL,/)
	assert.match(source, /openFeedbackPage\(\)\s*\{\s*this\.openExternalUrl\(FEEDBACK_URL,/)
	assert.match(styles, /\.settings-overview\.paper-main-page\s*\{[^}]*--settings-surface:\s*var\(--paper-bg/s)
	assert.match(styles, /\.settings-overview\.paper-main-page \.settings-profile\s*\{[^}]*flex-direction:\s*row/s)
	assert.match(source, /\.settings-profile-avatar-wrap\s*\{[^}]*overflow:\s*visible/s)
	assert.match(source, /\.settings-profile-camera\s*\{[^}]*right:\s*0[^}]*bottom:\s*0[^}]*z-index:\s*1/s)
	assert.match(styles, /\.settings-overview\.paper-main-page \.settings-icon\s*\{[^}]*background:\s*var\(--paper-soft/s)
	assert.match(styles, /\.settings-overview\.paper-main-page \.navigation-scroll-tail\s*\{[^}]*safe-area-inset-bottom/s)
	assert.doesNotMatch(source, /class="status-bar"/)
})

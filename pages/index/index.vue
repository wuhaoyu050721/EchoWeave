<template>
	<view class="app-shell" :class="{ 'chat-active': ui.screen === 'chat' }">
		<template v-if="ui.screen === 'conversations'">
			<view class="screen-view conversations-view">
				<view class="screen-header conversations-header">
					<text class="screen-title">织语</text>
					<view class="conversation-header-actions">
						<button class="icon-button" :class="{ active: searchOpen }" aria-label="搜索会话" @click="toggleConversationSearch"><Search :size="26" /></button>
						<button class="icon-button" :class="{ active: homeMenuOpen }" aria-label="更多会话操作" @click="toggleHomeMenu"><MoreVertical :size="25" /></button>
					</view>
				</view>
				<view v-if="searchOpen" class="search-box conversation-search"><Search :size="18" /><input v-model="searchQuery" :focus="searchOpen" confirm-type="search" placeholder="搜索会话" /><button v-if="searchQuery" aria-label="清空搜索" @click="searchQuery = ''"><X :size="17" /></button></view>
				<view v-if="homeMenuOpen" class="home-menu-backdrop" @click="homeMenuOpen = false" />
				<view v-if="homeMenuOpen" class="home-action-menu">
					<button @click="createConversationFromMenu"><Plus :size="19" /><text>新建会话</text></button>
					<button @click="refreshConversationsFromMenu"><RefreshCw :size="18" /><text>刷新会话</text></button>
				</view>
				<scroll-view class="conversation-list" scroll-y>
					<view v-if="!filteredConversations.length" class="empty-state"><text>暂无会话</text></view>
					<view v-for="conversation in filteredConversations" :key="conversation.id" class="conversation-row" :data-conversation-id="conversation.id">
						<button class="conversation-open" :aria-label="`打开会话 ${conversation.title}`" @click="openChat(conversation.id)" @longpress.stop="manageConversation(conversation)" @contextmenu.prevent.stop="manageConversation(conversation)">
							<view class="conversation-avatar"><ProviderLogo class="conversation-avatar-logo provider-logo" :src="conversationProviderLogo(conversation)" :alt="conversation.title" mode="aspectFill" /></view>
							<view class="conversation-copy"><view class="row-title-line"><text class="row-title">{{ conversation.title }}</text></view><text class="row-preview">{{ conversation.preview }}</text></view>
						</button>
						<button class="row-time" :aria-label="`管理会话 ${conversation.title}`" @click.stop="manageConversation(conversation)">{{ conversation.time }}</button>
					</view>
					<view class="conversation-scroll-tail" />
				</scroll-view>
			</view>
		</template>

		<template v-else-if="ui.screen === 'contacts'">
			<CharacterContacts
				:items="filteredCharacters"
				:query="contactSearchQuery"
				:sort-mode="contactSortMode"
				:busy="characterImportBusy"
				:world-book-count="worldBookItems.length"
				@update:query="contactSearchQuery = $event"
				@toggle-sort="toggleContactSort"
				@create-character="openCustomCharacterEditor"
				@import-character-gallery="openCharacterCardPicker('gallery')"
				@import-character-file="openCharacterCardPicker('file')"
				@manage-world-books="openWorldBookManager"
				@open-character-details="openCharacterDetailsView"
			/>
		</template>

		<template v-else-if="ui.screen === 'character-detail'">
			<CharacterDetail
				:character="selectedCharacter"
				:creating="Boolean(customCharacterDraft)"
				:editing="characterDetailEditing"
				:saving="characterSaveBusy"
				@back="closeCharacterDetailsView"
				@cancel="cancelCharacterEditing"
				@edit="characterDetailEditing = true"
				@save="saveCharacterDetails"
				@new-chat="startCharacterChatFromDetails"
				@request-avatar-change="requestCharacterAvatarChange"
				@export-json="exportCharacterJson"
				@export-png="exportCharacterPng"
				@delete-character="deleteCharacterFromDetails"
			/>
		</template>

		<template v-else-if="ui.screen === 'chat'">
			<view class="chat-toolbar">
				<button class="icon-button chat-back-button" data-testid="back-to-conversations" aria-label="返回会话" @click="backToConversations"><ArrowLeft :size="26" /></button>
				<button class="model-selector" :disabled="ui.generating" @click="toggleModelMenu">
					<ProviderLogo class="toolbar-provider-logo provider-logo" :src="activeAssistantAvatar" mode="aspectFill" />
					<view class="model-selector-copy"><text class="model-selector-title">{{ chatProviderName }}</text><text class="model-selector-subtitle">{{ chatModelName }}</text></view>
				</button>
				<button class="icon-button chat-more-button" aria-label="管理会话" @click="manageConversation(activeConversation)"><MoreVertical class="chat-more-icon" :size="23" /></button>
			</view>
			<button v-if="latestAssistantStatus && assistantStatusOverview" class="character-status-bar" :aria-expanded="assistantStatusOpen" :title="latestAssistantStatus.summary" aria-label="查看角色状态" @click="assistantStatusOpen = true">
				<view class="character-status-icon"><Activity :size="17" /></view>
				<text class="character-status-label">角色状态</text>
				<view class="character-status-field character-status-primary"><text>{{ assistantStatusOverview.primary }}</text></view>
				<view v-if="assistantStatusOverview.location" class="character-status-field character-status-location"><text>{{ assistantStatusOverview.location }}</text></view>
				<view v-if="assistantStatusOverview.scoreValue" class="character-status-field character-status-score"><text>{{ assistantStatusOverview.scoreLabel || '好感度' }} {{ assistantStatusOverview.scoreValue }}</text></view>
				<view class="character-status-update" :class="{ 'has-issue': assistantStatusIssue }"><AlertCircle v-if="assistantStatusIssue" :size="11" /><Check v-else :size="11" /><text>{{ assistantStatusUpdateLabel }}</text></view>
				<ChevronDown class="character-status-chevron" :size="15" />
			</button>
			<view v-if="modelMenuOpen" class="model-popover">
				<text class="popover-label">选择接口与模型</text>
				<view class="generation-mode-tabs" role="tablist">
					<button class="generation-mode-tab" :class="{ active: ui.generationMode === 'chat' }" @click="setChatGenerationMode"><MessageCircle :size="15" /><text>聊天</text></button>
					<button class="generation-mode-tab" :class="{ active: ui.generationMode === 'image' }" @click="setImageGenerationMode"><Image :size="15" /><text>生图</text></button>
				</view>
				<button v-for="provider in providerItems" :key="provider.id" class="popover-option" @click="selectConversationProvider(provider)">
					<text>{{ provider.name }}</text><text>{{ provider.defaultModel }}</text>
				</button>
			</view>
			<scroll-view ref="chatScroll" class="chat-scroll" :class="{ 'has-character-status': latestAssistantStatus }" scroll-y :scroll-into-view="chatScrollIntoView">
				<view class="date-divider"><text>今天</text></view>
				<view v-if="!messageItems.length" class="empty-chat"><MessageCircle :size="40" /><text>开始新对话</text></view>
				<template v-for="message in messageItems" :key="message.id">
					<view v-if="message.role === 'user'" class="message message-user">
						<view class="user-message-stack" :class="{ 'message-pop': animatedMessageIds.includes(message.id) }" @animationend="finishMessageAnimation(message.id)">
							<view v-if="imageAttachments(message).length" class="media-message user-media-message">
								<view class="sent-image-grid" :class="{ single: imageAttachments(message).length === 1 }">
									<view v-for="attachment in imageAttachments(message)" :key="attachment.id" class="sent-image-item"><button class="sent-image-button" :aria-label="`预览图片 ${attachment.name}`" @click="previewImageAttachment(attachment)"><AppImage class="attachment-image" :src="attachmentSource(attachment)" :alt="attachment.name" :mode="imageAttachments(message).length === 1 ? 'widthFix' : 'aspectFill'" /></button><button class="image-download-button" :disabled="imageDownloadBusy" :aria-label="`保存图片 ${attachment.name}`" title="保存到相册" @click.stop="downloadImageAttachment(attachment)"><Download :size="16" /></button></view>
								</view>
								<view v-if="!message.content && !textAttachments(message).length" class="media-message-meta user-media-meta"><text>{{ formatMessageTime(message.updatedAt) }}</text><CheckCheck v-if="isUserMessageRead(message)" class="read-receipt" :size="15" :stroke-width="2.2" /></view>
							</view>
							<view v-if="message.content || textAttachments(message).length" class="message-bubble user-bubble">
								<view v-if="textAttachments(message).length" class="message-attachments">
									<button v-for="attachment in textAttachments(message)" :key="attachment.id" class="sent-file-button" :aria-label="`预览文件 ${attachment.name}`" @click="previewTextAttachment(attachment)"><FileText :size="18" /><view class="sent-file-copy"><text>{{ attachment.name }}</text><text>{{ formatAttachmentSize(attachment.byteSize) }}</text></view><ChevronRight :size="15" /></button>
								</view>
								<text v-if="message.content" class="message-content" selectable user-select>{{ message.content }}</text>
								<view class="message-meta user-message-meta"><text class="message-time">{{ formatMessageTime(message.updatedAt) }}</text><CheckCheck v-if="isUserMessageRead(message)" class="read-receipt" :size="16" :stroke-width="2.2" /></view>
							</view>
						</view>
					</view>
					<view v-else class="message message-assistant">
						<ProviderLogo class="assistant-avatar provider-logo" :src="activeAssistantAvatar" mode="aspectFill" />
						<view class="assistant-message-stack" :class="{ 'message-pop': animatedMessageIds.includes(message.id) }" @animationend="finishMessageAnimation(message.id)">
							<view v-if="message.displayContent || message.status !== 'completed'" class="assistant-body" :class="{ 'generating-message': message.status === 'generating' }">
								<text class="assistant-name">{{ chatProviderName }}</text>
								<text v-if="message.displayContent" class="message-content" selectable user-select>{{ message.displayContent }}</text>
								<view v-if="message.status === 'generating'" class="generation-status"><view class="generation-dots"><i /><i /><i /></view><button class="stop-inline" @click="stopGeneration"><Square :size="12" fill="currentColor" /><text>停止生成</text></button></view>
								<view v-else-if="message.status !== 'completed'" class="message-status"><view class="message-status-copy"><text>{{ statusLabel(message.status) }}</text><text v-if="message.errorMessage" class="message-status-detail">{{ message.errorMessage }}</text></view><button class="retry-button" @click="retryMessage(message.id)">重试</button></view>
								<view v-else class="assistant-footer"><view class="message-actions"><button v-if="message.displayContent" aria-label="复制" @click="copyMessage(message.displayContent)"><Copy :size="16" /></button><button aria-label="赞同"><ThumbsUp :size="16" /></button><button aria-label="不赞同"><ThumbsDown :size="16" /></button><button v-if="!message.isGreeting" class="retry-action" @click="retryMessage(message.id)"><RotateCcw :size="14" /><text>重试</text></button></view><text class="assistant-time">{{ formatMessageTime(message.updatedAt) }}</text></view>
							</view>
							<view v-if="imageAttachments(message).length" class="media-message assistant-image-surface">
								<view class="sent-image-grid assistant-image-grid" :class="{ single: imageAttachments(message).length === 1 }">
									<view v-for="attachment in imageAttachments(message)" :key="attachment.id" class="sent-image-item"><button class="sent-image-button" :aria-label="`预览生成图片 ${attachment.name}`" @click="previewImageAttachment(attachment)"><AppImage class="attachment-image" :src="attachmentSource(attachment)" :alt="attachment.name" :mode="imageAttachments(message).length === 1 ? 'widthFix' : 'aspectFill'" /></button><button class="image-download-button" :disabled="imageDownloadBusy" :aria-label="`保存图片 ${attachment.name}`" title="保存到相册" @click.stop="downloadImageAttachment(attachment)"><Download :size="16" /></button></view>
								</view>
								<view v-if="!message.displayContent && message.status === 'completed'" class="media-message-meta assistant-media-meta"><text>{{ formatMessageTime(message.updatedAt) }}</text></view>
								<view v-if="!message.displayContent && message.status === 'completed'" class="assistant-image-footer"><button aria-label="重新生成图片" @click="retryMessage(message.id)"><RotateCcw :size="14" /></button></view>
							</view>
						</view>
					</view>
				</template>
				<view :id="`chat-bottom-${chatScrollRevision}`" class="chat-scroll-tail" />
			</scroll-view>
			<view v-if="attachmentMenuOpen || emojiMenuOpen" class="attachment-backdrop" @click="closeComposerMenus" />
			<view class="composer" :class="{ 'menu-open': attachmentMenuOpen || emojiMenuOpen, 'has-attachments': pendingAttachments.length || attachmentProcessing, 'is-multiline': composerMultiline }">
				<view v-if="attachmentMenuOpen" class="attachment-popover">
					<button v-for="action in attachmentActions" :key="action.id" class="attachment-action" :aria-label="action.label" @click="chooseAttachmentAction(action)"><component :is="iconMap[action.icon]" :size="28" /><text>{{ action.label }}</text></button>
				</view>
				<view v-if="emojiMenuOpen" class="emoji-popover">
					<button v-for="emoji in emojiOptions" :key="emoji" :aria-label="`插入表情 ${emoji}`" @click="appendEmoji(emoji)"><text>{{ emoji }}</text></button>
				</view>
				<button class="composer-emoji" aria-label="选择表情" @click="toggleEmojiMenu"><AppImage class="composer-smile-icon" src="/static/chat/smile.png" alt="" mode="aspectFit" /></button>
				<view class="composer-main">
					<scroll-view v-if="pendingAttachments.length || attachmentProcessing" class="pending-attachment-strip" scroll-x>
						<view class="pending-attachment-list">
							<view v-for="(attachment, index) in pendingAttachments" :key="`${attachment.kind}-${attachment.name}-${index}`" class="pending-attachment" :class="`pending-${attachment.kind}`">
								<AppImage v-if="attachment.kind === 'image'" class="attachment-image" :src="attachmentSource(attachment)" :alt="attachment.name" mode="aspectFill" />
								<template v-else><FileText :size="18" /><view class="pending-file-copy"><text>{{ attachment.name }}</text><text>{{ formatAttachmentSize(attachment.byteSize) }}</text></view></template>
								<button class="remove-pending-attachment" :aria-label="`移除附件 ${attachment.name}`" :disabled="attachmentProcessing" @click="removePendingAttachment(index)"><X :size="13" /></button>
							</view>
							<view v-if="attachmentProcessing" class="pending-processing"><RefreshCw :size="17" /><text>处理中</text></view>
						</view>
					</scroll-view>
					<textarea ref="composerInput" class="composer-input" v-model="draftMessage" rows="1" maxlength="-1" :style="{ height: composerInputHeight + 'px' }" placeholder-style="color:#858d90;font-size:15.5px" :placeholder="ui.generationMode === 'image' ? '描述要生成的图片...' : '输入消息'" @focus="closeComposerMenus" @linechange="resizeComposerInput" />
				</view>
				<button class="composer-attachment" :disabled="ui.generationMode === 'image'" aria-label="添加附件" @click="toggleAttachmentMenu"><Paperclip :size="27" /></button>
				<button class="composer-stop" :disabled="!ui.generating && (attachmentProcessing || (ui.generationMode === 'image' && !canSend))" :aria-label="ui.generating ? '停止生成' : (ui.generationMode === 'image' ? '生成图片' : (canSend ? '发送消息' : '语音输入'))" @click="handleComposerAction">
					<Square v-if="ui.generating" :size="14" fill="currentColor" /><Image v-else-if="ui.generationMode === 'image'" :size="18" /><Send v-else-if="canSend" :size="20" /><Mic v-else :size="26" />
				</button>
				<input ref="imageAttachmentInput" class="hidden-file-input" type="file" accept="image/*" multiple @change="handleAttachmentSelection" />
				<input ref="cameraAttachmentInput" class="hidden-file-input" type="file" accept="image/*" capture="environment" @change="handleAttachmentSelection" />
				<input ref="fileAttachmentInput" class="hidden-file-input" type="file" :accept="textAttachmentAccept" multiple @change="handleAttachmentSelection" />
			</view>
		</template>

		<template v-else-if="ui.screen === 'providers'">
			<view class="screen-view providers-view">
				<view class="screen-header provider-header"><text class="screen-title">接口</text><button class="provider-add-button" aria-label="添加接口" :disabled="!ready" @click="addProvider"><Plus :size="26" /></button></view>
				<scroll-view class="provider-screen reference-scroll" scroll-y>
					<view class="provider-list">
						<view v-for="provider in providerItems" :key="provider.id" class="provider-row" :class="{ selected: provider.id === ui.activeProviderId }">
							<button class="provider-card" :class="{ selected: provider.id === ui.activeProviderId }" :aria-label="`选择接口 ${provider.name}`" @click="selectProvider(provider.id)">
								<ProviderLogo class="provider-logo provider-logo-large" :src="provider.logo || '/static/providers/openai.png'" :alt="provider.name" mode="aspectFill" />
								<view class="provider-copy"><text class="provider-name">{{ provider.name }}</text><text class="provider-url">{{ provider.baseUrl }}</text><text class="provider-model">{{ provider.defaultModel || '未设置默认模型' }}</text></view>
								<view v-if="provider.id === ui.activeProviderId" class="provider-selection"><Check :size="16" /></view>
							</button>
							<button v-if="provider.id !== ui.activeProviderId && providerItems.length > 1" class="provider-delete" :aria-label="`删除接口 ${provider.name}`" @click.stop="deleteProvider(provider)"><Trash2 :size="18" /></button>
						</view>
					</view>
					<view class="provider-editor">
						<text class="content-section-label">{{ providerForm.id ? '编辑接口' : '添加接口' }}</text>
						<view class="provider-form provider-form-card">
							<button class="provider-avatar-selector" :disabled="!ready || providerAvatarBusy" @click="openProviderAvatarMenu">
								<view class="provider-avatar-preview">
									<ProviderLogo class="provider-avatar-preview-image" :src="providerFormAvatarSource" :alt="providerForm.name || '接口头像'" :mode="providerForm.avatar.mode === 'custom' ? 'aspectFill' : 'aspectFit'" />
									<view v-if="providerAvatarBusy" class="provider-avatar-loading"><RefreshCw class="spinning" :size="16" /></view>
								</view>
								<view class="provider-avatar-selector-copy"><text>接口头像</text><text>{{ providerFormAvatarDescription }}</text></view>
								<ChevronRight :size="18" />
							</button>
							<label class="form-row"><text>名称</text><input v-model="providerForm.name" placeholder="接口名称" /></label>
							<view class="form-row"><text>接口格式</text><view class="provider-protocol-control" role="group" aria-label="接口格式"><button v-for="protocol in providerProtocols" :key="protocol.id" class="provider-protocol-option" :class="{ active: providerForm.protocolType === protocol.id }" :disabled="providerBusy" :aria-pressed="providerForm.protocolType === protocol.id" @click="selectProviderProtocol(protocol.id)">{{ protocol.label }}</button></view></view>
							<label class="form-row"><text>基础地址</text><input v-model="providerForm.baseUrl" :placeholder="activeProviderProtocol.defaultBaseUrl" /></label>
							<label class="form-row"><text>API 密钥</text><view class="password-field"><input v-model="providerForm.apiKey" :type="showApiKey ? 'text' : 'password'" :placeholder="providerForm.hasApiKey ? '已安全保存，留空不修改' : '接口要求时填写并保存'" /><button aria-label="显示或隐藏密钥" @click="showApiKey = !showApiKey"><EyeOff :size="17" /></button></view></label>
							<label class="form-row"><text>默认模型</text><view class="select-field-wrap"><picker class="select-field-picker" mode="selector" :range="providerModelOptions" :value="providerModelIndex" :disabled="providerBusy || !providerModelOptions.length" @change="selectProviderModel"><view class="select-field"><text>{{ providerForm.defaultModel || '获取模型后选择' }}</text></view></picker><ChevronDown class="select-chevron" :size="17" /></view></label>
							<label class="form-row"><text>手动模型</text><input v-model="providerForm.defaultModel" :placeholder="activeProviderProtocol.modelPlaceholder" /></label>
							<view class="provider-form-actions"><button class="provider-action-button" :disabled="providerBusy" @click="fetchProviderModels"><RefreshCw :class="{ spinning: providerLoadingModels }" :size="17" /><text>{{ providerLoadingModels ? '获取中...' : '获取模型列表' }}</text></button><button class="provider-action-button" :disabled="providerBusy" @click="testConnection"><Activity :size="17" /><text>{{ providerTesting ? '测试中...' : '测试连接' }}</text></button></view>
							<button class="provider-save-button" :disabled="providerBusy" @click="saveProvider"><Check :size="18" /><text>{{ providerSaving ? '保存中...' : '保存' }}</text></button>
							<view v-if="connectionStatus === 'success'" class="connection-result test-success"><Check :size="15" /><text>连接成功</text></view><view v-else-if="connectionStatus === 'failed'" class="connection-result test-error"><AlertCircle :size="15" /><text>连接失败</text></view>
						</view>
					</view>
					<view class="navigation-scroll-tail" />
				</scroll-view>
				<view class="provider-navigation-fade" aria-hidden="true" />
			</view>
		</template>

		<template v-else>
			<view v-if="ui.settingsView === 'overview'" class="screen-view settings-overview">
				<scroll-view class="settings-screen reference-scroll" scroll-y>
					<view class="settings-profile">
						<view class="settings-profile-actions"><button class="settings-profile-action" :class="{ active: settingsSearchOpen }" aria-label="搜索设置" @click="toggleSettingsSearch"><Search :size="27" /></button><button class="settings-profile-action" aria-label="打开设置详情" @click="openSettingsDetails(ui)"><MoreVertical :size="26" /></button></view>
						<view v-if="settingsSearchOpen" class="settings-search-bar"><Search :size="18" /><input v-model="settingsSearchQuery" :focus="settingsSearchOpen" placeholder="搜索设置" /><button v-if="settingsSearchQuery" aria-label="清空设置搜索" @click="settingsSearchQuery = ''"><X :size="17" /></button></view>
						<button class="settings-profile-avatar-wrap" :aria-label="profileAvatar ? '更换头像' : '设置头像'" :disabled="!ready || profileAvatarBusy" @click="openProfileAvatarMenu"><ProviderLogo class="settings-profile-avatar provider-logo" :src="settingsProfileAvatarSource" alt="用户头像" mode="aspectFill" /><view class="settings-profile-camera" aria-hidden="true"><RefreshCw v-if="profileAvatarBusy" class="spinning" :size="17" /><Camera v-else :size="19" /></view></button>
						<text class="settings-profile-name">{{ settingsProfileName }}</text>
						<text class="settings-profile-subtitle">{{ settingsProfileSubtitle }}</text>
					</view>

					<view v-if="settingsSearchHasResults" class="settings-card settings-primary-card settings-menu-card">
						<button v-if="matchesSettingsSearch('对话设置 系统提示词 模型行为 动画效果')" class="settings-row" @click="toggleSystemPromptPanel"><view class="settings-icon settings-icon-orange"><FileCog :size="22" /></view><view class="settings-copy"><text>对话设置</text><text>系统提示词、模型行为与动画效果</text></view></button>
						<button v-if="matchesSettingsSearch('账号与云端 登录 自动备份 同步')" class="settings-row" @click="openCloudModal"><view class="settings-icon settings-icon-blue"><Cloud :size="22" /></view><view class="settings-copy"><text>账号与云端</text><text>{{ cloudConnected ? settingsProfileName : '本地模式，不会自动上传' }}</text></view></button>
						<button v-if="matchesSettingsSearch('隐私与安全 API 密钥 应用锁 加密 通知 回复提醒')" class="settings-row" @click="openSettingsDetails(ui)"><view class="settings-icon settings-icon-green"><KeyRound :size="22" /></view><view class="settings-copy"><text>隐私与安全</text><text>API 密钥、应用锁与回复通知</text></view></button>
						<button v-if="matchesSettingsSearch('NSFW 设置 成人 私密状态 状态栏')" class="settings-row" data-testid="nsfw-settings-entry" @click="openNsfwSettings(ui)"><view class="settings-icon settings-icon-red"><EyeOff :size="22" /></view><view class="settings-copy"><text>NSFW 设置</text><text>{{ nsfwSettingLabel }}</text></view><ChevronRight :size="18" /></button>
						<button v-if="matchesSettingsSearch('数据与存储 本地数据库 SQLite IndexedDB')" class="settings-row" @click="showLocalDataInfo"><view class="settings-icon settings-icon-indigo"><Database :size="22" /></view><view class="settings-copy"><text>数据与存储</text><text>{{ storageLabel }} 本地优先存储</text></view></button>
						<button v-if="matchesSettingsSearch('导入与导出 JSON 备份 恢复')" class="settings-row" @click="openBackupMenu"><view class="settings-icon settings-icon-cyan"><Import :size="22" /></view><view class="settings-copy"><text>导入与导出</text><text>本地文件与云端链接</text></view></button>
						<button v-if="matchesSettingsSearch('设备与诊断 Android 流式 日志')" class="settings-row" @click="openAndroidDiagnostics"><view class="settings-icon settings-icon-teal"><Activity :size="22" /></view><view class="settings-copy"><text>设备与诊断</text><text>Android 流式连接与运行日志</text></view></button>
						<button v-if="matchesSettingsSearch('关于应用 版本 信息')" class="settings-row" @click="showAboutApp"><view class="settings-icon settings-icon-red"><Info :size="22" /></view><view class="settings-copy"><text>关于应用</text><text>版本 1.0.1 · {{ aboutLabel }}</text></view></button>
						<button v-if="matchesSettingsSearch('检查更新 最新版本')" class="settings-row" @click="showToast('当前已是最新开发版本')"><view class="settings-icon settings-icon-amber"><RefreshCw :size="22" /></view><view class="settings-copy"><text>检查更新</text><text>获取最新功能与修复</text></view></button>
						<button v-if="matchesSettingsSearch('帮助与反馈 使用问题 问题反馈')" class="settings-row" @click="showToast('反馈功能将在服务端版本接入')"><view class="settings-icon settings-icon-purple"><CircleHelp :size="22" /></view><view class="settings-copy"><text>帮助与反馈</text><text>使用问题与问题反馈</text></view></button>
					</view>
					<view v-else class="settings-search-empty"><Search :size="24" /><text>未找到相关设置</text></view>

					<view v-if="systemPromptOpen" class="settings-card settings-expanded-panel prompt-editor"><view class="settings-expanded-heading"><text>对话设置</text><button aria-label="关闭对话设置" @click="systemPromptOpen = false"><X :size="18" /></button></view><view class="prompt-controls"><text>启用系统提示词</text><button class="toggle" :class="{ enabled: systemPromptEnabled }" @click="systemPromptEnabled = !systemPromptEnabled"><view class="toggle-thumb" /></button></view><textarea v-model="systemPrompt" placeholder="输入系统提示词" /><button class="primary-button prompt-save" @click="saveSystemPrompt">保存</button></view>

					<view class="navigation-scroll-tail" />
				</scroll-view>
			</view>

			<view v-else-if="ui.settingsView === 'nsfw'" class="screen-view settings-details nsfw-settings-details">
				<view class="screen-header reference-header settings-detail-header"><button class="icon-button header-back" aria-label="返回设置概览" @click="closeSettingsDetails(ui)"><ArrowLeft :size="21" /></button><text class="screen-title">NSFW 设置</text></view>
				<scroll-view class="settings-screen reference-scroll" scroll-y>
					<text class="settings-section-label">状态栏</text>
					<view class="settings-card">
						<button class="settings-row" data-testid="nsfw-status-toggle" role="switch" :aria-checked="nsfwEnabled" :disabled="nsfwSaving" @click="toggleNsfw"><view class="settings-icon"><EyeOff :size="19" /></view><view class="settings-copy"><text>显示私密状态</text><text>{{ nsfwSettingLabel }}</text></view><view class="toggle" :class="{ enabled: nsfwEnabled }"><view class="toggle-thumb" /></view></button>
					</view>
					<view class="navigation-scroll-tail" />
				</scroll-view>
			</view>

			<view v-else class="screen-view settings-details">
				<view class="screen-header reference-header settings-detail-header"><button class="icon-button header-back" aria-label="返回设置概览" @click="closeSettingsDetails(ui)"><ArrowLeft :size="21" /></button><text class="screen-title">设置</text></view>
				<scroll-view class="settings-screen reference-scroll" scroll-y>
					<text class="settings-section-label">安全</text>
					<view class="settings-card">
						<button class="settings-row" @click="goToTab('providers')"><view class="settings-icon"><KeyRound :size="19" /></view><view class="settings-copy"><text>API 密钥管理</text><text>使用 {{ encryptionLabel }} 加密后保存</text></view><ChevronRight :size="18" /></button>
						<button class="settings-row" data-testid="app-lock" @click="toggleLock"><view class="settings-icon"><LockKeyhole :size="19" /></view><view class="settings-copy"><text>应用锁</text><text>当前版本保存开关状态</text></view><view class="toggle" :class="{ enabled: ui.appLockEnabled }"><view class="toggle-thumb" /></view></button>
					</view>
					<text class="settings-section-label">提醒</text>
					<view class="settings-card">
						<button class="settings-row" data-testid="reply-notifications" @click="toggleReplyNotifications"><view class="settings-icon"><MessageCircle :size="19" /></view><view class="settings-copy"><text>回复通知</text><text>{{ replyNotificationLabel }}</text></view><view class="toggle" :class="{ enabled: replyNotificationSupported && replyNotificationsEnabled }"><view class="toggle-thumb" /></view></button>
					</view>
					<text class="settings-section-label">应用信息</text>
					<view class="settings-card">
						<button class="settings-row" @click="openAndroidDiagnostics"><view class="settings-icon"><Activity :size="19" /></view><view class="settings-copy"><text>Android 流式诊断</text><text>验证流式分块、停止和生命周期</text></view><ChevronRight :size="18" /></button>
						<button class="settings-row" @click="showAboutApp"><view class="settings-icon"><Info :size="19" /></view><view class="settings-copy"><text>关于应用</text><text>版本 1.0.1 · {{ aboutLabel }}</text></view><ChevronRight :size="18" /></button>
						<button class="settings-row" @click="showToast('当前已是最新开发版本')"><view class="settings-icon"><RefreshCw :size="19" /></view><view class="settings-copy"><text>检查更新</text><text>当前已是最新版本</text></view><ChevronRight :size="18" /></button>
						<button class="settings-row" @click="showToast('反馈功能将在服务端版本接入')"><view class="settings-icon"><CircleHelp :size="19" /></view><view class="settings-copy"><text>帮助与反馈</text><text>使用问题与问题反馈</text></view><ChevronRight :size="18" /></button>
					</view>
					<view class="navigation-scroll-tail" />
				</scroll-view>
			</view>
		</template>

		<view v-if="ui.screen !== 'chat' && ui.screen !== 'character-detail'" class="bottom-nav">
			<view class="nav-indicator" aria-hidden="true" :style="{ transform: `translateX(${activeNavigationIndex * 100}%)` }" />
			<button v-for="item in navigationItems" :key="item.id" class="nav-item" :data-tab="item.id" :class="{ active: ui.activeTab === item.id }" :aria-current="ui.activeTab === item.id ? 'page' : undefined" @click="goToTab(item.id)"><component :is="iconMap[item.icon]" :size="24" /><text>{{ item.label }}</text></button>
		</view>

		<input ref="characterCardInput" class="hidden-file-input" type="file" accept="image/png,.png" @change="handleCharacterCardSelection" />
		<input ref="characterAvatarInput" class="hidden-file-input" type="file" accept="image/*" @change="handleCharacterAvatarSelection" />
		<view v-if="characterImportPreview" class="modal-backdrop character-import-backdrop" @click.self="closeCharacterImportPreview">
			<view class="character-import-modal" role="dialog" aria-modal="true" aria-label="角色卡导入预览">
				<view class="modal-heading"><text>导入角色卡</text><button aria-label="关闭角色卡预览" :disabled="characterImportBusy" @click="closeCharacterImportPreview"><X :size="19" /></button></view>
				<scroll-view class="character-import-content" scroll-y>
					<view class="character-preview-identity">
						<ProviderLogo class="character-preview-avatar" :src="characterImportPreview.character.avatarDataUrl" :alt="characterImportPreview.character.name" mode="aspectFill" />
						<view><text class="character-preview-name">{{ characterImportPreview.character.name }}</text><text>{{ characterImportPreview.character.sourceVersion.toUpperCase() }} · {{ formatAttachmentSize(characterImportPreview.source.byteSize) }}</text></view>
					</view>
					<text v-if="characterImportPreview.character.description" class="character-preview-description">{{ characterImportPreview.character.description }}</text>
					<view class="character-preview-facts">
						<view><text>问候语</text><text>{{ characterImportPreview.character.greetingCount }}</text></view>
						<view><text>世界书</text><text>{{ characterImportPreview.worldBook?.entryCount || 0 }} 条</text></view>
						<view><text>附加资源</text><text>{{ characterImportPreview.assets.length }}</text></view>
					</view>
					<view v-for="warning in characterImportPreview.warnings" :key="warning.code" class="character-import-warning"><AlertCircle :size="17" /><text>{{ warning.message }}</text></view>
					<button v-if="characterImportPreview.requiresSensitiveExtensionConfirmation" class="character-permission-row" :class="{ confirmed: characterImportConfirmed }" @click="characterImportConfirmed = !characterImportConfirmed">
						<view class="character-permission-check"><Check v-if="characterImportConfirmed" :size="14" /></view>
						<view><text>允许导入高级扩展数据</text><text>相关脚本保持禁用，不会执行</text></view>
					</button>
				</scroll-view>
				<view class="character-import-actions">
					<button class="secondary-button" :disabled="characterImportBusy" @click="commitCharacterPreview(false)">仅保存</button>
					<button class="primary-button" :disabled="characterImportBusy" @click="commitCharacterPreview(true)">{{ characterImportBusy ? '导入中...' : '导入并新建聊天' }}</button>
				</view>
			</view>
		</view>

		<input ref="worldBookInput" class="hidden-file-input" type="file" accept="application/json,.json" @change="handleWorldBookSelection" />
		<WorldBookManager
			:open="worldBookManagerOpen"
			:repository="services?.repository"
			:world-books="worldBookItems"
			:characters="characterItems"
			:busy="worldBookImportBusy"
			@update:open="worldBookManagerOpen = $event"
			@update:world-books="worldBookItems = $event"
			@changed="handleWorldBookChanged"
			@close="closeWorldBookManager"
			@import="openWorldBookPicker"
			@error="handleWorldBookManagerError"
		/>
		<view v-if="worldBookImportPreview" class="modal-backdrop world-book-backdrop" @click.self="closeWorldBookImportPreview">
			<view class="character-import-modal world-book-import-modal" role="dialog" aria-modal="true" aria-label="世界书导入预览">
				<view class="modal-heading"><text>导入世界书</text><button aria-label="关闭世界书预览" :disabled="worldBookImportBusy" @click="closeWorldBookImportPreview"><X :size="19" /></button></view>
				<scroll-view class="character-import-content world-book-import-content" scroll-y>
					<view class="world-book-preview-heading"><view class="world-book-preview-icon"><FileText :size="25" /></view><view><text>{{ worldBookImportPreview.worldBook.name }}</text><text>{{ worldBookSourceLabel(worldBookImportPreview.source.format) }} · {{ formatAttachmentSize(worldBookImportPreview.source.byteSize) }}</text></view></view>
					<text v-if="worldBookImportPreview.worldBook.description" class="character-preview-description">{{ worldBookImportPreview.worldBook.description }}</text>
					<view class="character-preview-facts world-book-preview-facts">
						<view><text>规则</text><text>{{ worldBookImportPreview.worldBook.entryCount }}</text></view>
						<view><text>常驻</text><text>{{ worldBookImportPreview.worldBook.constantEntryCount }}</text></view>
						<view><text>关键词</text><text>{{ worldBookImportPreview.worldBook.keywordEntryCount }}</text></view>
					</view>
					<view v-for="warning in worldBookImportPreview.warnings" :key="warning.code" class="character-import-warning"><AlertCircle :size="17" /><text>{{ warning.message }}</text></view>
					<view class="world-book-binding-section">
						<text class="world-book-binding-title">应用角色</text>
						<button class="world-book-binding-row world-book-binding-all" :class="{ selected: worldBookApplyToAll }" @click="setWorldBookApplyToAll"><view class="world-book-binding-check"><Check v-if="worldBookApplyToAll" :size="14" /></view><view><text>所有角色</text><text>也会自动应用到以后导入的角色</text></view></button>
						<button class="world-book-binding-row world-book-binding-all" :class="{ selected: !worldBookApplyToAll }" @click="setWorldBookApplyToSelected"><view class="world-book-binding-check"><Check v-if="!worldBookApplyToAll" :size="14" /></view><view><text>指定角色</text><text>可同时选择多个联系人</text></view></button>
						<view v-if="!worldBookApplyToAll" class="world-book-character-list">
							<button v-for="character in characterItems" :key="character.id" class="world-book-binding-row" :class="{ selected: worldBookSelectedCharacterIds.includes(character.id) }" @click="toggleWorldBookCharacter(character.id)"><ProviderLogo class="world-book-character-avatar" :src="character.avatarDataUrl || '/static/zhiyu-logo.png'" :alt="character.name" mode="aspectFill" /><text>{{ character.name }}</text><view class="world-book-binding-check"><Check v-if="worldBookSelectedCharacterIds.includes(character.id)" :size="14" /></view></button>
							<text v-if="!characterItems.length" class="world-book-no-characters">请先导入角色联系人，或选择“所有角色”</text>
						</view>
					</view>
					<button v-if="worldBookImportPreview.requiresSensitiveExtensionConfirmation" class="character-permission-row" :class="{ confirmed: worldBookImportConfirmed }" @click="worldBookImportConfirmed = !worldBookImportConfirmed">
						<view class="character-permission-check"><Check v-if="worldBookImportConfirmed" :size="14" /></view>
						<view><text>允许导入高级扩展数据</text><text>相关脚本保持禁用，不会执行</text></view>
					</button>
				</scroll-view>
				<view class="character-import-actions">
					<button class="secondary-button" :disabled="worldBookImportBusy" @click="closeWorldBookImportPreview">取消</button>
					<button class="primary-button" :disabled="worldBookImportBusy || (!worldBookApplyToAll && !worldBookSelectedCharacterIds.length)" @click="commitWorldBookPreview">{{ worldBookImportBusy ? '导入中...' : '保存世界书' }}</button>
				</view>
			</view>
		</view>

		<view v-if="backupMenuOpen" class="modal-backdrop backup-modal-backdrop" @click.self="closeBackupMenu">
			<view class="action-modal backup-transfer-modal" role="dialog" aria-modal="true" aria-label="导入与导出 JSON">
				<view class="modal-heading"><text>导入与导出</text><button aria-label="关闭" :disabled="backupBusy" @click="closeBackupMenu"><X :size="19" /></button></view>
				<scroll-view class="backup-transfer-content" scroll-y>
					<text class="backup-section-label">保存 JSON</text>
					<view class="backup-choice-grid">
						<button class="backup-choice" :disabled="backupBusy" @click="exportData"><view class="backup-choice-icon local"><Download :size="19" /></view><view><text>保存到本地</text><text>下载 JSON 文件</text></view></button>
						<button class="backup-choice" :disabled="backupBusy" @click="exportDataToCloud"><view class="backup-choice-icon cloud"><Cloud :size="19" /></view><view><text>保存到云端</text><text>{{ cloudConnected ? '生成下载链接' : '登录后可用' }}</text></view></button>
					</view>
					<view v-if="cloudExportUrl" class="backup-link-result">
						<text>云端下载链接</text>
						<view class="backup-link-field"><input :value="cloudExportUrl" readonly /><button aria-label="复制云端下载链接" @click="copyCloudExportLink"><Copy :size="17" /></button></view>
					</view>
					<text class="backup-section-label backup-import-label">导入 JSON</text>
					<button class="backup-local-import" :disabled="backupBusy" @click="chooseImportFile"><Upload :size="18" /><view><text>从本地文件导入</text><text>选择设备中的 JSON 文件</text></view><ChevronRight :size="17" /></button>
					<view class="backup-url-import">
						<input v-model="cloudImportUrl" :disabled="backupBusy" type="text" placeholder="粘贴云端 JSON 下载链接" confirm-type="done" @confirm="importDataFromLink" />
						<button :disabled="backupBusy || !cloudImportUrl.trim()" @click="importDataFromLink"><Import :size="17" /><text>{{ backupBusy ? '处理中' : '链接导入' }}</text></button>
					</view>
				</scroll-view>
				<input ref="backupFile" class="hidden-file-input" type="file" accept="application/json,.json" @change="importData" />
			</view>
		</view>
		<view v-if="cloudOpen" class="modal-backdrop cloud-modal-backdrop" @click.self="closeCloudModal"><view class="cloud-modal cloud-backup-card" role="dialog" aria-modal="true" aria-label="账号与云端配置">
			<view class="cloud-modal-heading"><view class="settings-icon cloud-status-icon"><Cloud :size="20" /></view><view class="settings-copy"><text>账号与云端</text><text>{{ cloudAccountLabel }}</text></view><view v-if="cloudConnected" class="enabled-status"><i /><text>已启用</text></view><button aria-label="关闭账号与云端" @click="closeCloudModal"><X :size="19" /></button></view>
			<scroll-view class="cloud-modal-content" scroll-y>
				<label class="cloud-field"><text>服务器</text><input v-model="cloudForm.baseUrl" :disabled="cloudBusy || cloudConnected" :placeholder="DEFAULT_CLOUD_BASE_URL" /></label>
				<view class="cloud-field"><text>{{ cloudConnected ? '用户名' : '本地用户名' }}</text><view class="cloud-username-editor"><input v-model="cloudForm.username" :disabled="cloudBusy" maxlength="32" :placeholder="cloudConnected ? '1-32 个字符' : '本地显示名称'" /><button :disabled="cloudBusy || !cloudForm.username.trim()" @click.stop="saveProfileUsername">保存</button></view></view>
				<label class="cloud-field"><text>邮箱</text><input v-model="cloudForm.email" :disabled="cloudBusy || cloudConnected" placeholder="name@example.com" /></label>
				<label v-if="!cloudConnected" class="cloud-field"><text>登录密码</text><input v-model="cloudForm.password" :disabled="cloudBusy" type="password" placeholder="至少 12 个字符" /></label>
				<label v-else class="cloud-field"><text>同步密码</text><view class="password-field"><input v-model="cloudForm.syncPassword" :disabled="cloudBusy" type="password" placeholder="用于加密云端备份" /><EyeOff :size="16" /></view></label>
				<view v-if="cloudConnected" class="cloud-auto-row"><view><text>自动同步</text><text>{{ cloudBackupStatus || '前台每 3 分钟增量同步' }}</text></view><button class="toggle" :class="{ enabled: autoBackupEnabled }" :disabled="cloudBusy" @click="toggleAutoBackup"><view class="toggle-thumb" /></button></view>
				<view v-if="!cloudConnected" class="cloud-actions"><button class="secondary-button" :disabled="cloudBusy" @click="registerCloud">注册</button><button class="primary-button" :disabled="cloudBusy" @click="loginCloud">登录</button></view>
				<view v-else class="cloud-actions cloud-actions-wrap"><button class="primary-button" :disabled="cloudBusy" @click="syncCloudNow">立即同步</button><button class="secondary-button" :disabled="cloudBusy" @click="uploadCloudBackup">完整备份</button><button class="secondary-button" :disabled="cloudBusy" @click="restoreCloudBackup">从云端恢复</button><button class="danger-button" :disabled="cloudBusy" @click="deleteCloudBackup">删除完整备份</button><button class="logout-button" :disabled="cloudBusy" @click="logoutCloud">退出登录</button></view>
			</scroll-view>
		</view></view>
		<view v-if="profileAvatarMenuOpen" class="modal-backdrop" @click.self="profileAvatarMenuOpen = false"><view class="action-modal"><view class="modal-heading"><text>头像</text><button aria-label="关闭头像菜单" @click="profileAvatarMenuOpen = false"><X :size="19" /></button></view><button class="modal-action" @click="chooseProfileAvatarSource('image')"><Image :size="19" /><text>从相册选择</text></button><button class="modal-action" @click="chooseProfileAvatarSource('camera')"><Camera :size="19" /><text>拍照</text></button><button v-if="profileAvatar" class="modal-action avatar-reset-action" @click="resetProfileAvatar"><Trash2 :size="18" /><text>恢复默认头像</text></button></view></view>
		<input ref="profileAvatarInput" class="hidden-file-input" type="file" accept="image/*" @change="handleProfileAvatarSelection" />
		<input ref="profileAvatarCameraInput" class="hidden-file-input" type="file" accept="image/*" capture="user" @change="handleProfileAvatarSelection" />
		<view v-if="providerAvatarMenuOpen" class="modal-backdrop provider-avatar-backdrop" @click.self="providerAvatarMenuOpen = false">
			<view class="action-modal provider-avatar-modal" role="dialog" aria-modal="true" aria-label="选择接口头像">
				<view class="modal-heading"><view><text>接口头像</text><text class="provider-avatar-modal-subtitle">自动识别或手动固定品牌</text></view><button aria-label="关闭接口头像选择" :disabled="providerAvatarBusy" @click="providerAvatarMenuOpen = false"><X :size="19" /></button></view>
				<scroll-view class="provider-avatar-modal-content" scroll-y>
					<button class="provider-avatar-auto-option" :class="{ selected: providerForm.avatar.mode === 'auto' }" @click="selectAutomaticProviderAvatar">
						<ProviderLogo class="provider-avatar-option-image" :src="automaticProviderAvatarSource" alt="自动识别头像" mode="aspectFit" />
						<view><text>自动识别</text><text>{{ automaticProviderAvatarLabel }}</text></view>
						<view class="provider-avatar-option-check"><Check v-if="providerForm.avatar.mode === 'auto'" :size="15" /></view>
					</button>
					<text class="provider-avatar-section-label">默认头像</text>
					<view class="provider-avatar-preset-grid">
						<button v-for="preset in providerAvatarPresets" :key="preset.id" class="provider-avatar-preset" :class="{ selected: providerForm.avatar.mode === 'preset' && providerForm.avatar.presetId === preset.id }" :aria-label="`使用 ${preset.label} 头像`" @click="selectProviderAvatarPreset(preset.id)">
							<view class="provider-avatar-preset-image-wrap"><ProviderLogo class="provider-avatar-preset-image" :src="preset.source" :alt="preset.label" mode="aspectFit" /><view v-if="providerForm.avatar.mode === 'preset' && providerForm.avatar.presetId === preset.id" class="provider-avatar-preset-check"><Check :size="12" /></view></view>
							<text>{{ preset.label }}</text>
						</button>
					</view>
					<button class="provider-avatar-custom-option" :class="{ selected: providerForm.avatar.mode === 'custom' }" :disabled="providerAvatarBusy" @click="chooseProviderCustomAvatar">
						<view class="provider-avatar-custom-icon"><Image :size="21" /></view>
						<view><text>从手机相册选择</text><text>图片会压缩后随接口保存</text></view>
						<RefreshCw v-if="providerAvatarBusy" class="spinning" :size="17" /><Check v-else-if="providerForm.avatar.mode === 'custom'" :size="17" />
					</button>
				</scroll-view>
			</view>
		</view>
		<input ref="providerAvatarInput" class="hidden-file-input" type="file" accept="image/*" @change="handleProviderAvatarSelection" />
		<view v-if="attachmentPreview" class="modal-backdrop attachment-preview-backdrop" @click.self="attachmentPreview = null">
			<view class="attachment-preview-modal">
				<view class="attachment-preview-header"><view><text>{{ attachmentPreview.attachment.name }}</text><text>{{ formatAttachmentSize(attachmentPreview.attachment.byteSize) }}</text></view><button v-if="attachmentPreview.kind === 'image'" :disabled="imageDownloadBusy" aria-label="保存预览图片" title="保存到相册" @click="downloadImageAttachment(attachmentPreview.attachment)"><Download :size="18" /></button><button aria-label="关闭附件预览" @click="attachmentPreview = null"><X :size="19" /></button></view>
				<view v-if="attachmentPreview.kind === 'image'" class="attachment-preview-image" :style="attachmentPreviewImageStyle(attachmentPreview.attachment)" />
				<scroll-view v-else class="attachment-preview-text" scroll-y><text selectable user-select>{{ attachmentPreview.attachment.textContent }}</text></scroll-view>
			</view>
		</view>
		<view v-if="assistantStatusOpen && latestAssistantStatus && assistantStatusOverview" class="modal-backdrop assistant-status-backdrop" @click.self="assistantStatusOpen = false">
			<view class="assistant-status-modal" role="dialog" aria-modal="true" aria-label="角色状态详情" @click.stop>
				<view class="assistant-status-grabber" aria-hidden="true" />
				<button class="assistant-status-close" aria-label="关闭角色状态" @click="assistantStatusOpen = false"><X :size="21" /></button>
				<view class="assistant-status-hero">
					<view class="assistant-status-hero-item"><text>当前状态</text><text>{{ assistantStatusOverview.primary }}</text></view>
					<view v-if="assistantStatusOverview.scoreValue" class="assistant-status-hero-item assistant-status-hero-score"><text>{{ assistantStatusOverview.scoreLabel || '好感度' }}</text><text>{{ assistantStatusOverview.scoreValue }}</text></view>
					<view v-if="assistantStatusOverview.location" class="assistant-status-hero-item"><text>当前位置</text><text>{{ assistantStatusOverview.location }}</text></view>
				</view>
				<view v-if="assistantStatusOverview.scorePercent !== null" class="assistant-status-progress-row">
					<progress class="assistant-status-progress" :value="assistantStatusOverview.scorePercent" :percent="assistantStatusOverview.scorePercent" max="100" :show-info="false" />
				</view>
				<scroll-view class="assistant-status-content" scroll-y>
					<view v-for="section in assistantStatusSections" :key="section.id" class="assistant-status-section" :class="{ 'is-private': section.label === '私密状态' }">
						<view class="assistant-status-section-heading"><Activity :size="14" /><text class="assistant-status-section-title">{{ section.label }}</text></view>
						<view v-if="section.items.length" class="assistant-status-items">
							<view v-for="(item, itemIndex) in section.items" :key="`${section.id}-${itemIndex}`" class="assistant-status-item"><text>{{ item.label }}</text><text selectable user-select>{{ item.value }}</text></view>
						</view>
						<text v-if="section.text" class="assistant-status-text" selectable user-select>{{ section.text }}</text>
					</view>
				</scroll-view>
			</view>
		</view>
		<view v-if="toastMessage" class="toast-message">{{ toastMessage }}</view>
		<view v-if="errorMessage" class="error-banner"><AlertCircle :size="16" /><text>{{ errorMessage }}</text><button v-if="initializationError" class="error-retry-button" @click="retryInitialization"><RefreshCw :size="14" /><text>重试</text></button><button v-else aria-label="关闭错误" @click="errorMessage = ''"><X :size="15" /></button></view>
	</view>
</template>

<script>
	import { markRaw } from 'vue'
	import {
		Activity, AlertCircle, ArrowLeft, Camera, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Cloud, Copy, Database,
		Contact, Download, EyeOff, FileCog, FileText, Image, Import, Info, KeyRound, LockKeyhole, MessageCircle, Mic,
		MoreVertical, Paperclip, Plus, RefreshCw, RotateCcw, Search, Send, Server, Settings,
		Square, ThumbsDown, ThumbsUp, Trash2, Upload, X
	} from '../../src/components/app-icons.js'
	import AppImage from '../../src/components/app-image.js'
	import CharacterContacts from '../../src/components/character-contacts.vue'
	import CharacterDetail from '../../src/components/character-detail.vue'
	import ProviderLogo from '../../src/components/provider-logo.js'
	import WorldBookManager from '../../src/components/world-book-manager.vue'
	import { createCloudServices } from '../../src/app/create-cloud-services.js'
	import { saveLocalProfileName, syncProfileNameFromCloudSession } from '../../src/app/create-character-instructions.js'
	import { createPlatformServices, createPlatformWorkspaceManager } from '../../src/app/create-platform-services.js'
	import { assistantStatusSectionsForDisplay, createAssistantStatusOverview, extractAssistantStatus } from '../../src/core/assistant-status.js'
	import { imageAttachmentSource } from '../../src/core/image-output.js'
	import { PROFILE_AVATAR_SETTING_KEY, createProfileAvatar, normalizeProfileAvatar } from '../../src/core/profile-avatar.js'
	import {
		PROVIDER_AVATAR_PRESETS, createAutomaticProviderAvatar, createProviderCustomAvatar, createProviderPresetAvatar,
		describeProviderAvatar, detectProviderAvatarPreset, resolveProviderAvatarSource
	} from '../../src/core/provider-avatar.js'
	import { PROVIDER_PROTOCOLS, getProviderProtocol } from '../../src/core/provider-protocol.js'
	import { REPLY_NOTIFICATION_SETTING_KEY } from '../../src/services/reply-notification-service.js'
	import { createImageExportFileName, createJsonExportFileName, downloadImageInBrowser, exportBytesToDownloads, exportTextToDownloads, saveImageToPhotoAlbum } from '../../src/platform/app/app-file-exporter.js'
	import { preserveServiceIdentity } from '../../src/app/vue-service-container.js'
	import { TEXT_ATTACHMENT_ACCEPT, formatAttachmentSize } from '../../src/core/attachment-policy.js'
	import { commitCharacterImport, inspectCharacterCard } from '../../src/features/character-import/importCharacterCard.js'
	import { createCharacterManager } from '../../src/features/character-management.js'
	import { applyCharacterEdits, createCustomCharacter } from '../../src/features/character-editor.js'
	import { commitWorldBookImport, inspectWorldBook } from '../../src/features/world-book-import/importWorldBook.js'
	import {
		applyFetchedModels, applyProviderModelSelection, applyProviderProtocolSelection, attachmentActions, canSendMessage, closeCharacterDetails as closeCharacterDetailsState,
		closeSettingsDetails, createInitialUiState, createProviderForm, isUserMessageRead, navigationItems,
		openCharacterDetails as openCharacterDetailsState, openConversation, openNsfwSettings, openSettingsDetails, selectTab, setGenerating,
		resolveAppBackAction, setGenerationMode, summarizeConversation, toggleAppLock
	} from '../../src/ui-state.js'

	const iconMap = markRaw({ MessageCircle, Contact, Server, Settings, Image, Camera, FileText })
	const COMPOSER_MIN_HEIGHT = 44
	const COMPOSER_MAX_HEIGHT = 132
	const COMPOSER_LINE_HEIGHT = 22
	const DEFAULT_CLOUD_BASE_URL = 'http://118.145.98.165:8018'
	const NSFW_SETTING_KEY = 'nsfwEnabled'
	const SETTINGS_SEARCH_ITEMS = [
		'对话设置 系统提示词 模型行为 动画效果', '账号与云端 登录 自动备份 同步', '隐私与安全 API 密钥 应用锁 加密 通知 回复提醒',
		'NSFW 设置 成人 私密状态 状态栏',
		'数据与存储 本地数据库 SQLite IndexedDB', '导入与导出 JSON 备份 恢复', '设备与诊断 Android 流式 日志',
		'关于应用 版本 信息', '检查更新 最新版本', '帮助与反馈 使用问题 问题反馈'
	]
	function getUniApi() { return typeof uni !== 'undefined' ? uni : globalThis.uni }
	function getBrowserWindow() { return typeof window !== 'undefined' ? window : null }

	export default {
		components: {
			Activity, AlertCircle, ArrowLeft, Camera, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Cloud, Copy, Database,
			Download, EyeOff, FileCog, FileText, Image, Import, Info, KeyRound, LockKeyhole, MessageCircle, Mic,
			MoreVertical, Paperclip, Plus, AppImage, CharacterContacts, CharacterDetail, ProviderLogo, WorldBookManager, RefreshCw, RotateCcw, Search, Send, Square,
			ThumbsDown, ThumbsUp, Trash2, Upload, X
		},
		data() {
			return {
				ui: createInitialUiState(), iconMap, navigationItems, attachmentActions, services: null, workspaceManager: null, ready: false, initializing: false, initializationError: '',
				conversationItems: [], characterItems: [], worldBookItems: [], providerItems: [], messageItems: [], animatedMessageIds: [], assistantStatusOpen: false, chatScrollIntoView: '', chatScrollRevision: 0, chatScrollTimer: null, searchQuery: '', searchOpen: false, homeMenuOpen: false, draftMessage: '', composerInputHeight: COMPOSER_MIN_HEIGHT,
				contactSearchQuery: '', contactSortMode: 'name', customCharacterDraft: null, customCharacterAvatar: null, characterDetailEditing: false, characterSaveBusy: false, pendingCharacterAvatarId: '',
				characterImportBusy: false, characterImportPreview: null, characterImportConfirmed: false,
				worldBookManagerOpen: false, worldBookImportBusy: false, worldBookImportPreview: null, worldBookImportConfirmed: false,
				worldBookApplyToAll: true, worldBookSelectedCharacterIds: [],
				pendingAttachments: [], attachmentProcessing: false, attachmentPreview: null, imageDownloadBusy: false,
				textAttachmentAccept: TEXT_ATTACHMENT_ACCEPT,
				modelMenuOpen: false, attachmentMenuOpen: false, emojiMenuOpen: false,
				emojiOptions: ['😀', '😂', '😊', '😍', '👍', '🙏', '🎉', '❤️'],
				providerForm: createProviderForm(), providerSaving: false,
				providerTesting: false, providerLoadingModels: false, connectionStatus: 'untested', showApiKey: false,
				providerAvatarPresets: PROVIDER_AVATAR_PRESETS, providerProtocols: PROVIDER_PROTOCOLS, providerAvatarMenuOpen: false, providerAvatarBusy: false,
				systemPromptOpen: false, systemPromptEnabled: false, systemPrompt: '', nsfwEnabled: false, nsfwSaving: false, backupMenuOpen: false, backupBusy: false,
				cloudExportUrl: '', cloudImportUrl: '',
				settingsSearchOpen: false, settingsSearchQuery: '', profileName: '', profileAvatar: null, profileAvatarMenuOpen: false, profileAvatarBusy: false,
				cloudOpen: false, cloudBusy: false, cloudServices: null, cloudSession: null, networkSyncHandler: null,
				autoBackupEnabled: false, cloudBackupStatus: '',
				replyNotificationsEnabled: true, replyNotificationAuthorized: false,
				cloudForm: { baseUrl: DEFAULT_CLOUD_BASE_URL, username: '', email: '', password: '', syncPassword: '' },
				toastMessage: '', toastTimer: null, errorMessage: ''
			}
		},
		computed: {
			DEFAULT_CLOUD_BASE_URL() { return DEFAULT_CLOUD_BASE_URL },
			storageLabel() { return this.services?.platform?.storage || 'IndexedDB' },
			encryptionLabel() { return this.services?.platform?.encryption || 'Web Crypto' },
			aboutLabel() { return this.services?.platform?.about || '浏览器本地版' },
			replyNotificationSupported() { return Boolean(this.services?.replyNotificationService?.supported) },
			replyNotificationLabel() {
				if (!this.replyNotificationSupported) return '仅 Android App 安装包可用'
				if (!this.replyNotificationsEnabled) return '已关闭'
				return this.replyNotificationAuthorized ? '离开当前会话或进入后台时提醒' : '系统通知权限未开启，点击去设置'
			},
			cloudConnected() { return Boolean(this.cloudSession?.access_token) },
			settingsProfileName() {
				const email = this.cloudSession?.user?.email || this.cloudForm.email
				const username = this.cloudConnected ? this.cloudSession?.user?.username : this.profileName
				return this.cloudConnected ? (username || (email ? email.split('@')[0] : '云端用户')) : (username || '本地用户')
			},
			cloudAccountLabel() { return this.cloudConnected ? this.settingsProfileName : '登录后自动加密备份' },
			settingsProfileSubtitle() {
				const email = this.cloudSession?.user?.email || this.cloudForm.email
				return this.cloudConnected && email ? email : '本地模式'
			},
			settingsProfileAvatarSource() { return this.profileAvatar?.dataUrl || this.activeProviderLogo },
			latestAssistantStatus() {
				for (let index = this.messageItems.length - 1; index >= 0; index -= 1) {
					const message = this.messageItems[index]
					if (message.role === 'assistant' && message.status === 'completed' && message.assistantStatus) {
						return { ...message.assistantStatus, messageId: message.id, updatedAt: message.updatedAt }
					}
				}
				return null
			},
			latestCompletedAssistantMessage() {
				for (let index = this.messageItems.length - 1; index >= 0; index -= 1) {
					const message = this.messageItems[index]
					if (message.role === 'assistant' && message.status === 'completed' && message.generationMode !== 'image') return message
				}
				return null
			},
			assistantStatusIssue() {
				const latestMessage = this.latestCompletedAssistantMessage
				if (!latestMessage || !this.latestAssistantStatus || latestMessage.id === this.latestAssistantStatus.messageId) return ''
				return /<\s*sumo_monitor\b/i.test(String(latestMessage.content ?? '')) ? '状态格式未识别' : '本轮未返回状态'
			},
			assistantStatusOverview() { return createAssistantStatusOverview(this.latestAssistantStatus) },
			assistantStatusSections() { return assistantStatusSectionsForDisplay(this.latestAssistantStatus, { showPrivate: this.nsfwEnabled }) },
			nsfwSettingLabel() { return this.nsfwEnabled ? '已开启，显示私密状态' : '已关闭，隐藏私密状态' },
			assistantStatusUpdateLabel() {
				if (this.assistantStatusIssue) return this.assistantStatusIssue
				const value = this.latestAssistantStatus?.updatedAt
				if (!value) return '已更新'
				const updatedAt = new Date(value)
				if (Number.isNaN(updatedAt.getTime())) return '已更新'
				const elapsed = Date.now() - updatedAt.getTime()
				if (elapsed >= 0 && elapsed < 120000) return '刚刚更新'
				if (elapsed >= 0 && elapsed < 3600000) return `${Math.max(1, Math.floor(elapsed / 60000))}分钟前`
				return `更新于 ${this.formatMessageTime(updatedAt)}`
			},
			settingsSearchHasResults() { return SETTINGS_SEARCH_ITEMS.some((item) => this.matchesSettingsSearch(item)) },
			activeNavigationIndex() {
				const index = this.navigationItems.findIndex((item) => item.id === this.ui.activeTab)
				return index < 0 ? 0 : index
			},
			filteredConversations() {
				const keyword = this.searchQuery.trim().toLowerCase()
				if (!keyword) return this.conversationItems
				return this.conversationItems.filter((item) => `${item.title} ${item.preview}`.toLowerCase().includes(keyword))
			},
			filteredCharacters() {
				const keyword = this.contactSearchQuery.trim().toLowerCase()
				const filtered = keyword
					? this.characterItems.filter(item => `${item.name} ${item.creator || ''} ${(item.tags || []).join(' ')}`.toLowerCase().includes(keyword))
					: [...this.characterItems]
				return filtered.sort((left, right) => this.contactSortMode === 'recent'
					? String(right.importedAt || '').localeCompare(String(left.importedAt || ''))
					: String(left.name || '').localeCompare(String(right.name || '')))
			},
			activeConversation() { return this.conversationItems.find((item) => item.id === this.ui.activeConversationId) || null },
			selectedCharacter() {
				if (this.customCharacterDraft?.id === this.ui.activeCharacterId) return this.customCharacterDraft
				return this.characterItems.find(item => item.id === this.ui.activeCharacterId) || null
			},
			activeCharacter() { return this.characterItems.find(item => item.id === this.activeConversation?.characterId) || null },
			activeProvider() { return this.providerItems.find((item) => item.id === this.activeConversation?.providerProfileId) || this.providerItems.find((item) => item.id === this.ui.activeProviderId) || null },
			activeProviderLogo() { return this.activeProvider?.logo || '/static/providers/openai.png' },
			activeAssistantAvatar() { return this.activeCharacter?.avatarDataUrl || this.activeProviderLogo },
			chatProviderName() { return this.activeCharacter?.name || this.activeProvider?.name || this.activeConversation?.providerNameSnapshot || 'AI 助手' },
			chatModelName() { return this.activeConversation?.modelName || this.activeProvider?.defaultModel || '选择模型' },
			chatHeader() { return this.activeConversation ? `${this.activeProvider?.name || this.activeConversation.providerNameSnapshot || '接口'} · ${this.activeConversation.modelName || '模型'}` : '选择接口' },
			providerModelOptions() {
				const models = Array.isArray(this.providerForm.modelsCache) ? this.providerForm.modelsCache.filter(Boolean) : []
				const current = String(this.providerForm.defaultModel ?? '').trim()
				return current && !models.includes(current) ? [current, ...models] : models
			},
			providerModelIndex() {
				const index = this.providerModelOptions.indexOf(String(this.providerForm.defaultModel ?? '').trim())
				return index < 0 ? 0 : index
			},
			activeProviderProtocol() { return getProviderProtocol(this.providerForm.protocolType) },
			providerFormAvatarSource() { return resolveProviderAvatarSource(this.providerForm) },
			providerFormAvatarDescription() { return describeProviderAvatar(this.providerForm) },
			automaticProviderAvatar() { return detectProviderAvatarPreset(this.providerForm) },
			automaticProviderAvatarSource() { return this.automaticProviderAvatar.source },
			automaticProviderAvatarLabel() { return `当前识别为 ${this.automaticProviderAvatar.label}` },
			canSend() { return canSendMessage(this.ui, this.draftMessage, Boolean(this.activeProvider), this.pendingAttachments.length, this.attachmentProcessing) },
			composerMultiline() { return this.composerInputHeight > COMPOSER_MIN_HEIGHT },
			providerBusy() { return !this.ready || this.providerSaving || this.providerTesting || this.providerLoadingModels }
		},
		watch: {
			draftMessage(value) {
				if (!value) {
					this.composerInputHeight = COMPOSER_MIN_HEIGHT
					return
				}
				this.$nextTick(() => this.resizeComposerInput())
			}
		},
		async mounted() {
			await this.initializeApp()
			this.bindNetworkSyncListener()
		},
		onShow() {
			this.services?.replyNotificationService?.setAppVisible(true)
			this.services?.replyNotificationService?.refreshPermission?.().then(authorized => {
				this.replyNotificationAuthorized = Boolean(authorized)
			}).catch(() => {})
			const pendingConversationId = this.services?.replyNotificationService?.takePendingConversationId?.()
			if (pendingConversationId) this.openReplyNotificationConversation(pendingConversationId)
			if (this.autoBackupEnabled && this.cloudConnected) {
				this.cloudServices?.syncCoordinator?.startForeground().catch(() => {})
			}
		},
		onHide() { this.services?.replyNotificationService?.setAppVisible(false); this.cloudServices?.syncCoordinator?.stopForeground(); this.cloudServices?.scheduler?.stop() },
		onBackPress() { return this.handleAppBack() },
		beforeUnmount() {
			clearTimeout(this.toastTimer)
			clearTimeout(this.chatScrollTimer)
			this.unbindNetworkSyncListener()
			const closeWorkspace = async () => {
				await this.stopCloudActivityAndWait()
				if (this.workspaceManager) await this.workspaceManager.close()
				else await this.services?.replyNotificationService?.dispose?.()
			}
			closeWorkspace().catch(() => {})
		},
		methods: {
			closeSettingsDetails,
			formatAttachmentSize,
			isUserMessageRead,
			openNsfwSettings,
			openSettingsDetails,
			setGenerationMode,
			handleAppBack() {
				if (this.ui.screen === 'character-detail' && this.characterSaveBusy) return true
				if (this.ui.screen === 'character-detail' && this.characterDetailEditing) {
					if (this.customCharacterDraft) this.closeCharacterDetailsView()
					else this.characterDetailEditing = false
					return true
				}
				if (this.attachmentPreview) {
					this.attachmentPreview = null
					return true
				}
				if (this.assistantStatusOpen) {
					this.assistantStatusOpen = false
					return true
				}
				if (this.profileAvatarMenuOpen) {
					this.profileAvatarMenuOpen = false
					return true
				}
				if (this.providerAvatarMenuOpen) {
					this.providerAvatarMenuOpen = false
					return true
				}
				if (this.cloudOpen) {
					this.closeCloudModal()
					return true
				}
				if (this.backupMenuOpen) {
					this.closeBackupMenu()
					return true
				}
				if (this.worldBookImportPreview) {
					this.closeWorldBookImportPreview()
					return true
				}
				if (this.worldBookManagerOpen) {
					this.closeWorldBookManager()
					return true
				}
				if (this.characterImportPreview) {
					this.closeCharacterImportPreview()
					return true
				}
				if (this.modelMenuOpen) {
					this.modelMenuOpen = false
					return true
				}
				if (this.attachmentMenuOpen || this.emojiMenuOpen) {
					this.closeComposerMenus()
					return true
				}
				if (this.homeMenuOpen) {
					this.homeMenuOpen = false
					return true
				}
				if (this.searchOpen) {
					this.toggleConversationSearch()
					return true
				}
				if (this.systemPromptOpen) {
					this.systemPromptOpen = false
					return true
				}
				if (this.settingsSearchOpen) {
					this.toggleSettingsSearch()
					return true
				}

				const action = resolveAppBackAction(this.ui)
				if (action === 'settings-overview') {
					this.closeSettingsDetails(this.ui)
					return true
				}
				if (action === 'contacts') {
					this.closeCharacterDetailsView()
					return true
				}
				if (action === 'conversations') {
					if (this.ui.screen === 'chat') this.backToConversations()
					else this.goToTab('conversations')
					return true
				}

				return false
			},
			toggleConversationSearch() {
				this.homeMenuOpen = false
				this.searchOpen = !this.searchOpen
				if (!this.searchOpen) this.searchQuery = ''
			},
			toggleHomeMenu() {
				this.searchOpen = false
				this.searchQuery = ''
				this.homeMenuOpen = !this.homeMenuOpen
			},
			async createConversationFromMenu() {
				this.homeMenuOpen = false
				await this.addConversation()
			},
			async refreshConversationsFromMenu() {
				this.homeMenuOpen = false
				await this.loadConversations()
				this.showToast('会话已刷新')
			},
			providerLogoSource(provider = {}) {
				return provider.logo || resolveProviderAvatarSource(provider)
			},
			conversationProviderLogo(conversation) {
				const character = this.characterItems.find(item => item.id === conversation?.characterId)
				if (character?.avatarDataUrl) return character.avatarDataUrl
				const provider = this.providerItems.find(item => item.id === conversation?.providerProfileId)
				return provider?.logo || this.providerLogoSource({ name: conversation?.providerNameSnapshot })
			},
			toggleContactSort() {
				this.contactSortMode = this.contactSortMode === 'name' ? 'recent' : 'name'
			},
			openCharacterDetailsView(character) {
				if (!character?.id) return
				this.customCharacterDraft = null
				this.customCharacterAvatar = null
				this.characterDetailEditing = false
				openCharacterDetailsState(this.ui, character.id)
			},
			openCustomCharacterEditor() {
				if (this.characterImportBusy || this.characterSaveBusy) return
				const draft = createCustomCharacter()
				this.customCharacterDraft = draft
				this.customCharacterAvatar = null
				this.characterDetailEditing = true
				openCharacterDetailsState(this.ui, draft.id)
			},
			cancelCharacterEditing() {
				if (this.customCharacterDraft) this.closeCharacterDetailsView()
				else this.characterDetailEditing = false
			},
			closeCharacterDetailsView() {
				if (this.characterSaveBusy) return
				this.customCharacterDraft = null
				this.customCharacterAvatar = null
				this.characterDetailEditing = false
				closeCharacterDetailsState(this.ui)
			},
			async saveCharacterDetails(form) {
				if (!this.selectedCharacter || this.characterSaveBusy) return
				const sourceCharacter = this.selectedCharacter
				const creating = this.customCharacterDraft?.id === sourceCharacter.id
				this.characterSaveBusy = true
				this.errorMessage = ''
				try {
					const updated = applyCharacterEdits(sourceCharacter, form)
					if (creating) {
						await this.characterManager().createCharacter(updated, { avatar: this.customCharacterAvatar })
					} else {
						await this.services.repository.saveCharacter(updated)
					}
					await this.loadCharacters()
					if (creating) {
						this.customCharacterDraft = null
						this.customCharacterAvatar = null
					}
					this.characterDetailEditing = false
					this.showToast(creating ? '角色已创建' : '角色卡已保存')
				} catch (error) {
					this.handleError(error, '角色卡保存失败')
				} finally {
					this.characterSaveBusy = false
				}
			},
			characterManager() {
				return createCharacterManager({
					repository: this.services?.repository,
					convertAvatarToPng: avatar => this.convertCharacterAvatarToPng(avatar)
				})
			},
			convertCharacterAvatarToPng(avatar) {
				const browserWindow = getBrowserWindow()
				const documentApi = browserWindow?.document || (typeof document !== 'undefined' ? document : null)
				const ImageConstructor = browserWindow?.Image || globalThis.Image
				if (!documentApi?.createElement || typeof ImageConstructor !== 'function') {
					throw new Error('当前运行环境无法把头像转换为 PNG，请先更换为 PNG 头像')
				}
				return new Promise((resolve, reject) => {
					const image = new ImageConstructor()
					image.onload = () => {
						try {
							const canvas = documentApi.createElement('canvas')
							canvas.width = avatar.width
							canvas.height = avatar.height
							const context = canvas.getContext?.('2d')
							if (!context) throw new Error('图片转换画布不可用')
							context.drawImage(image, 0, 0, avatar.width, avatar.height)
							resolve({ dataUrl: canvas.toDataURL('image/png'), name: avatar.sourceName || 'avatar.png' })
						} catch (error) { reject(error) }
					}
					image.onerror = () => reject(new Error('头像图片解码失败'))
					image.src = avatar.dataUrl
				})
			},
			async requestCharacterAvatarChange({ characterId, source } = {}) {
				if (!characterId || !['gallery', 'file'].includes(source) || this.characterSaveBusy) return
				this.pendingCharacterAvatarId = characterId
				if (this.services?.nativeAttachmentPicker) {
					this.characterSaveBusy = true
					try {
						const prepared = await this.services.nativeAttachmentPicker.pick(source === 'gallery' ? 'image' : 'image-file', { maxCount: 1 })
						if (prepared[0]) await this.persistCharacterAvatar(prepared[0])
					} catch (error) {
						this.handleError(error, '角色头像设置失败')
					} finally {
						this.characterSaveBusy = false
						this.pendingCharacterAvatarId = ''
					}
					return
				}
				this.$nextTick(() => {
					const target = this.$refs.characterAvatarInput
					const input = Array.isArray(target) ? target[0] : target
					if (input?.click) input.click()
					else {
						this.pendingCharacterAvatarId = ''
						this.handleError(new Error('当前环境无法打开图片选择器'), '角色头像设置失败')
					}
				})
			},
			async handleCharacterAvatarSelection(event) {
				const input = event?.target
				if (!input?.files?.length || !this.pendingCharacterAvatarId || this.characterSaveBusy) return
				this.characterSaveBusy = true
				try {
					const prepared = await this.services.attachmentService.prepareFiles(input.files, { existing: [] })
					if (prepared[0]) await this.persistCharacterAvatar(prepared[0])
				} catch (error) {
					this.handleError(error, '角色头像设置失败')
				} finally {
					this.characterSaveBusy = false
					this.pendingCharacterAvatarId = ''
					input.value = ''
				}
			},
			async persistCharacterAvatar(avatar) {
				if (avatar?.kind && avatar.kind !== 'image') throw new Error('请选择图片文件')
				if (this.customCharacterDraft?.id === this.pendingCharacterAvatarId) {
					if (!avatar?.dataUrl) throw new Error('图片数据无效')
					this.customCharacterAvatar = avatar
					this.customCharacterDraft = { ...this.customCharacterDraft, avatarDataUrl: avatar.dataUrl }
					this.showToast('头像已选择，创建角色时保存')
					return
				}
				await this.characterManager().applyAvatar(this.pendingCharacterAvatarId, avatar)
				await Promise.all([this.loadCharacters(), this.loadConversations()])
				this.showToast('角色头像已更新')
			},
			async exportCharacterJson({ characterId } = {}) {
				const character = this.characterItems.find(item => item.id === characterId)
				if (!character || this.characterSaveBusy) return
				this.characterSaveBusy = true
				try {
					const exported = await this.characterManager().exportJson(character)
					const plusApi = typeof plus !== 'undefined' ? plus : null
					if (plusApi?.io?.requestFileSystem) {
						await exportTextToDownloads({ plusApi, fileName: exported.fileName, content: exported.content })
						this.showToast('角色卡 JSON 已保存到下载目录')
					} else {
						if (typeof Blob !== 'function' || typeof URL === 'undefined' || typeof document === 'undefined') throw new Error('当前环境不支持文件导出')
						const url = URL.createObjectURL(new Blob([exported.content], { type: exported.mimeType }))
						const anchor = document.createElement('a')
						anchor.href = url
						anchor.download = exported.fileName
						anchor.click()
						URL.revokeObjectURL(url)
						this.showToast('角色卡 JSON 下载已开始')
					}
				} catch (error) { this.handleError(error, '角色卡 JSON 导出失败') }
				finally { this.characterSaveBusy = false }
			},
			async exportCharacterPng({ characterId } = {}) {
				const character = this.characterItems.find(item => item.id === characterId)
				if (!character || this.characterSaveBusy) return
				this.characterSaveBusy = true
				try {
					const plusApi = typeof plus !== 'undefined' ? plus : null
					const exported = await this.characterManager().exportPng(character, { includeDataUrl: !plusApi })
					if (plusApi?.io?.requestFileSystem) {
						await exportBytesToDownloads({ plusApi, fileName: exported.fileName, bytes: exported.bytes, mimeType: exported.mimeType })
						this.showToast('角色卡 PNG 已原样保存到下载目录')
					} else {
						downloadImageInBrowser({ documentApi: typeof document !== 'undefined' ? document : null, fileName: exported.fileName, dataUrl: exported.dataUrl })
						this.showToast('角色卡 PNG 下载已开始')
					}
				} catch (error) { this.handleError(error, '角色卡 PNG 导出失败') }
				finally { this.characterSaveBusy = false }
			},
			async deleteCharacterFromDetails({ characterId } = {}) {
				if (!characterId || this.characterSaveBusy) return
				this.characterSaveBusy = true
				try {
					await this.characterManager().deleteCharacter(characterId)
					this.customCharacterDraft = null
					this.characterDetailEditing = false
					closeCharacterDetailsState(this.ui)
					await Promise.all([this.loadCharacters(), this.loadWorldBooks(), this.loadConversations()])
					this.showToast('角色已删除，历史会话已保留')
				} catch (error) { this.handleError(error, '角色删除失败') }
				finally { this.characterSaveBusy = false }
			},
			async startCharacterChatFromDetails() {
				if (!this.selectedCharacter || this.characterSaveBusy) return
				await this.startCharacterChat(this.selectedCharacter)
			},
			async loadCharacters() {
				if (!this.services?.repository?.listCharacters) return
				const characters = await this.services.repository.listCharacters()
				this.characterItems = await Promise.all(characters.map(async character => {
					const avatar = character.avatarAssetId
						? await this.services.repository.getCharacterAsset(character.avatarAssetId)
						: null
					return { ...character, avatarDataUrl: avatar?.dataUrl || avatar?.sourceUrl || '' }
				}))
			},
			async loadWorldBooks() {
				if (!this.services?.repository?.listAllWorldBooks) return
				this.worldBookItems = (await this.services.repository.listAllWorldBooks())
					.filter(book => book.scope === 'global' && !book.deletedAt)
					.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
			},
			openWorldBookManager() {
				if (this.worldBookImportBusy) return
				this.loadWorldBooks().catch(error => this.handleError(error, '世界书加载失败'))
				this.worldBookManagerOpen = true
			},
			closeWorldBookManager() {
				if (!this.worldBookImportBusy) this.worldBookManagerOpen = false
			},
			async handleWorldBookChanged(event) {
				await Promise.all([this.loadWorldBooks(), this.loadCharacters()])
				const labels = { created: '世界书已创建', updated: '世界书已保存', deleted: '世界书已删除' }
				this.showToast(labels[event?.type] || '世界书已更新')
			},
			handleWorldBookManagerError(error) {
				this.handleError(error, '世界书操作失败')
			},
			worldBookEntryCount(book) { return Array.isArray(book?.data?.entries) ? book.data.entries.length : 0 },
			worldBookBindingLabel(book) {
				const characterIds = Array.isArray(book?.characterIds) ? book.characterIds : []
				if (!characterIds.length) return '所有角色'
				const names = characterIds
					.map(id => this.characterItems.find(character => character.id === id)?.name)
					.filter(Boolean)
				if (!names.length) return `${characterIds.length} 个角色`
				return names.length <= 2 ? names.join('、') : `${names.slice(0, 2).join('、')}等 ${names.length} 个角色`
			},
			worldBookSourceLabel(format) { return format === 'sillytavern' ? 'SillyTavern' : 'Character Book' },
			openWorldBookPicker() {
				if (this.worldBookImportBusy) return
				if (this.services?.nativeWorldBookPicker) {
					this.pickNativeWorldBook()
					return
				}
				this.$nextTick(() => {
					const target = this.$refs.worldBookInput
					const input = Array.isArray(target) ? target[0] : target
					if (input?.click) input.click()
					else this.handleError(new Error('当前环境无法打开世界书文件选择器'), '世界书选择失败')
				})
			},
			async pickNativeWorldBook() {
				this.worldBookImportBusy = true
				this.errorMessage = ''
				try {
					const file = await this.services.nativeWorldBookPicker.pick()
					if (file) await this.inspectSelectedWorldBook(file)
					else this.worldBookManagerOpen = true
				} catch (error) {
					this.worldBookManagerOpen = true
					this.handleError(error, '世界书识别失败')
				} finally {
					this.worldBookImportBusy = false
				}
			},
			async handleWorldBookSelection(event) {
				const input = event?.target
				const file = input?.files?.[0]
				if (!file || this.worldBookImportBusy) {
					this.worldBookManagerOpen = true
					return
				}
				this.worldBookImportBusy = true
				this.errorMessage = ''
				try {
					await this.inspectSelectedWorldBook(file)
				} catch (error) {
					this.worldBookManagerOpen = true
					this.handleError(error, '世界书识别失败')
				} finally {
					this.worldBookImportBusy = false
					if (input) input.value = ''
				}
			},
			async inspectSelectedWorldBook(file) {
				this.worldBookImportPreview = markRaw(await inspectWorldBook(file))
				this.worldBookManagerOpen = false
				this.worldBookImportConfirmed = !this.worldBookImportPreview.requiresSensitiveExtensionConfirmation
				this.worldBookApplyToAll = true
				this.worldBookSelectedCharacterIds = []
			},
			closeWorldBookImportPreview() {
				if (this.worldBookImportBusy) return
				this.worldBookImportPreview = null
				this.worldBookImportConfirmed = false
				this.worldBookSelectedCharacterIds = []
				this.worldBookManagerOpen = true
			},
			setWorldBookApplyToAll() {
				this.worldBookApplyToAll = true
				this.worldBookSelectedCharacterIds = []
			},
			setWorldBookApplyToSelected() { this.worldBookApplyToAll = false },
			toggleWorldBookCharacter(characterId) {
				const selected = this.worldBookSelectedCharacterIds.includes(characterId)
				this.worldBookSelectedCharacterIds = selected
					? this.worldBookSelectedCharacterIds.filter(id => id !== characterId)
					: [...this.worldBookSelectedCharacterIds, characterId]
			},
			async commitWorldBookPreview() {
				if (!this.worldBookImportPreview || this.worldBookImportBusy) return
				if (this.worldBookImportPreview.requiresSensitiveExtensionConfirmation && !this.worldBookImportConfirmed) {
					this.showToast('请先确认高级扩展将保持禁用')
					return
				}
				if (!this.worldBookApplyToAll && !this.worldBookSelectedCharacterIds.length) {
					this.showToast('请至少选择一个角色')
					return
				}
				this.worldBookImportBusy = true
				this.errorMessage = ''
				try {
					await commitWorldBookImport(this.worldBookImportPreview, {
						repository: this.services.repository,
						characterIds: this.worldBookApplyToAll ? [] : this.worldBookSelectedCharacterIds,
						allowSensitiveExtensions: this.worldBookImportConfirmed
					})
					this.worldBookImportPreview = null
					this.worldBookImportConfirmed = false
					this.worldBookSelectedCharacterIds = []
					await Promise.all([this.loadWorldBooks(), this.loadCharacters()])
					this.worldBookManagerOpen = true
					this.showToast('世界书已保存并启用')
				} catch (error) {
					this.handleError(error, '世界书导入失败')
				} finally {
					this.worldBookImportBusy = false
				}
			},
			openCharacterCardPicker(source = 'file') {
				if (this.characterImportBusy) return
				if (this.services?.nativeCharacterCardPicker) {
					this.pickNativeCharacterCard(source)
					return
				}
				this.$nextTick(() => {
					const target = this.$refs.characterCardInput
					const input = Array.isArray(target) ? target[0] : target
					if (input?.click) input.click()
					else this.handleError(new Error('当前环境无法打开角色卡文件选择器'), '角色卡选择失败')
				})
			},
			async pickNativeCharacterCard(source) {
				this.characterImportBusy = true
				this.errorMessage = ''
				try {
					const file = await this.services.nativeCharacterCardPicker.pick(source)
					if (file) await this.inspectSelectedCharacterCard(file)
				} catch (error) {
					this.handleError(error, '角色卡识别失败')
				} finally {
					this.characterImportBusy = false
				}
			},
			async handleCharacterCardSelection(event) {
				const input = event?.target
				const file = input?.files?.[0]
				if (!file || this.characterImportBusy) return
				this.characterImportBusy = true
				this.errorMessage = ''
				try {
					await this.inspectSelectedCharacterCard(file)
				} catch (error) {
					this.handleError(error, '角色卡识别失败')
				} finally {
					this.characterImportBusy = false
					if (input) input.value = ''
				}
			},
			async inspectSelectedCharacterCard(file) {
				this.characterImportPreview = markRaw(await inspectCharacterCard(file))
				this.characterImportConfirmed = !this.characterImportPreview.requiresSensitiveExtensionConfirmation
			},
			closeCharacterImportPreview() {
				if (this.characterImportBusy) return
				this.characterImportPreview = null
				this.characterImportConfirmed = false
			},
			async commitCharacterPreview(openChatAfterImport) {
				if (!this.characterImportPreview || this.characterImportBusy) return
				if (this.characterImportPreview.requiresSensitiveExtensionConfirmation && !this.characterImportConfirmed) {
					this.showToast('请先确认高级扩展将保持禁用')
					return
				}
				this.characterImportBusy = true
				this.errorMessage = ''
				try {
					const result = await commitCharacterImport(this.characterImportPreview, {
						repository: this.services.repository,
						allowSensitiveExtensions: this.characterImportConfirmed
					})
					this.characterImportPreview = null
					this.characterImportConfirmed = false
					await this.loadCharacters()
					if (openChatAfterImport) await this.startCharacterChat(result.character)
					else this.showToast(result.duplicateOfCharacterIds.length ? '已另存为新角色联系人' : '角色已保存到联系人')
				} catch (error) {
					this.handleError(error, '角色卡导入失败')
				} finally {
					this.characterImportBusy = false
				}
			},
			async startCharacterChat(character) {
				if (!character) return
				try {
					const provider = this.providerItems.find(item => item.id === this.ui.activeProviderId) || this.providerItems[0]
					if (!provider) { this.goToTab('providers'); throw new Error('请先添加一个模型接口') }
					const conversation = await this.services.chatService.createCharacterConversation({
						characterId: character.id,
						providerProfileId: provider.id,
						providerNameSnapshot: provider.name,
						modelName: provider.defaultModel
					})
					await this.loadConversations()
					await this.openChat(conversation.id)
				} catch (error) {
					this.handleError(error, '新建角色聊天失败')
				}
			},
			resizeComposerInput(event) {
				const lineCount = Number(event?.detail?.lineCount)
				if (Number.isFinite(lineCount) && lineCount > 0) {
					this.composerInputHeight = Math.min(COMPOSER_MAX_HEIGHT, COMPOSER_MIN_HEIGHT + (lineCount - 1) * COMPOSER_LINE_HEIGHT)
					return
				}

				const ref = Array.isArray(this.$refs.composerInput) ? this.$refs.composerInput[0] : this.$refs.composerInput
				const textarea = ref?.tagName === 'TEXTAREA' ? ref : ref?.$el?.querySelector?.('textarea')
				if (!textarea || typeof textarea.scrollHeight !== 'number') return

				textarea.style.height = `${COMPOSER_MIN_HEIGHT}px`
				const nextHeight = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, Math.ceil(textarea.scrollHeight)))
				textarea.style.height = `${nextHeight}px`
				this.composerInputHeight = nextHeight
			},
			toggleModelMenu() { this.closeComposerMenus(); this.modelMenuOpen = !this.modelMenuOpen },
			setChatGenerationMode() { setGenerationMode(this.ui, 'chat') },
			setImageGenerationMode() {
				if (this.pendingAttachments.length) { this.showToast('生图模式暂不支持输入附件'); return }
				setGenerationMode(this.ui, 'image')
			},
			closeComposerMenus() { this.attachmentMenuOpen = false; this.emojiMenuOpen = false },
			toggleAttachmentMenu() { this.modelMenuOpen = false; this.emojiMenuOpen = false; this.attachmentMenuOpen = !this.attachmentMenuOpen },
			toggleEmojiMenu() { this.modelMenuOpen = false; this.attachmentMenuOpen = false; this.emojiMenuOpen = !this.emojiMenuOpen },
			appendEmoji(emoji) { this.draftMessage += emoji; this.emojiMenuOpen = false },
			chooseAttachmentAction(action) {
				this.closeComposerMenus()
				if (this.services?.nativeAttachmentPicker) {
					this.handleNativeAttachmentAction(action)
					return
				}
				this.$nextTick(() => {
					const target = this.$refs[action?.inputRef]
					const ref = Array.isArray(target) ? target[0] : target
					const input = ref?.type ? ref : ref?.$el?.querySelector?.('input')
					if (input?.type === 'file') {
						input.click()
						return
					}
					this.openNativeAttachmentPicker(action)
				})
			},
			async handleNativeAttachmentAction(action) {
				if (this.attachmentProcessing) return
				this.attachmentProcessing = true
				this.errorMessage = ''
				try {
					const prepared = await this.services.nativeAttachmentPicker.pick(action?.id, { existing: this.pendingAttachments })
					this.pendingAttachments = [...this.pendingAttachments, ...prepared]
				} catch (error) {
					this.handleError(error, '附件处理失败')
				} finally {
					this.attachmentProcessing = false
				}
			},
			openNativeAttachmentPicker(action) {
				if (typeof document === 'undefined') {
					this.handleError(new Error('当前 App 运行环境需要原生文件选择适配器'), '附件选择失败')
					return
				}
				const nativeInput = document.createElement('input')
				nativeInput.type = 'file'
				nativeInput.accept = action?.id === 'file' ? this.textAttachmentAccept : 'image/*'
				nativeInput.multiple = action?.id !== 'camera'
				if (action?.id === 'camera') nativeInput.setAttribute('capture', 'environment')
				nativeInput.style.display = 'none'
				document.body.appendChild(nativeInput)
				let cleanupTimer = 0
				const cleanup = () => {
					clearTimeout(cleanupTimer)
					nativeInput.remove()
				}
				nativeInput.addEventListener('change', event => {
					Promise.resolve(this.handleAttachmentSelection(event)).finally(cleanup)
				}, { once: true })
				nativeInput.addEventListener('cancel', cleanup, { once: true })
				cleanupTimer = setTimeout(cleanup, 5 * 60 * 1000)
				nativeInput.click()
			},
			async handleAttachmentSelection(event) {
				const input = event?.target
				const files = input?.files
				if (!files?.length || this.attachmentProcessing) return
				this.attachmentProcessing = true
				this.errorMessage = ''
				try {
					const prepared = await this.services.attachmentService.prepareFiles(files, { existing: this.pendingAttachments })
					this.pendingAttachments = [...this.pendingAttachments, ...prepared]
				} catch (error) {
					this.handleError(error, '附件处理失败')
				} finally {
					this.attachmentProcessing = false
					if (input) input.value = ''
				}
			},
			removePendingAttachment(index) {
				if (this.attachmentProcessing) return
				this.pendingAttachments.splice(index, 1)
			},
			imageAttachments(message) { return (message?.attachments || []).filter(attachment => attachment.kind === 'image') },
			textAttachments(message) { return (message?.attachments || []).filter(attachment => attachment.kind === 'text') },
			attachmentSource: imageAttachmentSource,
			attachmentPreviewImageStyle(attachment) { return { backgroundImage: `url(${this.attachmentSource(attachment)})` } },
			previewImageAttachment(attachment) { this.attachmentPreview = { kind: 'image', attachment } },
			previewTextAttachment(attachment) { this.attachmentPreview = { kind: 'text', attachment } },
			async downloadImageAttachment(attachment) {
				if (this.imageDownloadBusy) return
				this.imageDownloadBusy = true
				this.errorMessage = ''
				try {
					const fileName = createImageExportFileName(attachment)
					const plusApi = typeof plus !== 'undefined' ? plus : null
					if (plusApi) {
						await saveImageToPhotoAlbum({
							plusApi,
							uniApi: getUniApi(),
							fileName,
							dataUrl: attachment?.dataUrl,
							sourceUrl: attachment?.sourceUrl
						})
						this.showToast('图片已保存到系统相册')
					} else {
						downloadImageInBrowser({
							documentApi: typeof document !== 'undefined' ? document : null,
							fileName,
							dataUrl: attachment?.dataUrl,
							sourceUrl: attachment?.sourceUrl
						})
						this.showToast('图片下载已开始')
					}
				} catch (error) {
					this.handleError(error, '保存图片失败')
				} finally {
					this.imageDownloadBusy = false
				}
			},
			async initializeApp() {
				if (this.initializing) return
				this.initializing = true
				this.ready = false
				this.initializationError = ''
				this.errorMessage = ''
				try {
					this.workspaceManager = markRaw(await createPlatformWorkspaceManager({ accountNamespace: DEFAULT_CLOUD_BASE_URL }))
					const opened = await this.workspaceManager.openFromStoredSession()
					this.services = preserveServiceIdentity(opened.services)
					this.cloudSession = opened.session
					await this.loadWorkspaceSettings()
					await this.reloadWorkspaceData()
					this.ready = true
					await this.initializeReplyNotifications()
					if (this.cloudSession && this.autoBackupEnabled) this.cloudServices?.syncCoordinator?.startForeground().catch(() => {})
				} catch (error) {
					this.initializationError = error?.message || '未知初始化错误'
					this.handleError(error, '初始化失败')
				} finally {
					this.initializing = false
				}
			},
			async loadWorkspaceSettings() {
				await this.loadProfileAvatar()
				const app = await this.services.repository.getSetting('app', { appLockEnabled: false })
				this.ui.appLockEnabled = Boolean(app.appLockEnabled)
				this.replyNotificationsEnabled = Boolean(await this.services.repository.getSetting(REPLY_NOTIFICATION_SETTING_KEY, true))
				this.nsfwEnabled = Boolean(await this.services.repository.getSetting(NSFW_SETTING_KEY, false))
				const prompt = await this.services.repository.getSetting('systemPrompt', { enabled: false, encryptedValue: null })
				this.systemPromptEnabled = Boolean(prompt.enabled)
				this.systemPrompt = prompt.encryptedValue ? await this.services.vault.decryptString(prompt.encryptedValue) : ''
				const sessionBaseUrl = this.cloudSession?.cloud_base_url || DEFAULT_CLOUD_BASE_URL
				const cloudConfig = await this.services.repository.getSetting('cloudConfig', { baseUrl: sessionBaseUrl, email: '' })
				this.cloudForm.baseUrl = cloudConfig.baseUrl || sessionBaseUrl
				this.cloudForm.email = cloudConfig.email || this.cloudSession?.user?.email || ''
				this.autoBackupEnabled = Boolean(await this.services.repository.getSetting('cloudAutoBackup', false))
				await this.stopCloudActivityAndWait()
				this.cloudServices = this.cloudForm.baseUrl ? this.buildCloudServices(this.cloudForm.baseUrl) : null
				this.cloudSession = await this.services.tokenStore?.load?.() || this.cloudSession
				await this.syncCloudUsernameFromSession()
			},
			async reloadWorkspaceData() {
				this.resetWorkspaceViewState()
				await this.loadProviders()
				if (!this.providerItems.length) {
					await this.services.providerService.saveProvider({ name: 'OpenAI 官方', baseUrl: 'https://api.openai.com/v1', apiKey: '', defaultModel: 'gpt-4o-mini' })
					await this.loadProviders()
				}
				this.ui.activeProviderId = this.providerItems[0]?.id || null
				this.providerForm = createProviderForm(this.providerItems[0])
				await Promise.all([this.loadCharacters(), this.loadWorldBooks(), this.loadConversations()])
				if (!this.conversationItems.length && this.providerItems[0]) await this.addConversation(false)
			},
			resetWorkspaceViewState() {
				this.ui.activeConversationId = null
				this.ui.activeCharacterId = null
				this.ui.generating = false
				this.messageItems = []
				this.conversationItems = []
				this.characterItems = []
				this.worldBookItems = []
				this.providerItems = []
				this.pendingAttachments = []
				this.assistantStatusOpen = false
				this.customCharacterDraft = null
				this.characterDetailEditing = false
			},
			async activateWorkspaceForSession(session) {
				if (!this.workspaceManager) return
				const previousCloud = this.cloudServices
				await this.stopCloudActivityAndWait(previousCloud)
				const services = await this.workspaceManager.switchToSession(session, {
					beforeClose: () => this.stopCloudActivityAndWait(previousCloud)
				})
				this.services = preserveServiceIdentity(services)
				this.cloudServices = null
				this.cloudSession = session
				await this.loadWorkspaceSettings()
				await this.reloadWorkspaceData()
				await this.initializeReplyNotifications()
			},
			async activateLocalWorkspace() {
				if (!this.workspaceManager) return
				const previousCloud = this.cloudServices
				await this.stopCloudActivityAndWait(previousCloud)
				const services = await this.workspaceManager.switchToLocal({
					beforeClose: () => this.stopCloudActivityAndWait(previousCloud)
				})
				this.services = preserveServiceIdentity(services)
				this.cloudServices = null
				this.cloudSession = null
				await this.loadWorkspaceSettings()
				await this.reloadWorkspaceData()
				await this.initializeReplyNotifications()
			},
			retryInitialization() { return this.initializeApp() },
			providerServiceOrThrow() {
				const providerService = this.services?.providerService
				if (providerService) return providerService
				if (this.initializing) throw new Error('应用正在初始化，请稍后重试')
				throw new Error(this.initializationError || '应用初始化失败，请点击重试')
			},
			async loadProviders() {
				this.providerItems = (await this.providerServiceOrThrow().listProviders()).map(item => ({ ...item, logo: this.providerLogoSource(item) }))
			},
			async loadConversations() {
				if (!this.services) return
				const conversations = await this.services.repository.listConversations()
				this.conversationItems = await Promise.all(conversations.map(async (conversation) => {
					const messages = await this.services.repository.listMessages(conversation.id)
					return summarizeConversation(conversation, messages[messages.length - 1])
				}))
			},
			decorateChatMessage(message) {
				const rawContent = String(message?.content ?? '')
				if (message?.role !== 'assistant') {
					return { ...message, displayContent: rawContent, assistantStatus: null }
				}
				const extracted = extractAssistantStatus(rawContent, { hideIncomplete: message.status === 'generating' })
				return { ...message, displayContent: extracted.content, assistantStatus: extracted.status }
			},
			async openChat(conversationId) {
				this.homeMenuOpen = false
				openConversation(this.ui, conversationId)
				this.services?.replyNotificationService?.setActiveConversationId(conversationId)
				this.animatedMessageIds = []
				this.assistantStatusOpen = false
				const messages = await this.services.repository.listMessages(conversationId)
				this.messageItems = await Promise.all(messages.map(async message => {
					if (!message.attachmentIds?.length) return this.decorateChatMessage({ ...message, attachments: [] })
					const attachments = await this.services.repository.listMessageAttachments(message.id)
					const attachmentsById = new Map(attachments.map(attachment => [attachment.id, attachment]))
					return this.decorateChatMessage({ ...message, attachments: message.attachmentIds.map(id => attachmentsById.get(id)).filter(Boolean) })
				}))
				this.modelMenuOpen = false
				this.closeComposerMenus()
				this.scrollChatToBottom()
			},
			backToConversations() { this.closeComposerMenus(); this.assistantStatusOpen = false; this.services?.replyNotificationService?.setActiveConversationId(null); selectTab(this.ui, 'conversations'); this.loadConversations() },
			goToTab(tab) {
				this.closeComposerMenus(); this.homeMenuOpen = false; this.characterDetailEditing = false; this.services?.replyNotificationService?.setActiveConversationId(null); selectTab(this.ui, tab); this.modelMenuOpen = false
				if (tab === 'contacts') Promise.all([this.loadCharacters(), this.loadWorldBooks()]).catch(error => this.handleError(error, '联系人加载失败'))
			},
			toggleSettingsSearch() {
				this.settingsSearchOpen = !this.settingsSearchOpen
				if (!this.settingsSearchOpen) this.settingsSearchQuery = ''
			},
			openProfileAvatarMenu() {
				if (!this.ready || this.profileAvatarBusy) return
				this.profileAvatarMenuOpen = true
			},
			chooseProfileAvatarSource(mode) {
				if (!['image', 'camera'].includes(mode) || this.profileAvatarBusy) return
				this.profileAvatarMenuOpen = false
				if (this.services?.nativeAttachmentPicker) {
					this.pickNativeProfileAvatar(mode)
					return
				}
				this.$nextTick(() => {
					const target = this.$refs[mode === 'camera' ? 'profileAvatarCameraInput' : 'profileAvatarInput']
					const ref = Array.isArray(target) ? target[0] : target
					const input = ref?.type ? ref : ref?.$el?.querySelector?.('input')
					if (input?.type === 'file') input.click()
					else this.handleError(new Error('当前环境无法打开图片选择器'), '头像设置失败')
				})
			},
			async pickNativeProfileAvatar(mode) {
				this.profileAvatarBusy = true
				this.errorMessage = ''
				try {
					const prepared = await this.services.nativeAttachmentPicker.pick(mode, { maxCount: 1 })
					if (prepared[0]) await this.persistProfileAvatar(prepared[0])
				} catch (error) {
					this.handleError(error, '头像设置失败')
				} finally {
					this.profileAvatarBusy = false
				}
			},
			async handleProfileAvatarSelection(event) {
				const input = event?.target
				const files = input?.files
				if (!files?.length || this.profileAvatarBusy) return
				this.profileAvatarBusy = true
				this.errorMessage = ''
				try {
					const prepared = await this.services.attachmentService.prepareFiles(files, { existing: [] })
					if (prepared[0]) await this.persistProfileAvatar(prepared[0])
				} catch (error) {
					this.handleError(error, '头像设置失败')
				} finally {
					this.profileAvatarBusy = false
					if (input) input.value = ''
				}
			},
			async persistProfileAvatar(attachment) {
				const avatar = createProfileAvatar(attachment)
				await this.services.repository.setSetting(PROFILE_AVATAR_SETTING_KEY, avatar)
				this.profileAvatar = avatar
				this.showToast('头像已更新')
			},
			async loadProfileAvatar() {
				const stored = await this.services.repository.getSetting(PROFILE_AVATAR_SETTING_KEY, null)
				this.profileAvatar = normalizeProfileAvatar(stored)
			},
			async resetProfileAvatar() {
				if (this.profileAvatarBusy) return
				this.profileAvatarMenuOpen = false
				this.profileAvatarBusy = true
				this.errorMessage = ''
				try {
					await this.services.repository.setSetting(PROFILE_AVATAR_SETTING_KEY, null)
					this.profileAvatar = null
					this.showToast('已恢复默认头像')
				} catch (error) {
					this.handleError(error, '恢复默认头像失败')
				} finally {
					this.profileAvatarBusy = false
				}
			},
			matchesSettingsSearch(searchText) {
				const keyword = this.settingsSearchQuery.trim().toLowerCase()
				return !keyword || searchText.toLowerCase().includes(keyword)
			},
			toggleSystemPromptPanel() {
				this.systemPromptOpen = !this.systemPromptOpen
				if (this.systemPromptOpen) this.cloudOpen = false
			},
			async openCloudModal() {
				this.systemPromptOpen = false
				await this.syncCloudUsernameFromSession()
				this.cloudOpen = true
			},
			closeCloudModal() {
				this.cloudOpen = false
			},
			showAboutApp() { this.showToast(`织语 · 版本 1.0.1 · ${this.aboutLabel}`) },
			openAndroidDiagnostics() {
				if (typeof uni === 'undefined' || typeof uni.navigateTo !== 'function') {
					if (typeof window !== 'undefined') {
						window.location.href = `${window.location.pathname}?page=pages/android-diagnostics/index`
						return
					}
					this.showToast('仅 Android App 支持流式诊断')
					return
				}
				uni.navigateTo({ url: '/pages/android-diagnostics/index' })
			},
			async addConversation(open = true) {
				this.attachmentMenuOpen = false
				try {
					const provider = this.providerItems.find((item) => item.id === this.ui.activeProviderId) || this.providerItems[0]
					if (!provider) { this.goToTab('providers'); throw new Error('请先添加一个模型接口') }
					const conversation = await this.services.chatService.createConversation({ providerProfileId: provider.id, providerNameSnapshot: provider.name, modelName: provider.defaultModel })
					await this.loadConversations()
					if (open) await this.openChat(conversation.id)
				} catch (error) { this.handleError(error) }
			},
			chooseConversationAction() {
				const uniApi = getUniApi()
				if (typeof uniApi?.showActionSheet !== 'function') return Promise.resolve(null)
				return new Promise(resolve => uniApi.showActionSheet({
					itemList: ['重命名会话', '删除会话'],
					success: result => resolve(result.tapIndex === 0 ? 'rename' : result.tapIndex === 1 ? 'delete' : null),
					fail: () => resolve(null)
				}))
			},
			requestConversationTitle(currentTitle) {
				const uniApi = getUniApi()
				if (typeof uniApi?.showModal === 'function') {
					return new Promise(resolve => uniApi.showModal({
						title: '重命名会话',
						content: '请输入新的会话名称',
						editable: true,
						placeholderText: currentTitle,
						confirmText: '保存',
						success: result => resolve(result.confirm ? String(result.content ?? '').trim() || currentTitle : null),
						fail: () => resolve(null)
					}))
				}
				const browserWindow = getBrowserWindow()
				if (typeof browserWindow?.prompt !== 'function') { this.showToast('当前环境不支持重命名弹窗'); return Promise.resolve(null) }
				try { return Promise.resolve(browserWindow.prompt('重命名会话；留空将删除会话', currentTitle)) }
				catch (_) { this.showToast('当前环境不支持重命名弹窗'); return Promise.resolve(null) }
			},
			confirmAction(title, content, confirmText = '确定') {
				const uniApi = getUniApi()
				if (typeof uniApi?.showModal === 'function') {
					return new Promise(resolve => uniApi.showModal({
						title, content, confirmText, confirmColor: '#d9363e',
						success: result => resolve(Boolean(result.confirm)),
						fail: () => resolve(false)
					}))
				}
				const browserWindow = getBrowserWindow()
				if (typeof browserWindow?.confirm !== 'function') return Promise.resolve(false)
				try { return Promise.resolve(Boolean(browserWindow.confirm(content))) }
				catch (_) { return Promise.resolve(false) }
			},
			async manageConversation(conversation) {
				if (!conversation) return
				try {
					const usesActionSheet = typeof getUniApi()?.showActionSheet === 'function'
					let action = usesActionSheet ? await this.chooseConversationAction() : null
					let title = null
					if (action === 'rename' || !usesActionSheet) {
						title = await this.requestConversationTitle(conversation.title)
						if (title === null) return
						if (!usesActionSheet) action = String(title).trim() ? 'rename' : 'delete'
					}
					if (!action) return
					if (action === 'delete') {
						if (!await this.confirmAction('删除会话', '确定删除这个会话及其消息吗？', '删除')) return
						await this.services.chatService.deleteConversation(conversation.id)
						if (this.ui.activeConversationId === conversation.id) this.backToConversations()
					} else {
						const normalizedTitle = String(title).trim()
						if (!normalizedTitle) { this.showToast('会话名称不能为空'); return }
						await this.services.chatService.renameConversation(conversation.id, normalizedTitle)
					}
					await this.loadConversations()
				} catch (error) { this.handleError(error) }
			},
			upsertMessage(message) {
				const index = this.messageItems.findIndex((item) => item.id === message.id)
				const current = index === -1 ? null : this.messageItems[index]
				const next = this.decorateChatMessage({ ...current, ...message, attachments: message.attachments ?? current?.attachments ?? [] })
				if (index === -1) {
					this.animatedMessageIds.push(next.id)
					this.messageItems.push(next)
				} else {
					this.messageItems.splice(index, 1, next)
				}
				this.messageItems.sort((left, right) => left.sequence - right.sequence)
				this.scrollChatToBottom()
			},
			finishMessageAnimation(messageId) {
				this.animatedMessageIds = this.animatedMessageIds.filter((id) => id !== messageId)
			},
			async sendMessage() {
				if (!this.canSend) return
				this.closeComposerMenus()
				const content = this.draftMessage
				const pendingAttachments = this.pendingAttachments
				let userMessagePersisted = false
				this.draftMessage = ''
				this.errorMessage = ''
				try {
					await this.services.chatService.send({
						conversationId: this.ui.activeConversationId,
						providerProfileId: this.activeProvider?.id || null,
						content,
						attachments: pendingAttachments,
						mode: this.ui.generationMode,
						onMessage: message => {
							if (message.role === 'user') {
								userMessagePersisted = true
								this.pendingAttachments = []
							}
							this.upsertMessage(message)
						},
						onState: ({ generating }) => setGenerating(this.ui, generating)
					})
					await this.loadConversations()
				} catch (error) {
					if (!userMessagePersisted) {
						this.draftMessage = content
						this.pendingAttachments = pendingAttachments
					}
					this.handleError(error)
				}
			},
			handleComposerAction() {
				if (this.ui.generating) { this.stopGeneration(); return }
				if (this.canSend) { this.sendMessage(); return }
				if (this.ui.generationMode === 'chat') this.startVoiceInput()
			},
			startVoiceInput() {
				this.closeComposerMenus()
				if (typeof plus === 'undefined' || typeof plus.speech?.startRecognize !== 'function') { this.showToast('当前环境不支持语音输入'); return }
				plus.speech.startRecognize({ userInterface: true, continue: false }, result => {
					const recognized = String(result ?? '').trim()
					if (recognized) this.draftMessage = `${this.draftMessage}${this.draftMessage ? ' ' : ''}${recognized}`
				}, error => this.handleError(new Error(error?.message || '语音识别失败'), '语音输入失败'))
			},
			stopGeneration() { this.services.chatService.stop() },
			async retryMessage(messageId) {
				try { await this.services.chatService.retry(messageId, { providerProfileId: this.activeProvider?.id || null, onMessage: this.upsertMessage, onState: ({ generating }) => setGenerating(this.ui, generating) }); await this.loadConversations() }
				catch (error) { this.handleError(error) }
			},
			async copyMessage(content) { try { await this.writeClipboard(content); this.showToast('已复制') } catch { this.showToast('复制失败') } },
			openProviderAvatarMenu() {
				if (!this.ready || this.providerAvatarBusy) return
				this.providerAvatarMenuOpen = true
			},
			selectAutomaticProviderAvatar() {
				this.providerForm.avatar = createAutomaticProviderAvatar()
				this.providerAvatarMenuOpen = false
			},
			selectProviderAvatarPreset(presetId) {
				try {
					this.providerForm.avatar = createProviderPresetAvatar(presetId)
					this.providerAvatarMenuOpen = false
				} catch (error) {
					this.handleError(error, '头像选择失败')
				}
			},
			chooseProviderCustomAvatar() {
				if (this.providerAvatarBusy) return
				this.providerAvatarMenuOpen = false
				if (this.services?.nativeAttachmentPicker) {
					this.pickNativeProviderAvatar()
					return
				}
				this.$nextTick(() => {
					const target = this.$refs.providerAvatarInput
					const ref = Array.isArray(target) ? target[0] : target
					const input = ref?.type ? ref : ref?.$el?.querySelector?.('input')
					if (input?.type === 'file') input.click()
					else this.handleError(new Error('当前环境无法打开图片选择器'), '头像选择失败')
				})
			},
			async pickNativeProviderAvatar() {
				this.providerAvatarBusy = true
				this.errorMessage = ''
				try {
					const prepared = await this.services.nativeAttachmentPicker.pick('image', { maxCount: 1 })
					if (prepared[0]) this.applyProviderCustomAvatar(prepared[0])
				} catch (error) {
					this.handleError(error, '头像选择失败')
				} finally {
					this.providerAvatarBusy = false
				}
			},
			async handleProviderAvatarSelection(event) {
				const input = event?.target
				const files = input?.files
				if (!files?.length || this.providerAvatarBusy) return
				this.providerAvatarBusy = true
				this.errorMessage = ''
				try {
					const prepared = await this.services.attachmentService.prepareFiles(files, { existing: [] })
					if (prepared[0]) this.applyProviderCustomAvatar(prepared[0])
				} catch (error) {
					this.handleError(error, '头像选择失败')
				} finally {
					this.providerAvatarBusy = false
					if (input) input.value = ''
				}
			},
			applyProviderCustomAvatar(attachment) {
				this.providerForm.avatar = createProviderCustomAvatar(attachment)
				this.showToast('已选择自定义头像，保存接口后生效')
			},
			selectProvider(providerId) {
				const provider = this.providerItems.find((item) => item.id === providerId)
				if (!provider) return
				this.providerAvatarMenuOpen = false; this.ui.activeProviderId = providerId; this.providerForm = createProviderForm(provider); this.connectionStatus = provider.lastTestStatus || 'untested'; this.showApiKey = false
			},
			addProvider() { this.providerAvatarMenuOpen = false; this.ui.activeProviderId = null; this.providerForm = createProviderForm({ name: '新接口', baseUrl: 'https://example.com/v1', defaultModel: '' }); this.connectionStatus = 'untested' },
			selectProviderModel(event) {
				applyProviderModelSelection(this.providerForm, this.providerModelOptions, event?.detail?.value)
			},
			selectProviderProtocol(protocolType) {
				if (this.providerProtocols.some(protocol => protocol.id === protocolType)) {
					applyProviderProtocolSelection(this.providerForm, protocolType)
				}
			},
			async saveProvider() {
				this.providerSaving = true; this.errorMessage = ''
				try { const saved = await this.providerServiceOrThrow().saveProvider(this.providerForm); await this.loadProviders(); this.ui.activeProviderId = saved.id; this.providerForm = createProviderForm(saved); this.connectionStatus = saved.lastTestStatus; this.showToast('接口已保存'); return saved }
				catch (error) { this.handleError(error); return null }
				finally { this.providerSaving = false }
			},
			async testConnection() {
				const saved = await this.saveProvider(); if (!saved) return
				this.providerTesting = true; this.connectionStatus = 'testing'
				try { const tested = await this.providerServiceOrThrow().testConnection(saved.id); await this.loadProviders(); this.providerForm = createProviderForm(tested); this.connectionStatus = 'success' }
				catch (error) { this.connectionStatus = 'failed'; this.handleError(error, '连接测试失败') }
				finally { this.providerTesting = false }
			},
			async fetchProviderModels() {
				this.providerLoadingModels = true; this.errorMessage = ''
				try { const models = await this.providerServiceOrThrow().fetchModels(this.providerForm); applyFetchedModels(this.providerForm, models); this.connectionStatus = 'success'; this.showToast(`已获取 ${models.length} 个模型`) }
				catch (error) { this.connectionStatus = 'failed'; this.handleError(error, '获取模型列表失败') }
				finally { this.providerLoadingModels = false }
			},
			async deleteProvider(provider) {
				if (this.providerItems.length === 1) { this.showToast('至少保留一个接口'); return }
				if (!await this.confirmAction('删除接口', `确定删除接口“${provider.name}”吗？`, '删除')) return
				try { await this.providerServiceOrThrow().deleteProvider(provider.id); await this.loadProviders(); this.selectProvider(this.providerItems[0]?.id) }
				catch (error) { this.handleError(error) }
			},
			async selectConversationProvider(provider) {
				if (this.ui.generating || !this.activeConversation) return
				const updated = { ...this.activeConversation, providerProfileId: provider.id, providerNameSnapshot: provider.name, modelName: provider.defaultModel, updatedAt: new Date().toISOString() }
				await this.services.repository.saveConversation(updated); this.ui.activeProviderId = provider.id; this.modelMenuOpen = false; this.attachmentMenuOpen = false; await this.loadConversations()
			},
			async saveSystemPrompt() {
				try { const encryptedValue = this.systemPrompt.trim() ? await this.services.vault.encryptString(this.systemPrompt.trim()) : null; await this.services.repository.setSetting('systemPrompt', { enabled: this.systemPromptEnabled, encryptedValue }); this.showToast('系统提示词已保存') }
				catch (error) { this.handleError(error) }
			},
			async toggleLock() { toggleAppLock(this.ui); await this.services.repository.setSetting('app', { appLockEnabled: this.ui.appLockEnabled }) },
			async toggleNsfw() {
				if (this.nsfwSaving || !this.services?.repository) return
				const previous = this.nsfwEnabled
				this.nsfwEnabled = !previous
				this.nsfwSaving = true
				try {
					await this.services.repository.setSetting(NSFW_SETTING_KEY, this.nsfwEnabled)
					this.showToast(this.nsfwEnabled ? 'NSFW 已开启' : 'NSFW 已关闭')
				} catch (error) {
					this.nsfwEnabled = previous
					this.handleError(error, 'NSFW 设置保存失败')
				} finally {
					this.nsfwSaving = false
				}
			},
			async initializeReplyNotifications() {
				const notificationService = this.services?.replyNotificationService
				if (!notificationService) return
				const state = await notificationService.initialize({
					enabled: this.replyNotificationsEnabled,
					onOpenConversation: conversationId => this.openReplyNotificationConversation(conversationId)
				})
				this.replyNotificationAuthorized = Boolean(state.authorized)
				notificationService.setAppVisible(true)
				notificationService.setActiveConversationId(this.ui.screen === 'chat' ? this.ui.activeConversationId : null)
				const pendingConversationId = notificationService.takePendingConversationId()
				if (pendingConversationId) await this.openReplyNotificationConversation(pendingConversationId)
			},
			async openReplyNotificationConversation(conversationId) {
				if (!this.ready || !conversationId) return false
				const conversation = await this.services.repository.getConversation(conversationId)
				if (!conversation || conversation.deletedAt) {
					this.showToast('对应会话已不存在')
					return true
				}
				await this.loadConversations()
				await this.openChat(conversationId)
				return true
			},
			async toggleReplyNotifications() {
				const notificationService = this.services?.replyNotificationService
				if (!notificationService?.supported) {
					this.showToast('请在 Android App 安装包中使用回复通知')
					return
				}
				if (this.replyNotificationsEnabled && !this.replyNotificationAuthorized) {
					await notificationService.openSettings()
					return
				}
				this.replyNotificationsEnabled = !this.replyNotificationsEnabled
				this.replyNotificationAuthorized = Boolean(await notificationService.setEnabled(this.replyNotificationsEnabled))
				await this.services.repository.setSetting(REPLY_NOTIFICATION_SETTING_KEY, this.replyNotificationsEnabled)
				if (this.replyNotificationsEnabled && !this.replyNotificationAuthorized) this.showToast('请在系统设置中允许通知')
			},
			showLocalDataInfo() { this.showToast(`${this.conversationItems.length} 个会话，${this.providerItems.length} 个接口`) },
			openBackupMenu() {
				this.errorMessage = ''
				this.backupMenuOpen = true
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
				const baseUrl = this.cloudForm.baseUrl.trim().replace(/\/+$/, '')
				if (!baseUrl) throw new Error('请填写云端服务器地址')
				const sessionBaseUrl = String(this.cloudSession?.cloud_base_url || '').trim().replace(/\/+$/, '')
				if (sessionBaseUrl && sessionBaseUrl !== baseUrl) {
					throw new Error('当前账号属于其他云端服务器，请先退出登录')
				}
				if (!this.cloudServices || this.cloudServices.apiClient.baseUrl !== baseUrl) {
					await this.stopCloudActivityAndWait()
					this.cloudServices = this.buildCloudServices(baseUrl)
					this.cloudSession = await this.cloudServices.tokenStore.load()
					await this.syncCloudUsernameFromSession()
				}
				await this.services.repository.setSetting('cloudConfig', { baseUrl, email: this.cloudForm.email.trim() })
				return this.cloudServices
			},
			async cloudAuthenticate(action) {
				this.cloudBusy = true; this.errorMessage = ''
				try {
					const baseUrl = this.cloudForm.baseUrl.trim().replace(/\/+$/, '')
					const email = this.cloudForm.email.trim()
					const username = this.cloudForm.username.trim()
					const cloud = await this.prepareCloudServices()
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
			async uploadCloudBackup() {
				this.cloudBusy = true; this.errorMessage = ''
				try {
					const cloud = await this.prepareCloudServices()
					if (this.autoBackupEnabled && this.cloudForm.syncPassword) await cloud.credentialStore.save(this.cloudForm.syncPassword)
					const syncPassword = this.cloudForm.syncPassword || await cloud.credentialStore.load()
					if (!syncPassword) throw new Error('请先输入同步密码')
					await cloud.cloudBackupService.upload({ deviceId: await this.cloudDeviceId(), syncPassword })
					this.cloudBackupStatus = `最近备份 ${this.formatMessageTime(new Date().toISOString())}`
					this.showToast('云端备份完成')
				}
				catch (error) { this.handleError(error, '云端备份失败') }
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
					const data = await this.services.backupService.exportData()
					const content = JSON.stringify(data, null, 2)
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
			async exportDataToCloud() {
				if (this.backupBusy) return
				this.backupBusy = true
				this.errorMessage = ''
				try {
					const cloud = await this.prepareCloudServices()
					if (!this.cloudSession?.access_token) throw new Error('请先在“账号与云端”登录')
					const data = await this.services.backupService.exportData()
					const uploaded = await cloud.apiClient.uploadJsonExport(data)
					this.cloudExportUrl = uploaded.download_url
					this.showToast('云端 JSON 已保存')
				} catch (error) {
					this.handleError(error, '云端保存失败')
				} finally {
					this.backupBusy = false
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
			formatMessageTime(value) { const date = value ? new Date(value) : new Date(); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` },
			statusLabel(status) { return ({ failed: '回答失败', interrupted: '回答已中断', cancelled: '已停止生成' })[status] || '回答未完成' },
			requestChatScrollToBottom() {
				const revision = this.chatScrollRevision + 1
				this.chatScrollRevision = revision
				this.chatScrollIntoView = ''
				this.$nextTick(() => {
					if (revision !== this.chatScrollRevision) return
					this.chatScrollIntoView = `chat-bottom-${revision}`
					this.$nextTick(() => {
						const ref = Array.isArray(this.$refs.chatScroll) ? this.$refs.chatScroll[0] : this.$refs.chatScroll
						const target = ref?.$el || ref
						if (typeof target?.scrollTo === 'function') target.scrollTo({ top: target.scrollHeight })
						else if (target && 'scrollTop' in target) target.scrollTop = target.scrollHeight
					})
				})
			},
			scrollChatToBottom() {
				clearTimeout(this.chatScrollTimer)
				this.requestChatScrollToBottom()
				this.chatScrollTimer = setTimeout(() => this.requestChatScrollToBottom(), 80)
			},
			showToast(message) { this.toastMessage = message; clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { this.toastMessage = '' }, 2200) },
			handleError(error, prefix = '') { const message = error?.message || '操作失败'; this.errorMessage = prefix ? `${prefix}：${message}` : message }
		}
	}
</script>

<style>
	* {
		box-sizing: border-box;
	}

	html,
	body,
	#app {
		margin: 0;
		width: 100%;
		height: 100%;
		font-family: Inter, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif;
		background: #eceff1;
		color: #17191c;
		overflow: hidden;
	}

	button,
	input,
	textarea,
	select {
		font: inherit;
	}

	button {
		min-width: 0;
		margin: 0;
		border: 0;
		padding: 0;
		background: transparent;
		color: inherit;
		appearance: none;
		-webkit-appearance: none;
		line-height: normal;
		outline: none;
	}

	button::after {
		display: none;
	}

	view,
	scroll-view {
		display: block;
	}

	scroll-view {
		scrollbar-width: none;
	}

	scroll-view::-webkit-scrollbar {
		display: none;
	}

	.app-shell {
		--page: #f5f7fa;
		--card: #ffffff;
		--text: #172033;
		--muted: #758196;
		--border: #dce3ec;
		--soft: #f0f3f7;
		--soft-strong: #e8f1fd;
		--accent: #1f6fcb;
		--accent-strong: #155db6;
		--success: #36b52a;
		--danger: #e5484d;
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		margin: 0;
		padding-top: var(--status-bar-height, 0px);
		overflow: hidden;
		background: var(--page);
		box-shadow: none;
	}

	.app-shell.chat-active {
		background-color: #eef7f8;
		background-image: url('/static/chat-wallpaper.jpg');
		background-position: center;
		background-repeat: no-repeat;
		background-size: cover;
	}

	.screen-view {
		position: relative;
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		animation: page-switch-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.chat-toolbar,
	.chat-scroll,
	.composer {
		animation: page-switch-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.screen-header,
	.chat-toolbar {
		display: flex;
		align-items: center;
		height: 56px;
		padding: 0 18px;
		border-bottom: 1px solid transparent;
		flex: 0 0 auto;
	}

	.chat-toolbar {
		position: absolute;
		top: var(--status-bar-height, 0px);
		left: 0;
		right: 0;
		z-index: 6;
		gap: 6px;
		height: 62px;
		min-height: 62px;
		padding: 8px 6px;
		border-bottom: 0;
		background: transparent;
		color: var(--text);
		box-shadow: none;
	}

	.chat-toolbar .icon-button {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.96);
		color: #26343d;
		box-shadow: 0 4px 10px rgba(72, 59, 103, 0.18);
		flex: 0 0 auto;
	}

	.chat-more-icon {
		transform: rotate(90deg);
	}

	.screen-title {
		font-size: 23px;
		font-weight: 750;
		letter-spacing: 0;
	}

	.reference-header {
		height: 56px;
		padding: 0 16px;
		background: var(--accent);
		color: #fff;
	}

	.reference-header .screen-title {
		font-size: 19px;
		font-weight: 700;
	}

	.reference-header .icon-button,
	.header-command {
		color: #fff;
	}

	.conversations-view {
		--home-accent: #d43bc2;
		background: #fff;
	}

	.conversations-header {
		position: relative;
		z-index: 13;
		height: 64px;
		padding: 0 16px 0 21px;
		border-bottom-color: #ededf0;
		background: #fff;
		color: #17181b;
	}

	.conversations-header .screen-title {
		font-size: 22px;
		font-weight: 760;
		color: var(--home-accent);
	}

	.conversation-header-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		margin-left: auto;
	}

	.conversations-header .icon-button {
		width: 42px;
		height: 42px;
		border-radius: 50%;
		color: #17181b;
	}

	.conversations-header .icon-button.active,
	.conversations-header .icon-button:active {
		background: #f6edf5;
		color: var(--home-accent);
	}

	.header-command {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-height: 36px;
		font-size: 13px;
		font-weight: 600;
	}

	.reference-scroll {
		flex: 1;
		min-height: 0;
		background: var(--page);
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 6px;
	}

	.screen-header > .icon-button {
		margin-left: auto;
	}

	.search-box {
		display: flex;
		align-items: center;
		gap: 9px;
		height: 40px;
		margin: 10px 12px 8px;
		padding: 0 13px;
		border-radius: 8px;
		background: var(--soft);
		color: var(--muted);
		flex: 0 0 auto;
	}

	.conversation-search {
		z-index: 9;
		height: 42px;
		margin: 8px 16px;
		padding: 0 12px;
		border: 1px solid #e4e4e8;
		background: #f5f5f7;
		color: #777b82;
	}

	.conversation-search button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		color: #777b82;
		flex: 0 0 auto;
	}

	.search-box input {
		width: 100%;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 14px;
		color: var(--text);
	}

	.home-menu-backdrop {
		position: absolute;
		inset: 64px 0 0;
		z-index: 11;
		background: transparent;
	}

	.home-action-menu {
		position: absolute;
		top: 56px;
		right: 12px;
		z-index: 14;
		display: flex;
		flex-direction: column;
		width: 154px;
		padding: 6px;
		border: 1px solid #e7e3e8;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 10px 26px rgba(43, 35, 48, 0.16);
	}

	.home-action-menu button {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 42px;
		padding: 0 11px;
		border-radius: 6px;
		font-size: 14px;
		color: #252329;
		text-align: left;
	}

	.home-action-menu button:active {
		background: #f7f1f6;
		color: var(--home-accent);
	}

	.conversation-list {
		display: block;
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		padding: 0;
		background: #fff;
	}

	.conversation-scroll-tail {
		height: 100px;
	}

	.conversation-row {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 78px;
		background: #fff;
	}

	.conversation-open {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 78px;
		padding: 9px 16px;
		text-align: left;
	}

	.conversation-open:active {
		background: #f7f7f8;
	}

	.conversation-avatar {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 52px;
		height: 52px;
		border-radius: 50%;
		overflow: hidden;
		flex: 0 0 auto;
	}

	.conversation-avatar-logo {
		width: 52px;
		height: 52px;
		padding: 0;
		background: transparent;
		box-shadow: none;
	}

	.settings-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		border-radius: 8px;
		background: var(--soft-strong);
		color: var(--accent);
		flex: 0 0 auto;
	}

	.conversation-copy {
		min-width: 0;
		padding: 0 58px 0 12px;
		flex: 1;
	}

	.row-title-line {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.row-title {
		min-width: 0;
		font-size: 16px;
		font-weight: 680;
		line-height: 21px;
		color: #202126;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: 1;
	}

	.row-time {
		position: absolute;
		top: 10px;
		right: 13px;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		min-width: 48px;
		height: 31px;
		padding: 0 3px 0 8px;
		background: #fff;
		font-size: 12px;
		color: #8e9096;
		white-space: nowrap;
	}

	.row-preview {
		display: block;
		margin-top: 4px;
		font-size: 14px;
		line-height: 19px;
		color: #81838a;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.model-selector {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 44px;
		min-width: 0;
		max-width: none;
		margin: 0;
		padding: 3px 10px 3px 4px;
		border-radius: 22px;
		background: rgba(255, 255, 255, 0.96);
		box-shadow: 0 4px 10px rgba(72, 59, 103, 0.18);
		flex: 1;
		text-align: left;
	}

	.toolbar-provider-logo {
		width: 38px;
		height: 38px;
		padding: 0;
		background: rgba(255, 255, 255, 0.9);
		box-shadow: 0 1px 4px rgba(52, 78, 104, 0.14);
		flex: 0 0 auto;
	}

	.model-selector-copy {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		gap: 1px;
	}

	.model-selector-title,
	.model-selector-subtitle {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.model-selector-title {
		font-size: 15px;
		font-weight: 720;
		color: #172129;
	}

	.model-selector-subtitle {
		font-size: 11px;
		font-weight: 500;
		color: #7b8288;
	}

	.character-status-bar {
		position: absolute;
		top: calc(var(--status-bar-height, 0px) + 62px);
		left: 10px;
		right: 10px;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 6px;
		height: 48px;
		min-width: 0;
		padding: 6px 9px 6px 7px;
		overflow: hidden;
		border: 1px solid rgba(49, 126, 143, 0.18);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.94);
		box-shadow: 0 4px 14px rgba(38, 73, 86, 0.13);
		color: #47717b;
		text-align: left;
		-webkit-backdrop-filter: blur(12px);
		backdrop-filter: blur(12px);
	}

	.character-status-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 7px;
		background: #e8f4f5;
		color: #24879b;
		flex: 0 0 auto;
	}

	.character-status-label {
		display: block;
		flex: 0 0 auto;
		font-size: 10px;
		font-weight: 700;
		color: #24879b;
		white-space: nowrap;
	}

	.character-status-field {
		display: flex;
		align-items: center;
		min-width: 0;
		padding-left: 6px;
		border-left: 1px solid rgba(77, 111, 121, 0.16);
	}

	.character-status-field text {
		display: block;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11px;
		font-weight: 600;
		color: #263b42;
	}

	.character-status-primary {
		flex: 1 1 54px;
	}

	.character-status-location {
		flex: 1.25 1 62px;
	}

	.character-status-score {
		flex: 0.9 1 58px;
	}

	.character-status-score text {
		color: #465b62;
	}

	.character-status-update {
		display: flex;
		align-items: center;
		gap: 3px;
		min-width: 0;
		margin-left: auto;
		color: #2fa49f;
		flex: 0 1 auto;
	}

	.character-status-update text {
		display: block;
		overflow: hidden;
		font-size: 9px;
		font-weight: 600;
		color: #78888d;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.character-status-update.has-issue,
	.character-status-update.has-issue text {
		color: #c6535f;
	}

	.character-status-chevron {
		color: #466b74;
		flex: 0 0 auto;
	}

	.toolbar-spacer,
	.action-spacer {
		flex: 1;
	}

	.model-popover {
		position: absolute;
		top: calc(var(--status-bar-height, 0px) + 70px);
		left: 56px;
		right: 50px;
		z-index: 10;
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: #fff;
		box-shadow: 0 10px 24px rgba(18, 23, 31, 0.12);
	}

	.popover-label {
		font-size: 10px;
		color: var(--muted);
	}

	.generation-mode-tabs {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 3px;
		margin: 4px 0 5px;
		padding: 3px;
		border-radius: 6px;
		background: var(--soft);
	}

	.generation-mode-tab {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-height: 31px;
		border-radius: 5px;
		font-size: 11px;
		color: var(--muted);
	}

	.generation-mode-tab.active {
		background: #fff;
		box-shadow: 0 1px 3px rgba(18, 23, 31, 0.1);
		color: var(--accent);
		font-weight: 700;
	}

	.popover-value {
		font-size: 13px;
		font-weight: 650;
	}

	.popover-option {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		min-width: 220px;
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
		text-align: left;
		font-size: 12px;
	}

	.popover-option:last-child {
		border-bottom: 0;
	}

	.popover-option text:last-child {
		max-width: 108px;
		color: var(--muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chat-scroll {
		position: relative;
		z-index: 1;
		display: block;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 74px 11px 0;
		background: transparent;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior-y: contain;
		-webkit-mask-image: linear-gradient(to bottom, transparent 0, transparent 26px, rgba(0, 0, 0, 0.12) 34px, rgba(0, 0, 0, 0.4) 46px, rgba(0, 0, 0, 0.75) 58px, #000 70px, #000 100%);
		mask-image: linear-gradient(to bottom, transparent 0, transparent 26px, rgba(0, 0, 0, 0.12) 34px, rgba(0, 0, 0, 0.4) 46px, rgba(0, 0, 0, 0.75) 58px, #000 70px, #000 100%);
		-webkit-mask-repeat: no-repeat;
		mask-repeat: no-repeat;
		-webkit-mask-size: 100% 100%;
		mask-size: 100% 100%;
	}

	.chat-scroll.has-character-status {
		padding-top: 122px;
	}

	.chat-scroll-tail {
		height: 12px;
	}

	.date-divider {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 34px;
		font-size: 11px;
		color: #fff;
	}

	.date-divider text {
		min-width: 46px;
		padding: 4px 9px;
		border-radius: 12px;
		background: rgba(91, 113, 147, 0.58);
		box-shadow: 0 1px 4px rgba(37, 62, 79, 0.12);
		text-align: center;
	}

	.empty-state,
	.empty-chat {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--muted);
		font-size: 13px;
	}

	.empty-state {
		height: 160px;
	}

	.empty-chat {
		flex-direction: column;
		gap: 8px;
		height: min(430px, calc(100% - 34px));
		min-height: 300px;
		font-size: 13px;
		color: #5d7990;
		text-shadow: 0 1px 0 rgba(255, 255, 255, 0.8);
	}

	.message {
		display: flex;
		width: 100%;
		margin-bottom: 10px;
	}

	.message-user {
		justify-content: flex-end;
	}

	.message-bubble {
		max-width: 100%;
		min-width: 0;
		padding: 9px 11px 7px;
		border-radius: 14px;
		font-size: 14px;
		line-height: 1.5;
	}

	.user-message-stack {
		display: flex;
		align-items: flex-end;
		flex-direction: column;
		gap: 5px;
		max-width: 78%;
		min-width: 0;
	}

	.user-message-stack.message-pop {
		transform-origin: right bottom;
		animation: user-message-pop-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.user-bubble {
		display: flex;
		flex-direction: column;
		gap: 7px;
		border-bottom-right-radius: 4px;
		background: rgba(219, 244, 238, 0.96);
		box-shadow: 0 1px 5px rgba(35, 75, 81, 0.13);
	}

	.message-attachments {
		display: flex;
		flex-direction: column;
		gap: 7px;
		min-width: 0;
	}

	.sent-image-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 4px;
		width: 100%;
	}

	.sent-image-grid.single {
		grid-template-columns: minmax(0, 1fr);
	}

	.sent-image-item {
		position: relative;
		display: block;
		width: 100%;
		aspect-ratio: 1;
		overflow: hidden;
		border-radius: 8px;
	}

	.sent-image-button {
		display: block;
		width: 100%;
		height: 100%;
		aspect-ratio: 1;
		overflow: hidden;
		border: 0;
		border-radius: inherit;
		background: transparent;
	}

	.sent-image-button .attachment-image {
		display: block;
		width: 100%;
		height: 100%;
	}

	.sent-image-grid.single .sent-image-item,
	.sent-image-grid.single .sent-image-button {
		min-height: 128px;
		max-height: 360px;
		aspect-ratio: auto;
	}

	.sent-image-grid.single .sent-image-button {
		height: auto;
	}

	.sent-image-grid.single .attachment-image {
		height: auto;
		max-height: 360px;
		object-fit: contain;
	}

	.image-download-button {
		position: absolute;
		top: 7px;
		right: 7px;
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 1px solid rgba(255, 255, 255, 0.34);
		border-radius: 50%;
		color: #fff;
		background: rgba(16, 21, 27, 0.7);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
	}

	.image-download-button:active {
		background: rgba(16, 21, 27, 0.9);
	}

	.image-download-button:disabled {
		opacity: 0.55;
	}

	.media-message {
		position: relative;
		width: min(252px, 68vw);
		min-width: 0;
	}

	.assistant-image-grid {
		width: 100%;
		max-width: none;
	}

	.media-message-meta {
		position: absolute;
		right: 6px;
		bottom: 6px;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 3px 6px;
		border-radius: 7px;
		background: rgba(29, 46, 57, 0.62);
		color: #fff;
		font-size: 10px;
		line-height: 1;
		box-shadow: 0 1px 3px rgba(12, 28, 38, 0.16);
	}

	.media-message-meta .read-receipt {
		color: #9ee8ff;
	}

	.assistant-media-meta {
		bottom: 6px;
	}

	.sent-file-button {
		display: flex;
		align-items: center;
		gap: 8px;
		width: min(240px, 100%);
		min-height: 48px;
		padding: 7px 8px;
		border: 1px solid rgba(58, 127, 144, 0.15);
		border-radius: 7px;
		background: rgba(255, 255, 255, 0.66);
		text-align: left;
	}

	.sent-file-copy,
	.pending-file-copy {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.sent-file-copy text:first-child,
	.pending-file-copy text:first-child {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		font-weight: 650;
	}

	.sent-file-copy text:last-child,
	.pending-file-copy text:last-child {
		font-size: 10px;
		color: var(--muted);
	}

	.message-time {
		display: block;
		margin: 0;
		text-align: right;
		font-size: 10px;
		color: #748996;
	}

	.message-meta {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		margin-top: 6px;
	}

	.read-receipt {
		color: #2c9bb8;
		flex: 0 0 auto;
	}

	.message-content {
		white-space: pre-wrap;
		word-break: break-word;
		-webkit-user-select: text;
		user-select: text;
		cursor: text;
	}

	.message-assistant {
		align-items: flex-start;
		gap: 8px;
	}

	.provider-logo {
		display: block;
		object-fit: contain;
		border-radius: 50%;
	}

	.assistant-avatar,
	.interrupted-icon {
		width: 34px;
		height: 34px;
		flex: 0 0 auto;
	}

	.assistant-avatar {
		padding: 3px;
		background: rgba(255, 255, 255, 0.94);
		box-shadow: 0 1px 5px rgba(35, 73, 92, 0.16);
	}

	.assistant-message-stack {
		display: flex;
		align-items: flex-start;
		flex-direction: column;
		gap: 5px;
		width: calc(100% - 42px);
		min-width: 0;
	}

	.assistant-message-stack.message-pop {
		transform-origin: left bottom;
		animation: assistant-message-pop-in 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.assistant-body {
		display: flex;
		flex-direction: column;
		gap: 7px;
		width: auto;
		max-width: 100%;
		padding: 8px 11px 7px;
		border: 0;
		border-radius: 14px;
		border-bottom-left-radius: 4px;
		background: rgba(255, 255, 255, 0.96);
		box-shadow: 0 1px 5px rgba(35, 73, 92, 0.14);
		font-size: 14px;
		line-height: 1.52;
	}

	.assistant-name {
		display: block;
		max-width: 100%;
		overflow: hidden;
		color: #258ba5;
		font-size: 11px;
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.composer-attachment:disabled {
		color: var(--muted);
		opacity: 0.4;
	}

	.assistant-footer {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-top: 2px;
	}

	.message-actions {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
		margin-top: 1px;
		color: #6d7f89;
		flex: 1;
	}

	.message-actions button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.assistant-image-footer {
		position: absolute;
		left: 6px;
		bottom: 6px;
		z-index: 2;
	}

	.assistant-image-footer button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 27px;
		height: 27px;
		border-radius: 50%;
		background: rgba(29, 46, 57, 0.62);
		color: #fff;
		box-shadow: 0 1px 3px rgba(12, 28, 38, 0.16);
	}

	.retry-action text {
		font-size: 11px;
	}

	.assistant-time {
		font-size: 10px;
		color: var(--muted);
		flex: 0 0 auto;
	}

	.compact-user {
		margin-top: -2px;
	}

	.generating-message {
		min-width: 176px;
		padding-bottom: 7px;
	}

	.generation-status {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 3px;
		font-size: 11px;
		color: var(--muted);
	}

	.generation-dots {
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.generation-dots i {
		display: block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #43a9b8;
		animation: dot-pulse 1.15s ease-in-out infinite;
	}

	.generation-dots i:nth-child(2) {
		animation-delay: 0.16s;
	}

	.generation-dots i:nth-child(3) {
		animation-delay: 0.32s;
	}

	.stop-inline {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		padding: 5px 8px;
		border: 1px solid rgba(70, 116, 130, 0.18);
		border-radius: 6px;
		font-size: 11px;
		color: var(--text);
	}

	.interrupted-card {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 2px 0 8px 37px;
		padding: 10px;
		border: 1px solid #efc7c4;
		border-radius: 8px;
		background: #fff6f5;
	}

	.interrupted-icon {
		filter: sepia(1) saturate(5) hue-rotate(320deg);
	}

	.interrupted-card > view:nth-child(2) {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
	}

	.interrupted-title {
		font-size: 13px;
		font-weight: 650;
	}

	.interrupted-subtitle {
		font-size: 11px;
		color: #8d6b68;
	}

	.retry-button {
		padding: 5px 10px;
		border: 1px solid #e7cfcc;
		border-radius: 6px;
		font-size: 11px;
		background: #fff;
	}

	.message-status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 2px;
		padding-top: 7px;
		border-top: 1px solid rgba(120, 137, 146, 0.16);
		font-size: 11px;
		color: var(--danger);
	}

	.message-status-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.message-status-detail {
		font-size: 10px;
		line-height: 1.35;
		color: #8b3d38;
		word-break: break-word;
	}

	.composer {
		position: relative;
		z-index: 8;
		display: flex;
		align-items: center;
		gap: 0;
		height: 56px;
		min-height: 56px;
		max-height: 56px;
		margin: 8px 7px max(9px, env(safe-area-inset-bottom));
		padding: 6px 2px 6px 6px;
		border: 0;
		border-radius: 28px;
		background: rgba(255, 255, 255, 0.97);
		box-shadow: 0 4px 14px rgba(52, 74, 91, 0.16);
		flex: 0 0 auto;
	}

	.composer.has-attachments,
	.composer.is-multiline {
		align-items: flex-end;
		height: auto;
		max-height: none;
		border-radius: 20px;
	}

	.composer-main {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}

	.composer-emoji,
	.composer-attachment,
	.composer-stop {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 44px;
		min-height: 44px;
		max-height: 44px;
		margin: 0;
		padding: 0;
		border-radius: 50%;
		border: 0;
		line-height: 1;
		flex: 0 0 auto;
	}

	.composer-emoji {
		width: 44px;
		min-width: 44px;
		max-width: 44px;
	}

	.composer-smile-icon {
		display: block;
		width: 34px;
		height: 34px;
		transform: translateY(-3px);
		pointer-events: none;
	}

	.composer-attachment {
		width: 38px;
		min-width: 38px;
		max-width: 38px;
		color: #697277;
	}

	.composer-stop {
		width: 44px;
		min-width: 44px;
		max-width: 44px;
	}

	.composer-stop:disabled,
	.save-button:disabled,
	.test-button:disabled,
	.primary-button:disabled,
	.secondary-button:disabled,
	.danger-button:disabled,
	.logout-button:disabled {
		opacity: 0.45;
	}

	.composer-stop:disabled {
		opacity: 0.48;
	}

	.composer-input {
		display: block;
		width: 100%;
		height: 44px;
		min-height: 44px;
		max-height: 132px;
		margin: 0;
		padding: 10px 4px 8px;
		border: 0;
		outline: 0;
		border-radius: 0;
		background: transparent;
		font-size: 15.5px;
		color: #29343a;
		line-height: 22px;
		overflow-y: auto;
		resize: none;
		white-space: pre-wrap;
		word-break: break-word;
		appearance: none;
		-webkit-appearance: none;
	}

	.composer-input::-webkit-scrollbar {
		display: none;
	}

	.composer-input::placeholder {
		color: #858d90;
		opacity: 1;
	}

	.composer-stop {
		background: #c83fe5;
		color: #fff;
		box-shadow: 0 2px 8px rgba(176, 43, 207, 0.28);
	}

	.attachment-backdrop {
		position: absolute;
		inset: 0;
		z-index: 7;
		background: transparent;
	}

	.attachment-popover {
		position: absolute;
		left: 0;
		right: 0;
		bottom: calc(100% + 10px);
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0;
		min-height: 112px;
		padding: 14px 10px;
		border: 1px solid rgba(80, 119, 145, 0.14);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.97);
		box-shadow: 0 8px 24px rgba(31, 74, 93, 0.15);
	}

	.emoji-popover {
		position: absolute;
		left: 0;
		right: 0;
		bottom: calc(100% + 10px);
		display: grid;
		grid-template-columns: repeat(8, minmax(0, 1fr));
		gap: 2px;
		padding: 10px 8px;
		border: 1px solid rgba(80, 119, 145, 0.14);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.98);
		box-shadow: 0 8px 24px rgba(31, 74, 93, 0.15);
	}

	.emoji-popover button {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 38px;
		font-size: 23px;
	}

	.attachment-action {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 10px;
		padding: 10px 8px;
		border-radius: 8px;
		font-size: 13px;
		color: var(--accent);
	}

	.attachment-action > text {
		color: var(--text);
	}

	.attachment-action:active {
		background: var(--soft);
	}

	.pending-attachment-strip {
		display: block;
		width: 100%;
		height: 58px;
		overflow: hidden;
	}

	.pending-attachment-list {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 58px;
		min-width: 100%;
		padding: 1px;
		white-space: nowrap;
	}

	.pending-attachment {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 56px;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: #f7f8fb;
		vertical-align: top;
		flex: 0 0 auto;
	}

	.pending-image {
		width: 56px;
		overflow: hidden;
	}

	.pending-image .attachment-image {
		display: block;
		width: 100%;
		height: 100%;
	}

	.pending-text {
		gap: 7px;
		width: 164px;
		padding: 8px 26px 8px 9px;
		text-align: left;
	}

	.remove-pending-attachment {
		position: absolute;
		top: 3px;
		right: 3px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 19px;
		height: 19px;
		border-radius: 50%;
		background: rgba(24, 29, 38, 0.78);
		color: #fff;
	}

	.remove-pending-attachment:disabled {
		opacity: 0.45;
	}

	.pending-processing {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 56px;
		padding: 0 12px;
		border: 1px dashed var(--border);
		border-radius: 7px;
		color: var(--muted);
		font-size: 11px;
		flex: 0 0 auto;
	}

	.pending-processing svg {
		animation: spin 0.9s linear infinite;
	}

	.providers-view {
		--provider-accent: #d43bc2;
		--provider-accent-soft: #fff0fb;
		background: #fff;
	}

	.provider-header {
		position: relative;
		z-index: 13;
		justify-content: space-between;
		height: 64px;
		padding: 0 12px 0 21px;
		border-bottom: 1px solid #ededf0;
		background: #fff;
		color: #17181b;
	}

	.provider-header .screen-title {
		font-size: 22px;
		font-weight: 760;
		color: var(--provider-accent);
	}

	.provider-add-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		border-radius: 50%;
		color: #17181b;
	}

	.provider-add-button:active {
		background: #f6edf5;
		color: var(--provider-accent);
	}

	.provider-add-button:disabled {
		opacity: 0.4;
	}

	.text-button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
	}

	.provider-screen,
	.settings-screen {
		display: block;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: 0;
	}

	.provider-screen {
		padding: 0;
		background: #fff;
	}

	.provider-navigation-fade {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 12;
		height: 96px;
		background: #fff;
		pointer-events: none;
	}

	.provider-screen .navigation-scroll-tail {
		height: 104px;
	}

	.navigation-scroll-tail {
		height: 88px;
	}

	.provider-list {
		padding: 6px 0 2px;
		background: #fff;
	}

	.provider-row {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 78px;
		border-bottom: 1px solid #f0f0f2;
		background: #fff;
	}

	.provider-row.selected {
		background: #fffafd;
	}

	.provider-card {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 78px;
		padding: 9px 54px 9px 16px;
		text-align: left;
		border: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
	}

	.provider-card:active {
		background: #f8f8f9;
	}

	.provider-card.selected {
		background: transparent;
	}

	.provider-logo-large {
		width: 52px;
		height: 52px;
		margin-right: 12px;
		padding: 0;
		background: transparent;
		box-shadow: none;
		flex: 0 0 auto;
	}

	.provider-copy {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.provider-name {
		font-size: 16px;
		font-weight: 680;
		line-height: 21px;
		color: #202126;
	}

	.provider-url {
		margin-top: 3px;
		font-size: 12px;
		line-height: 17px;
		color: #85878d;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.provider-model {
		margin-top: 1px;
		font-size: 13px;
		line-height: 18px;
		color: #676970;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.provider-selection {
		position: absolute;
		right: 16px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--provider-accent);
		color: #fff;
		flex: 0 0 auto;
	}

	.provider-delete {
		position: absolute;
		top: 50%;
		right: 8px;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		color: #9a9ca2;
		transform: translateY(-50%);
	}

	.provider-delete:active {
		background: #fff0f1;
		color: var(--danger);
	}

	.provider-editor {
		padding: 0 16px 4px;
		border-top: 8px solid #f4f4f6;
		background: #fff;
	}

	.content-section-label {
		display: block;
		margin: 17px 0 13px;
		font-size: 15px;
		font-weight: 700;
		color: #24252a;
	}

	.provider-form {
		padding: 0;
		border: 0;
		border-radius: 0;
		background: #fff;
		box-shadow: none;
	}

	.provider-avatar-selector {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 72px;
		margin-bottom: 16px;
		padding: 9px 12px;
		border: 1px solid #ececf0;
		border-radius: 8px;
		background: #f8f8fa;
		text-align: left;
	}

	.provider-avatar-selector:active {
		background: #f2f2f5;
	}

	.provider-avatar-selector:disabled {
		opacity: 0.6;
	}

	.provider-avatar-preview {
		position: relative;
		width: 52px;
		height: 52px;
		margin-right: 12px;
		border: 1px solid #ececf0;
		border-radius: 50%;
		background: #fff;
		overflow: hidden;
		flex: 0 0 auto;
	}

	.provider-avatar-preview-image {
		display: block;
		width: 52px;
		height: 52px;
		padding: 4px;
		border-radius: 50%;
	}

	.provider-avatar-loading {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.78);
		color: var(--provider-accent);
	}

	.provider-avatar-selector-copy {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.provider-avatar-selector-copy text:first-child {
		font-size: 14px;
		font-weight: 650;
		line-height: 20px;
		color: #27282d;
	}

	.provider-avatar-selector-copy text:last-child {
		margin-top: 3px;
		font-size: 12px;
		font-weight: 400;
		line-height: 17px;
		color: #85878d;
	}

	.provider-avatar-selector > svg,
	.provider-avatar-selector > .lucide {
		margin-left: 8px;
		color: #9a9ca2;
		flex: 0 0 auto;
	}

	.form-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
		font-size: 15px;
		font-weight: 700;
	}

	.save-button {
		padding: 6px 12px;
		border-radius: 7px;
		background: var(--soft);
		font-size: 12px;
	}

	.provider-form .form-row {
		display: flex;
		align-items: stretch;
		flex-direction: column;
		gap: 7px;
		margin-bottom: 14px;
		font-size: 13px;
		font-weight: 600;
		color: #4c4e54;
	}

	.provider-form .form-row > input,
	.password-field,
	.select-field-wrap {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		height: 46px;
		padding: 0 13px;
		border: 1px solid #ececf0;
		border-radius: 8px;
		outline: 0;
		background: #f8f8fa;
		font-size: 14px;
		font-weight: 400;
	}

	.provider-form .form-row > input:focus,
	.password-field:focus-within,
	.select-field-wrap:focus-within {
		border-color: #e7acdf;
		background: #fff;
	}

	.provider-protocol-control {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 3px;
		width: 100%;
		height: 46px;
		padding: 3px;
		border: 1px solid #ececf0;
		border-radius: 8px;
		background: #f1f1f4;
	}

	.provider-protocol-option {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		height: 38px;
		padding: 0 7px;
		border-radius: 6px;
		font-size: 13px;
		font-weight: 600;
		color: #6d6f76;
	}

	.provider-protocol-option.active {
		background: #fff;
		box-shadow: 0 1px 4px rgba(38, 38, 44, 0.1);
		color: var(--provider-accent);
	}

	.provider-protocol-option:disabled {
		opacity: 0.5;
	}

	.password-field input {
		min-width: 0;
		flex: 1;
		height: auto;
		padding: 0;
		border: 0;
	}

	.password-field button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		color: #76787f;
		flex: 0 0 auto;
	}

	.password-field button:active {
		background: #eeeef1;
	}

	.select-field {
		display: flex;
		align-items: center;
		width: 100%;
		height: 44px;
		padding: 0 34px 0 0;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 14px;
		appearance: none;
		-webkit-appearance: none;
		color: var(--text);
	}

	.select-field-picker {
		display: block;
		width: 100%;
		height: 44px;
	}

	.select-field-wrap {
		position: relative;
		padding-right: 10px;
	}

	.select-chevron {
		position: absolute;
		right: 12px;
		color: #83858c;
		pointer-events: none;
	}

	.provider-form-actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 9px;
		margin-top: 2px;
	}

	.provider-action-button,
	.provider-save-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 100%;
		border-radius: 8px;
		font-weight: 650;
	}

	.provider-action-button {
		height: 44px;
		padding: 0 8px;
		border: 1px solid #eaddea;
		background: #fff;
		font-size: 13px;
		color: #b52da7;
	}

	.provider-action-button:active {
		background: var(--provider-accent-soft);
	}

	.provider-save-button {
		height: 46px;
		margin-top: 10px;
		background: var(--provider-accent);
		box-shadow: 0 4px 12px rgba(212, 59, 194, 0.18);
		font-size: 14px;
		color: #fff;
	}

	.provider-action-button:disabled,
	.provider-save-button:disabled {
		opacity: 0.45;
	}

	.spinning {
		animation: spin 0.9s linear infinite;
	}

	.primary-button,
	.secondary-button,
	.danger-button,
	.logout-button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 34px;
		padding: 7px 10px;
		border: 1px solid transparent;
		border-radius: 7px;
		font-size: 11px;
		font-weight: 600;
	}

	.primary-button {
		background: var(--accent);
		color: #fff;
	}

	.secondary-button {
		background: var(--soft);
		color: var(--accent-strong);
		border-color: #e2e8f0;
	}

	.connection-result {
		display: flex;
		align-items: center;
		gap: 5px;
		margin: 10px 2px 0;
		font-size: 12px;
	}

	.test-success {
		color: var(--success);
	}

	.test-error {
		color: var(--danger);
	}

	.settings-screen {
		padding: 12px 10px 0;
	}

	.settings-card {
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--card);
		box-shadow: 0 2px 8px rgba(29, 55, 90, 0.05);
	}

	.settings-row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 61px;
		padding: 10px 12px;
		text-align: left;
		border-bottom: 1px solid var(--border);
	}

	.settings-row:last-child {
		border-bottom: 0;
	}

	.settings-icon {
		width: 32px;
		height: 32px;
		background: transparent;
		color: var(--accent);
	}

	.settings-copy {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}

	.settings-copy text:first-child {
		font-size: 14px;
		font-weight: 600;
	}

	.settings-copy text:last-child {
		font-size: 11px;
		color: var(--muted);
	}

	.settings-overview {
		--settings-surface: #f3f3f5;
		background: var(--settings-surface);
	}

	.settings-overview .settings-screen {
		padding: 0 12px;
		background: var(--settings-surface);
	}

	.settings-profile {
		display: flex;
		align-items: center;
		flex-direction: column;
		min-height: 245px;
		padding: 6px 0 18px;
	}

	.settings-profile-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		width: 100%;
		height: 48px;
		margin-bottom: 7px;
	}

	.settings-profile-action {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		border-radius: 50%;
		color: #202124;
	}

	.settings-profile-action:active,
	.settings-profile-action.active {
		background: rgba(212, 59, 194, 0.08);
		color: #d43bc2;
	}

	.settings-search-bar {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		height: 42px;
		margin: -2px 0 12px;
		padding: 0 12px;
		border: 1px solid #e5e5e8;
		border-radius: 8px;
		background: #fff;
		color: #7a7b80;
	}

	.settings-search-bar input {
		min-width: 0;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 14px;
		color: #202124;
		flex: 1;
	}

	.settings-search-bar button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
	}

	.settings-profile-avatar-wrap {
		position: relative;
		display: block;
		width: 90px;
		height: 90px;
		overflow: visible;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		flex: 0 0 auto;
	}

	.settings-profile-avatar-wrap:active {
		transform: scale(0.98);
	}

	.settings-profile-avatar {
		display: block;
		width: 90px;
		height: 90px;
		padding: 0;
		border: 0;
		background: #fff;
		box-shadow: 0 2px 8px rgba(31, 34, 40, 0.12);
	}

	.settings-profile-camera {
		position: absolute;
		right: 0;
		bottom: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border: 2px solid var(--settings-surface);
		border-radius: 50%;
		background: #d43bc2;
		color: #fff;
		pointer-events: none;
	}

	.settings-profile-name {
		display: block;
		max-width: 100%;
		margin-top: 13px;
		font-size: 23px;
		font-weight: 750;
		line-height: 29px;
		color: #1f2023;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.settings-profile-subtitle {
		display: block;
		max-width: 100%;
		margin-top: 3px;
		font-size: 14px;
		line-height: 20px;
		color: #8a8b90;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.settings-overview .settings-card {
		border-color: transparent;
		box-shadow: none;
	}

	.settings-menu-card {
		background: #fff;
	}

	.settings-menu-card .settings-row {
		gap: 14px;
		min-height: 58px;
		padding: 6px 12px;
		border-bottom: 0;
	}

	.settings-menu-card .settings-row:active {
		background: #f7f7f8;
	}

	.settings-menu-card .settings-icon {
		width: 40px;
		height: 40px;
		border-radius: 8px;
		color: #fff;
		flex: 0 0 auto;
	}

	.settings-icon-blue { background: #2497d8; }
	.settings-icon-orange { background: #f29a18; }
	.settings-icon-green { background: #34bd59; }
	.settings-icon-red { background: #e84c5d; }
	.settings-icon-indigo { background: #4279df; }
	.settings-icon-cyan { background: #1aa7d9; }
	.settings-icon-teal { background: #2bb6bf; }
	.settings-icon-amber { background: #ef7d22; }
	.settings-icon-purple { background: #a94ad6; }

	.settings-menu-card .settings-copy {
		gap: 3px;
	}

	.settings-menu-card .settings-copy text:first-child {
		font-size: 16px;
		font-weight: 650;
		line-height: 21px;
		color: #242529;
	}

	.settings-menu-card .settings-copy text:last-child {
		font-size: 12px;
		line-height: 17px;
		color: #929399;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.settings-search-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 8px;
		height: 152px;
		border-radius: 8px;
		background: #fff;
		font-size: 13px;
		color: #8a8b90;
	}

	.settings-expanded-panel {
		margin-top: 10px;
		padding: 12px;
		background: #fff;
	}

	.settings-expanded-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
		font-size: 15px;
		font-weight: 700;
	}

	.settings-expanded-heading button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
	}

	.settings-overview .prompt-editor {
		padding: 12px;
		border-bottom: 0;
	}

	.settings-overview .navigation-scroll-tail {
		height: 100px;
	}

	.settings-section-label {
		display: block;
		margin: 16px 2px 8px;
		font-size: 13px;
		color: #526077;
	}

	.settings-detail-header {
		justify-content: flex-start;
		gap: 8px;
	}

	.settings-detail-header > .icon-button {
		margin-left: 0;
	}

	.header-back {
		margin-left: -8px;
	}

	.prompt-editor {
		padding: 0 12px 12px;
		border-bottom: 1px solid var(--border);
	}

	.prompt-editor textarea {
		width: 100%;
		min-height: 72px;
		padding: 9px;
		border: 1px solid var(--border);
		border-radius: 7px;
		font-size: 12px;
		resize: none;
	}

	.prompt-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
		font-size: 12px;
		font-weight: 600;
	}

	.prompt-save {
		display: block;
		margin: 8px 0 0 auto;
	}

	.cloud-modal-backdrop {
		padding: 12px;
	}

	.cloud-modal {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-height: calc(100% - 24px);
		overflow: hidden;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 18px 42px rgba(20, 23, 28, 0.24);
	}

	.cloud-modal-heading {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 62px;
		padding: 10px 10px 10px 14px;
		border-bottom: 1px solid var(--border);
		flex: 0 0 auto;
	}

	.cloud-modal-heading > button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		flex: 0 0 auto;
	}

	.cloud-modal-heading > button:active {
		background: #f2f3f5;
	}

	.cloud-modal-content {
		display: block;
		max-height: min(68vh, 560px);
		padding: 14px 14px max(14px, env(safe-area-inset-bottom));
		overflow-y: auto;
	}

	.cloud-status-icon {
		border: 1px solid #bed7f5;
		border-radius: 50%;
		background: #f5f9ff;
	}

	.enabled-status {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--success);
		flex: 0 0 auto;
	}

	.enabled-status i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--success);
	}

	.cloud-field {
		display: grid;
		grid-template-columns: 62px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
		font-size: 11px;
		font-weight: 600;
	}

	.cloud-field input,
	.cloud-field .password-field,
	.cloud-field .cloud-username-editor {
		display: flex;
		align-items: center;
		width: 100%;
		height: 34px;
		min-width: 0;
		padding: 0 9px;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: #fff;
		font-size: 11px;
		font-weight: 400;
	}

	.cloud-field .password-field input {
		padding: 0;
		border: 0;
		flex: 1;
	}

	.cloud-field .cloud-username-editor {
		padding-right: 4px;
	}

	.cloud-field .cloud-username-editor input {
		height: 100%;
		padding: 0 5px 0 0;
		border: 0;
		background: transparent;
		flex: 1;
	}

	.cloud-field .cloud-username-editor button {
		height: 26px;
		padding: 0 8px;
		border-radius: 6px;
		background: #eaf2ff;
		font-size: 10px;
		font-weight: 650;
		color: #2267c9;
		flex: 0 0 auto;
	}

	.cloud-actions {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 6px;
		margin-top: 12px;
	}

	.cloud-actions-wrap {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.cloud-auto-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 8px;
		padding-top: 10px;
		border-top: 1px solid var(--border);
	}

	.cloud-auto-row > view {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 12px;
		font-weight: 650;
	}

	.cloud-auto-row > view text:last-child {
		font-size: 10px;
		font-weight: 400;
		color: var(--muted);
	}

	.danger-button {
		border-color: #f5d4d6;
		background: #fff5f5;
		color: var(--danger);
	}

	.logout-button {
		grid-column: 1 / -1;
		border-color: #f0b9bd;
		background: #fff;
		color: var(--danger);
	}

	.toggle {
		position: relative;
		width: 40px;
		height: 23px;
		border-radius: 12px;
		background: #d1d4d7;
		transition: background 0.2s ease;
	}

	.toggle-thumb {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 17px;
		height: 17px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
		transition: transform 0.2s ease;
	}

	.toggle.enabled {
		background: var(--accent);
	}

	.toggle.enabled .toggle-thumb {
		transform: translateX(17px);
	}

	.bottom-nav {
		position: absolute;
		left: 16px;
		right: 16px;
		bottom: max(8px, env(safe-area-inset-bottom));
		z-index: 18;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		height: 68px;
		padding: 4px 9px;
		border: 1px solid rgba(224, 218, 225, 0.86);
		border-radius: 34px;
		background: rgba(255, 255, 255, 0.97);
		box-shadow: 0 8px 25px rgba(45, 37, 50, 0.18);
		flex: 0 0 auto;
		animation: bottom-nav-enter 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.nav-indicator {
		position: absolute;
		top: 4px;
		left: 9px;
		z-index: 0;
		width: calc(25% - 4.5px);
		height: 58px;
		border-radius: 29px;
		background: #fff0fb;
		box-shadow: 0 2px 8px rgba(212, 59, 194, 0.08);
		transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1);
		pointer-events: none;
	}

	.nav-item {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 2px;
		height: 58px;
		border-radius: 29px;
		font-size: 12px;
		font-weight: 560;
		color: #242329;
		background: transparent;
		transition: color 220ms ease, transform 180ms ease;
	}

	.nav-item .app-icon {
		transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.nav-item.active {
		color: #d43bc2;
		font-weight: 700;
	}

	.nav-item.active .app-icon {
		transform: translateY(-1px) scale(1.08);
	}

	.nav-item:active {
		transform: scale(0.96);
	}

	.character-import-backdrop {
		z-index: 38;
	}

	.character-import-modal {
		display: flex;
		width: 100%;
		max-height: min(78vh, 680px);
		overflow: hidden;
		flex-direction: column;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 18px 48px rgba(20, 23, 28, 0.24);
	}

	.character-import-modal .modal-heading {
		padding: 15px 16px 11px;
	}

	.character-import-content {
		min-height: 0;
		padding: 4px 16px 12px;
		flex: 1;
	}

	.character-preview-identity {
		display: flex;
		align-items: center;
		gap: 13px;
		padding: 6px 0 13px;
	}

	.character-preview-avatar {
		display: block;
		width: 70px;
		height: 70px;
		overflow: hidden;
		border-radius: 50%;
		background: #ececf0;
		flex: 0 0 auto;
	}

	.character-preview-identity > view {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 6px;
		color: #8e9096;
		font-size: 12px;
	}

	.character-preview-name {
		overflow: hidden;
		font-size: 20px;
		font-weight: 680;
		color: #222328;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.character-preview-description {
		display: -webkit-box;
		overflow: hidden;
		margin: 0 0 14px;
		font-size: 13px;
		line-height: 1.65;
		color: #666970;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
	}

	.character-preview-facts {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		border: 1px solid #ece9ee;
		border-radius: 8px;
		background: #faf9fb;
	}

	.character-preview-facts > view {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 0;
		min-height: 64px;
		flex-direction: column;
		gap: 5px;
		border-right: 1px solid #ece9ee;
	}

	.character-preview-facts > view:last-child {
		border-right: 0;
	}

	.character-preview-facts text:first-child {
		font-size: 11px;
		color: #929399;
	}

	.character-preview-facts text:last-child {
		font-size: 14px;
		font-weight: 650;
		color: #28292e;
	}

	.character-import-warning {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin-top: 10px;
		padding: 10px 11px;
		border: 1px solid #f0dca8;
		border-radius: 8px;
		background: #fffaf0;
		font-size: 12px;
		line-height: 1.5;
		color: #8a6419;
	}

	.character-import-warning .app-icon {
		margin-top: 1px;
		flex: 0 0 auto;
	}

	.character-permission-row {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
		margin-top: 12px;
		padding: 11px;
		border: 1px solid #e8e3e9;
		border-radius: 8px;
		text-align: left;
		background: #fff;
	}

	.character-permission-check {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: 1px solid #c8c5ca;
		border-radius: 5px;
		color: #fff;
		flex: 0 0 auto;
	}

	.character-permission-row.confirmed .character-permission-check {
		border-color: #d43bc2;
		background: #d43bc2;
	}

	.character-permission-row > view:last-child {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 4px;
	}

	.character-permission-row > view:last-child text:first-child {
		font-size: 13px;
		font-weight: 620;
		color: #292a2f;
	}

	.character-permission-row > view:last-child text:last-child {
		font-size: 11px;
		color: #8b8c92;
	}

	.character-import-actions {
		display: grid;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.5fr);
		gap: 10px;
		padding: 12px 16px max(14px, env(safe-area-inset-bottom));
		border-top: 1px solid #efedf0;
	}

	.character-import-actions button {
		height: 46px;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 650;
	}

	.world-book-backdrop {
		z-index: 39;
		padding: 12px;
	}

	.world-book-manager {
		display: flex;
		max-height: min(72vh, 620px);
		padding: 0;
		overflow: hidden;
		flex-direction: column;
	}

	.world-book-manager .modal-heading {
		min-height: 56px;
		padding: 10px 10px 10px 16px;
		border-bottom: 1px solid #efedf0;
	}

	.world-book-manager-content {
		min-height: 140px;
		padding: 4px 16px;
		flex: 1;
	}

	.world-book-list {
		display: flex;
		flex-direction: column;
	}

	.world-book-row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 68px;
		border-bottom: 1px solid #f0eef1;
	}

	.world-book-row:last-child {
		border-bottom: 0;
	}

	.world-book-row-icon,
	.world-book-preview-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		border-radius: 8px;
		background: #fff0fb;
		color: #c937b7;
		flex: 0 0 auto;
	}

	.world-book-row-copy {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 5px;
	}

	.world-book-row-copy text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.world-book-row-copy text:first-child {
		font-size: 14px;
		font-weight: 650;
		color: #25262b;
	}

	.world-book-row-copy text:last-child {
		font-size: 11px;
		color: #929399;
	}

	.world-book-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 180px;
		flex-direction: column;
		gap: 10px;
		font-size: 13px;
		color: #98999e;
	}

	.world-book-import-button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 46px;
		margin: 12px 16px max(14px, env(safe-area-inset-bottom));
		border-radius: 8px;
		font-size: 14px;
		font-weight: 650;
		flex: 0 0 auto;
	}

	.world-book-import-modal {
		max-height: min(84vh, 740px);
	}

	.world-book-import-content {
		padding-top: 6px;
	}

	.world-book-preview-heading {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 4px 0 14px;
	}

	.world-book-preview-heading > view:last-child {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 5px;
	}

	.world-book-preview-heading > view:last-child text:first-child {
		overflow: hidden;
		font-size: 18px;
		font-weight: 680;
		color: #25262b;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.world-book-preview-heading > view:last-child text:last-child {
		font-size: 11px;
		color: #929399;
	}

	.world-book-binding-section {
		display: flex;
		margin-top: 14px;
		flex-direction: column;
		gap: 8px;
	}

	.world-book-binding-title {
		font-size: 12px;
		font-weight: 700;
		color: #5f6168;
	}

	.world-book-binding-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 50px;
		padding: 7px 10px;
		border: 1px solid #e8e5e9;
		border-radius: 8px;
		background: #fff;
		text-align: left;
		color: #292a2f;
	}

	.world-book-binding-row.selected {
		border-color: #e4a4dc;
		background: #fff8fe;
	}

	.world-book-binding-all > view:nth-child(2) {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 3px;
	}

	.world-book-binding-all > view:nth-child(2) text:first-child,
	.world-book-binding-row > text {
		font-size: 13px;
		font-weight: 620;
	}

	.world-book-binding-all > view:nth-child(2) text:last-child {
		font-size: 10px;
		color: #909197;
	}

	.world-book-binding-check {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 21px;
		height: 21px;
		border: 1px solid #c8c5ca;
		border-radius: 50%;
		color: #fff;
		flex: 0 0 auto;
	}

	.world-book-binding-row.selected .world-book-binding-check {
		border-color: #d43bc2;
		background: #d43bc2;
	}

	.world-book-character-list {
		display: flex;
		padding-left: 12px;
		flex-direction: column;
		gap: 6px;
	}

	.world-book-character-list .world-book-binding-check {
		margin-left: auto;
	}

	.world-book-character-avatar {
		display: block;
		width: 34px;
		height: 34px;
		overflow: hidden;
		border-radius: 50%;
		background: #ececf0;
		flex: 0 0 auto;
	}

	.world-book-no-characters {
		padding: 12px 4px;
		font-size: 11px;
		line-height: 1.5;
		color: #929399;
	}

	.modal-backdrop {
		position: absolute;
		inset: 0;
		z-index: 30;
		display: flex;
		align-items: flex-end;
		padding: 18px;
		background: rgba(20, 23, 28, 0.34);
	}

	.assistant-status-backdrop {
		padding: 0;
		background: rgba(20, 23, 28, 0.18);
		animation: assistant-status-backdrop-in 180ms ease-out both;
	}

	.assistant-status-modal {
		position: relative;
		display: flex;
		width: 100%;
		max-height: min(70%, 620px);
		margin: 0 auto;
		overflow: hidden;
		border-radius: 8px 8px 0 0;
		background: #fff;
		box-shadow: 0 -12px 36px rgba(20, 23, 28, 0.16);
		flex-direction: column;
		animation: assistant-status-sheet-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.assistant-status-grabber {
		width: 38px;
		height: 4px;
		margin: 10px auto 0;
		border-radius: 2px;
		background: #c7ccd2;
		flex: 0 0 auto;
	}

	.assistant-status-close {
		position: absolute;
		top: 11px;
		right: 8px;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		color: #46555c;
	}

	.assistant-status-hero {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		align-items: stretch;
		padding: 14px 44px 10px 16px;
		flex: 0 0 auto;
	}

	.assistant-status-hero-item {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		min-height: 34px;
		padding: 0 8px;
		border-left: 1px solid #e8ecee;
		text-align: center;
	}

	.assistant-status-hero-item:first-child {
		padding-left: 0;
		border-left: 0;
	}

	.assistant-status-hero-item text {
		display: block;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.assistant-status-hero-item text:first-child {
		font-size: 10px;
		font-weight: 600;
		color: #728087;
	}

	.assistant-status-hero-item text:last-child {
		font-size: 14px;
		font-weight: 700;
		color: #214f60;
	}

	.assistant-status-hero-score text:last-child {
		color: #e64e75;
	}

	.assistant-status-progress-row {
		width: 140px;
		margin: 0 auto;
		padding: 0 0 10px;
		flex: 0 0 auto;
	}

	.assistant-status-progress {
		display: block;
		width: 100%;
		height: 3px;
		overflow: hidden;
		border: 0;
		border-radius: 2px;
		background: #e3e9eb;
		accent-color: #2fa49f;
		appearance: none;
		-webkit-appearance: none;
	}

	.assistant-status-progress::-webkit-progress-bar {
		border-radius: 2px;
		background: #e3e9eb;
	}

	.assistant-status-progress::-webkit-progress-value {
		border-radius: 2px;
		background: #2fa49f;
	}

	.assistant-status-progress::-moz-progress-bar {
		border-radius: 2px;
		background: #2fa49f;
	}

	.assistant-status-content {
		min-height: 0;
		padding: 0 16px max(12px, env(safe-area-inset-bottom));
		overflow-y: auto;
		flex: 1;
	}

	.assistant-status-section {
		padding: 12px 0;
		border-bottom: 1px solid #e7ecee;
	}

	.assistant-status-section:last-child {
		border-bottom: 0;
	}

	.assistant-status-section-heading {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-bottom: 8px;
		color: #2a9aa0;
	}

	.assistant-status-section-heading > .app-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px !important;
		height: 22px !important;
		border-radius: 6px;
		background: #eaf6f5;
		font-size: 13px !important;
		line-height: 22px !important;
	}

	.assistant-status-section.is-private .assistant-status-section-heading {
		color: #7554aa;
	}

	.assistant-status-section.is-private .assistant-status-section-heading > .app-icon {
		background: #f1ecf8;
	}

	.assistant-status-section-title {
		display: block;
		font-size: 12px;
		font-weight: 700;
		color: currentColor;
	}

	.assistant-status-items {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.assistant-status-item {
		display: grid;
		grid-template-columns: minmax(74px, 0.36fr) minmax(0, 1fr);
		align-items: start;
		gap: 12px;
		font-size: 13px;
		line-height: 1.45;
	}

	.assistant-status-item > text:first-child {
		color: #7b858b;
	}

	.assistant-status-item > text:last-child,
	.assistant-status-text {
		color: #242c31;
		white-space: pre-wrap;
		word-break: break-word;
		-webkit-user-select: text;
		user-select: text;
	}

	.assistant-status-text {
		display: block;
		font-size: 13px;
		line-height: 1.55;
	}

	.action-modal {
		width: 100%;
		padding: 14px;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 16px 40px rgba(20, 23, 28, 0.2);
	}

	.provider-avatar-backdrop {
		padding: 12px;
	}

	.provider-avatar-modal {
		display: flex;
		flex-direction: column;
		max-height: calc(100% - 24px);
		padding: 0;
		overflow: hidden;
	}

	.provider-avatar-modal .modal-heading {
		min-height: 60px;
		padding: 9px 10px 9px 16px;
		border-bottom: 1px solid var(--border);
		flex: 0 0 auto;
	}

	.provider-avatar-modal .modal-heading > view {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.provider-avatar-modal-subtitle {
		margin-top: 2px;
		font-size: 11px;
		font-weight: 400;
		line-height: 16px;
		color: var(--muted);
	}

	.provider-avatar-modal-content {
		display: block;
		max-height: min(72vh, 610px);
		padding: 14px 14px max(18px, env(safe-area-inset-bottom));
		overflow-y: auto;
	}

	.provider-avatar-auto-option,
	.provider-avatar-custom-option {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 64px;
		padding: 8px 10px;
		border: 1px solid #ececf0;
		border-radius: 8px;
		background: #fafafd;
		text-align: left;
	}

	.provider-avatar-auto-option.selected,
	.provider-avatar-custom-option.selected {
		border-color: #e5a6dd;
		background: var(--provider-accent-soft);
	}

	.provider-avatar-option-image {
		display: block;
		width: 44px;
		height: 44px;
		margin-right: 11px;
		padding: 3px;
		border: 1px solid #ececf0;
		border-radius: 50%;
		background: #fff;
		flex: 0 0 auto;
	}

	.provider-avatar-auto-option > view:nth-child(2),
	.provider-avatar-custom-option > view:nth-child(2) {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.provider-avatar-auto-option > view:nth-child(2) text:first-child,
	.provider-avatar-custom-option > view:nth-child(2) text:first-child {
		font-size: 14px;
		font-weight: 650;
		line-height: 20px;
		color: #27282d;
	}

	.provider-avatar-auto-option > view:nth-child(2) text:last-child,
	.provider-avatar-custom-option > view:nth-child(2) text:last-child {
		margin-top: 2px;
		font-size: 11px;
		line-height: 16px;
		color: #85878d;
	}

	.provider-avatar-option-check {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		margin-left: 8px;
		border: 1px solid #d6d7dc;
		border-radius: 50%;
		color: #fff;
		flex: 0 0 auto;
	}

	.provider-avatar-auto-option.selected .provider-avatar-option-check {
		border-color: var(--provider-accent);
		background: var(--provider-accent);
	}

	.provider-avatar-section-label {
		display: block;
		margin: 16px 2px 10px;
		font-size: 12px;
		font-weight: 700;
		color: #55575d;
	}

	.provider-avatar-preset-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
		width: 100%;
	}

	.provider-avatar-preset {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		min-width: 0;
		height: 92px;
		padding: 7px 4px;
		border: 1px solid #ececf0;
		border-radius: 8px;
		background: #fff;
	}

	.provider-avatar-preset.selected {
		border-color: #e5a6dd;
		background: var(--provider-accent-soft);
	}

	.provider-avatar-preset-image-wrap {
		position: relative;
		width: 54px;
		height: 54px;
		border: 1px solid #efeff2;
		border-radius: 50%;
		background: #fff;
		overflow: visible;
	}

	.provider-avatar-preset-image {
		display: block;
		width: 54px;
		height: 54px;
		padding: 4px;
		border-radius: 50%;
	}

	.provider-avatar-preset-check {
		position: absolute;
		right: -2px;
		bottom: -2px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: 2px solid #fff;
		border-radius: 50%;
		background: var(--provider-accent);
		color: #fff;
	}

	.provider-avatar-preset > text {
		display: block;
		width: 100%;
		margin-top: 5px;
		font-size: 11px;
		font-weight: 600;
		line-height: 15px;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.provider-avatar-custom-option {
		margin-top: 14px;
	}

	.provider-avatar-custom-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		margin-right: 11px;
		border-radius: 50%;
		background: #efe8f0;
		color: var(--provider-accent);
		flex: 0 0 auto;
	}

	.provider-avatar-custom-option > svg,
	.provider-avatar-custom-option > .lucide {
		margin-left: 8px;
		color: var(--provider-accent);
		flex: 0 0 auto;
	}

	.backup-modal-backdrop {
		padding: 12px;
	}

	.backup-transfer-modal {
		display: flex;
		flex-direction: column;
		max-height: calc(100% - 24px);
		padding: 0;
		overflow: hidden;
	}

	.backup-transfer-modal .modal-heading {
		min-height: 54px;
		padding: 8px 10px 8px 14px;
		border-bottom: 1px solid var(--border);
		flex: 0 0 auto;
	}

	.backup-transfer-content {
		display: block;
		max-height: min(72vh, 610px);
		padding: 14px 14px max(14px, env(safe-area-inset-bottom));
		overflow-y: auto;
	}

	.backup-section-label {
		display: block;
		margin-bottom: 8px;
		font-size: 11px;
		font-weight: 700;
		color: var(--muted);
	}

	.backup-import-label {
		margin-top: 18px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
	}

	.backup-choice-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.backup-choice {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
		height: 68px;
		padding: 9px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: #fff;
		text-align: left;
	}

	.backup-choice:active,
	.backup-local-import:active {
		background: #f6f7f9;
	}

	.backup-choice:disabled,
	.backup-local-import:disabled,
	.backup-url-import button:disabled,
	.backup-transfer-modal .modal-heading button:disabled {
		opacity: 0.5;
	}

	.backup-choice-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 7px;
		flex: 0 0 auto;
	}

	.backup-choice-icon.local {
		background: #eef5ff;
		color: #3478d4;
	}

	.backup-choice-icon.cloud {
		background: #fff0fb;
		color: #c92bb8;
	}

	.backup-choice > view:last-child,
	.backup-local-import > view {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.backup-choice > view:last-child text:first-child,
	.backup-local-import > view text:first-child {
		font-size: 13px;
		font-weight: 650;
		color: var(--text);
	}

	.backup-choice > view:last-child text:last-child,
	.backup-local-import > view text:last-child {
		overflow: hidden;
		font-size: 10px;
		color: var(--muted);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.backup-link-result {
		margin-top: 12px;
		padding-top: 11px;
		border-top: 1px solid var(--border);
	}

	.backup-link-result > text {
		display: block;
		margin-bottom: 6px;
		font-size: 11px;
		font-weight: 650;
	}

	.backup-link-field,
	.backup-url-import {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
	}

	.backup-link-field input,
	.backup-url-import input {
		width: 100%;
		height: 40px;
		min-width: 0;
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: #f8f9fb;
		font-size: 11px;
		flex: 1;
	}

	.backup-link-field button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border: 1px solid #efc4e9;
		border-radius: 7px;
		background: #fff3fc;
		color: #c92bb8;
		flex: 0 0 auto;
	}

	.backup-local-import {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: 54px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		color: #3478d4;
		text-align: left;
	}

	.backup-url-import {
		margin-top: 8px;
	}

	.backup-url-import button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		width: 102px;
		height: 40px;
		border-radius: 7px;
		background: #d43bc2;
		color: #fff;
		font-size: 12px;
		font-weight: 650;
		flex: 0 0 auto;
	}

	.attachment-preview-backdrop {
		align-items: center;
		justify-content: center;
		padding: 14px;
	}

	.attachment-preview-modal {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-height: 78%;
		overflow: hidden;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 18px 42px rgba(20, 23, 28, 0.24);
	}

	.attachment-preview-header {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 54px;
		padding: 8px 10px 8px 14px;
		border-bottom: 1px solid var(--border);
	}

	.attachment-preview-header > view {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.attachment-preview-header text:first-child {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		font-weight: 700;
	}

	.attachment-preview-header text:last-child {
		font-size: 10px;
		color: var(--muted);
	}

	.attachment-preview-header button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		flex: 0 0 auto;
	}

	.attachment-preview-image {
		display: block;
		width: 100%;
		height: min(64vh, 560px);
		background-color: #11151b;
		background-position: center;
		background-repeat: no-repeat;
		background-size: contain;
	}

	.attachment-preview-text {
		display: block;
		height: min(64vh, 560px);
		padding: 14px;
		overflow-y: auto;
		background: #f8f9fb;
	}

	.attachment-preview-text text {
		display: block;
		font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
		font-size: 12px;
		line-height: 1.55;
		white-space: pre-wrap;
		word-break: break-word;
		-webkit-user-select: text;
		user-select: text;
	}

	.modal-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 2px 2px 10px;
		font-size: 15px;
		font-weight: 700;
	}

	.modal-heading button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
	}

	.modal-action {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: 48px;
		padding: 0 10px;
		border-top: 1px solid var(--border);
		font-size: 14px;
		text-align: left;
	}

	.avatar-reset-action {
		color: #d9363e;
	}

	.hidden-file-input {
		display: none;
	}

	.toast-message {
		position: absolute;
		left: 50%;
		bottom: 84px;
		z-index: 40;
		max-width: calc(100% - 40px);
		padding: 8px 12px;
		border-radius: 7px;
		background: rgba(17, 19, 21, 0.9);
		color: #fff;
		font-size: 12px;
		transform: translateX(-50%);
		white-space: nowrap;
	}

	.error-banner {
		position: absolute;
		left: 14px;
		right: 14px;
		top: calc(var(--status-bar-height, 0px) + 86px);
		z-index: 25;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px;
		border: 1px solid #efc7c4;
		border-radius: 8px;
		background: #fff6f5;
		color: #8a312b;
		font-size: 12px;
		box-shadow: 0 8px 20px rgba(32, 25, 24, 0.1);
	}

	.error-banner > text {
		min-width: 0;
		flex: 1;
		word-break: break-word;
	}

	.error-banner button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		flex: 0 0 auto;
	}

	.error-banner .error-retry-button {
		width: auto;
		min-width: 64px;
		gap: 4px;
		padding: 0 9px;
		border: 1px solid currentColor;
		border-radius: 6px;
		font-size: 12px;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@keyframes dot-pulse {
		0%, 70%, 100% { opacity: 0.35; transform: translateY(0); }
		35% { opacity: 1; transform: translateY(-2px); }
	}

	@keyframes page-switch-in {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}

	@keyframes bottom-nav-enter {
		from { opacity: 0; transform: translateY(16px) scale(0.98); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}

	@keyframes user-message-pop-in {
		0% { opacity: 0; transform: translate(12px, 8px) scale(0.92); }
		70% { opacity: 1; transform: translate(-1px, -1px) scale(1.015); }
		100% { opacity: 1; transform: translate(0, 0) scale(1); }
	}

	@keyframes assistant-message-pop-in {
		0% { opacity: 0; transform: translate(-12px, 8px) scale(0.92); }
		70% { opacity: 1; transform: translate(1px, -1px) scale(1.015); }
		100% { opacity: 1; transform: translate(0, 0) scale(1); }
	}

	@keyframes assistant-status-backdrop-in {
		from { background-color: rgba(20, 23, 28, 0); }
		to { background-color: rgba(20, 23, 28, 0.18); }
	}

	@keyframes assistant-status-sheet-in {
		from { opacity: 0; transform: translateY(24px); }
		to { opacity: 1; transform: translateY(0); }
	}

	@media (max-width: 370px) {
		.character-status-bar {
			gap: 5px;
		}

		.character-status-field {
			padding-left: 5px;
		}

		.character-status-update text {
			display: none;
		}

		.assistant-status-hero {
			padding-right: 42px;
			padding-left: 12px;
		}

		.assistant-status-hero-item {
			gap: 2px;
			padding: 0 5px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.screen-view,
		.chat-toolbar,
		.chat-scroll,
		.composer,
		.bottom-nav,
		.message-pop,
		.assistant-status-backdrop,
		.assistant-status-modal {
			animation: none;
		}

		.nav-indicator,
		.nav-item,
		.nav-item .app-icon {
			transition: none;
		}
	}

	@media (min-width: 600px) and (hover: hover) and (pointer: fine) {
		.app-shell {
			width: 390px;
			height: min(100vh, 844px);
			height: min(100dvh, 844px);
			margin: 0 auto;
			box-shadow: 0 8px 32px rgba(20, 23, 28, 0.1);
		}
	}
</style>

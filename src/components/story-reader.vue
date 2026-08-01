<template>
	<view
		class="story-reader-shell"
		:class="{
			'story-chrome-visible': readerChromeShown,
			'story-chrome-hidden': !readerChromeShown,
			'story-page-mode-active': normalizedMode === 'page'
		}"
		:data-chrome-visible="readerChromeShown ? 'true' : 'false'"
		data-testid="story-reader"
	>
		<view class="story-reader-top-chrome" data-testid="story-reader-top-chrome" :aria-hidden="!readerChromeShown">
			<view class="story-reader-toolbar">
				<button class="story-toolbar-button" data-testid="back-to-conversations" aria-label="返回故事列表" @click="leaveStory"><ArrowLeft :size="25" /></button>
				<button class="story-book-identity" :disabled="generating" aria-label="选择故事模型" @click="$emit('toggle-model')">
					<ProviderLogo class="story-book-avatar" :src="avatarSource" :alt="readerTitle" mode="aspectFill" />
					<view><text class="story-book-title">{{ readerTitle }}</text><text class="story-book-model">{{ modelName }}</text></view>
				</button>
				<view class="story-toolbar-actions">
					<button v-if="statusAvailable" class="story-toolbar-button story-status-button" aria-label="查看角色状态" title="角色状态" @click="$emit('open-status')"><Activity :size="20" /></button>
					<button
						v-if="normalizedMode === 'scroll'"
						class="story-toolbar-button"
						data-testid="story-scroll-bottom"
						:disabled="!storyBlocks.length"
						aria-label="滚动到底部"
						title="滚动到底部"
						@click="scrollStoryToBottom"
					><ChevronDown :size="21" /></button>
					<button
						class="story-toolbar-button story-bookmark-button"
						:class="{ active: currentPageHasBookmark }"
						data-testid="story-bookmark-menu"
						:aria-label="currentPageHasBookmark ? '查看书签，本页已有书签' : '查看书签'"
						title="书签"
						@click="toggleBookmarkPanel"
					>
						<BookmarkFilled v-if="currentPageHasBookmark" :size="19" />
						<Bookmark v-else :size="19" />
					</button>
					<button class="story-toolbar-button" aria-label="管理故事" title="管理故事" @click="$emit('manage')"><MoreVertical :size="22" /></button>
				</view>
			</view>

			<view class="story-reader-modebar">
				<view class="story-reader-tabs" role="tablist" aria-label="阅读方式">
					<button data-testid="story-page-mode" role="tab" :aria-selected="normalizedMode === 'page'" :class="{ active: normalizedMode === 'page' }" @click="setMode('page')"><FileText :size="17" /><text>翻页</text></button>
					<button data-testid="story-scroll-mode" role="tab" :aria-selected="normalizedMode === 'scroll'" :class="{ active: normalizedMode === 'scroll' }" @click="setMode('scroll')"><Menu :size="17" /><text>滚动</text></button>
				</view>
				<text class="story-mode-meta">{{ normalizedMode === 'page' ? `${currentPageNumber} / ${pageCount}` : '连续阅读' }}</text>
			</view>
		</view>

		<view v-if="modelMenuOpen" class="story-reader-backdrop" @click="$emit('close-menus')" />
		<view v-if="modelMenuOpen" class="story-model-popover">
			<text class="story-popover-label">选择接口与模型</text>
			<button v-for="provider in providers" :key="provider.id" @click="$emit('select-provider', provider)">
				<text>{{ provider.name }}</text><text>{{ provider.defaultModel }}</text>
			</button>
		</view>

		<view v-if="bookmarkPanelOpen" class="story-reader-backdrop story-bookmark-backdrop" @click="closeBookmarkPanel" />
		<view v-if="bookmarkPanelOpen" class="story-bookmark-sheet" data-testid="story-bookmark-panel">
			<view class="story-bookmark-heading">
				<view><text>书签</text><text>{{ normalizedBookmarks.length }} 条</text></view>
				<button aria-label="关闭书签" @click="closeBookmarkPanel"><X :size="18" /></button>
			</view>
			<button
				class="story-bookmark-toggle"
				:class="{ active: Boolean(currentExactBookmark) }"
				:disabled="!currentBookmarkPosition"
				data-testid="story-bookmark-toggle"
				@click="toggleCurrentBookmark"
			>
				<BookmarkFilled v-if="currentExactBookmark" :size="20" />
				<Bookmark v-else :size="20" />
				<view>
					<text>{{ currentExactBookmark ? '移除当前位置书签' : '添加当前位置书签' }}</text>
					<text>{{ normalizedMode === 'page' ? `第 ${currentPageNumber} 页` : '当前阅读位置' }}</text>
				</view>
			</button>
			<scroll-view v-if="bookmarkItems.length" class="story-bookmark-list" scroll-y>
				<view v-for="bookmark in bookmarkItems" :key="bookmark.id" class="story-bookmark-row">
					<button class="story-bookmark-open" :disabled="bookmark.pageIndex < 0" :aria-label="`跳转书签 ${bookmark.locationLabel}`" @click="openBookmark(bookmark)">
						<view class="story-bookmark-meta"><text>{{ bookmark.locationLabel }}</text><text>{{ formatBookmarkTime(bookmark.createdAt) }}</text></view>
						<text class="story-bookmark-excerpt">{{ bookmark.excerpt || '故事书签' }}</text>
					</button>
					<button class="story-bookmark-delete" :aria-label="`删除书签 ${bookmark.locationLabel}`" @click="removeBookmark(bookmark)"><Trash2 :size="16" /></button>
				</view>
			</scroll-view>
			<view v-else class="story-bookmark-empty"><Bookmark :size="25" /><text>还没有书签</text></view>
		</view>

		<view class="story-reader-body">
			<view v-if="loading && !storyBlocks.length" class="story-reader-loading" aria-label="正在打开故事">
				<view /><view /><view /><view />
			</view>

			<template v-else-if="normalizedMode === 'page'">
				<view class="story-page-stage">
					<view class="story-page" @click="handleReaderClick" @touchstart="handleTouchStart" @touchend="handleTouchEnd">
						<view :key="pageAnimationKey" class="story-page-content" :class="pageTurnClass" data-testid="story-page-content">
						<view class="story-page-running-head"><text>{{ readerTitle }}</text><text>{{ currentPageNumber }}</text></view>
						<view v-if="historyHasMore && currentPageIndex === 0" class="story-history-command">
							<button :disabled="loading || generating" @click="$emit('load-earlier')"><RefreshCw :size="14" /><text>{{ loading ? '加载中' : '加载更早内容' }}</text></button>
						</view>
						<view v-if="!storyBlocks.length" class="story-reader-empty"><FileText :size="34" /><text>故事尚未开始</text></view>
						<StoryReaderBlock
							v-for="block in currentPage.blocks"
							:key="block.id"
							:block="block"
							:can-continue="continueMessageId === block.messageId"
							@copy="$emit('copy', $event)"
							@feedback="$emit('feedback', $event)"
							@retry="$emit('retry', $event)"
							@continue="continueStory"
							@stop="$emit('stop')"
							@preview-image="$emit('preview-image', $event)"
							@preview-text="$emit('preview-text', $event)"
						/>
						<view v-if="historyTrimmed && currentPageIndex === pageCount - 1" class="story-history-command is-latest">
							<button :disabled="loading || generating" @click="$emit('reload-latest')"><ChevronRight :size="14" /><text>返回最新内容</text></button>
						</view>
						</view>
					</view>
					<view class="story-page-controls">
						<button :disabled="currentPageIndex <= 0" aria-label="上一页" @click="previousPage"><ChevronRight class="story-prev-icon" :size="22" /></button>
						<text class="story-reader-page-counter" data-testid="story-page-counter">{{ currentPageNumber }} / {{ pageCount }}</text>
						<button :disabled="currentPageIndex >= pageCount - 1" aria-label="下一页" @click="nextPage"><ChevronRight :size="22" /></button>
					</view>
				</view>
			</template>

			<scroll-view ref="storyScroll" v-else class="story-reader-scroll" scroll-y :scroll-into-view="storyScrollIntoView" :scroll-top="storyScrollTop" @scroll="handleStoryScroll" @click="handleReaderClick" @touchstart="handleTouchStart" @touchend="handleScrollTouchEnd">
				<view class="story-scroll-paper">
					<view v-if="historyHasMore" class="story-history-command">
						<button :disabled="loading || generating" @click="$emit('load-earlier')"><RefreshCw :size="14" /><text>{{ loading ? '加载中' : '加载更早内容' }}</text></button>
					</view>
					<view v-if="!storyBlocks.length" class="story-reader-empty"><FileText :size="34" /><text>故事尚未开始</text></view>
					<StoryReaderBlock
						v-for="block in storyBlocks"
						:key="block.id"
						:block="block"
						:can-continue="continueMessageId === block.messageId"
						@copy="$emit('copy', $event)"
						@feedback="$emit('feedback', $event)"
						@retry="$emit('retry', $event)"
						@continue="continueStory"
						@stop="$emit('stop')"
						@preview-image="$emit('preview-image', $event)"
						@preview-text="$emit('preview-text', $event)"
					/>
					<view v-if="historyTrimmed" class="story-history-command is-latest">
						<button :disabled="loading || generating" @click="$emit('reload-latest')"><ChevronRight :size="14" /><text>返回最新内容</text></button>
					</view>
					<view id="story-scroll-end" class="story-scroll-tail" aria-hidden="true" />
				</view>
			</scroll-view>
		</view>

		<view v-if="attachmentMenuOpen" class="story-reader-backdrop composer-backdrop" @click="$emit('close-menus')" />
		<view
			class="story-direction-composer"
			:class="{ 'has-attachments': pendingAttachments.length || attachmentProcessing, 'is-multiline': composerInputHeight > 44 }"
			:aria-hidden="!readerChromeShown"
			data-testid="story-reader-composer"
		>
			<view v-if="attachmentMenuOpen" class="story-attachment-popover">
				<button v-for="action in attachmentActions" :key="action.id" :aria-label="action.label" @click="$emit('choose-attachment', action)"><component :is="iconMap[action.icon]" :size="24" /><text>{{ action.label }}</text></button>
			</view>
			<scroll-view v-if="pendingAttachments.length || attachmentProcessing" class="story-pending-strip" scroll-x>
				<view class="story-pending-list">
					<view v-for="(attachment, index) in pendingAttachments" :key="`${attachment.kind}-${attachment.name}-${index}`" class="story-pending-item">
						<AppImage v-if="attachment.kind === 'image'" class="story-pending-image" :src="attachmentSource(attachment)" :alt="attachment.name" mode="aspectFill" />
						<FileText v-else :size="17" />
						<view><text>{{ attachment.name }}</text><text>{{ formatAttachmentSize(attachment.byteSize) }}</text></view>
						<button :disabled="attachmentProcessing" :aria-label="`移除附件 ${attachment.name}`" @click="$emit('remove-attachment', index)"><X :size="12" /></button>
					</view>
					<view v-if="attachmentProcessing" class="story-pending-processing"><RefreshCw :size="16" /><text>处理中</text></view>
				</view>
			</scroll-view>
			<view class="story-composer-row">
				<button class="story-attachment-button" :disabled="generating" aria-label="添加附件" title="添加附件" @click="$emit('toggle-attachments')"><Paperclip :size="24" /></button>
				<textarea v-model="draftValue" class="story-direction-input" rows="1" maxlength="-1" :style="{ height: `${composerInputHeight}px` }" placeholder="输入事件走向，留空续写" placeholder-style="color:#97939a;font-size:14px" @linechange="resizeComposer" />
				<button class="story-send-button" :disabled="!generating && !canSend" :aria-label="generating ? '停止生成' : '发送事件走向'" @click="submit"><Square v-if="generating" :size="12" fill="currentColor" /><Send v-else :size="19" /></button>
			</view>
		</view>
	</view>
</template>

<script>
	import { markRaw } from 'vue'
	import AppImage from './app-image.js'
	import {
		Activity, ArrowLeft, Bookmark, BookmarkFilled, Camera, ChevronDown, ChevronRight, FileText, Image, Menu, MoreVertical,
		Paperclip, RefreshCw, Send, Square, Trash2, X
	} from './app-icons.js'
	import ProviderLogo from './provider-logo.js'
	import StoryReaderBlock from './story-reader-block.vue'
	import { formatAttachmentSize } from '../core/attachment-policy.js'
	import { imageAttachmentSource } from '../core/image-output.js'
	import {
		createStoryReaderBookmark, createStoryReaderBlocks, createStoryReaderPosition, normalizeStoryReaderBookmark,
		normalizeStoryReaderBookmarks, normalizeStoryReaderMode, normalizeStoryReaderPosition, paginateStoryBlocks,
		storyBlockDomId, storyBlockSourceId, storyBlockSourceOffset, storyPageCapacity, storyPageIndexForPosition,
		storyTextLength
	} from '../core/story-reader.js'

	const iconMap = markRaw({ Camera, FileText, Image })
	const STORY_SCROLL_RESTORE_INITIAL_DELAY = 48
	const STORY_SCROLL_RESTORE_RETRY_DELAY = 80
	const STORY_SCROLL_RESTORE_MAX_ATTEMPTS = 5
	const STORY_SCROLL_RESTORE_SUPPRESS_MS = 900
	const STORY_SCROLL_END_ANCHOR_ID = 'story-scroll-end'

	export default {
		name: 'StoryReader',
		components: {
			Activity, AppImage, ArrowLeft, Bookmark, BookmarkFilled, ChevronDown, ChevronRight, FileText, Menu, MoreVertical,
			Paperclip, ProviderLogo, RefreshCw, Send, Square, StoryReaderBlock, Trash2, X
		},
		props: {
			conversation: { type: Object, default: null },
			messages: { type: Array, default: () => [] },
			avatarSource: { type: String, default: '/static/zhiyu-logo.png' },
			providerName: { type: String, default: '' },
			modelName: { type: String, default: '' },
			providers: { type: Array, default: () => [] },
			modelMenuOpen: { type: Boolean, default: false },
			statusAvailable: { type: Boolean, default: false },
			mode: { type: String, default: 'page' },
			readerPosition: { type: Object, default: null },
			bookmarks: { type: Array, default: () => [] },
			loading: { type: Boolean, default: false },
			historyHasMore: { type: Boolean, default: false },
			historyTrimmed: { type: Boolean, default: false },
			generating: { type: Boolean, default: false },
			continueMessageId: { type: String, default: '' },
			modelValue: { type: String, default: '' },
			canSend: { type: Boolean, default: false },
			pendingAttachments: { type: Array, default: () => [] },
			attachmentProcessing: { type: Boolean, default: false },
			attachmentMenuOpen: { type: Boolean, default: false },
			attachmentActions: { type: Array, default: () => [] }
		},
		emits: [
			'back', 'choose-attachment', 'close-menus', 'continue', 'copy', 'feedback', 'load-earlier', 'manage',
			'open-status', 'preview-image', 'preview-text', 'reload-latest', 'remove-attachment', 'retry',
			'select-provider', 'stop', 'submit', 'toggle-attachments', 'toggle-model', 'update:bookmarks', 'update:mode',
			'update:modelValue', 'update:readerPosition'
		],
		data() {
			return {
				iconMap,
				currentPageIndex: 0,
				initialPagePositioned: false,
				initialViewportMeasured: false,
				readingPosition: null,
				pageCapacity: storyPageCapacity(),
				readerChromeVisible: false,
				bookmarkPanelOpen: false,
				pageTurnDirection: '',
				pageTurnRevision: 0,
				pageTurnTimer: null,
				touchStartX: null,
				touchStartY: null,
				lastReaderGestureAt: 0,
				lastReaderGestureX: null,
				lastReaderGestureY: null,
				storyScrollIntoView: '',
				storyScrollTop: 0,
				lastStoryScrollTop: 0,
				scrollPositionTimer: null,
				scrollRestoreTimer: null,
				scrollRestoreRevision: 0,
				suppressScrollPositionUntil: 0,
				composerInputHeight: 44,
				resizeHandler: null
			}
		},
		computed: {
			normalizedMode() { return normalizeStoryReaderMode(this.mode) },
			readerChromeShown() { return this.readerChromeVisible || this.modelMenuOpen || this.attachmentMenuOpen || this.bookmarkPanelOpen },
			readerTitle() { return this.providerName || this.conversation?.title || '未命名故事' },
			storyBlocks() { return createStoryReaderBlocks(this.messages) },
			storyPages() { return paginateStoryBlocks(this.storyBlocks, { capacity: this.pageCapacity }) },
			pageCount() { return Math.max(1, this.storyPages.length) },
			currentPageNumber() { return Math.min(this.pageCount, this.currentPageIndex + 1) },
			currentPage() { return this.storyPages[Math.min(this.currentPageIndex, this.pageCount - 1)] || { blocks: [] } },
			pageTurnClass() { return this.pageTurnDirection ? `turn-${this.pageTurnDirection}` : '' },
			pageAnimationKey() { return `${this.currentPage.id || 'empty'}-${this.pageTurnRevision}` },
			normalizedBookmarks() { return normalizeStoryReaderBookmarks(this.bookmarks, this.conversation?.id) },
			bookmarkItems() {
				return this.normalizedBookmarks.map(bookmark => {
					const pageIndex = storyPageIndexForPosition(this.storyPages, bookmark)
					return {
						...bookmark,
						pageIndex,
						locationLabel: pageIndex >= 0 ? `第 ${pageIndex + 1} 页` : '较早内容'
					}
				})
			},
			currentBookmarkPosition() {
				if (!this.storyBlocks.length) return null
				if (this.normalizedMode === 'scroll') return this.positionForConversation(this.readingPosition)
				return this.positionForPage(this.currentPage, this.readingPosition)
			},
			currentExactBookmark() {
				const positionKey = this.bookmarkPositionKey(this.currentBookmarkPosition)
				return positionKey
					? this.normalizedBookmarks.find(bookmark => this.bookmarkPositionKey(bookmark) === positionKey) || null
					: null
			},
			currentPageHasBookmark() {
				const pageIndex = storyPageIndexForPosition(this.storyPages, this.currentBookmarkPosition)
				return pageIndex >= 0 && this.bookmarkItems.some(bookmark => bookmark.pageIndex === pageIndex)
			},
			draftValue: {
				get() { return this.modelValue },
				set(value) { this.$emit('update:modelValue', value) }
			}
		},
		watch: {
			storyPages(nextPages, previousPages) {
				const nextHasContent = Boolean(nextPages?.some(page => page.blocks?.length))
				const previousHasContent = Boolean(previousPages?.some(page => page.blocks?.length))
				if (!nextHasContent) {
					this.currentPageIndex = 0
					this.initialPagePositioned = false
					return
				}
				if (!this.initialViewportMeasured) return
				if (!this.initialPagePositioned || !previousHasContent) {
					this.initializeReadingPosition(nextPages)
					return
				}
				const previousCount = Math.max(1, previousPages?.length || 1)
				const previousIndex = Math.min(this.currentPageIndex, previousCount - 1)
				const previousPosition = this.positionForPage(previousPages?.[previousIndex], this.readingPosition)
				const anchoredIndex = storyPageIndexForPosition(nextPages, previousPosition)
				this.currentPageIndex = anchoredIndex >= 0
					? anchoredIndex
					: Math.min(previousIndex, Math.max(0, nextPages.length - 1))
			},
			readerPosition: {
				deep: true,
				immediate: true,
				handler(value) {
					const position = this.positionForConversation(value)
					if (!position || this.positionsEqual(position, this.readingPosition)) return
					this.readingPosition = position
					if (!this.storyBlocks.length) return
					if (this.normalizedMode === 'page') this.restorePagePosition(position)
					else this.scheduleScrollPositionRestore(position)
				}
			},
			mode(value) {
				if (normalizeStoryReaderMode(value) === 'page') {
					this.cancelScrollPositionRestore()
					this.restorePagePosition(this.readingPosition)
				}
				else this.scheduleScrollPositionRestore(this.readingPosition)
			},
			'conversation.id'() {
				clearTimeout(this.scrollPositionTimer)
				this.scrollPositionTimer = null
				this.cancelScrollPositionRestore()
				this.readerChromeVisible = false
				this.bookmarkPanelOpen = false
				this.pageTurnDirection = ''
				this.initialPagePositioned = false
				this.readingPosition = null
				this.storyScrollIntoView = ''
				this.storyScrollTop = 0
				this.lastStoryScrollTop = 0
				this.$nextTick(() => {
					this.initializeReadingPosition(this.storyPages)
				})
			}
		},
		mounted() {
			this.resizeHandler = () => this.measureViewport()
			this.$nextTick(() => {
				this.measureViewport()
				this.initialViewportMeasured = true
				this.$nextTick(() => this.initializeReadingPosition(this.storyPages))
			})
			if (typeof window !== 'undefined') window.addEventListener('resize', this.resizeHandler)
		},
		beforeUnmount() {
			if (this.normalizedMode === 'scroll') this.captureScrollReadingPosition()
			this.cancelScrollPositionRestore()
			clearTimeout(this.pageTurnTimer)
			clearTimeout(this.scrollPositionTimer)
			if (typeof window !== 'undefined' && this.resizeHandler) window.removeEventListener('resize', this.resizeHandler)
		},
		methods: {
			attachmentSource: imageAttachmentSource,
			formatAttachmentSize,
			measureViewport() {
				const width = Number(this.$el?.clientWidth) || Number(globalThis.innerWidth) || 390
				const height = Number(this.$el?.clientHeight) || Number(globalThis.innerHeight) || 844
				this.pageCapacity = storyPageCapacity({ width, height, reservedHeight: 122 })
				this.resetReaderShellScroll()
			},
			resetReaderShellScroll() {
				const shell = this.$el
				if (shell && 'scrollTop' in shell && shell.scrollTop !== 0) shell.scrollTop = 0
			},
			positionsEqual(left, right) {
				return Boolean(left && right && left.conversationId === right.conversationId &&
					left.blockId === right.blockId && left.characterOffset === right.characterOffset)
			},
			positionForConversation(value) {
				return normalizeStoryReaderPosition(value, this.conversation?.id)
			},
			positionForBlock(block, relativeCharacterOffset = 0) {
				return createStoryReaderPosition(this.conversation?.id, block, relativeCharacterOffset)
			},
			positionForPage(page = this.currentPage, preferredPosition = null) {
				const preferred = this.positionForConversation(preferredPosition)
				if (preferred && storyPageIndexForPosition([page], preferred) === 0) return preferred
				return this.positionForBlock(page?.blocks?.[0])
			},
			bookmarkPositionKey(value) {
				const position = this.positionForConversation(value)
				return position ? `${position.blockId}:${position.characterOffset}` : ''
			},
			bookmarkExcerpt(position) {
				const normalized = this.positionForConversation(position)
				const block = normalized
					? this.storyBlocks.find(item => storyBlockSourceId(item) === normalized.blockId)
					: null
				if (!block) return ''
				const characters = Array.from(String(block.text || ''))
				const relativeOffset = Math.max(0, normalized.characterOffset - storyBlockSourceOffset(block))
				return characters.slice(relativeOffset, relativeOffset + 72).join('').replace(/\s+/g, ' ').trim()
			},
			formatBookmarkTime(value) {
				const date = new Date(value)
				if (Number.isNaN(date.getTime())) return ''
				const month = String(date.getMonth() + 1).padStart(2, '0')
				const day = String(date.getDate()).padStart(2, '0')
				const hours = String(date.getHours()).padStart(2, '0')
				const minutes = String(date.getMinutes()).padStart(2, '0')
				return `${month}-${day} ${hours}:${minutes}`
			},
			toggleBookmarkPanel() {
				const opening = !this.bookmarkPanelOpen
				if (opening) {
					this.$emit('close-menus')
					if (this.normalizedMode === 'scroll') this.captureScrollReadingPosition()
					this.readerChromeVisible = true
				}
				this.bookmarkPanelOpen = opening
			},
			closeBookmarkPanel() {
				this.bookmarkPanelOpen = false
			},
			toggleCurrentBookmark() {
				const position = this.normalizedMode === 'scroll'
					? (this.captureScrollReadingPosition() || this.currentBookmarkPosition)
					: this.currentBookmarkPosition
				const positionKey = this.bookmarkPositionKey(position)
				if (!position || !positionKey) return
				const existing = this.normalizedBookmarks.find(bookmark => this.bookmarkPositionKey(bookmark) === positionKey)
				const nextBookmarks = existing
					? this.normalizedBookmarks.filter(bookmark => this.bookmarkPositionKey(bookmark) !== positionKey)
					: normalizeStoryReaderBookmarks([
						createStoryReaderBookmark(this.conversation?.id, position, this.bookmarkExcerpt(position)),
						...this.normalizedBookmarks
					], this.conversation?.id)
				this.$emit('update:bookmarks', nextBookmarks)
			},
			removeBookmark(bookmark) {
				const positionKey = this.bookmarkPositionKey(bookmark)
				if (!positionKey) return
				this.$emit('update:bookmarks', this.normalizedBookmarks.filter(item => this.bookmarkPositionKey(item) !== positionKey))
			},
			openBookmark(value) {
				const bookmark = normalizeStoryReaderBookmark(value, this.conversation?.id)
				const pageIndex = bookmark ? storyPageIndexForPosition(this.storyPages, bookmark) : -1
				if (!bookmark || pageIndex < 0) return
				this.closeBookmarkPanel()
				if (this.normalizedMode === 'page') {
					this.changePage(pageIndex, { position: bookmark })
					return
				}
				this.rememberReadingPosition(bookmark)
				this.scheduleScrollPositionRestore(bookmark)
			},
			rememberReadingPosition(position) {
				const normalized = this.positionForConversation(position)
				if (!normalized) return null
				const changed = !this.positionsEqual(normalized, this.readingPosition)
				this.readingPosition = normalized
				if (changed) this.$emit('update:readerPosition', normalized)
				return normalized
			},
			initializeReadingPosition(pages = this.storyPages) {
				if (!this.storyBlocks.length || !pages?.length) {
					this.currentPageIndex = 0
					this.initialPagePositioned = false
					return
				}
				const savedPosition = this.positionForConversation(this.readerPosition) || this.readingPosition
				const savedPageIndex = storyPageIndexForPosition(pages, savedPosition)
				this.currentPageIndex = savedPageIndex >= 0 ? savedPageIndex : Math.max(0, pages.length - 1)
				this.initialPagePositioned = true
				this.readingPosition = savedPageIndex >= 0
					? savedPosition
					: this.positionForPage(pages[this.currentPageIndex])
				if (this.normalizedMode === 'scroll') this.scheduleScrollPositionRestore(this.readingPosition)
			},
			restorePagePosition(position, pages = this.storyPages) {
				const pageIndex = storyPageIndexForPosition(pages, this.positionForConversation(position))
				if (pageIndex < 0) return false
				this.currentPageIndex = pageIndex
				this.initialPagePositioned = true
				return true
			},
			setMode(mode) {
				const nextMode = normalizeStoryReaderMode(mode)
				if (nextMode === this.normalizedMode) return
				this.closeBookmarkPanel()
				this.pageTurnDirection = ''
				const position = this.normalizedMode === 'scroll'
					? (this.captureScrollReadingPosition() || this.readingPosition)
					: this.rememberReadingPosition(this.positionForPage(this.currentPage, this.readingPosition))
				if (nextMode === 'page') {
					this.cancelScrollPositionRestore()
					this.restorePagePosition(position)
				}
				else this.prepareScrollPositionRestore(position)
				this.$emit('update:mode', nextMode)
				this.$nextTick(() => this.resetReaderShellScroll())
			},
			changePage(nextIndex, { position = null, animate = true } = {}) {
				const normalizedIndex = Math.max(0, Math.min(this.pageCount - 1, nextIndex))
				const normalizedPosition = this.positionForConversation(position)
				if (normalizedIndex === this.currentPageIndex) {
					if (normalizedPosition) this.rememberReadingPosition(normalizedPosition)
					return
				}
				if (animate) {
					this.pageTurnDirection = normalizedIndex > this.currentPageIndex ? 'forward' : 'backward'
					this.pageTurnRevision += 1
					clearTimeout(this.pageTurnTimer)
					this.pageTurnTimer = setTimeout(() => {
						this.pageTurnTimer = null
						this.pageTurnDirection = ''
					}, 280)
				}
				this.currentPageIndex = normalizedIndex
				this.$nextTick(() => {
					this.resetReaderShellScroll()
					this.rememberReadingPosition(normalizedPosition || this.positionForPage(this.currentPage))
				})
			},
			previousPage() { this.changePage(this.currentPageIndex - 1) },
			nextPage() { this.changePage(this.currentPageIndex + 1) },
			storyScrollTarget() {
				const ref = Array.isArray(this.$refs.storyScroll) ? this.$refs.storyScroll[0] : this.$refs.storyScroll
				return ref?.$el || ref || null
			},
			storyScrollNodes() {
				return this.storyScrollTarget()?.querySelectorAll?.('.story-reader-block[data-story-source-id]') || []
			},
			findStoryScrollNode(sourceId) {
				for (const node of this.storyScrollNodes()) {
					const nodeSourceId = String(node.dataset?.storySourceId || node.getAttribute?.('data-story-source-id') || '')
					if (nodeSourceId === sourceId) return node
				}
				return null
			},
			storyPositionTextTarget(node) {
				return node?.querySelector?.('.story-prose, .story-event-text') || node || null
			},
			storyReadingLineInset(viewportRect) {
				return Math.min(28, Math.max(4, Number(viewportRect?.height || 0) * 0.06))
			},
			storyTextNodes(root) {
				const textNodes = []
				const visit = (node) => {
					for (const child of Array.from(node?.childNodes || [])) {
						if (Number(child?.nodeType) === 3) textNodes.push(child)
						else visit(child)
					}
				}
				visit(root)
				return textNodes
			},
			storyTextDomPoint(root, characterOffset) {
				if (!root) return null
				let remaining = Math.max(0, Math.floor(Number(characterOffset) || 0))
				let lastTextNode = null
				for (const textNode of this.storyTextNodes(root)) {
					lastTextNode = textNode
					const textValue = String(textNode.nodeValue ?? textNode.textContent ?? textNode.data ?? '')
					const characters = Array.from(textValue)
					if (remaining <= characters.length) {
						return { node: textNode, offset: characters.slice(0, remaining).join('').length }
					}
					remaining -= characters.length
				}
				const finalTextValue = String(lastTextNode?.nodeValue ?? lastTextNode?.textContent ?? lastTextNode?.data ?? '')
				return lastTextNode ? { node: lastTextNode, offset: finalTextValue.length } : null
			},
			storyTextRectAtOffset(node, characterOffset) {
				const root = this.storyPositionTextTarget(node)
				const documentRef = root?.ownerDocument
				const textLength = storyTextLength(root?.textContent)
				if (!root || !documentRef?.createRange || !textLength) return null
				const normalizedOffset = Math.max(0, Math.min(textLength - 1, Math.floor(Number(characterOffset) || 0)))
				const start = this.storyTextDomPoint(root, normalizedOffset)
				const end = this.storyTextDomPoint(root, normalizedOffset + 1)
				if (!start || !end) return null
				try {
					const range = documentRef.createRange()
					range.setStart(start.node, start.offset)
					range.setEnd(end.node, end.offset)
					return range.getClientRects?.()[0] || range.getBoundingClientRect?.() || null
				} catch {
					return null
				}
			},
			storyTextOffsetAtReadingLine(node, readingLine) {
				const root = this.storyPositionTextTarget(node)
				const textLength = storyTextLength(root?.textContent)
				if (!root || !textLength) return null
				let low = 0
				let high = textLength - 1
				let match = null
				while (low <= high) {
					const middle = Math.floor((low + high) / 2)
					const rect = this.storyTextRectAtOffset(node, middle)
					if (!rect) return null
					if (rect.bottom > readingLine) {
						match = middle
						high = middle - 1
					} else {
						low = middle + 1
					}
				}
				return match
			},
			captureScrollReadingPosition() {
				const target = this.storyScrollTarget()
				const nodes = this.storyScrollNodes()
				const viewportRect = target?.getBoundingClientRect?.()
				if (!target || !nodes.length || !viewportRect) return null
				const readingLine = viewportRect.top + this.storyReadingLineInset(viewportRect)
				let selectedNode = nodes[nodes.length - 1]
				for (const node of nodes) {
					const rect = this.storyPositionTextTarget(node)?.getBoundingClientRect?.()
					if (rect && rect.bottom > readingLine) { selectedNode = node; break }
				}
				const rect = selectedNode?.getBoundingClientRect?.()
				const sourceId = String(selectedNode?.dataset?.storySourceId || selectedNode?.getAttribute?.('data-story-source-id') || '')
				const block = this.storyBlocks.find(item => storyBlockSourceId(item) === sourceId)
				if (!rect || !block || !sourceId) return null
				const exactOffset = this.storyTextOffsetAtReadingLine(selectedNode, readingLine)
				const progress = rect.height > 0 ? Math.max(0, Math.min(1, (readingLine - rect.top) / rect.height)) : 0
				const relativeOffset = exactOffset === null
					? Math.round(storyTextLength(block.text) * progress)
					: exactOffset
				return this.rememberReadingPosition(this.positionForBlock(block, relativeOffset))
			},
			handleStoryScroll(event) {
				this.lastStoryScrollTop = Math.max(0, Number(event?.detail?.scrollTop) || 0)
				if (Date.now() < this.suppressScrollPositionUntil) return
				clearTimeout(this.scrollPositionTimer)
				this.scrollPositionTimer = setTimeout(() => {
					this.scrollPositionTimer = null
					this.captureScrollReadingPosition()
				}, 120)
			},
			prepareScrollPositionRestore(position) {
				const normalized = this.positionForConversation(position)
				if (!normalized || !this.storyBlocks.length) return null
				const block = this.storyBlocks.find(item => storyBlockSourceId(item) === normalized.blockId)
				const anchorId = storyBlockDomId(block)
				if (!block || !anchorId) return null
				clearTimeout(this.scrollPositionTimer)
				this.scrollPositionTimer = null
				this.storyScrollIntoView = anchorId
				this.suppressScrollPositionUntil = Date.now() + STORY_SCROLL_RESTORE_SUPPRESS_MS
				return { normalized, block }
			},
			cancelScrollPositionRestore() {
				this.scrollRestoreRevision += 1
				clearTimeout(this.scrollRestoreTimer)
				this.scrollRestoreTimer = null
				this.storyScrollIntoView = ''
			},
			scrollStoryToBottom() {
				if (this.normalizedMode !== 'scroll' || !this.storyBlocks.length) return
				this.cancelScrollPositionRestore()
				clearTimeout(this.scrollPositionTimer)
				this.scrollPositionTimer = null
				const revision = this.scrollRestoreRevision
				const finalBlock = this.storyBlocks[this.storyBlocks.length - 1]
				const finalPosition = this.positionForBlock(finalBlock, storyTextLength(finalBlock.text))
				if (finalPosition) this.rememberReadingPosition(finalPosition)
				this.suppressScrollPositionUntil = Date.now() + STORY_SCROLL_RESTORE_SUPPRESS_MS
				this.$nextTick(() => {
					if (revision !== this.scrollRestoreRevision || this.normalizedMode !== 'scroll') return
					this.storyScrollIntoView = STORY_SCROLL_END_ANCHOR_ID
					this.$nextTick(() => {
						if (revision !== this.scrollRestoreRevision || this.normalizedMode !== 'scroll') return
						const target = this.storyScrollTarget()
						const scrollHeight = Number(target?.scrollHeight)
						const clientHeight = Number(target?.clientHeight)
						if (!Number.isFinite(scrollHeight) || !Number.isFinite(clientHeight) || scrollHeight <= 0) return
						const maximumTop = Math.max(0, scrollHeight - clientHeight)
						this.storyScrollTop = Math.abs(this.storyScrollTop - maximumTop) < 0.5 ? maximumTop + 0.01 : maximumTop
						this.lastStoryScrollTop = maximumTop
						if (target && 'scrollTop' in target) target.scrollTop = maximumTop
					})
				})
			},
			scheduleScrollPositionRestore(position) {
				const prepared = this.prepareScrollPositionRestore(position)
				if (!prepared) return
				const { normalized } = prepared
				const revision = ++this.scrollRestoreRevision
				clearTimeout(this.scrollRestoreTimer)
				this.$nextTick(() => {
					if (revision !== this.scrollRestoreRevision || this.normalizedMode !== 'scroll') return
					this.scrollRestoreTimer = setTimeout(
						() => this.applyScrollPosition(normalized, { revision, attempt: 0 }),
						STORY_SCROLL_RESTORE_INITIAL_DELAY
					)
				})
			},
			retryScrollPositionRestore(position, revision, attempt) {
				if (revision !== this.scrollRestoreRevision || this.normalizedMode !== 'scroll') return
				if (attempt >= STORY_SCROLL_RESTORE_MAX_ATTEMPTS) {
					this.$nextTick(() => {
						if (revision === this.scrollRestoreRevision) this.storyScrollIntoView = ''
					})
					return
				}
				clearTimeout(this.scrollRestoreTimer)
				this.scrollRestoreTimer = setTimeout(
					() => this.applyScrollPosition(position, { revision, attempt: attempt + 1 }),
					STORY_SCROLL_RESTORE_RETRY_DELAY
				)
			},
			applyScrollPosition(position, { revision = this.scrollRestoreRevision, attempt = 0 } = {}) {
				this.scrollRestoreTimer = null
				if (revision !== this.scrollRestoreRevision || this.normalizedMode !== 'scroll') return false
				const normalized = this.positionForConversation(position)
				const target = this.storyScrollTarget()
				const node = normalized ? this.findStoryScrollNode(normalized.blockId) : null
				const viewportRect = target?.getBoundingClientRect?.()
				const blockRect = node?.getBoundingClientRect?.()
				const block = normalized ? this.storyBlocks.find(item => storyBlockSourceId(item) === normalized.blockId) : null
				if (!target || !node || !viewportRect || !blockRect || !block) {
					this.retryScrollPositionRestore(normalized, revision, attempt)
					return false
				}
				const blockOffset = storyBlockSourceOffset(block)
				const blockLength = Math.max(1, storyTextLength(block.text))
				const relativeOffset = Math.max(0, Math.min(blockLength, normalized.characterOffset - blockOffset))
				const progress = Math.max(0, Math.min(1, relativeOffset / blockLength))
				const measuredScrollTop = Number(target.scrollTop)
				const currentScrollTop = Number.isFinite(measuredScrollTop)
					? Math.max(0, measuredScrollTop)
					: Math.max(0, Number(this.lastStoryScrollTop) || 0)
				const preciseRect = this.storyTextRectAtOffset(node, relativeOffset)
				const anchorTop = preciseRect?.top ?? (blockRect.top + blockRect.height * progress)
				const readingLine = viewportRect.top + this.storyReadingLineInset(viewportRect)
				const desiredTop = currentScrollTop + anchorTop - readingLine
				const maximumTop = Math.max(0, (Number(target.scrollHeight) || desiredTop) - (Number(target.clientHeight) || viewportRect.height || 0))
				const nextTop = Math.max(0, Math.min(maximumTop, desiredTop))
				this.suppressScrollPositionUntil = Date.now() + 300
				this.storyScrollTop = Math.abs(this.storyScrollTop - nextTop) < 0.5 ? nextTop + 0.01 : nextTop
				this.lastStoryScrollTop = nextTop
				if ('scrollTop' in target) target.scrollTop = nextTop
				this.$nextTick(() => {
					if (revision === this.scrollRestoreRevision) this.storyScrollIntoView = ''
				})
				return true
			},
			touchPoint(event) {
				const touch = event?.changedTouches?.[0] || event?.touches?.[0] || event?.detail?.changedTouches?.[0] || event?.detail?.touches?.[0] || event
				if (!touch) return null
				const x = Number(touch.clientX ?? touch.pageX ?? touch.x)
				const y = Number(touch.clientY ?? touch.pageY ?? touch.y)
				return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
			},
			handleTouchStart(event) {
				const point = this.touchPoint(event)
				this.touchStartX = point?.x ?? null
				this.touchStartY = point?.y ?? null
			},
			handleTouchEnd(event) {
				const point = this.touchPoint(event)
				if (!point || this.touchStartX === null || this.touchStartY === null) return
				const deltaX = point.x - this.touchStartX
				const deltaY = point.y - this.touchStartY
				this.touchStartX = null
				this.touchStartY = null
				if (Math.abs(deltaX) < 44 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) {
					if (Math.abs(deltaX) > 12 || Math.abs(deltaY) > 12) this.rememberReaderGesture(point)
					return
				}
				this.rememberReaderGesture(point)
				if (deltaX < 0) this.nextPage()
				else this.previousPage()
			},
			handleScrollTouchEnd(event) {
				const point = this.touchPoint(event)
				if (!point || this.touchStartX === null || this.touchStartY === null) return
				const deltaX = point.x - this.touchStartX
				const deltaY = point.y - this.touchStartY
				this.touchStartX = null
				this.touchStartY = null
				if (Math.abs(deltaX) > 12 || Math.abs(deltaY) > 12) this.rememberReaderGesture(point)
			},
			rememberReaderGesture(point) {
				this.lastReaderGestureAt = Date.now()
				this.lastReaderGestureX = point?.x ?? null
				this.lastReaderGestureY = point?.y ?? null
			},
			isInteractiveReaderTarget(event) {
				let node = event?.target || null
				const boundary = event?.currentTarget || null
				while (node) {
					const tagName = String(node.tagName || node.nodeName || '').toUpperCase()
					if (tagName.endsWith('BUTTON') || ['A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(tagName)) return true
					if (node?.getAttribute?.('role') === 'button') return true
					if (node === boundary) break
					node = node.parentNode
				}
				return false
			},
			isReaderCenterPoint(event) {
				const point = this.touchPoint(event)
				const rect = event?.currentTarget?.getBoundingClientRect?.()
				if (!point || !rect || !Number(rect.width) || !Number(rect.height)) return true
				const relativeX = point.x - rect.left
				const relativeY = point.y - rect.top
				return relativeX >= rect.width * 0.24 && relativeX <= rect.width * 0.76 &&
					relativeY >= rect.height * 0.18 && relativeY <= rect.height * 0.82
			},
			handleReaderClick(event) {
				if (this.isInteractiveReaderTarget(event)) return
				const clickPoint = this.touchPoint(event)
				if (Date.now() - this.lastReaderGestureAt < 450) {
					if (!clickPoint) return
					const distanceX = Math.abs(clickPoint.x - Number(this.lastReaderGestureX))
					const distanceY = Math.abs(clickPoint.y - Number(this.lastReaderGestureY))
					if (distanceX < 44 && distanceY < 44) return
				}
				const selectedText = typeof window !== 'undefined' ? String(window.getSelection?.()?.toString?.() || '') : ''
				if (selectedText || !this.isReaderCenterPoint(event)) return
				if (this.modelMenuOpen || this.attachmentMenuOpen || this.bookmarkPanelOpen) {
					this.closeBookmarkPanel()
					this.$emit('close-menus')
					this.readerChromeVisible = true
					return
				}
				this.readerChromeVisible = !this.readerChromeVisible
				this.$nextTick(() => this.resetReaderShellScroll())
			},
			leaveStory() {
				this.closeBookmarkPanel()
				if (this.normalizedMode === 'scroll') this.captureScrollReadingPosition()
				else this.rememberReadingPosition(this.positionForPage(this.currentPage, this.readingPosition))
				this.$emit('back')
			},
			resizeComposer(event) {
				const lineCount = Math.max(1, Number(event?.detail?.lineCount) || 1)
				this.composerInputHeight = Math.min(92, 44 + (lineCount - 1) * 22)
			},
			continueStory(messageId) {
				this.readerChromeVisible = false
				this.closeBookmarkPanel()
				this.$emit('close-menus')
				this.$emit('continue', messageId)
				this.$nextTick(() => this.resetReaderShellScroll())
			},
			submit() {
				this.closeBookmarkPanel()
				if (this.generating) this.$emit('stop')
				else if (this.canSend) {
					this.$emit('submit')
					this.readerChromeVisible = false
					this.$nextTick(() => this.resetReaderShellScroll())
				}
			}
		}
	}
</script>

<style scoped>
	.story-reader-shell {
		position: relative;
		display: flex;
		width: 100%;
		min-width: 0;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		overflow: hidden;
		overflow: clip;
		background: #fff;
		color: #242126;
		animation: story-reader-enter 220ms ease-out both;
	}

	.story-reader-top-chrome {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 12;
		display: flex;
		flex-direction: column;
		opacity: 0;
		transform: translateY(-100%);
		visibility: hidden;
		pointer-events: none;
		transition:
			transform 190ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 150ms ease,
			visibility 0s linear 190ms;
	}

	.story-chrome-visible .story-reader-top-chrome {
		opacity: 1;
		transform: translateY(0);
		visibility: visible;
		pointer-events: auto;
		transition-delay: 0s;
	}

	.story-reader-toolbar {
		position: relative;
		z-index: 12;
		display: flex;
		align-items: center;
		gap: 7px;
		height: 60px;
		min-height: 60px;
		padding: 6px 8px;
		border-bottom: 1px solid #ece9ed;
		background: rgba(255, 255, 255, 0.98);
		flex: 0 0 auto;
	}

	.story-toolbar-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		border-radius: 50%;
		color: #29262c;
		flex: 0 0 auto;
	}

	.story-toolbar-button:active,
	.story-book-identity:active {
		background: #f5f2f6;
	}

	.story-bookmark-button.active {
		background: #fbf0fd;
		color: #b12cc7;
	}

	.story-book-identity {
		display: flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
		height: 48px;
		padding: 3px 5px;
		flex: 1;
		text-align: left;
		border-radius: 6px;
	}

	.story-book-identity > view {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 2px;
	}

	.story-book-avatar {
		display: block;
		width: 39px;
		height: 39px;
		border: 1px solid #e8e3eb;
		border-radius: 50%;
		background: #f4f1f5;
		flex: 0 0 auto;
	}

	.story-book-title,
	.story-book-model {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.story-book-title {
		font-size: 16px;
		font-weight: 720;
		line-height: 20px;
		color: #262328;
	}

	.story-book-model {
		font-size: 10px;
		line-height: 14px;
		color: #928b96;
	}

	.story-toolbar-actions {
		display: flex;
		align-items: center;
		flex: 0 0 auto;
	}

	.story-reader-backdrop {
		position: absolute;
		inset: 0;
		z-index: 9;
		background: rgba(27, 22, 29, 0.08);
	}

	.story-reader-backdrop.composer-backdrop {
		inset: 0;
		z-index: 14;
		background: transparent;
	}

	.story-model-popover {
		position: absolute;
		top: 54px;
		left: 58px;
		right: 48px;
		z-index: 15;
		padding: 8px 12px;
		border: 1px solid #e6e1e8;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 10px 24px rgba(46, 38, 50, 0.16);
	}

	.story-popover-label {
		display: block;
		padding: 4px 0 7px;
		font-size: 11px;
		font-weight: 700;
		color: #918996;
	}

	.story-model-popover button {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 38px;
		border-top: 1px solid #f0edf1;
		font-size: 12px;
		text-align: left;
	}

	.story-model-popover button text:first-child {
		min-width: 0;
		flex: 1;
		font-weight: 650;
	}

	.story-model-popover button text:last-child {
		max-width: 112px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #958d99;
	}

	.story-bookmark-backdrop {
		z-index: 16;
		background: rgba(29, 24, 31, 0.24);
	}

	.story-bookmark-sheet {
		position: absolute;
		left: 12px;
		right: 12px;
		bottom: calc(12px + env(safe-area-inset-bottom));
		z-index: 17;
		display: flex;
		max-height: calc(100% - 132px);
		padding: 14px;
		border: 1px solid #e6e0e7;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 18px 42px rgba(43, 33, 47, 0.2);
		flex-direction: column;
	}

	.story-bookmark-heading,
	.story-bookmark-heading > view,
	.story-bookmark-toggle,
	.story-bookmark-row,
	.story-bookmark-meta {
		display: flex;
		align-items: center;
	}

	.story-bookmark-heading {
		min-height: 34px;
		padding: 0 2px 9px;
	}

	.story-bookmark-heading > view {
		min-width: 0;
		flex: 1;
		gap: 8px;
	}

	.story-bookmark-heading > view text:first-child {
		font-size: 16px;
		font-weight: 720;
		color: #2d2930;
	}

	.story-bookmark-heading > view text:last-child {
		font-size: 11px;
		color: #9b929e;
	}

	.story-bookmark-heading > button,
	.story-bookmark-delete {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		color: #817784;
		flex: 0 0 auto;
	}

	.story-bookmark-toggle {
		gap: 11px;
		width: 100%;
		min-height: 56px;
		padding: 8px 12px;
		border: 1px solid #eadfec;
		border-radius: 6px;
		background: #fcf8fd;
		color: #a52bb8;
		text-align: left;
	}

	.story-bookmark-toggle.active {
		border-color: #dec9e2;
		background: #f7eef8;
	}

	.story-bookmark-toggle:disabled {
		opacity: 0.45;
	}

	.story-bookmark-toggle > view {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 2px;
	}

	.story-bookmark-toggle > view text:first-child {
		font-size: 13px;
		font-weight: 700;
		color: #4b3e4e;
	}

	.story-bookmark-toggle > view text:last-child {
		font-size: 10px;
		color: #9a899d;
	}

	.story-bookmark-list {
		min-height: 0;
		max-height: 320px;
		margin-top: 8px;
		flex: 1;
	}

	.story-bookmark-row {
		min-height: 68px;
		border-top: 1px solid #f0ecf1;
	}

	.story-bookmark-row:first-child {
		border-top: 0;
	}

	.story-bookmark-open {
		display: flex;
		min-width: 0;
		min-height: 68px;
		padding: 8px 4px;
		flex: 1;
		flex-direction: column;
		justify-content: center;
		gap: 5px;
		text-align: left;
	}

	.story-bookmark-open:disabled {
		opacity: 0.5;
	}

	.story-bookmark-meta {
		width: 100%;
		gap: 8px;
		font-size: 10px;
		color: #a097a2;
	}

	.story-bookmark-meta text:first-child {
		font-weight: 700;
		color: #ad35bf;
	}

	.story-bookmark-meta text:last-child {
		margin-left: auto;
	}

	.story-bookmark-excerpt {
		display: -webkit-box;
		overflow: hidden;
		font-family: "Songti SC", "STSong", serif;
		font-size: 13px;
		line-height: 19px;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		word-break: break-word;
		color: #494249;
	}

	.story-bookmark-delete {
		margin-left: 4px;
		color: #a79da9;
	}

	.story-bookmark-delete:active,
	.story-bookmark-heading > button:active {
		background: #f5f1f6;
	}

	.story-bookmark-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 92px;
		color: #a39aa5;
		font-size: 12px;
	}

	.story-reader-modebar {
		display: flex;
		align-items: stretch;
		height: 50px;
		min-height: 50px;
		padding: 0 15px;
		border-bottom: 1px solid #eeeaf0;
		background: rgba(255, 255, 255, 0.98);
		box-shadow: 0 9px 22px rgba(45, 37, 49, 0.07);
		flex: 0 0 auto;
	}

	.story-reader-tabs {
		display: flex;
		align-items: stretch;
		gap: 2px;
	}

	.story-reader-tabs button {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		width: 86px;
		color: #9a939f;
		font-size: 14px;
	}

	.story-reader-tabs button.active {
		color: #2d2830;
		font-weight: 700;
	}

	.story-reader-tabs button.active::after {
		position: absolute;
		left: 16px;
		right: 16px;
		bottom: 0;
		height: 3px;
		border-radius: 2px 2px 0 0;
		background: #c83fe5;
		content: '';
	}

	.story-mode-meta {
		align-self: center;
		margin-left: auto;
		font-size: 12px;
		color: #9a939f;
	}

	.story-reader-body {
		display: flex;
		min-height: 0;
		flex: 1;
		background: #fffdf9;
		overflow: hidden;
	}

	.story-reader-loading {
		display: flex;
		width: 100%;
		padding: 38px 34px;
		flex-direction: column;
		gap: 16px;
	}

	.story-reader-loading view {
		height: 13px;
		border-radius: 4px;
		background: #efebe6;
		animation: story-loading 1.2s ease-in-out infinite;
	}

	.story-reader-loading view:nth-child(2) { width: 86%; }
	.story-reader-loading view:nth-child(3) { width: 94%; }
	.story-reader-loading view:nth-child(4) { width: 61%; }

	.story-page-stage {
		display: flex;
		width: 100%;
		min-width: 0;
		min-height: 0;
		flex: 1;
		flex-direction: column;
	}

	.story-page {
		position: relative;
		min-height: 0;
		padding: 24px 25px 8px;
		flex: 1;
		overflow: hidden;
		background: #fffdf9;
		perspective: 900px;
		touch-action: pan-y;
	}

	.story-page-content {
		min-height: 100%;
		backface-visibility: hidden;
		transform-origin: center;
	}

	.story-page-content.turn-forward {
		animation: story-page-turn-forward 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
		transform-origin: right center;
	}

	.story-page-content.turn-backward {
		animation: story-page-turn-backward 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
		transform-origin: left center;
	}

	.story-page-running-head {
		display: flex;
		align-items: center;
		margin-bottom: 18px;
		padding-bottom: 8px;
		border-bottom: 1px solid #eee9e2;
		font-family: Inter, "PingFang SC", sans-serif;
		font-size: 9px;
		color: #aaa29a;
	}

	.story-page-running-head text:first-child {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.story-reader-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		height: 100%;
		flex-direction: column;
		color: #aaa39d;
		font-size: 13px;
	}

	.story-page-controls {
		display: grid;
		align-items: center;
		height: 40px;
		min-height: 40px;
		padding: 0 12px;
		grid-template-columns: 42px 1fr 42px;
		background: #fffdf9;
		flex: 0 0 auto;
	}

	.story-page-controls button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 36px;
		border-radius: 50%;
		color: #8e8790;
	}

	.story-page-controls button:disabled {
		opacity: 0.28;
	}

	.story-prev-icon {
		transform: rotate(180deg);
	}

	.story-reader-page-counter {
		text-align: center;
		font-size: 12px;
		color: #9a939b;
	}

	.story-reader-scroll {
		display: block;
		width: 100%;
		min-height: 0;
		flex: 1;
		overflow-y: auto;
		background: #fffdf9;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior-y: contain;
	}

	.story-scroll-paper {
		min-height: 100%;
		padding: 28px 25px 12px;
	}

	.story-scroll-tail {
		height: 22px;
	}

	.story-history-command {
		display: flex;
		justify-content: center;
		margin: 0 0 15px;
	}

	.story-history-command.is-latest {
		margin-top: 8px;
	}

	.story-history-command button {
		display: flex;
		align-items: center;
		gap: 5px;
		min-height: 30px;
		padding: 0 10px;
		border: 1px solid #e3dce4;
		border-radius: 6px;
		background: #fff;
		font-family: Inter, "PingFang SC", sans-serif;
		font-size: 10px;
		color: #756c78;
	}

	.story-history-command button:disabled {
		opacity: 0.5;
	}

	.story-direction-composer {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 16;
		display: flex;
		min-height: 64px;
		padding: 7px 9px max(8px, env(safe-area-inset-bottom));
		border-top: 1px solid #ece8ed;
		background: #fff;
		flex: 0 0 auto;
		flex-direction: column;
		gap: 6px;
		opacity: 0;
		transform: scale(0.985);
		transform-origin: center bottom;
		visibility: hidden;
		pointer-events: none;
		transition:
			transform 190ms cubic-bezier(0.22, 1, 0.36, 1),
			opacity 150ms ease,
			visibility 0s linear 190ms;
	}

	.story-page-mode-active .story-direction-composer {
		bottom: 40px;
	}

	.story-chrome-visible .story-direction-composer {
		opacity: 1;
		transform: scale(1);
		visibility: visible;
		pointer-events: auto;
		transition-delay: 0s;
	}

	.story-composer-row {
		display: flex;
		align-items: flex-end;
		gap: 3px;
		min-width: 0;
	}

	.story-attachment-button,
	.story-send-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		flex: 0 0 auto;
	}

	.story-attachment-button {
		color: #716a74;
	}

	.story-send-button {
		background: #c83fe5;
		box-shadow: 0 2px 8px rgba(174, 50, 201, 0.24);
		color: #fff;
	}

	.story-attachment-button:disabled,
	.story-send-button:disabled {
		opacity: 0.42;
	}

	.story-direction-input {
		display: block;
		min-width: 0;
		min-height: 44px;
		max-height: 92px;
		margin: 0;
		padding: 10px 11px 8px;
		border: 1px solid #ddd8df;
		border-radius: 8px;
		outline: 0;
		background: #fff;
		color: #343037;
		font-size: 14px;
		line-height: 22px;
		resize: none;
		overflow-y: auto;
		flex: 1;
		appearance: none;
		-webkit-appearance: none;
	}

	.story-direction-input::placeholder {
		color: #97939a;
		opacity: 1;
	}

	.story-attachment-popover {
		position: absolute;
		left: 9px;
		right: 9px;
		bottom: calc(100% + 8px);
		display: grid;
		z-index: 18;
		padding: 5px;
		border: 1px solid #e4dfe6;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 10px 24px rgba(49, 41, 52, 0.16);
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}

	.story-attachment-popover button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 52px;
		border-radius: 6px;
		color: #5e5661;
		font-size: 11px;
	}

	.story-attachment-popover button:active {
		background: #faf5fb;
	}

	.story-pending-strip {
		display: block;
		width: 100%;
		overflow-x: auto;
	}

	.story-pending-list {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: max-content;
	}

	.story-pending-item {
		position: relative;
		display: flex;
		align-items: center;
		gap: 7px;
		width: 158px;
		height: 46px;
		padding: 4px 27px 4px 5px;
		border: 1px solid #e3dfe4;
		border-radius: 6px;
		background: #fbfafb;
		color: #6b636e;
	}

	.story-pending-image {
		display: block;
		width: 36px;
		height: 36px;
		border-radius: 4px;
		flex: 0 0 auto;
	}

	.story-pending-item > view {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
	}

	.story-pending-item > view text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 10px;
	}

	.story-pending-item > view text:last-child {
		font-size: 9px;
		color: #9b949e;
	}

	.story-pending-item > button {
		position: absolute;
		top: 4px;
		right: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #eee9ef;
	}

	.story-pending-processing {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 0 10px;
		font-size: 10px;
		color: #8a818d;
	}

	@keyframes story-reader-enter {
		from { opacity: 0; transform: translateY(5px); }
		to { opacity: 1; transform: translateY(0); }
	}

	@keyframes story-loading {
		0%, 100% { opacity: 0.45; }
		50% { opacity: 1; }
	}

	@keyframes story-page-turn-forward {
		from { opacity: 0.25; transform: translateX(24px) rotateY(-3deg); }
		to { opacity: 1; transform: translateX(0) rotateY(0); }
	}

	@keyframes story-page-turn-backward {
		from { opacity: 0.25; transform: translateX(-24px) rotateY(3deg); }
		to { opacity: 1; transform: translateX(0) rotateY(0); }
	}

	@media (max-width: 355px) {
		.story-reader-tabs button { width: 76px; }
		.story-page, .story-scroll-paper { padding-right: 20px; padding-left: 20px; }
		.story-toolbar-actions .story-status-button { display: none; }
	}

	@media (prefers-reduced-motion: reduce) {
		.story-reader-shell,
		.story-reader-loading view,
		.story-page-content.turn-forward,
		.story-page-content.turn-backward { animation: none; }

		.story-reader-top-chrome,
		.story-direction-composer { transition: none; }
	}
</style>

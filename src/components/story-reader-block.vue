<template>
	<view :id="domId" class="story-reader-block" :class="[`story-block-${block.type}`, { continuation: block.continuation }]" :data-story-block-id="block.id" :data-story-source-id="sourceId" :data-story-source-offset="sourceOffset" :data-story-source-length="sourceLength">
		<text v-if="block.type === 'narrative'" class="story-prose" selectable user-select>{{ block.text }}</text>

		<view v-else-if="block.type === 'event'" class="story-event-copy">
			<text class="story-event-label">事件走向</text>
			<text class="story-event-text" selectable user-select>{{ block.text }}</text>
		</view>

		<view v-else-if="block.type === 'media'" class="story-media">
			<text class="story-media-label">{{ block.role === 'user' ? '事件附件' : '故事插图' }}</text>
			<view v-if="imageAttachments.length" class="story-image-grid" :class="{ single: imageAttachments.length === 1 }">
				<button v-for="attachment in imageAttachments" :key="attachment.id || attachment.name" :aria-label="`预览图片 ${attachment.name || ''}`" @click="$emit('preview-image', attachment)">
					<AppImage class="story-image" :src="attachmentSource(attachment)" :alt="attachment.name || ''" mode="aspectFill" />
				</button>
			</view>
			<button v-for="attachment in textAttachments" :key="attachment.id || attachment.name" class="story-file" :aria-label="`预览文件 ${attachment.name || ''}`" @click="$emit('preview-text', attachment)">
				<FileText :size="17" />
				<text>{{ attachment.name || '文本附件' }}</text>
				<ChevronRight :size="15" />
			</button>
		</view>

		<view v-else-if="block.type === 'status'" class="story-generation-state" :class="`is-${block.statusKind}`">
			<template v-if="block.statusKind === 'generating'">
				<view class="story-generation-dots" aria-label="正在续写"><i /><i /><i /></view>
				<text>{{ block.text }}</text>
				<button class="story-stop-inline" aria-label="停止生成" @click="$emit('stop')"><Square :size="11" fill="currentColor" /><text>停止</text></button>
			</template>
			<template v-else>
				<AlertCircle :size="16" />
				<view class="story-status-copy"><text>{{ statusLabel }}</text><text>{{ block.text }}</text></view>
				<view class="story-status-actions">
					<button v-if="canContinue" @click.stop="$emit('continue', block.messageId)"><PlayOutline :size="13" /><text>续写</text></button>
					<button @click="$emit('retry', block.messageId)"><RotateCcw :size="13" /><text>重试</text></button>
				</view>
			</template>
		</view>

		<view v-if="block.showActions" class="story-message-footer">
			<view class="story-message-actions">
				<button v-if="block.messageContent" aria-label="复制本段故事" title="复制" @click="$emit('copy', block.messageContent)"><Copy :size="15" /></button>
				<button :class="{ active: block.feedback === 'positive' }" :aria-pressed="block.feedback === 'positive'" aria-label="赞同" title="赞同" @click="$emit('feedback', { messageId: block.messageId, feedback: 'positive' })"><ThumbsUp :size="15" /></button>
				<button :class="{ active: block.feedback === 'negative' }" :aria-pressed="block.feedback === 'negative'" aria-label="不赞同" title="不赞同" @click="$emit('feedback', { messageId: block.messageId, feedback: 'negative' })"><ThumbsDown :size="15" /></button>
				<button v-if="!block.isGreeting" class="story-action-with-text" @click="$emit('retry', block.messageId)"><RotateCcw :size="13" /><text>重试</text></button>
				<button v-if="canContinue" class="story-action-with-text" data-testid="story-continue-writing" @click.stop="$emit('continue', block.messageId)"><PlayOutline :size="13" /><text>续写</text></button>
			</view>
			<text class="story-message-time">{{ formattedTime }}</text>
		</view>
	</view>
</template>

<script>
	import AppImage from './app-image.js'
	import {
		AlertCircle, ChevronRight, Copy, FileText, PlayOutline, RotateCcw, Square, ThumbsDown, ThumbsUp
	} from './app-icons.js'
	import { imageAttachmentSource } from '../core/image-output.js'
	import { storyBlockDomId, storyBlockSourceId, storyBlockSourceLength, storyBlockSourceOffset } from '../core/story-reader.js'

	export default {
		name: 'StoryReaderBlock',
		components: { AlertCircle, AppImage, ChevronRight, Copy, FileText, PlayOutline, RotateCcw, Square, ThumbsDown, ThumbsUp },
		props: {
			block: { type: Object, required: true },
			canContinue: { type: Boolean, default: false }
		},
		emits: ['continue', 'copy', 'feedback', 'preview-image', 'preview-text', 'retry', 'stop'],
		computed: {
			domId() { return storyBlockDomId(this.block) },
			sourceId() { return storyBlockSourceId(this.block) },
			sourceOffset() { return storyBlockSourceOffset(this.block) },
			sourceLength() { return storyBlockSourceLength(this.block) },
			imageAttachments() { return (this.block.attachments || []).filter(attachment => attachment?.kind === 'image') },
			textAttachments() { return (this.block.attachments || []).filter(attachment => attachment?.kind !== 'image') },
			statusLabel() {
				if (this.block.statusKind === 'interrupted') return '续写已中断'
				if (this.block.statusKind === 'failed') return '生成失败'
				return '生成未完成'
			},
			formattedTime() {
				const date = new Date(this.block.updatedAt)
				if (Number.isNaN(date.getTime())) return ''
				return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
			}
		},
		methods: { attachmentSource: imageAttachmentSource }
	}
</script>

<style scoped>
	.story-reader-block {
		min-width: 0;
	}

	.story-block-narrative {
		margin-bottom: 18px;
	}

	.story-prose {
		display: block;
		font-family: "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif;
		font-size: 18px;
		font-weight: 400;
		line-height: 1.88;
		letter-spacing: 0;
		text-align: justify;
		text-indent: 2em;
		white-space: pre-wrap;
		word-break: break-word;
		color: #282522;
	}

	.story-block-narrative.continuation .story-prose {
		text-indent: 0;
	}

	.story-block-event {
		margin: 7px 0 19px clamp(24px, 12%, 58px);
		padding: 9px 11px 10px 13px;
		border-left: 2px solid #c83fe5;
		border-radius: 0 4px 4px 0;
		background: #fcf7fd;
	}

	.story-event-copy {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.story-event-label,
	.story-media-label {
		font-size: 11px;
		font-weight: 720;
		line-height: 16px;
		color: #b12cc7;
	}

	.story-event-text {
		font-family: "Songti SC", "STSong", "Noto Serif CJK SC", serif;
		font-size: 14px;
		line-height: 1.65;
		letter-spacing: 0;
		white-space: pre-wrap;
		word-break: break-word;
		color: #5b445e;
	}

	.story-block-media {
		margin: 2px 0 18px;
	}

	.story-media {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.story-image-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 7px;
	}

	.story-image-grid.single {
		grid-template-columns: minmax(0, 1fr);
	}

	.story-image-grid button {
		display: block;
		width: 100%;
		min-height: 120px;
		border-radius: 6px;
		overflow: hidden;
		background: #eef0f2;
	}

	.story-image {
		display: block;
		width: 100%;
		height: 148px;
	}

	.story-image-grid.single .story-image {
		height: 210px;
	}

	.story-file {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 42px;
		padding: 0 10px;
		border: 1px solid #e5e0e6;
		border-radius: 6px;
		background: #fff;
		color: #655b68;
	}

	.story-file text {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
		font-size: 12px;
	}

	.story-generation-state {
		display: flex;
		align-items: center;
		gap: 9px;
		min-height: 48px;
		margin: 6px 0 16px;
		padding: 9px 10px;
		border: 1px solid #e7e0e8;
		border-radius: 6px;
		background: #fbf9fb;
		font-family: Inter, "PingFang SC", sans-serif;
		font-size: 12px;
		color: #716675;
	}

	.story-generation-state:not(.is-generating) {
		border-color: #edd4d1;
		background: #fff8f7;
		color: #9b4740;
	}

	.story-generation-dots {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.story-generation-dots i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #b12cc7;
		animation: story-dot 1.1s ease-in-out infinite;
	}

	.story-generation-dots i:nth-child(2) { animation-delay: 140ms; }
	.story-generation-dots i:nth-child(3) { animation-delay: 280ms; }

	.story-stop-inline {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		padding: 5px 8px;
		border-radius: 6px;
		background: #f1e7f3;
		color: #8d319c;
		font-size: 11px;
	}

	.story-status-copy {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 2px;
	}

	.story-status-copy text:first-child {
		font-weight: 700;
	}

	.story-status-copy text:last-child {
		font-size: 10px;
		line-height: 1.35;
		word-break: break-word;
	}

	.story-status-actions,
	.story-status-actions button,
	.story-message-actions,
	.story-message-actions button {
		display: flex;
		align-items: center;
	}

	.story-status-actions {
		gap: 4px;
	}

	.story-status-actions button {
		gap: 3px;
		padding: 5px 7px;
		border: 1px solid #e4c6c2;
		border-radius: 6px;
		background: #fff;
		font-size: 10px;
	}

	.story-message-footer {
		display: flex;
		align-items: center;
		min-height: 32px;
		margin: -7px 0 17px;
		border-top: 1px solid #eee9e4;
		color: #98918a;
		font-family: Inter, "PingFang SC", sans-serif;
	}

	.story-message-actions {
		gap: 1px;
	}

	.story-message-actions button {
		justify-content: center;
		gap: 3px;
		min-width: 30px;
		height: 30px;
		padding: 0 6px;
		border-radius: 6px;
		color: #98918a;
	}

	.story-message-actions button.active {
		background: #f5e9f7;
		color: #aa2fbc;
	}

	.story-message-actions .story-action-with-text {
		width: auto;
	}

	.story-action-with-text text {
		font-size: 10px;
	}

	.story-message-time {
		margin-left: auto;
		font-size: 10px;
	}

	@keyframes story-dot {
		0%, 100% { opacity: 0.3; transform: translateY(0); }
		50% { opacity: 1; transform: translateY(-2px); }
	}

	@media (prefers-reduced-motion: reduce) {
		.story-generation-dots i { animation: none; }
	}
</style>

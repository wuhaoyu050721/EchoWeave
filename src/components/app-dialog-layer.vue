<template>
	<view
		v-if="actionSheet"
		class="app-dialog-backdrop app-action-sheet-backdrop"
		@click.self="$emit('cancel-action')"
		@touchmove.stop.prevent
	>
		<view class="app-action-sheet" role="dialog" aria-modal="true" aria-label="会话操作" data-testid="conversation-action-sheet" @click.stop @touchmove.stop>
			<view class="app-action-sheet-grabber" />
			<view class="app-action-sheet-heading">
				<view class="app-action-sheet-copy">
					<text>会话操作</text>
					<text>{{ actionSheet.title }}</text>
				</view>
				<button aria-label="关闭会话操作" @click="$emit('cancel-action')"><X :size="20" /></button>
			</view>
			<view class="app-action-sheet-list">
				<button v-if="actionSheet.group" class="app-action-row" data-testid="conversation-group-settings-action" @click="$emit('select-action', 'group-settings')">
					<view class="app-action-icon app-action-icon-primary"><Contact :size="20" /></view>
					<view class="app-action-copy"><text>群聊设置</text><text>调整成员与角色回复方式</text></view>
					<ChevronRight :size="18" />
				</button>
				<button class="app-action-row" data-testid="conversation-rename-action" @click="$emit('select-action', 'rename')">
					<view class="app-action-icon app-action-icon-primary"><MessageCircle :size="20" /></view>
					<view class="app-action-copy"><text>重命名会话</text><text>修改当前会话名称</text></view>
					<ChevronRight :size="18" />
				</button>
				<button class="app-action-row app-action-row-danger" data-testid="conversation-delete-action" @click="$emit('select-action', 'delete')">
					<view class="app-action-icon app-action-icon-danger"><Trash2 :size="20" /></view>
					<view class="app-action-copy"><text>删除会话</text><text>同时删除其中的全部消息</text></view>
					<ChevronRight :size="18" />
				</button>
			</view>
		</view>
	</view>

	<view
		v-if="dialog"
		class="app-dialog-backdrop app-confirm-backdrop"
		@click.self="$emit('cancel-dialog')"
		@touchmove.stop.prevent
	>
		<view
			class="app-confirm-dialog"
			:class="{ 'is-danger': isDanger, 'is-prompt': isPrompt }"
			:role="isPrompt ? 'dialog' : 'alertdialog'"
			aria-modal="true"
			:aria-label="dialog.title"
			data-testid="app-dialog"
			@click.stop
			@touchmove.stop
		>
			<view class="app-confirm-icon">
				<MessageCircle v-if="isPrompt" :size="23" />
				<Trash2 v-else-if="isDanger" :size="23" />
				<Info v-else :size="23" />
			</view>
			<text class="app-confirm-title">{{ dialog.title }}</text>
			<text v-if="dialog.content" class="app-confirm-copy" :class="{ 'preserve-lines': dialog.preserveLineBreaks }">{{ dialog.content }}</text>
			<label v-if="isPrompt" class="app-confirm-field">
				<text>会话名称</text>
				<input
					class="app-confirm-input"
					:value="inputValue"
					:focus="true"
					maxlength="80"
					confirm-type="done"
					aria-label="会话名称"
					placeholder="输入会话名称"
					data-testid="app-dialog-input"
					@input="$emit('update:inputValue', $event.detail?.value ?? $event.target?.value ?? '')"
					@confirm="confirmDisabled || $emit('confirm-dialog')"
				/>
			</label>
			<view class="app-confirm-actions">
				<button class="app-confirm-cancel" @click="$emit('cancel-dialog')">{{ dialog.cancelText || '取消' }}</button>
				<button
					class="app-confirm-submit"
					:class="{ danger: isDanger }"
					:disabled="confirmDisabled"
					data-testid="app-dialog-confirm"
					@click="$emit('confirm-dialog')"
				>{{ dialog.confirmText || '确定' }}</button>
			</view>
		</view>
	</view>
</template>

<script>
	import { ChevronRight, Contact, Info, MessageCircle, Trash2, X } from './app-icons.js'

	export default {
		components: { ChevronRight, Contact, Info, MessageCircle, Trash2, X },
		props: {
			actionSheet: { type: Object, default: null },
			dialog: { type: Object, default: null },
			inputValue: { type: String, default: '' }
		},
		emits: ['cancel-action', 'select-action', 'cancel-dialog', 'confirm-dialog', 'update:inputValue'],
		computed: {
			isPrompt() { return this.dialog?.kind === 'prompt' },
			isDanger() { return this.dialog?.tone === 'danger' },
			confirmDisabled() { return this.isPrompt && !String(this.inputValue || '').trim() }
		}
	}
</script>

<style scoped>
	.app-dialog-backdrop {
		position: absolute;
		inset: 0;
		z-index: 70;
		display: flex;
		box-sizing: border-box;
		background: rgba(37, 35, 42, 0.4);
		-webkit-backdrop-filter: blur(2px);
		backdrop-filter: blur(2px);
		animation: app-dialog-backdrop-in 160ms ease-out both;
	}

	.app-action-sheet-backdrop {
		align-items: flex-end;
	}

	.app-action-sheet {
		display: flex;
		box-sizing: border-box;
		width: 100%;
		max-height: 100%;
		padding: 0 20px max(14px, calc(env(safe-area-inset-bottom) + 10px));
		overflow-y: auto;
		border: 1px solid var(--paper-line, #e5e0e7);
		border-bottom: 0;
		border-radius: 26px 26px 0 0;
		background: var(--paper-bg, #f8f7f4);
		box-shadow: 0 -18px 48px rgba(42, 31, 55, 0.16);
		flex-direction: column;
		animation: app-action-sheet-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.app-action-sheet > * {
		flex-shrink: 0;
	}

	.app-action-sheet-grabber {
		width: 38px;
		height: 4px;
		margin: 9px auto 0;
		border-radius: 2px;
		background: #ccc2d3;
	}

	.app-action-sheet-heading {
		display: flex;
		align-items: center;
		min-height: 65px;
		border-bottom: 1px solid var(--paper-line, #e5e0e7);
	}

	.app-action-sheet-copy {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 3px;
	}

	.app-action-sheet-copy text:first-child {
		font-size: 16px;
		font-weight: 750;
		line-height: 22px;
		color: var(--paper-ink, #25232a);
	}

	.app-action-sheet-copy text:last-child {
		display: block;
		max-width: 100%;
		overflow: hidden;
		font-size: 12px;
		line-height: 17px;
		color: var(--paper-muted, #706775);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.app-action-sheet-heading > button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		margin-left: 12px;
		border-radius: 50%;
		background: var(--paper-soft, #eee8f4);
		color: var(--paper-accent, #7850a0);
		flex: 0 0 auto;
	}

	.app-action-sheet-list {
		display: flex;
		flex-direction: column;
	}

	.app-action-row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 66px;
		padding: 12px 0;
		border-bottom: 1px solid var(--paper-line, #e5e0e7);
		line-height: 20px;
		text-align: left;
		white-space: normal;
	}

	.app-action-row:last-child {
		border-bottom: 0;
	}

	.app-action-row > .app-icon {
		margin-left: auto;
		color: #a99caf;
		flex: 0 0 auto;
	}

	.app-action-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 13px;
		flex: 0 0 auto;
	}

	.app-action-icon-primary {
		background: var(--paper-soft, #eee8f4);
		color: var(--paper-accent, #7850a0);
	}

	.app-action-icon-danger {
		background: #fff0f1;
		color: #c43d49;
	}

	.app-action-copy {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 2px;
	}

	.app-action-copy text:first-child {
		font-size: 14px;
		font-weight: 680;
		line-height: 20px;
		color: var(--paper-ink, #25232a);
	}

	.app-action-copy text:last-child {
		font-size: 11px;
		line-height: 16px;
		color: var(--paper-muted, #706775);
	}

	.app-action-row-danger .app-action-copy text:first-child {
		color: #b83240;
	}

	.app-confirm-backdrop {
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.app-confirm-dialog {
		display: flex;
		box-sizing: border-box;
		width: min(340px, 100%);
		max-height: calc(100% - 40px);
		padding: 24px 22px 20px;
		overflow-y: auto;
		border: 1px solid var(--paper-line, #e5e0e7);
		border-radius: 24px;
		background: var(--paper-bg, #f8f7f4);
		box-shadow: 0 20px 56px rgba(42, 31, 55, 0.2);
		flex-direction: column;
		animation: app-confirm-dialog-in 190ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.app-confirm-dialog > * {
		flex-shrink: 0;
	}

	.app-confirm-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--paper-soft, #eee8f4);
		color: var(--paper-accent, #7850a0);
	}

	.app-confirm-dialog.is-danger .app-confirm-icon {
		background: #fff0f1;
		color: #c43d49;
	}

	.app-confirm-title {
		margin-top: 14px;
		font-size: 18px;
		font-weight: 750;
		line-height: 25px;
		color: var(--paper-ink, #25232a);
		word-break: break-word;
	}

	.app-confirm-copy {
		margin-top: 7px;
		font-size: 13px;
		line-height: 20px;
		color: var(--paper-muted, #706775);
		word-break: break-word;
	}

	.app-confirm-field {
		display: flex;
		margin-top: 18px;
		flex-direction: column;
		gap: 7px;
	}

	.app-confirm-copy.preserve-lines {
		white-space: pre-line;
		text-align: left;
	}

	.app-confirm-field > text {
		font-size: 12px;
		font-weight: 650;
		line-height: 17px;
		color: var(--paper-muted, #706775);
	}

	.app-confirm-input {
		box-sizing: border-box;
		width: 100%;
		height: 46px;
		padding: 0 12px;
		border: 1px solid var(--paper-line, #e5e0e7);
		border-radius: 14px;
		background: #fff;
		font-size: 14px;
		line-height: 22px;
		color: var(--paper-ink, #25232a);
		outline: none;
	}

	.app-confirm-input:focus,
	.app-confirm-input:focus-within {
		border-color: var(--paper-accent, #7850a0);
		background: #fff;
		box-shadow: 0 0 0 3px rgba(120, 80, 160, 0.12);
	}

	.app-confirm-input :deep(.uni-input-wrapper) {
		display: flex;
		align-items: center;
		height: 100%;
	}

	.app-confirm-input :deep(.uni-input-input) {
		height: 100%;
		line-height: 22px;
	}

	.app-confirm-input :deep(.uni-input-placeholder) {
		display: flex;
		align-items: center;
		height: 100%;
		line-height: 22px;
	}

	.app-confirm-actions {
		display: grid;
		gap: 10px;
		margin-top: 20px;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.app-confirm-actions button {
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-height: 46px;
		height: auto;
		padding: 11px 12px;
		border-radius: 14px;
		font-size: 14px;
		font-weight: 680;
		line-height: 22px;
		text-align: center;
		white-space: normal;
		word-break: break-word;
	}

	.app-confirm-cancel {
		background: var(--paper-soft, #eee8f4);
		color: var(--paper-accent, #7850a0);
	}

	.app-confirm-submit {
		background: var(--paper-accent, #7850a0);
		color: #fff;
	}

	.app-confirm-submit.danger {
		background: #d9434d;
	}

	.app-confirm-submit:disabled {
		opacity: 0.42;
	}

	@keyframes app-dialog-backdrop-in {
		from { background-color: rgba(37, 35, 42, 0); }
		to { background-color: rgba(37, 35, 42, 0.4); }
	}

	@keyframes app-action-sheet-in {
		from { opacity: 0; transform: translateY(28px); }
		to { opacity: 1; transform: translateY(0); }
	}

	@keyframes app-confirm-dialog-in {
		from { opacity: 0; transform: translateY(10px) scale(0.97); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}

	@media (prefers-reduced-motion: reduce) {
		.app-dialog-backdrop,
		.app-action-sheet,
		.app-confirm-dialog {
			animation: none;
		}
	}
</style>

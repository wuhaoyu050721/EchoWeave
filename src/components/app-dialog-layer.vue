<template>
	<view
		v-if="actionSheet"
		class="app-dialog-backdrop app-action-sheet-backdrop"
		@click.self="$emit('cancel-action')"
		@touchmove.stop.prevent
	>
		<view class="app-action-sheet" role="dialog" aria-modal="true" aria-label="会话操作" data-testid="conversation-action-sheet" @click.stop>
			<view class="app-action-sheet-grabber" />
			<view class="app-action-sheet-heading">
				<view class="app-action-sheet-copy">
					<text>会话操作</text>
					<text>{{ actionSheet.title }}</text>
				</view>
				<button aria-label="关闭会话操作" @click="$emit('cancel-action')"><X :size="20" /></button>
			</view>
			<view class="app-action-sheet-list">
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
		>
			<view class="app-confirm-icon">
				<MessageCircle v-if="isPrompt" :size="23" />
				<Trash2 v-else-if="isDanger" :size="23" />
				<Info v-else :size="23" />
			</view>
			<text class="app-confirm-title">{{ dialog.title }}</text>
			<text v-if="dialog.content" class="app-confirm-copy">{{ dialog.content }}</text>
			<label v-if="isPrompt" class="app-confirm-field">
				<text>会话名称</text>
				<input
					:value="inputValue"
					:focus="true"
					maxlength="80"
					confirm-type="done"
					aria-label="会话名称"
					placeholder="输入会话名称"
					data-testid="app-dialog-input"
					@input="$emit('update:inputValue', $event.detail.value)"
					@confirm="confirmDisabled || $emit('confirm-dialog')"
				/>
			</label>
			<view class="app-confirm-actions">
				<button class="app-confirm-cancel" @click="$emit('cancel-dialog')">取消</button>
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
	import { ChevronRight, Info, MessageCircle, Trash2, X } from './app-icons.js'

	export default {
		components: { ChevronRight, Info, MessageCircle, Trash2, X },
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
		background: rgba(15, 20, 29, 0.42);
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
		padding: 0 14px max(14px, calc(env(safe-area-inset-bottom) + 10px));
		border: 1px solid rgba(220, 227, 236, 0.9);
		border-bottom: 0;
		border-radius: 8px 8px 0 0;
		background: #fff;
		box-shadow: 0 -18px 48px rgba(15, 20, 29, 0.2);
		flex-direction: column;
		animation: app-action-sheet-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.app-action-sheet-grabber {
		width: 38px;
		height: 4px;
		margin: 9px auto 0;
		border-radius: 2px;
		background: #cbd3dc;
	}

	.app-action-sheet-heading {
		display: flex;
		align-items: center;
		min-height: 65px;
		border-bottom: 1px solid #e7ebf0;
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
		color: #172033;
	}

	.app-action-sheet-copy text:last-child {
		display: block;
		max-width: 100%;
		overflow: hidden;
		font-size: 12px;
		line-height: 17px;
		color: #758196;
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
		background: #f0f3f7;
		color: #536174;
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
		border-bottom: 1px solid #edf0f4;
		text-align: left;
	}

	.app-action-row:last-child {
		border-bottom: 0;
	}

	.app-action-row > .app-icon {
		margin-left: auto;
		color: #a1aab7;
		flex: 0 0 auto;
	}

	.app-action-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 8px;
		flex: 0 0 auto;
	}

	.app-action-icon-primary {
		background: #eaf3ff;
		color: #1f6fcb;
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
		color: #222b3b;
	}

	.app-action-copy text:last-child {
		font-size: 11px;
		line-height: 16px;
		color: #8792a3;
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
		padding: 22px 20px 18px;
		overflow-y: auto;
		border: 1px solid rgba(220, 227, 236, 0.92);
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 20px 56px rgba(15, 20, 29, 0.24);
		flex-direction: column;
		animation: app-confirm-dialog-in 190ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.app-confirm-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: #eaf3ff;
		color: #1f6fcb;
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
		color: #172033;
		word-break: break-word;
	}

	.app-confirm-copy {
		margin-top: 7px;
		font-size: 13px;
		line-height: 20px;
		color: #758196;
		word-break: break-word;
	}

	.app-confirm-field {
		display: flex;
		margin-top: 18px;
		flex-direction: column;
		gap: 7px;
	}

	.app-confirm-field > text {
		font-size: 12px;
		font-weight: 650;
		line-height: 17px;
		color: #536174;
	}

	.app-confirm-field input {
		box-sizing: border-box;
		width: 100%;
		height: 46px;
		padding: 0 12px;
		border: 1px solid #cdd7e3;
		border-radius: 7px;
		background: #f8fafc;
		font-size: 14px;
		color: #172033;
		outline: none;
	}

	.app-confirm-field input:focus {
		border-color: #4c8fd9;
		background: #fff;
		box-shadow: 0 0 0 3px rgba(31, 111, 203, 0.12);
	}

	.app-confirm-actions {
		display: grid;
		gap: 10px;
		margin-top: 20px;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.app-confirm-actions button {
		height: 43px;
		border-radius: 7px;
		font-size: 14px;
		font-weight: 680;
	}

	.app-confirm-cancel {
		background: #eef2f6;
		color: #4e5b6d;
	}

	.app-confirm-submit {
		background: #1f6fcb;
		color: #fff;
	}

	.app-confirm-submit.danger {
		background: #d9434d;
	}

	.app-confirm-submit:disabled {
		opacity: 0.42;
	}

	@keyframes app-dialog-backdrop-in {
		from { background-color: rgba(15, 20, 29, 0); }
		to { background-color: rgba(15, 20, 29, 0.42); }
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

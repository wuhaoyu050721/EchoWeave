<template>
	<view v-if="open" class="world-book-manager-backdrop" @click.self="closeManager">
		<view class="world-book-manager-sheet" role="dialog" aria-modal="true" :aria-label="editorOpen ? '编辑世界书' : '世界书管理'">
			<view class="manager-heading">
				<button v-if="editorOpen" class="manager-icon-button" aria-label="返回世界书列表" title="返回" :disabled="operationBusy" @click="cancelEditor"><ArrowLeft :size="20" /></button>
				<view v-else class="manager-heading-spacer" />
				<text>{{ editorOpen ? (editingId ? '编辑世界书' : '新建世界书') : '世界书' }}</text>
				<button class="manager-icon-button" aria-label="关闭世界书管理" title="关闭" :disabled="operationBusy" @click="closeManager"><X :size="19" /></button>
			</view>

			<template v-if="!editorOpen">
				<scroll-view class="manager-list-scroll" scroll-y>
					<view v-if="localError" class="manager-error" role="alert"><AlertCircle :size="17" /><text>{{ localError }}</text></view>
					<view v-if="managedWorldBooks.length" class="manager-book-list">
						<button v-for="book in managedWorldBooks" :key="book.id" class="manager-book-row" :disabled="operationBusy" :aria-label="`编辑世界书 ${book.name}`" @click="beginEdit(book)">
							<view class="manager-book-icon"><FileText :size="20" /></view>
							<view class="manager-book-copy">
								<text>{{ book.name || '未命名世界书' }}</text>
								<text>{{ entryCount(book) }} 条规则 · {{ bindingLabel(book) }}</text>
							</view>
							<ChevronRight :size="18" />
						</button>
					</view>
					<view v-else class="manager-empty"><FileText :size="35" /><text>还没有世界书</text></view>
				</scroll-view>
				<view class="manager-list-actions">
					<button class="manager-secondary-button" :disabled="operationBusy" @click="requestImport"><Import :size="18" /><text>导入</text></button>
					<button class="manager-primary-button" :disabled="operationBusy" @click="beginCreate"><Plus :size="18" /><text>新建世界书</text></button>
				</view>
			</template>

			<template v-else>
				<scroll-view class="manager-editor-scroll" scroll-y>
					<view v-if="localError" class="manager-error" role="alert"><AlertCircle :size="17" /><text>{{ localError }}</text></view>

					<view class="manager-section">
						<text class="manager-section-title">基本信息</text>
						<label class="manager-field"><text>名称</text><input v-model="draft.name" :disabled="operationBusy" maxlength="200" placeholder="世界书名称" /></label>
						<label class="manager-field manager-field-multiline"><text>描述</text><textarea v-model="draft.description" :disabled="operationBusy" maxlength="20000" auto-height placeholder="可选" /></label>
						<view class="manager-number-grid">
							<label class="manager-field"><text>扫描深度</text><input v-model.number="draft.scan_depth" :disabled="operationBusy" type="number" min="1" max="100" /></label>
							<label class="manager-field"><text>Token 预算</text><input v-model.number="draft.token_budget" :disabled="operationBusy" type="number" min="1" max="1000000" /></label>
						</view>
					</view>

					<view class="manager-section">
						<text class="manager-section-title">应用角色</text>
						<view class="manager-segmented" role="group" aria-label="世界书应用范围">
							<button :class="{ selected: draft.bindingMode === 'global' }" :aria-pressed="draft.bindingMode === 'global'" :disabled="operationBusy" @click="setBindingMode('global')">全局</button>
							<button :class="{ selected: draft.bindingMode === 'characters' }" :aria-pressed="draft.bindingMode === 'characters'" :disabled="operationBusy" @click="setBindingMode('characters')">指定角色</button>
						</view>
						<view v-if="draft.bindingMode === 'characters'" class="manager-character-list">
							<button v-for="character in characters" :key="character.id" class="manager-character-row" :class="{ selected: isCharacterSelected(character.id) }" :aria-pressed="isCharacterSelected(character.id)" :disabled="operationBusy" @click="toggleCharacter(character.id)">
								<ProviderLogo class="manager-character-avatar" :src="character.avatarDataUrl || '/static/zhiyu-logo.png'" :alt="character.name" mode="aspectFill" />
								<text>{{ character.name }}</text>
								<view class="manager-check"><Check v-if="isCharacterSelected(character.id)" :size="14" /></view>
							</button>
							<text v-if="!characters.length" class="manager-character-empty">暂无可选角色</text>
						</view>
					</view>

					<view class="manager-section manager-rules-section">
						<view class="manager-section-heading"><text class="manager-section-title">规则（{{ draft.entries.length }}）</text><button class="manager-add-rule" :disabled="operationBusy" @click="addRule"><Plus :size="17" /><text>添加规则</text></button></view>
						<view v-if="draft.entries.length" class="manager-rule-list">
							<view v-for="(rule, index) in draft.entries" :key="rule._clientKey" class="manager-rule-card">
								<view class="manager-rule-heading">
									<text>{{ rule.name.trim() || `规则 ${index + 1}` }}</text>
									<view class="manager-rule-heading-actions">
										<text>{{ rule.enabled ? '启用' : '停用' }}</text>
										<button class="manager-toggle" :class="{ enabled: rule.enabled }" role="switch" :aria-checked="rule.enabled" :aria-label="`${rule.name || `规则 ${index + 1}`}启用状态`" :disabled="operationBusy" @click="rule.enabled = !rule.enabled"><view /></button>
										<button class="manager-delete-rule" :aria-label="`删除规则 ${index + 1}`" title="删除规则" :disabled="operationBusy" @click="removeRule(index)"><Trash2 :size="17" /></button>
									</view>
								</view>
								<label class="manager-field"><text>规则名称</text><input v-model="rule.name" :disabled="operationBusy" maxlength="200" placeholder="可选" /></label>
								<label class="manager-field"><text>备注</text><input v-model="rule.comment" :disabled="operationBusy" maxlength="200" placeholder="可选，独立于规则名称" /></label>
								<label class="manager-field"><text>关键词</text><input v-model="rule.keywordsText" :disabled="operationBusy || rule.constant" placeholder="用逗号分隔" /></label>
								<label class="manager-field manager-field-multiline"><text>内容</text><textarea v-model="rule.content" :disabled="operationBusy" maxlength="-1" auto-height placeholder="命中后注入提示词的内容" /></label>
								<view class="manager-rule-options">
									<view class="manager-constant-control"><view><text>常驻</text></view><button class="manager-toggle" :class="{ enabled: rule.constant }" role="switch" :aria-checked="rule.constant" :aria-label="`${rule.name || `规则 ${index + 1}`}常驻状态`" :disabled="operationBusy" @click="rule.constant = !rule.constant"><view /></button></view>
									<label class="manager-field manager-order-field"><text>顺序</text><input v-model.number="rule.order" :disabled="operationBusy" type="number" min="-1000000" max="1000000" /></label>
								</view>
								<label class="manager-field"><text>位置</text><view class="manager-picker-wrap"><picker class="manager-picker" mode="selector" :range="positionOptions" range-key="label" :value="positionIndex(rule.position)" :disabled="operationBusy" @change="selectPosition($event, rule)"><view class="manager-picker-value"><text>{{ positionLabel(rule.position) }}</text><ChevronDown :size="16" /></view></picker></view></label>
							</view>
						</view>
						<view v-else class="manager-no-rules"><text>暂无规则</text></view>
					</view>

					<view v-if="editingId" class="manager-danger-zone">
						<button v-if="!deleteArmed" class="manager-delete-book" :disabled="operationBusy" @click="deleteArmed = true"><Trash2 :size="17" /><text>删除世界书</text></button>
						<view v-else class="manager-delete-confirm"><text>确认删除“{{ draft.name || '未命名世界书' }}”？</text><view><button :disabled="operationBusy" @click="deleteArmed = false">取消</button><button :disabled="operationBusy" @click="deleteWorldBook">删除</button></view></view>
					</view>
					<view class="manager-editor-tail" />
				</scroll-view>
				<view class="manager-editor-actions">
					<button class="manager-secondary-button" :disabled="operationBusy" @click="cancelEditor">取消</button>
					<button class="manager-primary-button" :disabled="operationBusy" @click="saveWorldBook">{{ operationBusy ? '保存中...' : '保存' }}</button>
				</view>
			</template>
		</view>
	</view>
</template>

<script>
	import { AlertCircle, ArrowLeft, Check, ChevronDown, ChevronRight, FileText, Import, Plus, Trash2, X } from './app-icons.js'
	import ProviderLogo from './provider-logo.js'
	import {
		createEmptyWorldBookDraft,
		createEmptyWorldBookRule,
		createWorldBookDraft,
		createWorldBookManagementService,
		normalizeWorldBookDraft,
		worldBookBindingLabel
	} from '../features/world-book-management/index.js'

	const POSITION_OPTIONS = Object.freeze([
		{ value: 'before_char', label: '角色设定前' },
		{ value: 'after_char', label: '角色设定后' },
		{ value: 'before_example', label: '示例对话前' },
		{ value: 'after_example', label: '示例对话后' },
		{ value: 'before_author_note', label: '作者注释前' },
		{ value: 'after_author_note', label: '作者注释后' },
		{ value: 'at_depth', label: '历史深度位置' }
	])

	export default {
		name: 'WorldBookManager',
		components: { AlertCircle, ArrowLeft, Check, ChevronDown, ChevronRight, FileText, Import, Plus, ProviderLogo, Trash2, X },
		props: {
			open: { type: Boolean, default: false },
			repository: { type: Object, default: null },
			worldBooks: { type: Array, default: () => [] },
			characters: { type: Array, default: () => [] },
			busy: { type: Boolean, default: false }
		},
		emits: ['changed', 'close', 'error', 'import', 'update:open', 'update:worldBooks'],
		data() {
			const initialDraft = createEmptyWorldBookDraft()
			return {
				managedWorldBooks: [],
				editorOpen: false,
				editingId: null,
				draft: {
					...initialDraft,
					entries: initialDraft.entries.map((rule, index) => ({ ...rule, _clientKey: `world-book-rule-${index + 1}` }))
				},
				internalBusy: false,
				localError: '',
				deleteArmed: false,
				ruleSequence: initialDraft.entries.length,
				positionOptions: POSITION_OPTIONS
			}
		},
		computed: {
			operationBusy() { return this.busy || this.internalBusy }
		},
		watch: {
			worldBooks: {
				immediate: true,
				handler(value) { this.managedWorldBooks = this.sortBooks(value) }
			},
			open: {
				immediate: true,
				handler(value) {
					if (value) {
						this.localError = ''
						this.refreshItems().catch(error => this.reportError(error))
					} else {
						this.resetEditor()
					}
				}
			}
		},
		methods: {
			sortBooks(books) {
				return (Array.isArray(books) ? books : [])
					.filter(book => book && !book.deletedAt)
					.slice()
					.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
			},
			withClientKeys(draft) {
				const source = draft || createEmptyWorldBookDraft()
				return {
					...source,
					entries: (Array.isArray(source.entries) ? source.entries : []).map(rule => ({
						...rule,
						_clientKey: `world-book-rule-${++this.ruleSequence}`
					}))
				}
			},
			async refreshItems() {
				if (typeof this.repository?.listAllWorldBooks !== 'function') {
					this.managedWorldBooks = this.sortBooks(this.worldBooks)
					return this.managedWorldBooks
				}
				const books = await this.repository.listAllWorldBooks()
				this.managedWorldBooks = this.sortBooks(books)
				this.$emit('update:worldBooks', this.managedWorldBooks.slice())
				return this.managedWorldBooks
			},
			closeManager() {
				if (this.operationBusy) return
				this.resetEditor()
				this.$emit('update:open', false)
				this.$emit('close')
			},
			requestImport() {
				if (!this.operationBusy) this.$emit('import')
			},
			beginCreate() {
				if (this.operationBusy) return
				this.editingId = null
				this.draft = this.withClientKeys(createEmptyWorldBookDraft())
				this.localError = ''
				this.deleteArmed = false
				this.editorOpen = true
			},
			beginEdit(worldBook) {
				if (this.operationBusy) return
				this.editingId = worldBook.id
				this.draft = this.withClientKeys(createWorldBookDraft(worldBook))
				this.localError = ''
				this.deleteArmed = false
				this.editorOpen = true
			},
			cancelEditor() {
				if (!this.operationBusy) this.resetEditor()
			},
			resetEditor() {
				this.editorOpen = false
				this.editingId = null
				this.draft = this.withClientKeys(createEmptyWorldBookDraft())
				this.localError = ''
				this.deleteArmed = false
			},
			setBindingMode(mode) {
				this.draft.bindingMode = mode
				this.localError = ''
			},
			isCharacterSelected(characterId) {
				return this.draft.characterIds.includes(String(characterId))
			},
			toggleCharacter(characterId) {
				const id = String(characterId)
				this.draft.characterIds = this.isCharacterSelected(id)
					? this.draft.characterIds.filter(value => value !== id)
					: [...this.draft.characterIds, id]
				this.localError = ''
			},
			addRule() {
				this.draft.entries.push({ ...createEmptyWorldBookRule(), _clientKey: `world-book-rule-${++this.ruleSequence}` })
			},
			removeRule(index) {
				this.draft.entries.splice(index, 1)
			},
			positionIndex(position) {
				const index = this.positionOptions.findIndex(option => option.value === position)
				return index >= 0 ? index : 1
			},
			positionLabel(position) {
				return this.positionOptions.find(option => option.value === position)?.label || '角色设定后'
			},
			selectPosition(event, rule) {
				const index = Number(event?.detail?.value ?? event?.target?.value)
				rule.position = this.positionOptions[index]?.value || 'after_char'
			},
			entryCount(worldBook) {
				return Array.isArray(worldBook?.data?.entries) ? worldBook.data.entries.length : 0
			},
			bindingLabel(worldBook) {
				return worldBookBindingLabel(worldBook, this.characters)
			},
			managementService() {
				return createWorldBookManagementService({ repository: this.repository })
			},
			applyOperationResult(type, result) {
				if (type === 'deleted') {
					this.managedWorldBooks = this.managedWorldBooks.filter(book => book.id !== result.worldBook.id)
				} else {
					this.managedWorldBooks = this.sortBooks([
						...this.managedWorldBooks.filter(book => book.id !== result.worldBook.id),
						result.worldBook
					])
				}
				this.$emit('update:worldBooks', this.managedWorldBooks.slice())
			},
			reportError(error) {
				this.localError = error?.issues?.[0]?.message || error?.message || '世界书操作失败'
				this.$emit('error', error)
			},
			async saveWorldBook() {
				if (this.operationBusy) return
				this.localError = ''
				try {
					const input = normalizeWorldBookDraft(this.draft)
					this.internalBusy = true
					const service = this.managementService()
					const result = this.editingId
						? await service.update(this.editingId, input)
						: await service.create(input)
					const type = this.editingId ? 'updated' : 'created'
					this.applyOperationResult(type, result)
					this.resetEditor()
					this.$emit('changed', { type, ...result })
					try {
						await this.refreshItems()
					} catch (error) {
						this.reportError(error)
					}
				} catch (error) {
					this.reportError(error)
				} finally {
					this.internalBusy = false
				}
			},
			async deleteWorldBook() {
				if (!this.editingId || this.operationBusy) return
				this.localError = ''
				try {
					this.internalBusy = true
					const result = await this.managementService().remove(this.editingId)
					this.applyOperationResult('deleted', result)
					this.resetEditor()
					this.$emit('changed', { type: 'deleted', ...result })
					try {
						await this.refreshItems()
					} catch (error) {
						this.reportError(error)
					}
				} catch (error) {
					this.reportError(error)
				} finally {
					this.internalBusy = false
				}
			}
		}
	}
</script>

<style scoped>
	.world-book-manager-backdrop {
		position: absolute;
		inset: 0;
		z-index: 39;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		padding: 12px 12px max(12px, env(safe-area-inset-bottom));
		background: rgba(20, 23, 28, 0.34);
	}

	.world-book-manager-sheet {
		display: flex;
		width: 100%;
		max-width: 560px;
		max-height: min(92vh, 820px);
		overflow: hidden;
		border: 1px solid #e8e5e9;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 18px 52px rgba(32, 26, 35, 0.2);
		flex-direction: column;
	}

	.manager-heading {
		display: grid;
		align-items: center;
		min-height: 56px;
		padding: 8px 10px;
		border-bottom: 1px solid #efedf0;
		grid-template-columns: 40px minmax(0, 1fr) 40px;
	}

	.manager-heading > text {
		overflow: hidden;
		font-size: 16px;
		font-weight: 680;
		color: #24252a;
		text-align: center;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.manager-heading-spacer,
	.manager-icon-button {
		width: 40px;
		height: 40px;
	}

	.manager-icon-button {
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		color: #303137;
	}

	.manager-icon-button:active {
		background: #f4f2f5;
	}

	.manager-list-scroll,
	.manager-editor-scroll {
		min-height: 0;
		flex: 1;
	}

	.manager-list-scroll {
		min-height: 180px;
		padding: 4px 16px;
	}

	.manager-book-list {
		display: flex;
		flex-direction: column;
	}

	.manager-book-row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 72px;
		padding: 8px 0;
		border-bottom: 1px solid #f0eef1;
		color: #a7a4aa;
		text-align: left;
	}

	.manager-book-row:last-child {
		border-bottom: 0;
	}

	.manager-book-row:active {
		background: #fcf8fc;
	}

	.manager-book-icon {
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

	.manager-book-copy {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 5px;
	}

	.manager-book-copy text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.manager-book-copy text:first-child {
		font-size: 14px;
		font-weight: 650;
		color: #25262b;
	}

	.manager-book-copy text:last-child {
		font-size: 11px;
		color: #929399;
	}

	.manager-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 220px;
		flex-direction: column;
		gap: 10px;
		font-size: 13px;
		color: #98999e;
	}

	.manager-list-actions,
	.manager-editor-actions {
		display: grid;
		gap: 10px;
		padding: 12px 16px max(14px, env(safe-area-inset-bottom));
		border-top: 1px solid #efedf0;
		grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.4fr);
	}

	.manager-list-actions button,
	.manager-editor-actions button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		height: 46px;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 650;
	}

	.manager-primary-button {
		background: #d43bc2;
		color: #fff;
	}

	.manager-secondary-button {
		border: 1px solid #dfdce2;
		background: #fff;
		color: #34353a;
	}

	.manager-editor-scroll {
		padding: 0 16px;
		background: #f7f6f8;
	}

	.manager-section {
		padding: 18px 0;
		border-bottom: 1px solid #e9e7ea;
	}

	.manager-section-title {
		display: block;
		margin-bottom: 12px;
		font-size: 13px;
		font-weight: 700;
		color: #55575e;
	}

	.manager-section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}

	.manager-section-heading .manager-section-title {
		margin-bottom: 0;
	}

	.manager-field {
		display: flex;
		min-width: 0;
		margin-top: 12px;
		flex-direction: column;
		gap: 7px;
	}

	.manager-field > text,
	.manager-constant-control text {
		font-size: 11px;
		font-weight: 650;
		color: #77787e;
	}

	.manager-field input,
	.manager-field textarea,
	.manager-picker-value {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #e2dfe4;
		border-radius: 8px;
		background: #fff;
		color: #25262b;
		font-size: 14px;
	}

	.manager-field input,
	.manager-picker-value {
		height: 44px;
		padding: 0 12px;
	}

	.manager-field textarea {
		min-height: 82px;
		padding: 11px 12px;
		line-height: 1.55;
	}

	.manager-number-grid,
	.manager-rule-options {
		display: grid;
		gap: 10px;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.manager-segmented {
		display: grid;
		padding: 3px;
		border: 1px solid #e0dde2;
		border-radius: 8px;
		background: #eceaee;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.manager-segmented button {
		height: 38px;
		border-radius: 6px;
		color: #77787e;
		font-size: 13px;
		font-weight: 650;
	}

	.manager-segmented button.selected {
		background: #fff;
		box-shadow: 0 1px 5px rgba(39, 34, 43, 0.1);
		color: #bd34ad;
	}

	.manager-character-list {
		display: flex;
		margin-top: 10px;
		flex-direction: column;
	}

	.manager-character-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 52px;
		padding: 6px 4px;
		border-bottom: 1px solid #e9e7ea;
		color: #2e2f34;
		text-align: left;
	}

	.manager-character-row > text {
		overflow: hidden;
		flex: 1;
		font-size: 13px;
		font-weight: 620;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.manager-character-avatar {
		display: block;
		width: 36px;
		height: 36px;
		overflow: hidden;
		border-radius: 50%;
		background: #ececf0;
		flex: 0 0 auto;
	}

	.manager-check {
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

	.manager-character-row.selected .manager-check {
		border-color: #d43bc2;
		background: #d43bc2;
	}

	.manager-character-empty,
	.manager-no-rules {
		display: block;
		padding: 16px 4px;
		font-size: 12px;
		color: #929399;
		text-align: center;
	}

	.manager-add-rule {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		height: 34px;
		padding: 0 10px;
		border: 1px solid #e2b0dc;
		border-radius: 8px;
		background: #fff8fe;
		color: #b432a5;
		font-size: 12px;
		font-weight: 650;
	}

	.manager-rule-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.manager-rule-card {
		padding: 14px;
		border: 1px solid #e6e3e7;
		border-radius: 8px;
		background: #fff;
	}

	.manager-rule-card .manager-field:first-of-type {
		margin-top: 14px;
	}

	.manager-rule-heading,
	.manager-rule-heading-actions,
	.manager-constant-control {
		display: flex;
		align-items: center;
	}

	.manager-rule-heading {
		justify-content: space-between;
		gap: 10px;
	}

	.manager-rule-heading > text {
		overflow: hidden;
		font-size: 13px;
		font-weight: 700;
		color: #303137;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.manager-rule-heading-actions {
		gap: 7px;
		flex: 0 0 auto;
	}

	.manager-rule-heading-actions > text {
		font-size: 10px;
		color: #8b8c92;
	}

	.manager-toggle {
		position: relative;
		width: 40px;
		height: 24px;
		border-radius: 12px;
		background: #c7c5ca;
		transition: background 160ms ease;
	}

	.manager-toggle view {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 3px rgba(30, 27, 32, 0.25);
		transition: transform 160ms ease;
	}

	.manager-toggle.enabled {
		background: #d43bc2;
	}

	.manager-toggle.enabled view {
		transform: translateX(16px);
	}

	.manager-delete-rule {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		color: #b24a55;
	}

	.manager-rule-options {
		align-items: end;
	}

	.manager-constant-control {
		justify-content: space-between;
		height: 44px;
		margin-top: 12px;
		padding: 0 2px;
	}

	.manager-order-field {
		margin-top: 12px;
	}

	.manager-picker-wrap,
	.manager-picker {
		width: 100%;
	}

	.manager-picker-value {
		display: flex;
		align-items: center;
		justify-content: space-between;
		color: #303137;
	}

	.manager-danger-zone {
		padding: 18px 0;
	}

	.manager-delete-book {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		width: 100%;
		height: 44px;
		border: 1px solid #e5b7bd;
		border-radius: 8px;
		background: #fff;
		color: #ad3f4b;
		font-size: 13px;
		font-weight: 650;
	}

	.manager-delete-confirm {
		display: flex;
		padding: 13px;
		border: 1px solid #e5b7bd;
		border-radius: 8px;
		background: #fff7f8;
		flex-direction: column;
		gap: 12px;
	}

	.manager-delete-confirm > text {
		font-size: 12px;
		line-height: 1.5;
		color: #71353d;
	}

	.manager-delete-confirm > view {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.manager-delete-confirm button {
		height: 34px;
		padding: 0 14px;
		border: 1px solid #dbd7dc;
		border-radius: 8px;
		background: #fff;
		color: #4e4f55;
		font-size: 12px;
		font-weight: 650;
	}

	.manager-delete-confirm button:last-child {
		border-color: #b94653;
		background: #b94653;
		color: #fff;
	}

	.manager-error {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin: 12px 0 0;
		padding: 10px 12px;
		border: 1px solid #edc5ca;
		border-radius: 8px;
		background: #fff7f8;
		color: #a83f4b;
	}

	.manager-error text {
		min-width: 0;
		font-size: 12px;
		line-height: 1.5;
		word-break: break-word;
	}

	.manager-editor-tail {
		height: 6px;
	}

	button:disabled,
	input:disabled,
	textarea:disabled {
		opacity: 0.58;
	}

	@media (max-width: 380px) {
		.world-book-manager-backdrop {
			padding-right: 8px;
			padding-left: 8px;
		}

		.manager-editor-scroll,
		.manager-list-scroll {
			padding-right: 12px;
			padding-left: 12px;
		}

		.manager-number-grid,
		.manager-rule-options {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.manager-toggle,
		.manager-toggle view {
			transition: none;
		}
	}
</style>

<template>
	<view class="character-detail-screen" data-testid="character-detail">
		<view class="character-detail-header">
			<button class="character-detail-back" :aria-label="creating ? '取消新建角色' : editing ? '取消编辑' : '返回联系人'" @click="handleBack"><ArrowLeft :size="25" /></button>
			<text class="character-detail-title">{{ creating ? '新建角色' : '角色卡详情' }}</text>
			<button v-if="character" class="character-detail-edit" :disabled="saving" @click="editing ? $emit('cancel') : $emit('edit')">{{ editing ? '取消' : '编辑' }}</button>
			<view v-else class="character-detail-header-space" />
		</view>

		<scroll-view v-if="character" class="character-detail-scroll" scroll-y>
			<view class="character-profile">
				<view class="character-profile-avatar-wrap">
					<ProviderLogo class="character-profile-avatar" :src="character.avatarDataUrl || '/static/zhiyu-logo.png'" :alt="profileName" mode="aspectFill" />
					<view v-if="editing" class="character-profile-avatar-badge" aria-hidden="true"><Camera :size="18" /></view>
				</view>
				<view v-if="editing" class="character-avatar-source-actions" aria-label="更换角色头像">
					<button :disabled="saving" @click="requestAvatarChange('gallery')"><Image :size="17" /><text>相册</text></button>
					<button :disabled="saving" @click="requestAvatarChange('file')"><FileText :size="17" /><text>文件</text></button>
				</view>
				<text class="character-profile-name">{{ profileName }}</text>
				<text v-if="profileNickname" class="character-profile-nickname">{{ profileNickname }}</text>
				<view v-if="characterTags.length" class="character-tag-list">
					<text v-for="tag in characterTags" :key="tag" class="character-tag">{{ tag }}</text>
				</view>
				<text v-if="character.creator" class="character-profile-creator">创作者：{{ character.creator }}</text>
			</view>

			<template v-if="editing">
				<view class="character-form-section">
					<text class="character-section-title">基本信息</text>
					<label class="character-field"><text>角色名称</text><input v-model="editForm.name" maxlength="120" placeholder="输入角色名称" /></label>
					<label class="character-field"><text>昵称</text><input v-model="editForm.nickname" maxlength="120" placeholder="可选" /></label>
					<label class="character-field"><text>创作者</text><input v-model="editForm.creator" maxlength="120" placeholder="可选" /></label>
					<label class="character-field"><text>标签</text><input v-model="editForm.tagsText" maxlength="500" placeholder="用逗号分隔多个标签" /></label>
				</view>

				<view class="character-form-section">
					<text class="character-section-title">角色设定</text>
					<label class="character-field character-field-multiline"><text>描述</text><textarea v-model="editForm.description" maxlength="-1" auto-height placeholder="角色背景与设定" /></label>
					<label class="character-field character-field-multiline"><text>性格</text><textarea v-model="editForm.personality" maxlength="-1" auto-height placeholder="角色性格" /></label>
					<label class="character-field character-field-multiline"><text>场景</text><textarea v-model="editForm.scenario" maxlength="-1" auto-height placeholder="对话发生的场景" /></label>
				</view>

				<view class="character-form-section">
					<text class="character-section-title">问候与示例</text>
					<label class="character-field character-field-multiline"><text>首次问候语</text><textarea v-model="editForm.firstMessage" maxlength="-1" auto-height placeholder="新建聊天时发送的第一条消息" /></label>
					<view class="alternate-greetings-header"><text>备用问候语</text><button aria-label="添加备用问候语" @click="addGreeting"><Plus :size="17" /><text>添加</text></button></view>
					<view v-if="editForm.alternateGreetings.length" class="alternate-greetings-list">
						<view v-for="(_, index) in editForm.alternateGreetings" :key="index" class="alternate-greeting-editor">
							<textarea v-model="editForm.alternateGreetings[index]" maxlength="-1" auto-height :placeholder="`备用问候语 ${index + 1}`" />
							<button :aria-label="`删除备用问候语 ${index + 1}`" @click="removeGreeting(index)"><Trash2 :size="17" /></button>
						</view>
					</view>
					<text v-else class="character-form-empty">暂无备用问候语</text>
					<label class="character-field character-field-multiline"><text>对话示例</text><textarea v-model="editForm.messageExample" maxlength="-1" auto-height placeholder="角色与用户的示例对话" /></label>
				</view>

				<view class="character-form-section">
					<text class="character-section-title">提示词</text>
					<label class="character-field character-field-multiline"><text>系统提示词</text><textarea v-model="editForm.systemPrompt" maxlength="-1" auto-height placeholder="角色专用系统提示词" /></label>
					<label class="character-field character-field-multiline"><text>历史后提示词</text><textarea v-model="editForm.postHistoryInstructions" maxlength="-1" auto-height placeholder="追加在历史消息之后的提示词" /></label>
					<label class="character-field character-field-multiline"><text>创作者备注</text><textarea v-model="editForm.creatorNotes" maxlength="-1" auto-height placeholder="不会作为角色消息直接发送" /></label>
				</view>
			</template>

			<template v-else>
				<view class="character-detail-section">
					<text class="character-section-title">角色设定</text>
					<view class="character-detail-item"><text>描述</text><text selectable user-select>{{ detailValue(cardData.description) }}</text></view>
					<view class="character-detail-item"><text>性格</text><text selectable user-select>{{ detailValue(cardData.personality) }}</text></view>
					<view class="character-detail-item"><text>场景</text><text selectable user-select>{{ detailValue(cardData.scenario) }}</text></view>
				</view>

				<view class="character-detail-section">
					<text class="character-section-title">问候与示例</text>
					<view class="character-detail-item"><text>首次问候语</text><text selectable user-select>{{ detailValue(cardData.first_mes) }}</text></view>
					<view class="character-detail-item"><text>备用问候语</text><text>{{ alternateGreetingCount }} 条</text></view>
					<view v-for="(greeting, index) in alternateGreetings" :key="index" class="character-greeting"><text>{{ index + 1 }}</text><text selectable user-select>{{ greeting }}</text></view>
					<view class="character-detail-item"><text>对话示例</text><text selectable user-select>{{ detailValue(cardData.mes_example) }}</text></view>
				</view>

				<view class="character-detail-section">
					<text class="character-section-title">提示词</text>
					<view class="character-detail-item"><text>系统提示词</text><text selectable user-select>{{ detailValue(cardData.system_prompt) }}</text></view>
					<view class="character-detail-item"><text>历史后提示词</text><text selectable user-select>{{ detailValue(cardData.post_history_instructions) }}</text></view>
					<view class="character-detail-item"><text>创作者备注</text><text selectable user-select>{{ detailValue(cardData.creator_notes) }}</text></view>
				</view>

				<view class="character-detail-section character-world-book-section" data-testid="character-world-books">
					<view class="character-world-book-heading">
						<text class="character-section-title">世界书</text>
						<text>{{ worldBookCount }} 本 · {{ worldBookEntryCount }} 条规则</text>
					</view>
					<view v-if="displayWorldBooks.length" class="character-world-book-list">
						<view v-for="(book, bookIndex) in displayWorldBooks" :key="worldBookKey(book, bookIndex)" class="character-world-book">
							<button
								class="character-world-book-toggle"
								:aria-expanded="isWorldBookExpanded(book, bookIndex)"
								:aria-label="`${isWorldBookExpanded(book, bookIndex) ? '收起' : '展开'}世界书 ${worldBookName(book)}`"
								@click="toggleWorldBook(book, bookIndex)"
							>
								<view class="character-world-book-icon"><FileText :size="19" /></view>
								<view class="character-world-book-copy">
									<text>{{ worldBookName(book) }}</text>
									<text>{{ worldBookMeta(book) }}</text>
								</view>
								<ChevronDown class="character-world-book-chevron" :class="{ expanded: isWorldBookExpanded(book, bookIndex) }" :size="18" />
							</button>
							<view v-if="isWorldBookExpanded(book, bookIndex)" class="character-world-book-body">
								<text v-if="worldBookDescription(book)" class="character-world-book-description" selectable user-select>{{ worldBookDescription(book) }}</text>
								<view v-if="worldBookEntries(book).length" class="character-world-book-entries">
									<view v-for="(entry, entryIndex) in worldBookEntries(book)" :key="`${worldBookKey(book, bookIndex)}-entry-${entry.id ?? entry.uid ?? entryIndex}`" class="character-world-book-entry">
										<view class="character-world-book-entry-heading">
											<text>{{ worldBookEntryTitle(entry, entryIndex) }}</text>
											<text :class="{ disabled: entry.enabled === false }">{{ worldBookEntryMode(entry) }}</text>
										</view>
										<view v-if="worldBookEntryKeys(entry)" class="character-world-book-triggers"><text>触发词</text><text selectable user-select>{{ worldBookEntryKeys(entry) }}</text></view>
										<text class="character-world-book-entry-content" selectable user-select>{{ detailValue(entry.content) }}</text>
									</view>
								</view>
								<view v-else class="character-world-book-no-rules"><text>暂无规则</text></view>
							</view>
						</view>
					</view>
					<view v-else class="character-world-book-empty"><FileText :size="27" /><text>这张角色卡没有关联世界书</text></view>
				</view>

				<view class="character-detail-section character-source-section">
					<text class="character-section-title">卡片信息</text>
					<view class="character-source-row"><text>卡片版本</text><text>{{ character.characterVersion || character.sourceVersion || 'V3' }}</text></view>
					<view class="character-source-row"><text>源文件</text><text>{{ character.sourceFileName || '未知' }}</text></view>
					<view class="character-source-row"><text>世界书</text><text>{{ worldBookCount }} 本</text></view>
					<view class="character-source-row"><text>附加资源</text><text>{{ assetCount }} 项</text></view>
					<view class="character-source-row"><text>导入时间</text><text>{{ formatDate(character.importedAt) }}</text></view>
				</view>

				<view v-if="!creating" class="character-detail-section character-management-section">
					<text class="character-section-title">角色管理</text>
					<button class="character-management-row" :disabled="saving" @click="emitCharacterAction('export-json')"><FileText :size="19" /><text>导出角色卡 JSON</text><Download :size="18" /></button>
					<button class="character-management-row" :disabled="saving" @click="emitCharacterAction('export-png')"><Image :size="19" /><text>导出角色卡 PNG</text><Download :size="18" /></button>
					<button class="character-management-row character-management-danger" :disabled="saving" @click="deleteConfirmationOpen = true"><Trash2 :size="19" /><text>删除角色</text><ChevronRight :size="18" /></button>
				</view>
			</template>

			<view class="character-detail-tail" />
		</scroll-view>

		<view v-else class="character-detail-empty">
			<Contact :size="44" />
			<text>角色卡不存在或已被移除</text>
			<button @click="$emit('back')">返回联系人</button>
		</view>

		<view v-if="character" class="character-detail-footer">
			<button v-if="editing" class="character-primary-action" :disabled="saving || !canSave" @click="save"><Check :size="19" /><text>{{ saving ? '保存中...' : creating ? '创建角色' : '保存角色卡' }}</text></button>
			<button v-else class="character-primary-action" :disabled="saving" data-testid="new-character-chat" @click="$emit('new-chat')"><MessageCircle :size="20" /><text>新建聊天</text></button>
		</view>

		<view v-if="deleteConfirmationOpen && character" class="character-delete-backdrop" @click.self="deleteConfirmationOpen = false">
			<view class="character-delete-dialog" role="dialog" aria-modal="true" aria-label="确认删除角色">
				<view class="character-delete-icon"><Trash2 :size="24" /></view>
				<text class="character-delete-title">删除“{{ profileName }}”？</text>
				<text class="character-delete-copy">角色及头像资源将被移除，已有会话会保留并解除角色绑定。</text>
				<view class="character-delete-actions">
					<button :disabled="saving" @click="deleteConfirmationOpen = false">取消</button>
					<button class="character-delete-confirm" :disabled="saving" @click="confirmDelete">确认删除</button>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import { ArrowLeft, Camera, Check, ChevronDown, ChevronRight, Contact, Download, FileText, Image, MessageCircle, Plus, Trash2 } from './app-icons.js'
	import ProviderLogo from './provider-logo.js'
	import { createCharacterEditForm } from '../features/character-editor.js'
	import { CHARACTER_MANAGEMENT_EVENTS } from '../features/character-management.js'

	export default {
		components: { ArrowLeft, Camera, Check, ChevronDown, ChevronRight, Contact, Download, FileText, Image, MessageCircle, Plus, ProviderLogo, Trash2 },
		props: {
			character: { type: Object, default: null },
			worldBooks: { type: Array, default: () => [] },
			creating: { type: Boolean, default: false },
			editing: { type: Boolean, default: false },
			saving: { type: Boolean, default: false }
		},
		emits: {
			back: null,
			cancel: null,
			edit: null,
			'new-chat': null,
			save: payload => Boolean(payload && typeof payload === 'object'),
			'request-avatar-change': payload => ['gallery', 'file'].includes(payload?.source) && Boolean(payload?.characterId),
			'export-json': payload => Boolean(payload?.characterId),
			'export-png': payload => Boolean(payload?.characterId),
			'delete-character': payload => Boolean(payload?.characterId)
		},
		data() {
			return { editForm: createCharacterEditForm(this.character || {}), deleteConfirmationOpen: false, expandedWorldBookIds: [] }
		},
		computed: {
			cardData() { return this.character?.card?.data || {} },
			profileName() { return String(this.editing ? this.editForm.name : this.character?.name || '').trim() || '未命名角色' },
			profileNickname() { return String(this.editing ? this.editForm.nickname : this.character?.nickname || '').trim() },
			characterTags() { return Array.isArray(this.character?.tags) ? this.character.tags.filter(Boolean) : [] },
			alternateGreetings() { return Array.isArray(this.cardData.alternate_greetings) ? this.cardData.alternate_greetings.filter(Boolean) : [] },
			alternateGreetingCount() { return this.alternateGreetings.length },
			embeddedWorldBook() {
				const data = this.cardData.character_book
				if (!data || typeof data !== 'object' || Array.isArray(data)) return null
				return {
					id: `embedded-${this.character?.id || 'character'}`,
					characterId: this.character?.id || null,
					scope: 'character',
					source: 'character-card',
					name: data.name || `${this.profileName} 世界书`,
					data
				}
			},
			displayWorldBooks() {
				const books = (Array.isArray(this.worldBooks) ? this.worldBooks : []).filter(book => book && !book.deletedAt)
				if (!this.embeddedWorldBook) return books
				const characterId = String(this.character?.id || '')
				const hasStoredEmbeddedBook = books.some(book => book.source === 'character-card' || (
					book.scope === 'character' && String(book.characterId || '') === characterId
				))
				return hasStoredEmbeddedBook ? books : [this.embeddedWorldBook, ...books]
			},
			worldBookCount() { return this.displayWorldBooks.length },
			worldBookEntryCount() { return this.displayWorldBooks.reduce((total, book) => total + this.worldBookEntries(book).length, 0) },
			assetCount() { return Array.isArray(this.character?.assetIds) ? this.character.assetIds.length : 0 },
			canSave() { return Boolean(String(this.editForm.name || '').trim()) }
		},
		watch: {
			displayWorldBooks: {
				immediate: true,
				handler(books) {
					const keys = books.map((book, index) => this.worldBookKey(book, index))
					const retained = this.expandedWorldBookIds.filter(id => keys.includes(id))
					this.expandedWorldBookIds = retained.length ? retained : keys.slice(0, 1)
				}
			},
			editing(value) {
				if (value) this.resetEditForm()
			},
			character(value) {
				this.deleteConfirmationOpen = false
				if (!this.editing) this.editForm = createCharacterEditForm(value || {})
			}
		},
		methods: {
			resetEditForm() { this.editForm = createCharacterEditForm(this.character || {}) },
			worldBookKey(book, index) { return String(book?.id || `world-book-${index}`) },
			worldBookName(book) { return String(book?.name || book?.data?.name || '未命名世界书').trim() || '未命名世界书' },
			worldBookDescription(book) { return String(book?.data?.description || book?.description || '').trim() },
			worldBookEntries(book) {
				const entries = book?.data?.entries
				if (Array.isArray(entries)) return entries.filter(entry => entry && typeof entry === 'object')
				if (entries && typeof entries === 'object') return Object.values(entries).filter(entry => entry && typeof entry === 'object')
				return []
			},
			worldBookScopeLabel(book) {
				if (book?.source === 'character-card' || book?.scope === 'character') return '角色卡内嵌'
				const characterIds = Array.isArray(book?.characterIds) ? book.characterIds.filter(Boolean) : []
				return book?.scope === 'global' && !book?.characterId && !characterIds.length ? '全局生效' : '当前角色'
			},
			worldBookMeta(book) { return `${this.worldBookEntries(book).length} 条规则 · ${this.worldBookScopeLabel(book)}` },
			worldBookEntryTitle(entry, index) { return String(entry?.name || entry?.comment || '').trim() || `规则 ${index + 1}` },
			worldBookEntryKeys(entry) {
				const values = [entry?.keys ?? entry?.key, entry?.secondary_keys ?? entry?.keysecondary]
					.flatMap(value => Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
					.map(value => String(value).trim())
					.filter(Boolean)
				return [...new Set(values)].join('、')
			},
			worldBookEntryMode(entry) {
				if (entry?.enabled === false) return '已停用'
				if (entry?.constant) return '常驻'
				return this.worldBookEntryKeys(entry) ? '关键词' : '条件'
			},
			isWorldBookExpanded(book, index) { return this.expandedWorldBookIds.includes(this.worldBookKey(book, index)) },
			toggleWorldBook(book, index) {
				const id = this.worldBookKey(book, index)
				this.expandedWorldBookIds = this.expandedWorldBookIds.includes(id)
					? this.expandedWorldBookIds.filter(value => value !== id)
					: [...this.expandedWorldBookIds, id]
			},
			handleBack() {
				if (this.deleteConfirmationOpen) {
					this.deleteConfirmationOpen = false
					return
				}
				this.$emit(this.editing ? 'cancel' : 'back')
			},
			requestAvatarChange(source) {
				if (!this.editing || this.saving || !['gallery', 'file'].includes(source)) return
				this.$emit(CHARACTER_MANAGEMENT_EVENTS.requestAvatarChange, { characterId: this.character.id, source })
			},
			emitCharacterAction(eventName) {
				if (this.saving || !this.character?.id || ![CHARACTER_MANAGEMENT_EVENTS.exportJson, CHARACTER_MANAGEMENT_EVENTS.exportPng].includes(eventName)) return
				this.$emit(eventName, { characterId: this.character.id })
			},
			confirmDelete() {
				if (this.saving || !this.character?.id) return
				this.deleteConfirmationOpen = false
				this.$emit(CHARACTER_MANAGEMENT_EVENTS.deleteCharacter, { characterId: this.character.id })
			},
			addGreeting() { this.editForm.alternateGreetings.push('') },
			removeGreeting(index) { this.editForm.alternateGreetings.splice(index, 1) },
			save() {
				if (!this.canSave || this.saving) return
				this.$emit('save', { ...this.editForm, alternateGreetings: [...this.editForm.alternateGreetings] })
			},
			detailValue(value) { return String(value || '').trim() || '未填写' },
			formatDate(value) {
				const date = new Date(value)
				if (!value || Number.isNaN(date.getTime())) return '未知'
				const pad = number => String(number).padStart(2, '0')
				return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
			}
		}
	}
</script>

<style scoped>
	.character-detail-screen {
		position: relative;
		display: flex;
		min-width: 0;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		background: #f3f3f5;
		animation: character-detail-enter 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.character-detail-header {
		display: grid;
		align-items: center;
		grid-template-columns: 52px minmax(0, 1fr) 52px;
		height: 62px;
		padding: 0 8px;
		border-bottom: 1px solid #e8e8eb;
		background: #fff;
		flex: 0 0 auto;
	}

	.character-detail-back,
	.character-detail-edit {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 42px;
		color: #24252a;
	}

	.character-detail-back {
		width: 42px;
		border-radius: 50%;
	}

	.character-detail-edit {
		width: 52px;
		font-size: 15px;
		font-weight: 650;
		color: #c437b4;
	}

	.character-detail-title {
		overflow: hidden;
		font-size: 18px;
		font-weight: 700;
		color: #202126;
		text-align: center;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.character-detail-header-space {
		width: 52px;
	}

	.character-detail-scroll {
		display: block;
		min-height: 0;
		flex: 1;
	}

	.character-profile {
		display: flex;
		align-items: center;
		padding: 24px 20px 22px;
		background: #fff;
		flex-direction: column;
	}

	.character-profile-avatar {
		display: block;
		width: 92px;
		height: 92px;
		overflow: hidden;
		border-radius: 50%;
		background: #e8e8ec;
		box-shadow: 0 5px 16px rgba(41, 35, 45, 0.13);
	}

	.character-profile-avatar-wrap {
		position: relative;
		width: 92px;
		height: 92px;
		flex: 0 0 auto;
	}

	.character-profile-avatar-badge {
		position: absolute;
		right: -3px;
		bottom: -2px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 3px solid #fff;
		border-radius: 50%;
		background: #2f3035;
		color: #fff;
	}

	.character-avatar-source-actions {
		display: grid;
		width: min(220px, 100%);
		height: 38px;
		margin-top: 13px;
		overflow: hidden;
		border: 1px solid #dedde2;
		border-radius: 7px;
		background: #fff;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.character-avatar-source-actions button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-width: 0;
		font-size: 13px;
		font-weight: 650;
		color: #4f5056;
	}

	.character-avatar-source-actions button + button {
		border-left: 1px solid #dedde2;
	}

	.character-avatar-source-actions button:active {
		background: #f4f4f6;
	}

	.character-avatar-source-actions button:disabled {
		opacity: 0.5;
	}

	.character-profile-name {
		max-width: 100%;
		margin-top: 13px;
		font-size: 23px;
		font-weight: 750;
		line-height: 30px;
		color: #202126;
		text-align: center;
		word-break: break-word;
	}

	.character-profile-nickname,
	.character-profile-creator {
		margin-top: 4px;
		font-size: 13px;
		line-height: 19px;
		color: #88898f;
		text-align: center;
	}

	.character-tag-list {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		margin-top: 10px;
		flex-wrap: wrap;
	}

	.character-tag {
		padding: 4px 8px;
		border-radius: 5px;
		background: #fff0fb;
		font-size: 11px;
		line-height: 16px;
		color: #b632a8;
	}

	.character-detail-section,
	.character-form-section {
		margin-top: 10px;
		padding: 17px 18px 5px;
		background: #fff;
	}

	.character-section-title {
		display: block;
		padding-bottom: 12px;
		font-size: 15px;
		font-weight: 700;
		color: #c437b4;
	}

	.character-detail-item {
		display: flex;
		padding: 13px 0 15px;
		border-top: 1px solid #efeff1;
		flex-direction: column;
		gap: 7px;
	}

	.character-detail-item > text:first-child,
	.character-source-row > text:first-child,
	.character-field > text:first-child,
	.alternate-greetings-header > text {
		font-size: 13px;
		font-weight: 650;
		color: #65666c;
	}

	.character-detail-item > text:last-child {
		font-size: 14px;
		line-height: 22px;
		color: #28292e;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.character-greeting {
		display: flex;
		gap: 10px;
		padding: 10px 0 14px;
		border-top: 1px solid #f1f1f3;
	}

	.character-greeting > text:first-child {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #f4eaf3;
		font-size: 11px;
		color: #b632a8;
		flex: 0 0 auto;
	}

	.character-greeting > text:last-child {
		min-width: 0;
		font-size: 13px;
		line-height: 21px;
		color: #44454a;
		white-space: pre-wrap;
		word-break: break-word;
		flex: 1;
	}

	.character-world-book-section {
		padding-bottom: 8px;
	}

	.character-world-book-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding-bottom: 12px;
	}

	.character-world-book-heading .character-section-title {
		padding-bottom: 0;
	}

	.character-world-book-heading > text:last-child {
		font-size: 12px;
		line-height: 18px;
		color: #888f99;
		white-space: nowrap;
	}

	.character-world-book-list,
	.character-world-book-empty {
		border-top: 1px solid #efeff1;
	}

	.character-world-book + .character-world-book {
		border-top: 1px solid #efeff1;
	}

	.character-world-book-toggle {
		display: grid;
		align-items: center;
		gap: 11px;
		width: 100%;
		min-height: 66px;
		padding: 10px 0;
		grid-template-columns: 38px minmax(0, 1fr) 20px;
		text-align: left;
	}

	.character-world-book-toggle:active {
		background: #f8f9fa;
	}

	.character-world-book-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 8px;
		background: #eaf5f3;
		color: #287d76;
	}

	.character-world-book-copy {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 3px;
	}

	.character-world-book-copy > text:first-child {
		overflow: hidden;
		font-size: 14px;
		font-weight: 680;
		line-height: 20px;
		color: #292b30;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.character-world-book-copy > text:last-child {
		overflow: hidden;
		font-size: 11px;
		line-height: 17px;
		color: #858c96;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.character-world-book-chevron {
		color: #8f969f;
		transition: transform 180ms ease;
	}

	.character-world-book-chevron.expanded {
		transform: rotate(180deg);
	}

	.character-world-book-body {
		min-width: 0;
		margin-left: 49px;
		padding: 0 0 8px;
	}

	.character-world-book-description {
		display: block;
		padding: 3px 0 13px;
		font-size: 13px;
		line-height: 20px;
		color: #5d626a;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.character-world-book-entry {
		padding: 12px 0 14px;
		border-top: 1px solid #eff1f2;
	}

	.character-world-book-entry-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}

	.character-world-book-entry-heading > text:first-child {
		min-width: 0;
		font-size: 13px;
		font-weight: 680;
		line-height: 19px;
		color: #303238;
		word-break: break-word;
		flex: 1;
	}

	.character-world-book-entry-heading > text:last-child {
		padding: 2px 6px;
		border-radius: 4px;
		background: #edf7f5;
		font-size: 10px;
		line-height: 15px;
		color: #27766f;
		white-space: nowrap;
		flex: 0 0 auto;
	}

	.character-world-book-entry-heading > text:last-child.disabled {
		background: #f2f2f3;
		color: #8d8e93;
	}

	.character-world-book-triggers {
		display: grid;
		gap: 8px;
		margin-top: 8px;
		grid-template-columns: 42px minmax(0, 1fr);
	}

	.character-world-book-triggers > text:first-child {
		font-size: 11px;
		line-height: 18px;
		color: #8b9199;
	}

	.character-world-book-triggers > text:last-child {
		min-width: 0;
		font-size: 11px;
		line-height: 18px;
		color: #4d6e78;
		word-break: break-word;
	}

	.character-world-book-entry-content {
		display: block;
		margin-top: 8px;
		padding-left: 10px;
		border-left: 2px solid #d5e8e5;
		font-size: 13px;
		line-height: 21px;
		color: #3f4248;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.character-world-book-no-rules,
	.character-world-book-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 72px;
		font-size: 13px;
		color: #989da4;
	}

	.character-world-book-no-rules {
		justify-content: flex-start;
		min-height: 48px;
		border-top: 1px solid #eff1f2;
	}

	.character-source-section {
		padding-bottom: 12px;
	}

	.character-management-section {
		padding-bottom: 8px;
	}

	.character-management-row {
		display: grid;
		align-items: center;
		width: 100%;
		min-height: 48px;
		padding: 0 2px;
		border-top: 1px solid #efeff1;
		grid-template-columns: 28px minmax(0, 1fr) 24px;
		color: #4b4c52;
		text-align: left;
	}

	.character-management-row > text {
		min-width: 0;
		font-size: 14px;
		font-weight: 600;
		color: #2e2f34;
	}

	.character-management-row > :last-child {
		color: #929399;
	}

	.character-management-row:active {
		background: #f7f7f8;
	}

	.character-management-row:disabled {
		opacity: 0.5;
	}

	.character-management-danger,
	.character-management-danger > text,
	.character-management-danger > :last-child {
		color: #b93b49;
	}

	.character-source-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 18px;
		min-height: 40px;
		padding: 10px 0;
		border-top: 1px solid #efeff1;
	}

	.character-source-row > text:last-child {
		min-width: 0;
		font-size: 13px;
		line-height: 20px;
		color: #303136;
		text-align: right;
		word-break: break-all;
	}

	.character-field {
		display: flex;
		padding: 12px 0;
		border-top: 1px solid #efeff1;
		flex-direction: column;
		gap: 8px;
	}

	.character-field input,
	.character-field textarea,
	.alternate-greeting-editor textarea {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #dedde1;
		border-radius: 7px;
		background: #fafafa;
		font-size: 14px;
		line-height: 21px;
		color: #24252a;
	}

	.character-field input {
		height: 44px;
		padding: 0 12px;
	}

	.character-field textarea,
	.alternate-greeting-editor textarea {
		min-height: 90px;
		padding: 10px 12px;
	}

	.alternate-greetings-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 0 8px;
		border-top: 1px solid #efeff1;
	}

	.alternate-greetings-header button {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 34px;
		padding: 0 9px;
		border-radius: 6px;
		background: #fff0fb;
		font-size: 12px;
		font-weight: 650;
		color: #b632a8;
	}

	.alternate-greeting-editor {
		position: relative;
		padding: 4px 0 8px;
	}

	.alternate-greeting-editor textarea {
		padding-right: 44px;
	}

	.alternate-greeting-editor button {
		position: absolute;
		top: 12px;
		right: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 6px;
		color: #b44a57;
	}

	.character-form-empty {
		display: block;
		padding: 8px 0 14px;
		font-size: 13px;
		color: #999aa0;
	}

	.character-detail-tail {
		height: 112px;
	}

	.character-detail-footer {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 8;
		padding: 10px 18px max(10px, env(safe-area-inset-bottom));
		border-top: 1px solid rgba(226, 223, 227, 0.92);
		background: rgba(255, 255, 255, 0.97);
		box-shadow: 0 -5px 18px rgba(39, 33, 42, 0.07);
	}

	.character-primary-action {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 100%;
		height: 50px;
		border-radius: 8px;
		background: #d43bc2;
		font-size: 16px;
		font-weight: 700;
		color: #fff;
		box-shadow: 0 6px 16px rgba(212, 59, 194, 0.22);
	}

	.character-primary-action:active {
		transform: scale(0.985);
	}

	.character-primary-action:disabled,
	.character-detail-edit:disabled {
		opacity: 0.5;
	}

	.character-detail-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		flex-direction: column;
		gap: 14px;
		font-size: 14px;
		color: #8c8d92;
	}

	.character-detail-empty button {
		height: 40px;
		padding: 0 16px;
		border-radius: 7px;
		background: #d43bc2;
		font-size: 14px;
		color: #fff;
	}

	.character-delete-backdrop {
		position: fixed;
		inset: 0;
		z-index: 30;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		background: rgba(22, 22, 25, 0.42);
	}

	.character-delete-dialog {
		display: flex;
		box-sizing: border-box;
		width: min(340px, 100%);
		padding: 22px 20px 18px;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 16px 44px rgba(20, 19, 22, 0.22);
		flex-direction: column;
	}

	.character-delete-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 42px;
		border-radius: 50%;
		background: #fff0f1;
		color: #b93b49;
	}

	.character-delete-title {
		margin-top: 14px;
		font-size: 17px;
		font-weight: 750;
		line-height: 24px;
		color: #24252a;
		word-break: break-word;
	}

	.character-delete-copy {
		margin-top: 8px;
		font-size: 13px;
		line-height: 20px;
		color: #77787e;
	}

	.character-delete-actions {
		display: grid;
		gap: 10px;
		margin-top: 20px;
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.character-delete-actions button {
		height: 42px;
		border-radius: 7px;
		background: #f1f1f3;
		font-size: 14px;
		font-weight: 650;
		color: #4c4d52;
	}

	.character-delete-actions .character-delete-confirm {
		background: #b93b49;
		color: #fff;
	}

	.character-delete-actions button:disabled {
		opacity: 0.5;
	}

	@keyframes character-detail-enter {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@media (prefers-reduced-motion: reduce) {
		.character-detail-screen { animation: none; }
		.character-world-book-chevron { transition: none; }
	}
</style>

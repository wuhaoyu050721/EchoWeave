<template>
	<view class="contacts-screen">
		<view class="contacts-header">
			<text class="contacts-title">联系人</text>
			<view class="contacts-header-actions">
				<button class="contacts-world-books" :class="{ active: worldBookCount > 0 }" :aria-label="`管理世界书，当前 ${worldBookCount} 本`" @click="$emit('manage-world-books')"><FileText :size="23" /><text v-if="worldBookCount" class="contacts-world-book-count">{{ worldBookCount > 99 ? '99+' : worldBookCount }}</text></button>
				<button class="contacts-sort" :class="{ active: sortMode === 'recent' }" :aria-label="sortMode === 'name' ? '按导入时间排序' : '按名称排序'" @click="$emit('toggle-sort')"><Tune :size="25" /></button>
			</view>
		</view>
		<view class="contacts-search">
			<Search :size="21" />
			<input :value="query" placeholder="搜索联系人" confirm-type="search" @input="$emit('update:query', $event.detail?.value ?? $event.target?.value ?? '')" />
			<button v-if="query" aria-label="清空联系人搜索" @click="$emit('update:query', '')"><X :size="17" /></button>
		</view>
		<scroll-view class="contacts-scroll" scroll-y>
			<view v-if="items.length" class="contacts-list">
				<text class="contacts-list-label">{{ sortMode === 'name' ? '按名称排序' : '按导入时间排序' }}</text>
				<button v-for="character in items" :key="character.id" class="contact-row" :aria-label="`查看角色卡 ${character.name}`" @click="$emit('open-character-details', character)">
					<ProviderLogo class="contact-avatar" :src="character.avatarDataUrl || '/static/zhiyu-logo.png'" :alt="character.name" mode="aspectFill" />
					<view class="contact-copy">
						<text class="contact-name">{{ character.name }}</text>
						<text class="contact-meta">{{ characterMeta(character) }}</text>
					</view>
					<ChevronRight :size="18" />
				</button>
			</view>
			<view v-else class="contacts-empty">
				<Contact :size="42" />
				<text>{{ query ? '没有匹配的联系人' : '还没有角色联系人' }}</text>
			</view>
			<view class="contacts-tail" />
		</scroll-view>
		<view class="contacts-add-scrim" :class="{ visible: addMenuOpen }" aria-hidden="true" @click="closeAddMenu" />
		<view class="contacts-add-control" :class="{ open: addMenuOpen }">
			<view id="contacts-add-menu" class="contacts-add-menu" :aria-hidden="!addMenuOpen">
				<button class="contacts-add-option custom" :disabled="busy" :tabindex="addMenuOpen ? 0 : -1" aria-label="新建自定义角色" @click="createCharacter">
					<view class="contacts-add-option-icon"><PersonAdd :size="19" /></view><text>新建角色</text>
				</button>
				<button class="contacts-add-option gallery" :disabled="busy" :tabindex="addMenuOpen ? 0 : -1" aria-label="从相册导入角色卡" @click="importCharacterFromGallery">
					<view class="contacts-add-option-icon"><Image :size="19" /></view><text>相册导入</text>
				</button>
				<button class="contacts-add-option file" :disabled="busy" :tabindex="addMenuOpen ? 0 : -1" aria-label="从文件管理器导入角色卡" @click="importCharacterFromFile">
					<view class="contacts-add-option-icon"><FileText :size="19" /></view><text>文件导入</text>
				</button>
			</view>
			<button class="contacts-add-toggle" :class="{ active: addMenuOpen }" :disabled="busy" aria-controls="contacts-add-menu" :aria-expanded="addMenuOpen" :aria-label="addMenuOpen ? '收起添加菜单' : '添加角色'" @click="toggleAddMenu">
				<Plus class="contacts-add-toggle-icon" :size="21" /><text>添加</text>
			</button>
		</view>
	</view>
</template>

<script>
	import { ChevronRight, Contact, FileText, Image, PersonAdd, Plus, Search, Tune, X } from './app-icons.js'
	import ProviderLogo from './provider-logo.js'

	export default {
		components: { ChevronRight, Contact, FileText, Image, PersonAdd, Plus, ProviderLogo, Search, Tune, X },
		props: {
			items: { type: Array, default: () => [] },
			query: { type: String, default: '' },
			sortMode: { type: String, default: 'name' },
			worldBookCount: { type: Number, default: 0 },
			busy: { type: Boolean, default: false }
		},
		emits: ['create-character', 'import-character-file', 'import-character-gallery', 'manage-world-books', 'open-character-details', 'toggle-sort', 'update:query'],
		data() {
			return { addMenuOpen: false }
		},
		watch: {
			busy(value) {
				if (value) this.closeAddMenu()
			}
		},
		methods: {
			toggleAddMenu() {
				if (!this.busy) this.addMenuOpen = !this.addMenuOpen
			},
			closeAddMenu() {
				this.addMenuOpen = false
			},
			createCharacter() {
				this.closeAddMenu()
				this.$emit('create-character')
			},
			importCharacterFromGallery() {
				this.closeAddMenu()
				this.$emit('import-character-gallery')
			},
			importCharacterFromFile() {
				this.closeAddMenu()
				this.$emit('import-character-file')
			},
			characterMeta(character) {
				const entries = character.card?.data?.character_book?.entries?.length || 0
				const creator = String(character.creator || '').trim()
				return [entries ? `世界书 ${entries} 条` : '无内嵌世界书', creator].filter(Boolean).join(' · ')
			}
		}
	}
</script>

<style scoped>
	.contacts-screen {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
		flex-direction: column;
		padding: 0 16px;
		background: #f3f3f5;
	}

	.contacts-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 64px;
		padding-top: 6px;
	}

	.contacts-title {
		font-size: 26px;
		font-weight: 650;
		color: #1f2023;
	}

	.contacts-sort,
	.contacts-world-books,
	.contacts-search button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		color: #26272b;
	}

	.contacts-sort.active {
		color: #d43bc2;
		background: #fff0fb;
	}

	.contacts-header-actions {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.contacts-world-books {
		position: relative;
	}

	.contacts-world-books.active {
		color: #d43bc2;
	}

	.contacts-world-book-count {
		position: absolute;
		top: 1px;
		right: -1px;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 16px;
		height: 16px;
		padding: 0 3px;
		border: 2px solid #f3f3f5;
		border-radius: 8px;
		background: #d43bc2;
		color: #fff;
		font-size: 9px;
		font-weight: 700;
	}

	.contacts-search {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 54px;
		padding: 0 15px;
		border: 1px solid #e9e7eb;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 3px 12px rgba(43, 39, 47, 0.06);
		color: #8b8c91;
	}

	.contacts-search input {
		min-width: 0;
		font-size: 15px;
		color: #222328;
		flex: 1;
	}

	.contacts-search button {
		width: 30px;
		height: 30px;
	}

	.contacts-scroll {
		min-height: 0;
		padding-top: 18px;
		flex: 1;
	}

	.contacts-list {
		overflow: hidden;
		border: 1px solid #ebe9ed;
		border-radius: 8px;
		background: #fff;
		box-shadow: 0 4px 16px rgba(43, 39, 47, 0.05);
	}

	.contacts-list-label {
		display: block;
		padding: 16px 18px 8px;
		font-size: 13px;
		font-weight: 600;
		color: #c03db3;
	}

	.contact-row {
		display: flex;
		align-items: center;
		gap: 13px;
		width: 100%;
		min-height: 76px;
		padding: 8px 15px;
		text-align: left;
		color: #b0adb3;
	}

	.contact-row:active {
		background: #faf7fb;
	}

	.contact-avatar {
		display: block;
		width: 56px;
		height: 56px;
		overflow: hidden;
		border-radius: 50%;
		background: #ececf0;
		flex: 0 0 auto;
	}

	.contact-copy {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 5px;
	}

	.contact-name,
	.contact-meta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.contact-name {
		font-size: 16px;
		font-weight: 620;
		color: #24252a;
	}

	.contact-meta {
		font-size: 12px;
		color: #98999e;
	}

	.contacts-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 260px;
		flex-direction: column;
		gap: 12px;
		color: #999aa0;
		font-size: 14px;
	}

	.contacts-tail {
		height: 250px;
	}

	.contacts-add-scrim {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 5;
		background: rgba(31, 28, 34, 0.1);
		opacity: 0;
		pointer-events: none;
		transition: opacity 180ms ease;
	}

	.contacts-add-scrim.visible {
		opacity: 1;
		pointer-events: auto;
	}

	.contacts-add-control {
		position: absolute;
		right: 20px;
		bottom: 92px;
		z-index: 6;
		display: flex;
		align-items: flex-end;
		flex-direction: column;
		gap: 10px;
	}

	.contacts-add-menu {
		display: flex;
		align-items: flex-end;
		flex-direction: column;
		gap: 8px;
		opacity: 0;
		transform: translateY(14px) scale(0.98);
		transform-origin: right bottom;
		pointer-events: none;
		transition: opacity 160ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.contacts-add-control.open .contacts-add-menu {
		opacity: 1;
		transform: translateY(0) scale(1);
		pointer-events: auto;
	}

	.contacts-add-option {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 148px;
		height: 48px;
		padding: 0 12px;
		border: 1px solid #e4e1e6;
		border-radius: 8px;
		background: #fff;
		color: #2d2e33;
		font-size: 13px;
		font-weight: 650;
		box-shadow: 0 10px 26px rgba(39, 34, 43, 0.15);
		opacity: 0;
		transform: translateY(10px);
		transition: opacity 150ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1), background 150ms ease;
	}

	.contacts-add-control.open .contacts-add-option {
		opacity: 1;
		transform: translateY(0);
	}

	.contacts-add-control.open .contacts-add-option:nth-child(1) {
		transition-delay: 20ms;
	}

	.contacts-add-control.open .contacts-add-option:nth-child(2) {
		transition-delay: 55ms;
	}

	.contacts-add-control.open .contacts-add-option:nth-child(3) {
		transition-delay: 90ms;
	}

	.contacts-add-option-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		flex: 0 0 auto;
	}

	.contacts-add-option.custom .contacts-add-option-icon {
		background: #fff0fb;
		color: #c733b5;
	}

	.contacts-add-option.gallery .contacts-add-option-icon {
		background: #edf6ff;
		color: #3185cc;
	}

	.contacts-add-option.file .contacts-add-option-icon {
		background: #fff5e9;
		color: #d77928;
	}

	.contacts-add-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		width: 104px;
		height: 50px;
		border: 1px solid rgba(255, 255, 255, 0.35);
		border-radius: 8px;
		background: #d43bc2;
		color: #fff;
		font-size: 14px;
		font-weight: 700;
		box-shadow: 0 10px 26px rgba(188, 45, 173, 0.28);
		transition: transform 180ms ease, background 180ms ease, box-shadow 180ms ease;
	}

	.contacts-add-toggle-icon {
		transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.contacts-add-toggle.active {
		background: #292a2f;
		box-shadow: 0 10px 26px rgba(32, 31, 36, 0.24);
	}

	.contacts-add-toggle.active .contacts-add-toggle-icon {
		transform: rotate(45deg);
	}

	.contacts-add-option:active,
	.contacts-add-toggle:active {
		transform: scale(0.96);
	}

	.contacts-add-option:disabled,
	.contacts-add-toggle:disabled {
		opacity: 0.58;
	}

	@media (prefers-reduced-motion: reduce) {
		.contacts-add-scrim,
		.contacts-add-menu,
		.contacts-add-option,
		.contacts-add-toggle,
		.contacts-add-toggle-icon {
			transition: none;
		}
	}
</style>

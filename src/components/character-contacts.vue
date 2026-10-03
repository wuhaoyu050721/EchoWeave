<template>
	<view class="contacts-screen paper-main-page" @keydown.esc="closeAddMenu">
		<scroll-view class="contacts-scroll" scroll-y @scroll="closeAddMenu" @scrolltolower="$emit('load-more')">
			<view class="contacts-page-content">
				<MainPageHeading title="联系人" subtitle="让每个角色，都有自己的故事。">
					<template #actions>
						<view class="contacts-add-control" :class="{ open: addMenuOpen }">
							<button class="contacts-add-toggle paper-action" :class="{ active: addMenuOpen }" :disabled="busy" aria-controls="contacts-add-menu" :aria-expanded="addMenuOpen" :aria-label="addMenuOpen ? '收起添加菜单' : '添加角色'" @click="toggleAddMenu">
								<Plus class="contacts-add-toggle-icon" :size="19" /><text>添加</text>
							</button>
							<view v-if="addMenuOpen" id="contacts-add-menu" class="contacts-add-menu">
								<button class="contacts-add-option" :disabled="busy" aria-label="新建自定义角色" @click="createCharacter"><PersonAdd :size="19" /><text>新建角色</text></button>
								<button class="contacts-add-option" :disabled="busy" aria-label="从相册导入角色卡" @click="importCharacterFromGallery"><Image :size="19" /><text>相册导入</text></button>
								<button class="contacts-add-option" :disabled="busy" aria-label="从文件管理器导入角色卡" @click="importCharacterFromFile"><FileText :size="19" /><text>文件导入</text></button>
								<button class="contacts-add-option contacts-character-maker" :disabled="busy" aria-label="点击前往制作角色卡" @click="openCharacterMaker"><Plus :size="19" /><text>制作角色卡</text><ChevronRight :size="14" /></button>
							</view>
						</view>
					</template>
				</MainPageHeading>
				<view class="contacts-search paper-search">
					<Search :size="21" />
					<input :value="query" placeholder="搜索角色" aria-label="搜索联系人" confirm-type="search" @focus="closeAddMenu" @input="$emit('update:query', $event.detail?.value ?? $event.target?.value ?? '')" />
					<button v-if="query" aria-label="清空联系人搜索" @click="$emit('update:query', '')"><X :size="17" /></button>
				</view>
				<view class="contacts-section-heading paper-section-heading">
					<text>我的角色</text>
					<button class="contacts-sort" :class="{ active: sortMode === 'recent' }" :aria-label="sortMode === 'name' ? '按导入时间排序' : '按名称排序'" @click="$emit('toggle-sort')"><Tune :size="17" /><text>{{ sortMode === 'name' ? '按名称' : '按导入时间' }}</text><ChevronDown :size="14" /></button>
				</view>
				<view v-if="items.length" class="contacts-list">
					<button v-for="character in items" :key="character.id" v-memo="[character]" class="contact-row" :aria-label="`查看角色卡 ${character.name}`" @click="$emit('open-character-details', character)">
						<ProviderLogo class="contact-avatar" :src="character.avatarDataUrl || '/static/zhiyu-logo.png'" :alt="character.name" mode="aspectFill" lazy-load />
						<view class="contact-copy">
							<text class="contact-name">{{ character.name }}</text>
							<text class="contact-meta">{{ characterMeta(character) }}</text>
						</view>
					</button>
				</view>
				<view v-else class="contacts-empty">
					<view class="contacts-empty-icon"><Contact :size="33" /></view>
					<text class="contacts-empty-title">{{ query ? '没有匹配的联系人' : '还没有角色联系人' }}</text>
					<text class="contacts-empty-copy">{{ query ? '试试角色名、标签或创作者。' : '添加一个角色，让故事从这里开始。' }}</text>
					<button v-if="query" class="contacts-empty-action" @click="$emit('update:query', '')">清空搜索</button>
					<button v-else class="contacts-empty-action" :disabled="busy" @click="createCharacter"><Plus :size="16" /><text>新建角色</text></button>
				</view>
				<button class="contacts-world-books" :aria-label="`管理世界书，当前 ${worldBookCount} 本`" @click="$emit('manage-world-books')">
					<view class="contacts-world-book-icon"><FileText :size="26" /></view>
					<view class="contacts-world-book-copy"><view class="contacts-world-book-title"><text>世界书</text><text v-if="worldBookCount" class="contacts-world-book-count">{{ worldBookCount }} 本</text></view><text class="contacts-world-book-description">为角色补充背景与设定</text></view>
					<ChevronRight :size="20" />
				</button>
				<button class="contacts-import-link" :disabled="busy" aria-label="导入角色卡" @click="importCharacterFromFile"><Import :size="17" /><text>{{ busy ? '正在导入…' : '导入角色卡' }}</text></button>
			</view>
		</scroll-view>
		<view v-if="addMenuOpen" class="contacts-add-scrim" aria-hidden="true" @click="closeAddMenu" />
	</view>
</template>

<script>
	import { ChevronDown, ChevronRight, Contact, FileText, Image, Import, PersonAdd, Plus, Search, Tune, X } from './app-icons.js'
	import MainPageHeading from './main-page-heading.vue'
	import ProviderLogo from './provider-logo.js'

	export default {
		components: { ChevronDown, ChevronRight, Contact, FileText, Image, Import, MainPageHeading, PersonAdd, Plus, ProviderLogo, Search, Tune, X },
		props: {
			items: { type: Array, default: () => [] },
			query: { type: String, default: '' },
			sortMode: { type: String, default: 'name' },
			worldBookCount: { type: Number, default: 0 },
			busy: { type: Boolean, default: false }
		},
		emits: ['create-character', 'import-character-file', 'import-character-gallery', 'load-more', 'manage-world-books', 'open-character-details', 'open-character-maker', 'toggle-sort', 'update:query'],
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
			openCharacterMaker() {
				this.closeAddMenu()
				this.$emit('open-character-maker')
			},
			characterMeta(character) {
				const tags = Array.isArray(character.tags) ? character.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 2) : []
				if (tags.length) return tags.join(' · ')
				const entries = character.card?.data?.character_book?.entries?.length || 0
				const creator = String(character.creator || '').trim()
				return [creator, entries ? `世界书 ${entries} 条` : ''].filter(Boolean).join(' · ') || '等待与你相遇'
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
		min-width: 0;
		flex-direction: column;
		padding: 0;
		background: var(--paper-bg, #f8f7f4);
		color: var(--paper-ink, #25232a);
	}

	.contacts-scroll { flex: 1; min-height: 0; overflow-y: auto; }
	.contacts-page-content { padding: 0 20px calc(88px + env(safe-area-inset-bottom)); }
	.contacts-page-content :deep(.paper-heading) { margin-right: -20px; margin-left: -20px; }
	.contacts-page-content :deep(.paper-heading-actions) { z-index: 21; }
	.contacts-search { margin-bottom: 20px; }
	.contacts-search input { min-width: 0; flex: 1; color: var(--paper-ink, #25232a); font-size: 14px; }
	.contacts-search button { display: flex; align-items: center; justify-content: center; width: 32px; height: 36px; color: var(--paper-muted, #82798b); }
	.contacts-section-heading { margin-bottom: 12px; }
	.contacts-sort { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-height: 44px; margin: -12px 0; padding: 0 0 0 8px; color: var(--paper-muted, #82798b); font-size: 12px; font-weight: 400; }
	.contacts-sort.active { color: var(--paper-accent, #7850a0); }
	.contacts-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 12px; row-gap: 20px; }
	.contact-row { display: flex; min-width: 0; flex-direction: column; padding: 0; border-radius: 10px; background: transparent; text-align: left; content-visibility: auto; contain-intrinsic-size: auto 194px; }
	.contact-avatar { display: block; width: 100%; height: auto; aspect-ratio: 4 / 3; overflow: hidden; border-radius: 10px; background: var(--paper-soft, #eee8f4); flex: 0 0 auto; }
	.contact-copy { display: flex; width: 100%; min-width: 0; padding: 9px 1px 0; flex-direction: column; gap: 4px; }
	.contact-name, .contact-meta { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.contact-name { color: var(--paper-ink, #25232a); font-size: 16px; font-weight: 650; line-height: 23px; }
	.contact-meta { color: var(--paper-muted, #82798b); font-size: 12px; line-height: 18px; }
	.contacts-world-books { display: flex; align-items: center; gap: 13px; width: 100%; margin-top: 18px; padding: 10px 3px; border-top: 1px solid var(--paper-line, #e7e2e9); border-bottom: 1px solid var(--paper-line, #e7e2e9); border-radius: 0; overflow: visible; color: var(--paper-muted, #82798b); text-align: left; }
	.contacts-world-book-icon, .contacts-empty-icon { display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; border-radius: 50%; background: var(--paper-soft, #eee8f4); color: var(--paper-accent, #7850a0); flex: 0 0 auto; }
	.contacts-world-book-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 5px; }
	.contacts-world-book-title { display: flex; align-items: center; gap: 8px; color: var(--paper-ink, #25232a); font-size: 16px; font-weight: 600; }
	.contacts-world-book-count { color: var(--paper-accent, #7850a0); font-size: 11px; font-weight: 400; pointer-events: none; }
	.contacts-world-book-description { font-size: 12px; line-height: 18px; }
	.contacts-import-link, .contacts-empty-action { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; color: var(--paper-accent, #7850a0); font-size: 13px; }
	.contacts-import-link { width: 100%; margin-top: 4px; }
	.contacts-empty { display: flex; align-items: center; justify-content: center; min-height: 240px; padding: 16px 8px; flex-direction: column; gap: 10px; text-align: center; }
	.contacts-empty-icon { width: 68px; height: 68px; margin-bottom: 6px; }
	.contacts-empty-title { font-size: 15px; font-weight: 550; }
	.contacts-empty-copy { color: var(--paper-muted, #82798b); font-size: 12px; line-height: 20px; }
	.contacts-empty-action { padding: 0 15px; }
	.contacts-add-scrim { position: absolute; inset: 0; z-index: 20; background: transparent; }
	.contacts-add-control { position: relative; }
	.contacts-add-control.open { z-index: 21; }
	.contacts-add-toggle { gap: 5px; }
	.contacts-add-toggle-icon { transition: transform 150ms ease; }
	.contacts-add-toggle.active .contacts-add-toggle-icon { transform: rotate(45deg); }
	.contacts-add-menu { position: absolute; top: calc(100% + 8px); right: 0; width: 176px; padding: 6px; border: 1px solid var(--paper-line, #e7e2e9); border-radius: 14px; background: var(--paper-bg, #f8f7f4); box-shadow: 0 9px 28px rgba(42, 31, 55, 0.12); animation: contacts-menu-enter 150ms ease both; }
	.contacts-add-option { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 0 10px; border-radius: 8px; color: var(--paper-ink, #25232a); font-size: 13px; text-align: left; }
	.contacts-add-option :deep(.app-icon) { color: var(--paper-accent, #7850a0); flex: 0 0 auto; }
	.contacts-character-maker { margin-top: 4px; border-top: 1px solid var(--paper-line, #e7e2e9); border-radius: 0 0 8px 8px; }
	.contacts-add-option:active, .contact-row:active { background: var(--paper-soft, #eee8f4); }
	.contacts-screen button:disabled { opacity: 0.55; }
	.contacts-screen button:focus-visible { outline: 2px solid var(--paper-accent, #7850a0); outline-offset: 3px; }
	@keyframes contacts-menu-enter { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
	@media (prefers-reduced-motion: reduce) { .contacts-add-menu { animation: none; } .contacts-add-toggle-icon { transition: none; } }
</style>

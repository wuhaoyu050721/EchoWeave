<template>
	<view class="group-editor" data-testid="group-chat-editor">
		<view class="group-editor-header">
			<button class="group-editor-back" aria-label="返回会话" :disabled="saving" @click="$emit('back')"><ArrowLeft :size="23" /></button>
			<view class="group-editor-heading">
				<text>{{ editing ? '群聊设置' : '新建群聊' }}</text>
				<text>角色卡与 AI 接口可混合，最多 8 位</text>
			</view>
			<button class="group-editor-save" :disabled="!canSave" @click="submit">{{ saving ? '保存中' : '保存' }}</button>
		</view>

		<scroll-view class="group-editor-scroll" scroll-y>
			<view class="group-editor-summary">
				<GroupAvatar :participants="selectedParticipants" :size="62" :name="title || '新群聊'" />
				<view class="group-editor-summary-copy">
					<text>{{ title.trim() || generatedTitle }}</text>
					<text>已选择 {{ selectedKeys.length }} / 8 位成员</text>
				</view>
			</view>

			<text class="group-editor-section-label">群聊名称</text>
			<label class="group-editor-name-field">
				<input v-model="title" maxlength="40" placeholder="留空时使用成员名称" />
				<text>{{ title.length }}/40</text>
			</label>

			<text class="group-editor-section-label">群成员</text>
			<view class="group-member-tabs" role="tablist" aria-label="群成员类型">
				<button
					class="group-member-tab"
					:class="{ active: memberTab === 'characters' }"
					:aria-selected="memberTab === 'characters'"
					role="tab"
					@click="memberTab = 'characters'"
				>
					<Contact :size="17" />
					<text>角色卡</text>
					<text v-if="selectedCharacterCount" class="group-member-tab-count">{{ selectedCharacterCount }}</text>
				</button>
				<button
					class="group-member-tab"
					:class="{ active: memberTab === 'providers' }"
					:aria-selected="memberTab === 'providers'"
					role="tab"
					@click="memberTab = 'providers'"
				>
					<Server :size="17" />
					<text>AI 接口</text>
					<text v-if="selectedProviderCount" class="group-member-tab-count">{{ selectedProviderCount }}</text>
				</button>
			</view>

			<view class="group-member-list">
				<template v-if="memberTab === 'characters'">
					<button
						v-for="character in characters"
						:key="`character:${character.id}`"
						class="group-member-row"
						:class="{ selected: isSelected('character', character.id) }"
						:aria-pressed="isSelected('character', character.id)"
						@click="toggleMember('character', character)"
					>
						<view class="group-member-avatar-shell">
							<ProviderLogo class="group-member-avatar" :src="character.avatarDataUrl || '/static/zhiyu-logo.png'" :alt="character.name" mode="aspectFill" />
						</view>
						<view class="group-member-copy">
							<text>{{ character.name || '未命名角色' }}</text>
							<text>{{ characterSubtitle(character) }}</text>
						</view>
						<view class="group-member-type character">角色</view>
						<view class="group-member-check"><Check v-if="isSelected('character', character.id)" :size="14" /></view>
					</button>
					<view v-if="!characters.length" class="group-member-empty">
						<Contact :size="34" />
						<text>暂无可用角色卡</text>
					</view>
				</template>

				<template v-else>
					<button
						v-for="provider in providers"
						:key="`provider:${provider.id}`"
						class="group-member-row"
						:class="{ selected: isSelected('provider', provider.id) }"
						:aria-pressed="isSelected('provider', provider.id)"
						@click="toggleMember('provider', provider)"
					>
						<view class="group-member-avatar-shell provider">
							<ProviderLogo class="group-member-avatar" :src="provider.logo || '/static/providers/openai.png'" :alt="provider.name" mode="aspectFill" />
						</view>
						<view class="group-member-copy">
							<text>{{ provider.name || '未命名接口' }}</text>
							<text>{{ providerSubtitle(provider) }}</text>
						</view>
						<view class="group-member-type provider">接口</view>
						<view class="group-member-check"><Check v-if="isSelected('provider', provider.id)" :size="14" /></view>
					</button>
					<view v-if="!providers.length" class="group-member-empty">
						<Server :size="34" />
						<text>暂无已保存的 AI 接口</text>
					</view>
				</template>
			</view>

			<text class="group-editor-section-label">回复方式</text>
			<view class="group-reply-modes" role="radiogroup" aria-label="群聊回复方式">
				<button
					v-for="option in modeOptions"
					:key="option.id"
					class="group-reply-mode"
					:class="{ active: replyMode === option.id }"
					:aria-checked="replyMode === option.id"
					role="radio"
					@click="replyMode = option.id"
				>
					<text>{{ option.label }}</text>
					<text>{{ option.description }}</text>
				</button>
			</view>

			<view v-if="replyMode === 'round-robin'" class="group-responder-count">
				<view>
					<text>每轮发言成员</text>
					<text>没有点名时依次选择</text>
				</view>
				<view class="group-count-stepper">
					<button aria-label="减少每轮发言成员" :disabled="respondersPerTurn <= 1" @click="adjustResponderCount(-1)">-</button>
					<text>{{ respondersPerTurn }}</text>
					<button aria-label="增加每轮发言成员" :disabled="respondersPerTurn >= maximumResponders" @click="adjustResponderCount(1)">+</button>
				</view>
			</view>

			<button class="group-auto-handoff" :class="{ active: autoHandoff }" role="switch" :aria-checked="autoHandoff" @click="autoHandoff = !autoHandoff">
				<view class="group-auto-handoff-copy">
					<text>AI 自动接力</text>
					<text>回复中的 @ 点名会触发下一位成员</text>
				</view>
				<view class="group-auto-handoff-switch"><i /></view>
			</button>

			<view class="group-editor-tail" />
		</scroll-view>

		<view class="group-editor-footer">
			<text v-if="selectedKeys.length < 2">至少选择两位成员</text>
			<text v-else>{{ replySummary }}</text>
			<button :disabled="!canSave" @click="submit"><MessageCircle :size="18" /><text>{{ editing ? '保存群聊' : '创建群聊' }}</text></button>
		</view>
	</view>
</template>

<script>
	import { GROUP_MEMBER_KINDS, groupParticipantKey, normalizeGroupParticipants } from '../core/group-chat.js'
	import { ArrowLeft, Check, Contact, MessageCircle, Server } from './app-icons.js'
	import GroupAvatar from './group-avatar.vue'
	import ProviderLogo from './provider-logo.js'

	export default {
		components: { ArrowLeft, Check, Contact, GroupAvatar, MessageCircle, ProviderLogo, Server },
		props: {
			characters: { type: Array, default: () => [] },
			providers: { type: Array, default: () => [] },
			conversation: { type: Object, default: null },
			saving: { type: Boolean, default: false }
		},
		emits: ['back', 'limit', 'save'],
		data() {
			return {
				title: '',
				memberTab: 'characters',
				selectedKeys: [],
				replyMode: 'round-robin',
				respondersPerTurn: 2,
				autoHandoff: true,
				responderCountTouched: false,
				modeOptions: [
					{ id: 'round-robin', label: '轮流回复', description: '点名优先，否则按成员顺序依次选择' },
					{ id: 'all', label: '全员回复', description: '每一轮所有群成员依次发言' },
					{ id: 'mention', label: '仅点名', description: '只有被 @ 的群成员会回复' }
				]
			}
		},
		computed: {
			editing() { return Boolean(this.conversation?.id) },
			selectedCharacterCount() {
				return this.selectedKeys.filter(key => key.startsWith(`${GROUP_MEMBER_KINDS.CHARACTER}:`)).length
			},
			selectedProviderCount() {
				return this.selectedKeys.filter(key => key.startsWith(`${GROUP_MEMBER_KINDS.PROVIDER}:`)).length
			},
			selectedParticipants() {
				const characterById = new Map(this.characters.map(character => [String(character.id), character]))
				const providerById = new Map(this.providers.map(provider => [String(provider.id), provider]))
				const previousByKey = new Map(normalizeGroupParticipants(this.conversation?.participants)
					.map(participant => [groupParticipantKey(participant), participant]))
				return this.selectedKeys.map(key => {
					const separator = key.indexOf(':')
					const kind = separator >= 0 ? key.slice(0, separator) : ''
					const id = separator >= 0 ? key.slice(separator + 1) : ''
					if (kind === GROUP_MEMBER_KINDS.PROVIDER) {
						const provider = providerById.get(id)
						if (provider) {
							return {
								memberKind: GROUP_MEMBER_KINDS.PROVIDER,
								providerProfileId: id,
								modelName: String(provider.defaultModel || ''),
								nameSnapshot: provider.name || '未命名接口',
								avatarSource: provider.logo || null,
								avatarDataUrl: provider.logo || '',
								enabled: true
							}
						}
					} else {
						const character = characterById.get(id)
						if (character) {
							return {
								memberKind: GROUP_MEMBER_KINDS.CHARACTER,
								characterId: id,
								nameSnapshot: character.name || '未命名角色',
								avatarAssetId: character.avatarAssetId || null,
								avatarDataUrl: character.avatarDataUrl || '',
								enabled: true
							}
						}
					}
					return previousByKey.get(key) || null
				}).filter(Boolean)
			},
			generatedTitle() {
				const names = this.selectedParticipants.slice(0, 3).map(participant => participant.nameSnapshot).filter(Boolean)
				return names.length ? names.join('、') : '选择群成员'
			},
			maximumResponders() { return Math.max(1, this.selectedKeys.length) },
			canSave() { return !this.saving && this.selectedKeys.length >= 2 && this.selectedKeys.length <= 8 },
			replySummary() {
				if (this.replyMode === 'all') return '所有成员将依次回复'
				if (this.replyMode === 'mention') return '发送消息时需要 @ 群成员'
				return `每轮默认由 ${this.respondersPerTurn} 位成员回复`
			}
		},
		watch: {
			conversation: {
				immediate: true,
				handler(value) {
					this.title = String(value?.title || '')
					this.selectedKeys = normalizeGroupParticipants(value?.participants)
						.filter(participant => participant.enabled !== false)
						.map(groupParticipantKey)
						.filter(Boolean)
						.slice(0, 8)
					this.memberTab = this.selectedProviderCount && !this.selectedCharacterCount ? 'providers' : 'characters'
					this.replyMode = ['round-robin', 'all', 'mention'].includes(value?.replyPolicy?.mode)
						? value.replyPolicy.mode
						: 'round-robin'
					this.respondersPerTurn = Math.max(1, Number(value?.replyPolicy?.respondersPerTurn) || 2)
					this.autoHandoff = value?.replyPolicy?.autoHandoff !== false
					this.responderCountTouched = Boolean(value?.id)
					this.clampResponderCount()
				}
			},
			selectedKeys() {
				if (!this.editing && !this.responderCountTouched) {
					this.respondersPerTurn = Math.min(2, this.maximumResponders)
				} else {
					this.clampResponderCount()
				}
			}
		},
		methods: {
			memberKey(kind, id) {
				return groupParticipantKey(kind === GROUP_MEMBER_KINDS.PROVIDER
					? { memberKind: kind, providerProfileId: id }
					: { memberKind: kind, characterId: id })
			},
			isSelected(kind, id) {
				return this.selectedKeys.includes(this.memberKey(kind, id))
			},
			toggleMember(kind, member) {
				const key = this.memberKey(kind, member?.id)
				if (!key || this.saving) return
				if (this.selectedKeys.includes(key)) {
					this.selectedKeys = this.selectedKeys.filter(value => value !== key)
					return
				}
				if (this.selectedKeys.length >= 8) {
					this.$emit('limit')
					return
				}
				this.selectedKeys = [...this.selectedKeys, key]
			},
			clampResponderCount() {
				this.respondersPerTurn = Math.max(1, Math.min(this.maximumResponders, Number(this.respondersPerTurn) || 1))
			},
			adjustResponderCount(delta) {
				this.responderCountTouched = true
				this.respondersPerTurn = Math.max(1, Math.min(this.maximumResponders, this.respondersPerTurn + delta))
			},
			characterSubtitle(character) {
				const personality = String(character?.card?.data?.personality || character?.card?.data?.description || '')
					.replace(/\s+/g, ' ')
					.trim()
				return personality.slice(0, 48) || '角色卡'
			},
			providerSubtitle(provider) {
				const protocol = provider?.protocolType === 'gemini-native' ? 'Gemini' : 'OpenAI 兼容'
				const model = String(provider?.defaultModel || '').trim() || '未设置默认模型'
				return `${protocol} · ${model}`
			},
			submit() {
				if (!this.canSave) return
				this.$emit('save', {
					id: this.conversation?.id || null,
					title: this.title.trim(),
					participants: this.selectedParticipants.map(participant => (
						participant.memberKind === GROUP_MEMBER_KINDS.PROVIDER
							? {
								memberKind: GROUP_MEMBER_KINDS.PROVIDER,
								providerProfileId: participant.providerProfileId,
								modelName: participant.modelName,
								enabled: true
							}
							: {
								memberKind: GROUP_MEMBER_KINDS.CHARACTER,
								characterId: participant.characterId,
								enabled: true
							}
					)),
					replyPolicy: {
						mode: this.replyMode,
						respondersPerTurn: this.respondersPerTurn,
						autoHandoff: this.autoHandoff
					}
				})
			}
		}
	}
</script>

<style scoped>
	.group-editor {
		display: flex;
		min-height: 0;
		background: #f3f3f5;
		flex: 1;
		flex-direction: column;
	}

	.group-editor-header {
		display: grid;
		align-items: center;
		min-height: 64px;
		padding: 4px 14px 0;
		border-bottom: 1px solid #e5e5e8;
		background: rgba(250, 250, 251, 0.96);
		grid-template-columns: 42px minmax(0, 1fr) 58px;
	}

	.group-editor-back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		color: #22252a;
	}

	.group-editor-heading {
		display: flex;
		min-width: 0;
		text-align: center;
		flex-direction: column;
	}

	.group-editor-heading text:first-child {
		font-size: 17px;
		font-weight: 700;
		color: #202226;
	}

	.group-editor-heading text:last-child {
		margin-top: 2px;
		font-size: 11px;
		color: #85888e;
	}

	.group-editor-save {
		font-size: 14px;
		font-weight: 700;
		color: #c12eb0;
	}

	.group-editor-save:disabled {
		color: #aaaeb4;
	}

	.group-editor-scroll {
		display: block;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		flex: 1;
	}

	.group-editor-summary {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 22px 18px 18px;
		background: #fff;
	}

	.group-editor-summary-copy {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 5px;
	}

	.group-editor-summary-copy text:first-child {
		overflow: hidden;
		font-size: 18px;
		font-weight: 750;
		color: #202226;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.group-editor-summary-copy text:last-child {
		font-size: 13px;
		color: #85888e;
	}

	.group-editor-section-label {
		display: block;
		padding: 18px 18px 8px;
		font-size: 12px;
		font-weight: 650;
		color: #777b83;
	}

	.group-editor-name-field {
		display: flex;
		align-items: center;
		min-height: 52px;
		padding: 0 16px;
		border-top: 1px solid #ececef;
		border-bottom: 1px solid #ececef;
		background: #fff;
	}

	.group-editor-name-field input {
		min-width: 0;
		font-size: 15px;
		color: #23252a;
		flex: 1;
	}

	.group-editor-name-field > text {
		margin-left: 10px;
		font-size: 11px;
		color: #a0a3a8;
	}

	.group-member-tabs {
		display: grid;
		margin: 0 16px 10px;
		padding: 3px;
		border: 1px solid #e2e3e7;
		border-radius: 8px;
		background: #e9e9ed;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 3px;
	}

	.group-member-tab {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 38px;
		border-radius: 6px;
		color: #6c7077;
		font-size: 13px;
		font-weight: 650;
		gap: 6px;
	}

	.group-member-tab.active {
		background: #fff;
		color: #b528a5;
		box-shadow: 0 1px 4px rgba(39, 41, 47, 0.1);
	}

	.group-member-tab-count {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 18px;
		height: 18px;
		padding: 0 4px;
		border-radius: 9px;
		background: #eceef1;
		color: #6f737a;
		font-size: 10px;
		font-weight: 700;
	}

	.group-member-tab.active .group-member-tab-count {
		background: #fae8f7;
		color: #a91f98;
	}

	.group-member-list,
	.group-reply-modes {
		border-top: 1px solid #ececef;
		border-bottom: 1px solid #ececef;
		background: #fff;
	}

	.group-member-row {
		display: flex;
		align-items: center;
		box-sizing: border-box;
		width: 100%;
		min-height: 68px;
		padding: 8px 16px;
		text-align: left;
	}

	.group-member-row + .group-member-row,
	.group-reply-mode + .group-reply-mode {
		border-top: 1px solid #f0f0f2;
	}

	.group-member-row.selected {
		background: #fff8fe;
	}

	.group-member-avatar-shell {
		display: flex;
		overflow: hidden;
		width: 46px;
		height: 46px;
		border-radius: 50%;
		background: #eef0f2;
		flex: 0 0 46px;
	}

	.group-member-avatar-shell.provider {
		box-sizing: border-box;
		border: 1px solid #e4e6e9;
		background: #fff;
	}

	.group-member-avatar {
		display: block;
		width: 46px;
		height: 46px;
		border-radius: 50%;
		object-fit: cover;
		flex: 0 0 46px;
	}

	.group-member-copy {
		display: flex;
		min-width: 0;
		margin-left: 12px;
		flex: 1;
		flex-direction: column;
		gap: 4px;
	}

	.group-member-copy text:first-child {
		overflow: hidden;
		font-size: 15px;
		font-weight: 650;
		color: #222429;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.group-member-copy text:last-child {
		overflow: hidden;
		font-size: 12px;
		color: #8a8d93;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.group-member-type {
		margin-left: 8px;
		padding: 3px 6px;
		border-radius: 5px;
		background: #eef5f6;
		color: #48808a;
		font-size: 10px;
		font-weight: 700;
		flex: 0 0 auto;
	}

	.group-member-type.provider {
		background: #faeaf7;
		color: #a52b96;
	}

	.group-member-check {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 23px;
		height: 23px;
		margin-left: 9px;
		border: 1.5px solid #c8cbd0;
		border-radius: 50%;
		color: #fff;
		flex: 0 0 23px;
	}

	.group-member-row.selected .group-member-check {
		border-color: #c833b7;
		background: #c833b7;
	}

	.group-member-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 142px;
		color: #999ca2;
		flex-direction: column;
		gap: 10px;
	}

	.group-reply-mode {
		display: flex;
		box-sizing: border-box;
		width: 100%;
		min-height: 67px;
		padding: 12px 18px;
		text-align: left;
		flex-direction: column;
		gap: 4px;
	}

	.group-reply-mode text:first-child {
		font-size: 15px;
		font-weight: 650;
		color: #25272b;
	}

	.group-reply-mode text:last-child {
		font-size: 12px;
		color: #888b91;
	}

	.group-reply-mode.active {
		border-left: 3px solid #c833b7;
		background: #fff7fd;
	}

	.group-reply-mode.active text:first-child {
		color: #b525a4;
	}

	.group-responder-count {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 68px;
		margin-top: 10px;
		padding: 0 18px;
		border-top: 1px solid #ececef;
		border-bottom: 1px solid #ececef;
		background: #fff;
	}

	.group-responder-count > view:first-child {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.group-responder-count > view:first-child text:first-child {
		font-size: 15px;
		font-weight: 650;
		color: #25272b;
	}

	.group-responder-count > view:first-child text:last-child {
		font-size: 12px;
		color: #8a8d93;
	}

	.group-count-stepper {
		display: grid;
		align-items: center;
		overflow: hidden;
		width: 112px;
		height: 36px;
		border: 1px solid #dedfe3;
		border-radius: 8px;
		background: #fafafb;
		grid-template-columns: 36px 40px 36px;
	}

	.group-count-stepper button,
	.group-count-stepper > text {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 36px;
		font-size: 18px;
		color: #3b3e44;
	}

	.group-count-stepper > text {
		border-right: 1px solid #e4e4e7;
		border-left: 1px solid #e4e4e7;
		font-size: 14px;
		font-weight: 700;
	}

	.group-count-stepper button:disabled {
		color: #c5c7cb;
	}

	.group-auto-handoff {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		box-sizing: border-box;
		width: 100%;
		min-height: 62px;
		margin-top: 10px;
		padding: 10px 18px;
		border-top: 1px solid #ececef;
		border-bottom: 1px solid #ececef;
		background: #fff;
		text-align: left;
	}

	.group-auto-handoff-copy {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 3px;
	}

	.group-auto-handoff-copy text:first-child {
		color: #25272b;
		font-size: 15px;
		font-weight: 650;
	}

	.group-auto-handoff-copy text:last-child {
		overflow: hidden;
		color: #8a8d93;
		font-size: 12px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.group-auto-handoff-switch {
		position: relative;
		width: 38px;
		height: 22px;
		border-radius: 11px;
		background: #c8cbd1;
		flex: 0 0 auto;
		transition: background 160ms ease;
	}

	.group-auto-handoff-switch i {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		box-shadow: 0 1px 3px rgba(20, 24, 30, 0.2);
		transition: transform 160ms ease;
	}

	.group-auto-handoff.active .group-auto-handoff-switch {
		background: #1f6fcb;
	}

	.group-auto-handoff.active .group-auto-handoff-switch i {
		transform: translateX(16px);
	}

	.group-editor-tail {
		height: 24px;
	}

	.group-editor-footer {
		display: flex;
		align-items: center;
		min-height: 70px;
		padding: 10px 16px max(10px, env(safe-area-inset-bottom));
		border-top: 1px solid #e2e3e6;
		background: #fff;
	}

	.group-editor-footer > text {
		min-width: 0;
		padding-right: 12px;
		font-size: 12px;
		line-height: 17px;
		color: #7c8087;
		flex: 1;
	}

	.group-editor-footer > button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 130px;
		height: 44px;
		border-radius: 8px;
		background: #c833b7;
		color: #fff;
		font-size: 14px;
		font-weight: 700;
		gap: 7px;
	}

	.group-editor-footer > button:disabled {
		background: #d8d8dc;
		color: #fff;
	}
</style>

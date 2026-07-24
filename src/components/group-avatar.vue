<template>
	<view
		class="group-avatar"
		:class="`group-avatar-count-${displayParticipants.length}`"
		:style="{ width: `${resolvedSize}px`, height: `${resolvedSize}px` }"
		:aria-label="label"
	>
		<view
			v-for="(participant, index) in displayParticipants"
			:key="participantKey(participant) || index"
			class="group-avatar-item"
		>
			<ProviderLogo
				class="group-avatar-image"
				:src="participant.avatarDataUrl || participant.avatarSource || '/static/zhiyu-logo.png'"
				:alt="participant.nameSnapshot || participant.name || '群成员'"
				mode="aspectFill"
				lazy-load
			/>
			<view v-if="index === 3 && overflowCount" class="group-avatar-overflow">+{{ overflowCount }}</view>
		</view>
	</view>
</template>

<script>
	import { groupParticipantKey } from '../core/group-chat.js'
	import ProviderLogo from './provider-logo.js'

	export default {
		components: { ProviderLogo },
		props: {
			participants: { type: Array, default: () => [] },
			size: { type: [Number, String], default: 48 },
			name: { type: String, default: '' }
		},
		methods: {
			participantKey(participant) {
				return groupParticipantKey(participant)
			}
		},
		computed: {
			resolvedSize() {
				const value = Number(this.size)
				return Number.isFinite(value) && value > 0 ? value : 48
			},
			displayParticipants() {
				return (Array.isArray(this.participants) ? this.participants : [])
					.filter(participant => participant && participant.enabled !== false)
					.slice(0, 4)
			},
			overflowCount() {
				const count = (Array.isArray(this.participants) ? this.participants : [])
					.filter(participant => participant && participant.enabled !== false)
					.length
				return count > 4 ? count - 3 : 0
			},
			label() {
				if (this.name) return this.name
				const names = this.displayParticipants
					.map(participant => participant.nameSnapshot || participant.name)
					.filter(Boolean)
				return names.length ? `群聊：${names.join('、')}` : '群聊'
			}
		}
	}
</script>

<style scoped>
	.group-avatar {
		position: relative;
		display: block;
		overflow: hidden;
		border-radius: 50%;
		background: #e9ecf0;
		flex: 0 0 auto;
	}

	.group-avatar-item {
		position: absolute;
		overflow: hidden;
		box-sizing: border-box;
		border: 1.5px solid #fff;
		border-radius: 50%;
		background: #dfe4e9;
	}

	.group-avatar-image {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		object-fit: cover;
		flex: 0 0 100%;
	}

	.group-avatar-count-1 .group-avatar-item {
		inset: 0;
		border-width: 0;
	}

	.group-avatar-count-2 .group-avatar-item {
		top: 17%;
		width: 66%;
		height: 66%;
	}

	.group-avatar-count-2 .group-avatar-item:first-child {
		left: 0;
	}

	.group-avatar-count-2 .group-avatar-item:nth-child(2) {
		right: 0;
	}

	.group-avatar-count-3 .group-avatar-item {
		width: 60%;
		height: 60%;
	}

	.group-avatar-count-3 .group-avatar-item:first-child {
		top: 0;
		left: 20%;
	}

	.group-avatar-count-3 .group-avatar-item:nth-child(2) {
		bottom: 0;
		left: 0;
	}

	.group-avatar-count-3 .group-avatar-item:nth-child(3) {
		right: 0;
		bottom: 0;
	}

	.group-avatar-count-4 .group-avatar-item {
		width: 54%;
		height: 54%;
	}

	.group-avatar-count-4 .group-avatar-item:first-child {
		top: 0;
		left: 0;
	}

	.group-avatar-count-4 .group-avatar-item:nth-child(2) {
		top: 0;
		right: 0;
	}

	.group-avatar-count-4 .group-avatar-item:nth-child(3) {
		bottom: 0;
		left: 0;
	}

	.group-avatar-count-4 .group-avatar-item:nth-child(4) {
		right: 0;
		bottom: 0;
	}

	.group-avatar-overflow {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		background: rgba(31, 36, 43, 0.68);
		color: #fff;
		font-size: 10px;
		font-weight: 700;
	}
</style>

<template>
	<view class="paper-heading">
		<AppImage class="paper-heading-leaves" src="/static/design/paper-leaves.png" alt="" aria-hidden="true" mode="aspectFit" />
		<view class="paper-brand"><text>织语</text><text>EchoWeave</text></view>
		<view class="paper-heading-actions"><slot name="actions" /></view>
		<text class="paper-heading-title">{{ title }}</text>
		<text v-if="subtitle" class="paper-heading-subtitle">{{ subtitle }}</text>
	</view>
</template>

<script>
	import AppImage from './app-image.js'
	export default {
		components: { AppImage },
		props: { title: { type: String, required: true }, subtitle: { type: String, default: '' } }
	}
</script>

<style scoped>
	.paper-heading { position: relative; flex: 0 0 auto; padding: 16px 20px 15px; }
	.paper-heading-leaves { position: absolute; top: 0; right: 0; width: 170px; height: 113px; pointer-events: none; opacity: .64; }
	.paper-brand { position: relative; display: flex; flex-direction: column; gap: 1px; margin-bottom: 9px; }
	.paper-brand text:first-child { color: var(--paper-accent, #7850a0); font-size: 19px; line-height: 24px; font-weight: 750; }
	.paper-brand text:last-child { color: var(--paper-muted, #79717d); font-size: 10px; line-height: 14px; letter-spacing: .3px; }
	.paper-heading-title { position: relative; display: block; color: var(--paper-ink, #25232a); font-size: 36px; font-weight: 750; line-height: 44px; letter-spacing: -.8px; }
	.paper-heading-subtitle { position: relative; display: block; color: var(--paper-muted, #79717d); font-size: 14px; line-height: 23px; margin-top: 2px; }
	.paper-heading-actions { position: absolute; top: 50px; right: 20px; display: flex; align-items: center; gap: 5px; z-index: 2; }
	@media (max-width: 350px) {
		.paper-heading { padding-left: 16px; padding-right: 16px; }
		.paper-heading-actions { right: 16px; }
		.paper-heading-title { font-size: 32px; line-height: 42px; }
		.paper-heading-subtitle { font-size: 12px; }
	}
</style>

<script>
	export default {
		onLaunch: function() {
			globalThis.__aiChatAppVisible = true
			console.log('App Launch')
		},
		onShow: function() {
			globalThis.__aiChatAppVisible = true
			console.log('App Show')
		},
		onHide: function() {
			globalThis.__aiChatAppVisible = false
			console.log('App Hide')
		}
	}
</script>

<style>
	page {
		background: #eceff1;
	}
</style>

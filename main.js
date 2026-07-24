import './src/core/legacy-runtime-polyfill.js'
import './src/core/abort-controller-polyfill.js'
import './src/core/text-encoding-polyfill.js'
import './src/components/app-icons.css'

// #ifdef APP-PLUS
import './src/components/app-icons-app.css'
import {
	aiChatKeystoreReady,
	aiChatKeystoreEncrypt,
	aiChatKeystoreDecrypt,
	aiChatSecureRandom
} from './uni_modules/ai-chat-keystore'
import {
	aiChatPickAttachments,
	aiChatWriteDownloadFile
} from './uni_modules/ai-chat-attachment-picker'
import {
	onAiChatStreamEvent,
	offAiChatStreamEvent,
	aiChatStreamRequest,
	aiChatStreamCancel
} from './uni_modules/ai-chat-streaming'

globalThis.__aiChatPackagedApp = true
globalThis.__aiChatNativeApis = {
	aiChatKeystoreReady,
	aiChatKeystoreEncrypt,
	aiChatKeystoreDecrypt,
	aiChatSecureRandom,
	aiChatPickAttachments,
	aiChatWriteDownloadFile,
	onAiChatStreamEvent,
	offAiChatStreamEvent,
	aiChatStreamRequest,
	aiChatStreamCancel
}
// #endif

import App from './App.vue'

// #ifndef VUE3
import Vue from 'vue'
import './uni.promisify.adaptor'
Vue.config.productionTip = false
App.mpType = 'app'
const app = new Vue({
	...App
})
app.$mount()
// #endif

// #ifdef VUE3
import {
	createSSRApp
} from 'vue'
export function createApp() {
	const app = createSSRApp(App)
	return {
		app
	}
}
// #endif

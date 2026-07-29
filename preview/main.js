import { createApp, defineAsyncComponent } from 'vue'
import MainPage from '../pages/index/index.vue'
import '../src/components/app-icons.css'

const previewLocation = `${window.location.search}${window.location.hash}`
const PreviewPage = previewLocation.includes('pages/android-diagnostics/index')
  ? defineAsyncComponent(() => import('../pages/android-diagnostics/index.vue'))
  : MainPage

const previewApp = createApp(PreviewPage)
const previewInstance = previewApp.mount('#app')
if (import.meta.env.DEV) {
  Object.defineProperty(globalThis, '__echoWeavePreview', {
    configurable: true,
    value: previewInstance
  })
}

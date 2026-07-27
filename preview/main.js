import { createApp, defineAsyncComponent } from 'vue'
import MainPage from '../pages/index/index.vue'
import '../src/components/app-icons.css'

const previewLocation = `${window.location.search}${window.location.hash}`
const PreviewPage = previewLocation.includes('pages/android-diagnostics/index')
  ? defineAsyncComponent(() => import('../pages/android-diagnostics/index.vue'))
  : MainPage

createApp(PreviewPage).mount('#app')

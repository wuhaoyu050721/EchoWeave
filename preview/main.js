import { createApp } from 'vue'
import DiagnosticsPage from '../pages/android-diagnostics/index.vue'
import MainPage from '../pages/index/index.vue'
import '../src/components/app-icons.css'

const previewLocation = `${window.location.search}${window.location.hash}`
const PreviewPage = previewLocation.includes('pages/android-diagnostics/index') ? DiagnosticsPage : MainPage

createApp(PreviewPage).mount('#app')

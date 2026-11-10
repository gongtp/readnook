import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import router from '@/router'
import { installProgressFlushListeners } from '@/services/readingProgress'
import { installGestureGuards } from '@/services/touchGuards'
import '@/styles/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
installProgressFlushListeners()
installGestureGuards()
app.mount('#app')

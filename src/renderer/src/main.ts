import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createIPCSyncPlugin } from './plugins/pinia-ipc-sync'
import App from './App.vue'

const app = createApp(App)

const pinia = createPinia()
pinia.use(createIPCSyncPlugin())

app.use(pinia)
app.mount('#app')

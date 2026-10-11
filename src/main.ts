import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { registerDocuments } from './documents'
import './style.css'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

registerDocuments()
createApp(App).use(createPinia()).mount('#app')

/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // Les tests Playwright (e2e/) tournent à part : `npm run test:e2e`.
  test: { include: ['src/**/*.test.ts'] },
})

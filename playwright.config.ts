import { defineConfig } from '@playwright/test'

const PORT = 5199

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
    // Navigateur déjà installé (Edge sur Windows) : aucun téléchargement. En CI : `E2E_CHANNEL=chromium` après `npx playwright install chromium`.
    channel: process.env.E2E_CHANNEL ?? 'msedge',
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
  },
})

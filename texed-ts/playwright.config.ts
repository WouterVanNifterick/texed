import { defineConfig, devices } from '@playwright/test';

// Runs against the production build: `pnpm build` first, then `pnpm exec playwright test`.
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://localhost:4173/texed/',
    viewport: { width: 1440, height: 1020 },
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm preview',
    url: 'http://localhost:4173/texed/',
    reuseExistingServer: !process.env.CI,
  },
});

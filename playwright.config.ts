import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 65000,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['json', { outputFile: 'playwright-report/results.json' }]]
    : 'list',
  use: {
    baseURL: 'http://localhost:4173/rocket-landing-3d-version2/',
    trace: 'on-first-retry',
    actionTimeout: 15000,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    channel: 'chrome',
    launchOptions: {
      args: ['--no-sandbox'],
    },
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    viewport: { width: 1280, height: 800 },
  },
});

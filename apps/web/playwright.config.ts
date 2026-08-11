import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', timeout: 30_000, fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4188', trace: 'retain-on-failure' },
  webServer: { command: 'node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4188', url: 'http://127.0.0.1:4188', reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  outputDir: 'test-results',
});

import { defineConfig, devices } from '@playwright/test';
import { diagnosticSpecs } from './playwright.suites';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:41988', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'diagnostic-mobile-chromium',
      testMatch: diagnosticSpecs,
      use: { ...devices['Pixel 7'], timezoneId: 'Asia/Shanghai' },
    },
  ],
  outputDir: 'test-results',
});

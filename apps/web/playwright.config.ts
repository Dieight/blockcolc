import { defineConfig, devices } from '@playwright/test';
import { crossViewportRendererSpecs, desktopOnlySpecs, diagnosticSpecs } from './playwright.suites';

export default defineConfig({
  testDir: './tests', timeout: 30_000, fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:41988', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'mobile-chromium',
      testIgnore: [desktopOnlySpecs, diagnosticSpecs],
      use: { ...devices['Pixel 7'], timezoneId: 'Asia/Shanghai' },
    },
    {
      name: 'desktop-chromium',
      testMatch: [desktopOnlySpecs, crossViewportRendererSpecs],
      testIgnore: diagnosticSpecs,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Shanghai' },
    },
  ],
  outputDir: 'test-results',
});

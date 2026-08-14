import { defineConfig, devices } from '@playwright/test';

const desktopOnlySpecs = /(?:responsive-qa|v2-world-interaction|v11-world-environment)\.spec\.ts/;
const crossViewportRendererSpecs = /(?:v3-lightweight-shading|v15-lighting-quality)\.spec\.ts/;

export default defineConfig({
  testDir: './tests', timeout: 30_000, fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:41988', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'mobile-chromium',
      testIgnore: desktopOnlySpecs,
      use: { ...devices['Pixel 7'], timezoneId: 'Asia/Shanghai' },
    },
    {
      name: 'desktop-chromium',
      testMatch: [desktopOnlySpecs, crossViewportRendererSpecs],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Shanghai' },
    },
  ],
  outputDir: 'test-results',
});

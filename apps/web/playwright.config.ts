import { defineConfig, devices } from '@playwright/test';

const desktopOnlySpecs = /(?:responsive-qa|v2-world-interaction|v11-world-environment)\.spec\.ts/;
const crossViewportRendererSpecs = /(?:v3-lightweight-shading|v15-lighting-quality)\.spec\.ts/;

export default defineConfig({
  testDir: './tests', timeout: 30_000, fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4188', trace: 'retain-on-failure' },
  webServer: { command: 'node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4188', url: 'http://127.0.0.1:4188', reuseExistingServer: true, timeout: 120_000 },
  projects: [
    {
      name: 'mobile-chromium',
      testIgnore: desktopOnlySpecs,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'desktop-chromium',
      testMatch: [desktopOnlySpecs, crossViewportRendererSpecs],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  outputDir: 'test-results',
});

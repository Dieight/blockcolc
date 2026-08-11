import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:4188",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

test('imports a real Litematic under a CSP that forbids eval', async ({ page }) => {
  const sample = resolve(process.cwd(), '../../litematic/bd29cade-7000-42b7-adc1-0631ce512c30.litematic');
  test.skip(!existsSync(sample), 'The real Litematic compatibility fixture stays local.');
  await page.addInitScript(() => {
    const violations: Array<{ directive: string; blocked: string }> = [];
    Object.defineProperty(window, '__blockcolcCspViolations', { value: violations });
    window.addEventListener('securitypolicyviolation', (event) => {
      violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': STRICT_CSP },
    });
  });

  await page.goto('/');
  await page.getByLabel('导入 .litematic').setInputFiles(sample);
  await expect(page.getByText(/4,301 个方块/)).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(4);

  const runtime = await page.evaluate(() => ({
    violations: (window as Window & { __blockcolcCspViolations?: unknown[] }).__blockcolcCspViolations ?? [],
    hasGlobalBuffer: 'Buffer' in window,
  }));
  expect(runtime.violations).toEqual([]);
  expect(runtime.hasGlobalBuffer).toBe(false);
});

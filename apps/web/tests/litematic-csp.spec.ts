import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:41988",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

// The user-supplied local bundle is intentionally optional on clean checkouts.
// The dedicated packaged-catalog spec asserts all seven entries when the bundle
// is available; this compatibility test keeps its original core/import
// contract in either checkout shape.
const LOCAL_BUILTIN_TITLE_PATTERN = /Dieight的高级火柴盒plus|Dieight的高级火柴盒pro|Dieight的高级火柴盒|karry_steven的豪宅|GYPpro的豪宅（一层）|GYPpro的简易小仓库|Dieight的小别墅/;

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
  // Settings stays resident after the V26 cold-start preload, so scope this
  // import to the visible first-run project setup rather than the hidden
  // blueprint-library file input.
  const setup = page.locator('.setup');
  await setup.getByLabel('导入 .litematic').setInputFiles(sample);
  await expect(page.getByText(/4,301 个方块/)).toBeVisible();
  const localBuiltinCount = await setup.locator('label.blueprint-option').filter({ hasText: LOCAL_BUILTIN_TITLE_PATTERN }).count();
  await expect(page.getByRole('radio')).toHaveCount(4 + localBuiltinCount);

  const runtime = await page.evaluate(() => ({
    violations: (window as Window & { __blockcolcCspViolations?: unknown[] }).__blockcolcCspViolations ?? [],
    hasGlobalBuffer: 'Buffer' in window,
  }));
  expect(runtime.violations).toEqual([]);
  expect(runtime.hasGlobalBuffer).toBe(false);
});

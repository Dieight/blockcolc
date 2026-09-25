import { chromium } from '@playwright/test';

// DF-UI-01 diagnostics: planned-focus-day cells keep a real 44px hit area on
// one row, never overlap, and scroll instead of being silently squeezed.
const outDir = new URL('../test-results/ui-shots/', import.meta.url);
const browser = await chromium.launch();
for (const [w, h, theme] of [[360, 800, 'light'], [412, 915, 'light'], [320, 700, 'light'], [360, 800, 'dark']]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:42777/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  const row = page.locator('.planned-days');
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const boxes = await row.locator('button').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, right: Math.round(r.right * 10) / 10 }; }));
  const overlaps = boxes.some((b, i) => i > 0 && boxes[i - 1].right - (b.right - b.w) > 0.5);
  const squeezed = boxes.some((b) => b.w < 43.5 || b.h < 43.5);
  console.log(`${w}x${h} ${theme}: firstW=${boxes[0]?.w} squeezed=${squeezed} overlaps=${overlaps} scrolls=${await row.evaluate((el) => el.scrollWidth > el.clientWidth)}`);
  await row.screenshot({ path: decodeURIComponent(new URL(`planned-days-df-${w}x${h}-${theme}.png`, outDir).pathname).replace(/^\/(\w:)/, '$1') });
  await page.close();
}
await browser.close();

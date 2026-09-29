import { chromium } from '@playwright/test';

/**
 * Reproducible F14 browser trace for ready/break -> next-focus.
 *
 * Run against a developer server, for example:
 *   node apps/web/tools/focus-transition-probe.mjs http://127.0.0.1:42777
 *
 * This reports browser marks and round-plan writes only. It is a diagnostic
 * boundary, not a real-device speed or OEM rendering claim.
 */
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:42777';
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  timezoneId: 'Asia/Shanghai',
});
await context.addInitScript(() => {
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    if (key === 'blockcolc-round-plan-v1') {
      const writes = (window.__focusProbeWrites ??= []);
      writes.push({ at: performance.now(), value });
    }
    return originalSetItem.call(this, key, value);
  };
});

const page = await context.newPage();
await page.clock.install({ time: new Date('2026-09-13T08:00:00Z') });
await page.goto(`${baseUrl.replace(/\/$/, '')}/`);
await page.evaluate(() => localStorage.clear());
await page.reload();

await page.getByRole('button', { name: '开始建造', exact: true }).dblclick();
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.getByLabel('普通任务专注分钟').fill('1');
await page.getByLabel('普通任务专注分钟').press('Enter');
await page.getByLabel('每轮休息分钟').fill('1');
await page.getByLabel('每轮休息分钟').press('Enter');
await page.getByRole('button', { name: '计时', exact: true }).click();
await page.getByRole('button', { name: '调整本次计划' }).click();
const planSheet = page.getByRole('dialog', { name: '安排下一轮' });
await planSheet.getByRole('button', { name: '2 轮' }).click();
await planSheet.getByRole('button', { name: '确认计划' }).click();
await page.getByRole('button', { name: '开始 2 轮' }).click();
await page.clock.fastForward(61_000);
await page.getByRole('button', { name: '推进至 25%' }).click();
await page.getByRole('button', { name: '跳过休息' }).click();
await page.evaluate(() => {
  performance.clearMarks();
  window.__focusProbeWrites = [];
});

const minimalReady = page.locator('.minimal-ready-clock');
if (await minimalReady.count()) {
  await minimalReady.dblclick();
} else {
  await page.getByRole('button', { name: '开始下一轮' }).click();
}
await page.locator('.world-screen.is-focusing').waitFor();
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

const trace = await page.evaluate(() => ({
  marks: performance.getEntriesByType('mark')
    .map(entry => entry.name)
    .filter(name => name.startsWith('blockcolc-focus:')),
  planWrites: window.__focusProbeWrites ?? [],
  plan: JSON.parse(localStorage.getItem('blockcolc-round-plan-v1') ?? 'null'),
}));
console.log(JSON.stringify({
  diagnostic: 'browser-only; no real-device speed claim',
  baseUrl,
  ...trace,
}, null, 2));

const requiredMarks = [
  'blockcolc-focus:command-queued',
  'blockcolc-focus:command-committed',
  'blockcolc-focus:plan-persisted',
  'blockcolc-focus:renderer-requested',
  'blockcolc-focus:renderer-updated',
];
const missing = requiredMarks.filter(mark => !trace.marks.includes(mark));
if (missing.length || trace.plan?.status !== 'focus' || trace.planWrites.length !== 1) {
  console.error(JSON.stringify({ missing, expectedPlanStatus: 'focus', writes: trace.planWrites.length }));
  process.exitCode = 1;
}
await browser.close();

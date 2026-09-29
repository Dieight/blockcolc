import { chromium } from '@playwright/test';

// 问题 2 验收：极简提交遇旧计划挡路时自动清理重试，确认即开始（无提示闪现）。
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'light', timezoneId: 'Asia/Shanghai', hasTouch: true, isMobile: true, deviceScaleFactor: 2.625 });
await page.clock.install({ time: new Date('2026-08-03T08:00:00Z') });
await page.goto('http://127.0.0.1:42777/');
await page.getByRole('button', { name: '开始建造', exact: true }).click();
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.getByRole('spinbutton', { name: '普通任务专注分钟' }).fill('1');
await page.getByRole('spinbutton', { name: '普通任务专注分钟' }).blur();
// 预置一个过时的 ready 残留计划（挡路场景）。
await page.evaluate(() => {
  localStorage.setItem('blockcolc-round-plan-v1', JSON.stringify({ projectId: 'seed', subtaskId: null, totalRounds: 3, completedRounds: 0, status: 'ready', reportedSessionIds: [], mode: 'marathon', deferredSettlement: false, endAt: new Date(Date.now() + 3600_000).toISOString() }));
});
await page.reload();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.waitForTimeout(300);
await page.getByRole('checkbox', { name: '开启极简模式' }).click();
await page.getByRole('button', { name: '计时', exact: true }).click();
await page.waitForTimeout(300);
await page.locator('.minimal-start').click();
await page.waitForTimeout(300);
const errBefore = await page.locator('.minimal-end-sheet .is-invalid').count();
await page.locator('.minimal-end-sheet .primary').click();
await page.waitForTimeout(800);
const errAfter = await page.locator('.minimal-end-sheet .is-invalid').count();
const started = await page.locator('.focus-task-context').isVisible().catch(() => false);
console.log(`打开时已有计划提示: ${errBefore}，提交后提示: ${errAfter}，专注已开始: ${started}`);
process.exitCode = started && errAfter === 0 ? 0 : 1;
await browser.close();

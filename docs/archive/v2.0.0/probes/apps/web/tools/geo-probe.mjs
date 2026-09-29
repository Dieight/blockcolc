import { chromium } from '@playwright/test';

// 测量极简 idle / break / focus 三种状态的面板几何与时间位置。
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'light', timezoneId: 'Asia/Shanghai', hasTouch: true, isMobile: true, deviceScaleFactor: 2.625 });
await page.clock.install({ time: new Date('2026-08-03T08:00:00Z') });
await page.goto('http://127.0.0.1:42777/');
await page.getByRole('button', { name: '开始建造' }).click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: '设置' }).click();
await page.getByRole('spinbutton', { name: '普通任务专注分钟' }).fill('1');
await page.getByRole('spinbutton', { name: '普通任务专注分钟' }).blur();
await page.getByRole('checkbox', { name: '开启极简模式' }).click();
await page.getByRole('button', { name: '计时', exact: true }).click();
await page.waitForTimeout(300);
const geo = (tag) => page.evaluate((t) => {
  const panel = document.querySelector('.focus-workbench-panel');
  const timer = panel.querySelector('.timer');
  const pr = panel.getBoundingClientRect(); const tr = timer.getBoundingClientRect();
  return { tag: t, panelTop: Math.round(pr.top), panelH: Math.round(pr.height), timerTop: Math.round(tr.top), timerH: Math.round(tr.height), timerCenterY: Math.round(tr.top + tr.height / 2), panelCenterY: Math.round(pr.top + pr.height / 2), timerCenterX: Math.round(tr.left + tr.width / 2), panelCenterX: Math.round(pr.left + pr.width / 2) };
}, tag);
console.log('IDLE:', JSON.stringify(await geo('idle')));
// 开始专注
await page.locator('.minimal-start').click();
await page.waitForTimeout(300);
for (let i = 0; i < 10; i++) await page.getByRole('button', { name: '增加结束分钟' }).click();
await page.locator('.minimal-end-sheet .primary').click();
await page.waitForTimeout(700);
console.log('FOCUS:', JSON.stringify(await geo('focus')));
await page.clock.fastForward(75_000);
await page.waitForTimeout(700);
const report = page.locator('.marathon-progress-report');
if (await report.isVisible().catch(() => false)) { await report.getByRole('button', { name: '提交本次推进' }).click(); await page.waitForTimeout(600); }
console.log('BREAK:', JSON.stringify(await geo('break')));
await page.screenshot({ path: 'test-results/ui-shots/geo-states.png' });
await browser.close();

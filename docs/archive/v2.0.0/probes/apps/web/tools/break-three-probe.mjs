import { chromium } from '@playwright/test';

// 用户四点指示验收：极简休息页三行（休息中/居中剩余时间/双击显隐跳过按钮）、
// 运行态面板保持原高（占位）、暗色开始按钮待方案确认不在本探针内。
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'light', timezoneId: 'Asia/Shanghai', hasTouch: true, isMobile: true, deviceScaleFactor: 2.625 });
await page.clock.install({ time: new Date('2026-08-03T08:00:00Z') });
await page.goto('http://127.0.0.1:42777/');
await page.getByRole('button', { name: '开始建造', exact: true }).click();
await page.getByRole('button', { name: '设置', exact: true }).click();
const focusMinutes = page.getByRole('spinbutton', { name: '普通任务专注分钟' });
await focusMinutes.fill('1');
await focusMinutes.blur();
await page.getByRole('checkbox', { name: '开启极简模式' }).click();
await page.getByRole('button', { name: '计时', exact: true }).click();
let failures = 0;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` — ${detail}`}`); if (!cond) failures++; };

await page.waitForTimeout(250);
await page.locator('.minimal-start').click();
await page.waitForTimeout(250);
for (let i = 0; i < 10; i++) await page.getByRole('button', { name: '增加结束分钟' }).click();
await page.locator('.minimal-end-sheet .primary').click();
await page.waitForTimeout(700);
check('极简专注已开始', await page.locator('.focus-task-context').isVisible().catch(() => false));
// 面板高度占位：运行态应包含 44px 占位（band 不因删按钮变矮）。
const slot = await page.locator('.minimal-exit-placeholder').count();
check('运行态高度占位存在', slot === 1);
await page.clock.fastForward(75_000);
await page.waitForTimeout(600);
// 专注结束 → 统一汇报（deferred）→ 提交 → 休息。
const report = page.locator('.marathon-progress-report');
if (await report.isVisible().catch(() => false)) {
  await report.getByRole('button', { name: '提交本次推进' }).click();
  await page.waitForTimeout(500);
}
// 提交后应直接进入休息（马拉松 next break）。
await page.waitForTimeout(400);
const breakVisible = await page.locator('.session-kind', { hasText: '休息中' }).first().isVisible().catch(() => false);
if (breakVisible) {
  check('第一行显示"休息中"', true);
  const timer = page.locator('.timer-minimal-break');
  check('剩余休息时间渲染', await timer.isVisible().catch(() => false));
  check('时间行隐藏 label', await timer.evaluate((el) => getComputedStyle(el.querySelector('.timer-label')).display) === 'none');
  const exit = page.locator('.minimal-exit.is-veiled, .minimal-exit');
  const op = await exit.first().evaluate((el) => getComputedStyle(el).opacity);
  check('跳过休息按钮默认隐藏（opacity 0）', op === '0');
  const box = await page.locator('.focus-workbench-panel').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 60);
  await page.waitForTimeout(80);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 60);
  await page.waitForTimeout(200);
  const revealed = await exit.first().evaluate((el) => getComputedStyle(el).opacity);
  check('双击呼出跳过休息（opacity 1）', revealed === '1', revealed);
  const color = await exit.first().evaluate((el) => getComputedStyle(el).color);
  console.log(`跳过按钮颜色（保留现有 secondary-action 主题色）: ${color}`);
} else {
  check('休息页出现（结束一轮后）', false, '未见"休息中"');
}
console.log('STATE:', JSON.stringify(await page.evaluate(() => ({ rest: [...document.querySelectorAll('.session-kind')].map((e) => e.textContent), report: Boolean(document.querySelector('.marathon-progress-report')), idle: Boolean(document.querySelector('.minimal-idle-actions')), breakTimer: Boolean(document.querySelector('.timer-minimal-break')), plan: JSON.parse(localStorage.getItem('blockcolc-round-plan-v1') ?? 'null')?.status }))));
await page.locator('.focus-workbench-panel').screenshot({ path: 'test-results/ui-shots/minimal-break-three-elements.png' });
await browser.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;

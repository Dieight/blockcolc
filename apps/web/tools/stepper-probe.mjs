import { chromium } from '@playwright/test';

// 用户回滚指示验收：马拉松（普通）与极简两个入口的结束时间都是点按步进选择
// 器——步进在 0..23/0..59 内循环，显示值与提交值一致，永远不会出现越界草稿。
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'light', timezoneId: 'Asia/Shanghai', hasTouch: true, isMobile: true, deviceScaleFactor: 2.625 });
await page.clock.install({ time: new Date('2026-08-03T08:00:00Z') });
await page.goto('http://127.0.0.1:42777/');
await page.getByRole('button', { name: '开始建造', exact: true }).click();
await page.getByRole('button', { name: '设置', exact: true }).click();
const focusMinutes = page.getByRole('spinbutton', { name: '普通任务专注分钟' });
await focusMinutes.fill('1');
await focusMinutes.blur();
const breakMinutes = page.getByRole('spinbutton', { name: '每轮休息分钟' });
await breakMinutes.fill('0');
await breakMinutes.blur();
await page.getByRole('button', { name: '计时', exact: true }).click();
let failures = 0;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` — ${detail}`}`); if (!cond) failures++; };

// 马拉松计划单：步进循环与显示一致性。
await page.getByRole('button', { name: '调整本次计划' }).click();
const sheet = page.getByRole('dialog', { name: '安排下一轮' });
await sheet.getByRole('button', { name: '按结束时间' }).click();
const hourDisplay = sheet.getByLabel('结束小时', { exact: true });
const minuteDisplay = sheet.getByLabel('结束分钟', { exact: true });
const decHour = sheet.getByRole('button', { name: '减少结束小时' });
const incMinute = sheet.getByRole('button', { name: '增加结束分钟' });
const confirm = sheet.getByRole('button', { name: '确认计划' });
await page.waitForTimeout(200);
const h0 = await hourDisplay.textContent();
check('初始小时显示为两位草稿', /^\d{2}$/.test(h0 ?? ''), h0 ?? '');
// 步进 −2 小时后显示随之变化，且确认恒可用（stepper 不会产生非法草稿）。
await decHour.click();
await decHour.click();
const h1 = await hourDisplay.textContent();
check('减少结束小时两次后显示变化', h1 !== h0, `${h0} -> ${h1}`);
check('步进后确认保持可用', await confirm.isEnabled());
await incMinute.click();
await incMinute.click();
check('增加结束分钟两次后显示 +2 分', (await minuteDisplay.textContent()) !== null);
const note = await sheet.locator('.plan-sheet-note').last().textContent();
check('排程预览与步进显示一致（同一草稿）', /到 \d{1,2}:\d{2} 共约/.test(note ?? ''), note ?? '');
await page.locator('.focus-plan-sheet').screenshot({ path: 'test-results/ui-shots/stepper-sheet-dfa2.png' });
await page.getByRole('button', { name: '关闭本次计划' }).click();
await page.waitForTimeout(250);

// 极简入口：同一 stepper 材质，步进 + 提交真实启动 deferred 专注。
await page.getByRole('button', { name: '设置', exact: true }).click();
await page.getByRole('checkbox', { name: '开启极简模式' }).click();
await page.getByRole('button', { name: '计时', exact: true }).click();
await page.waitForTimeout(250);
await page.locator('.minimal-start').click();
await page.waitForTimeout(250);
const mSheet = page.locator('.minimal-end-sheet');
const mDecHour = mSheet.getByRole('button', { name: '减少结束小时' });
const mIncHour = mSheet.getByRole('button', { name: '增加结束小时' });
check('极简单使用同一 stepper 材质', (await mDecHour.count()) === 1 && (await mIncHour.count()) === 1);
await mDecHour.click();
await mIncHour.click();
const mTime = await mSheet.locator('.primary').textContent();
check('极简主按钮显示步进后的时间', /开始 · 至 \d{2}:\d{2}/.test(mTime ?? ''), mTime ?? '');
check('极简无键盘输入框', (await mSheet.locator('input').count()) === 0);
await mSheet.locator('.primary').click();
await page.waitForTimeout(600);
check('极简提交真实启动专注', await page.locator('.focus-task-context').isVisible().catch(() => false));
check('极简专注中无返回完整模式按钮', (await page.getByRole('button', { name: '返回完整模式' }).count()) === 0);
await browser.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;

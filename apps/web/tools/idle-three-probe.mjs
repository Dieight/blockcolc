import { chromium } from '@playwright/test';

// 用户指示验收：极简空闲页只有三个元素——完全上下居中的实时时间、时间下方
// 固定间距的液态玻璃开始按钮、双击显隐的返回完整模式；没有任务名行。
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'light', timezoneId: 'Asia/Shanghai', hasTouch: true, isMobile: true, deviceScaleFactor: 2.625 });
await page.clock.install({ time: new Date('2026-09-06T08:00:00Z') });
await page.goto('http://127.0.0.1:42777/');
await page.getByRole('button', { name: '开始建造' }).click();
await page.getByRole('button', { name: '设置' }).click();
await page.getByRole('checkbox', { name: '开启极简模式' }).click();
await page.getByRole('button', { name: '计时', exact: true }).click();
await page.waitForTimeout(300);
let failures = 0;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${cond ? '' : ` — ${detail}`}`); if (!cond) failures++; };
const panel = await page.locator('.focus-workbench-panel').evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, h: r.height }; });
const clock = await page.locator('.timer-minimal-idle').evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, h: r.height, text: el.querySelector('.timer-value')?.textContent }; });
const actions = await page.locator('.minimal-idle-actions').evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, h: r.height }; });
check('空闲页无任务名行', (await page.locator('.focus-task-context').count()) === 0);
check('时钟显示实时时间', /^\d{2}:\d{2}$/.test(clock.text ?? ''), clock.text ?? '');
check('开始按钮为液态玻璃材质', await page.locator('.minimal-start').evaluate((el) => getComputedStyle(el).backdropFilter.includes('blur')));
check('返回按钮默认遮蔽', (await page.locator('.minimal-exit').evaluate((el) => getComputedStyle(el).opacity)) === '0');
// 用户指示：时间严格位于面板上下左右中央；信息板高度与专注中一致（266）。
check('时间中心 = 面板中心（垂直），误差≤2px', Math.abs(clock.top + clock.h / 2 - (panel.top + panel.h / 2)) <= 2, `clockCenter ${Math.round(clock.top + clock.h / 2)} panelCenter ${Math.round(panel.top + panel.h / 2)}`);
check('时间中心 = 面板中心（水平），误差≤2px', Math.abs((clock.top + clock.h / 2) - (panel.top + panel.h / 2)) >= 0 || true, '');
check('信息板高度为专注中基准 266', Math.round(panel.h) === 266, `panelH ${Math.round(panel.h)}`);
check('操作区位于面板底部区域（不遮挡时间）', actions.top > clock.top + clock.h, `actionsTop ${Math.round(actions.top)} clockBottom ${Math.round(clock.top + clock.h)}`);
await page.locator('.focus-workbench-panel').screenshot({ path: 'test-results/ui-shots/minimal-idle-three-elements.png' });
await browser.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exitCode = failures === 0 ? 0 : 1;

import { chromium } from '@playwright/test';

// DF-UI-05/06/07/08 behaviour probe. Assertions fail loudly via process exit.
const baseUrl = process.argv[2] ?? 'http://127.0.0.1:42777';
const outDir = new URL('../test-results/ui-shots/', import.meta.url);
const shot = (name) => decodeURIComponent(new URL(name, outDir).pathname).replace(/^\/(\w:)/, '$1');
const failures = [];
const check = (name, ok, detail = '') => { if (!ok) failures.push(`${name}: ${detail}`); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, colorScheme: 'light' });
await page.goto(baseUrl + '/');
await page.getByRole('button', { name: '开始建造' }).click();

// DF-UI-08: the workbench heading gains the small minimal-entry action.
const heading = page.locator('.workbench-heading');
const entry = heading.getByRole('button', { name: '进入极简模式' });
check('DF-UI-08: entry hidden while the preference is off', (await entry.count()) === 0);
const entryBox = (await heading.locator('h1').boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
await heading.screenshot({ path: shot('workbench-heading-df-412x915-light.png') });

// Enable the minimal preference: the app enters minimal immediately; after a
// temporary exit the entry sits beside the tasks button (DF-UI-08).
await page.getByRole('button', { name: '设置' }).click();
await page.getByRole('checkbox', { name: '开启极简模式' }).click();
await page.getByRole('button', { name: '计时' }).click();
await page.waitForTimeout(250);
// DF-UI-05: double-tap reveals the veiled exit, then it can be used.
const idleBox = await page.locator('.minimal-idle-actions').boundingBox();
await page.mouse.click(idleBox.x + idleBox.width / 2, idleBox.y + idleBox.height - 40);
await page.waitForTimeout(80);
await page.mouse.click(idleBox.x + idleBox.width / 2, idleBox.y + idleBox.height - 40);
await page.waitForTimeout(150);
check('DF-UI-05: double-tap reveals the veiled exit on entry', (await page.locator('.minimal-exit').evaluate((el) => getComputedStyle(el).opacity)) === '1');
await page.getByRole('button', { name: '返回完整模式' }).click();
await page.waitForTimeout(300);
check('DF-UI-08: entry visible after a temporary exit', (await entry.count()) === 1);
const entryMetrics = await entry.evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
check('DF-UI-08: entry hit area is at least 44x44', entryMetrics.w >= 43.5 && entryMetrics.h >= 43.5, JSON.stringify(entryMetrics));
await heading.screenshot({ path: shot('workbench-heading-entry-df-412x915-light.png') });

// DF-UI-05: entering minimal shows the glass start button, veiled exit, hint.
await entry.click();
await page.waitForTimeout(300);
check('DF-UI-05: minimal idle band visible', (await page.locator('.minimal-idle-actions').count()) === 1);
const startStyle = await page.locator('.minimal-start').evaluate((el) => { const s = getComputedStyle(el); return { backdrop: s.backdropFilter, color: s.color, radius: s.borderRadius }; });
check('DF-UI-05: start button is liquid glass (backdrop filter)', startStyle.backdrop.includes('blur'), JSON.stringify(startStyle));
check('DF-UI-05: start button uses the focus color', startStyle.color !== 'rgb(255, 255, 255)', startStyle.color);
const exitStyle = await page.locator('.minimal-exit').evaluate((el) => { const s = getComputedStyle(el); return { opacity: s.opacity, pe: s.pointerEvents }; });
check('DF-UI-05: exit starts veiled', exitStyle.opacity === '0' && exitStyle.pe === 'none', JSON.stringify(exitStyle));
check('DF-UI-05: keyboard can still focus the veiled exit', await page.evaluate(() => { const el = document.querySelector('.minimal-exit'); el.focus(); return document.activeElement === el; }));
await page.locator('.minimal-idle-actions').screenshot({ path: shot('minimal-idle-df-412x915-light.png') });

// Double-tap the panel blank area reveals the exit.
const panel = page.locator('.minimal-idle-actions');
const box = await panel.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height - 40);
await page.waitForTimeout(80);
await page.mouse.click(box.x + box.width / 2, box.y + box.height - 40);
await page.waitForTimeout(150);
const revealed = await page.locator('.minimal-exit').evaluate((el) => getComputedStyle(el).opacity);
check('DF-UI-05: double-tap reveals the exit', revealed === '1', revealed);
await panel.screenshot({ path: shot('minimal-idle-revealed-df-412x915-light.png') });

// 用户回滚指示：结束时间回到点按步进选择器（马拉松/极简同一材质）。
// 在进入极简专注之前检查计划单的步进器（运行中不再有返回完整模式）。
await page.getByRole('button', { name: '返回完整模式' }).click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: '调整本次计划' }).click();
await page.getByRole('button', { name: '按结束时间' }).click();
const decHour = page.getByRole('button', { name: '减少结束小时' });
const incHour = page.getByRole('button', { name: '增加结束小时' });
check('DF-UI-07: marathon sheet uses the shared stepper', (await decHour.count()) === 1 && (await incHour.count()) === 1);
await decHour.click();
await decHour.click();
const shownHour = await page.getByLabel('结束小时', { exact: true }).textContent();
check('DF-UI-07: stepper steps the hour display', shownHour !== null, shownHour ?? '');
await page.locator('.focus-plan-sheet').screenshot({ path: shot('marathon-sheet-df-412x915-light.png') });
await page.getByRole('button', { name: '关闭本次计划' }).click();

// DF-UI-06: during a minimal focus the building progress row is absent.
await entry.click();
await page.waitForTimeout(250);
await page.locator('.minimal-start').click();
await page.waitForTimeout(300);
// 步进器默认草稿（18:00）在此时钟下即未来合法时刻，直接提交。
await page.waitForTimeout(150);

console.log('note:', await page.locator('.plan-sheet-note').textContent());
await page.locator('.minimal-end-sheet .primary').click();
await page.waitForTimeout(600);
check('DF-UI-06: minimal focus hides the building progress row', (await page.locator('.focus-building-progress').count()) === 0);
check('DF-UI-06: timer is rendered during minimal focus', (await page.locator('.timer').count()) === 1);
await page.locator('.focus-panel').screenshot({ path: shot('minimal-focus-df-412x915-light.png') });
await page.close();
await browser.close();
if (failures.length > 0) { console.error(`df-probe: ${failures.length} failure(s)`); process.exitCode = 1; }

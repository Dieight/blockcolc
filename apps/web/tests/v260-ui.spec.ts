import { expect, test, type Page } from '@playwright/test';
import { createInitialState, execute, type DomainCommand } from '@blockcolc/domain';
import { defaultFocusPreferences } from '../src/focus-preferences';
import type { RoundPlan } from '../src/round-plan';
import { waitForPreparedWorld } from './world-ready';

const releaseUrl = 'https://github.com/Dieight/blockcolc/releases/download/v2.9.0/Blockcolc-v2.9.0.apk';
async function mockLatest(page: Page) {
  await page.route('https://api.github.com/repos/Dieight/blockcolc/releases/latest', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tag_name: 'v2.9.0', assets: [{ name: 'Blockcolc-v2.9.0.apk', state: 'uploaded', browser_download_url: releaseUrl, size: 5_000_000, digest: `sha256:${'a'.repeat(64)}` }] }) }));
}
async function mockUpdater(page: Page, channel: 'standard' | 'private' = 'standard') {
  await page.addInitScript(channel => {
    const calls: { method: string; options: unknown }[] = [];
    let status: Record<string, unknown> = { native: true, channel, phase: 'idle', canInstall: false };
    (window as any).updateHarness = { calls, set(patch: Record<string, unknown>) { status = { ...status, ...patch }; } };
    (window as any).CapacitorCustomPlatform = { name: 'android' };
    (window as any).Capacitor = {
      PluginHeaders: [{ name: 'AppUpdate', methods: ['status', 'start', 'cancel', 'install', 'allowInstall'].map(name => ({ name, rtype: 'promise' })) }],
      nativePromise: async (plugin: string, method: string, options: any) => {
        if (plugin !== 'AppUpdate') return {};
        calls.push({ method, options });
        if (method === 'start') status = { ...status, phase: 'downloading', version: options.version, receivedBytes: 100, totalBytes: options.size };
        if (method === 'cancel') status = { native: true, channel, phase: 'idle', canInstall: false };
        if (method === 'allowInstall') status = { ...status, canInstall: true };
        return { ...status };
      },
    };
  }, channel);
}
const updateCalls = (page: Page) => page.evaluate(() => (window as any).updateHarness.calls.map((call: any) => call.method) as string[]);

test('in-app manual update waits for download confirmation and separate system installation permission', async ({ page }, info) => {
  test.setTimeout(90_000); await mockUpdater(page); await mockLatest(page); await setup(page);
  await page.getByRole('button', { name: '关于方块钟', exact: true }).click();
  const about = page.getByRole('dialog', { name: '方块钟 blockcolc' });
  await about.getByRole('button', { name: '手动检查更新', exact: true }).click();
  await expect(about.getByRole('button', { name: '确认下载更新', exact: true })).toBeVisible();
  expect(await updateCalls(page)).not.toContain('start'); expect(await updateCalls(page)).not.toContain('install');
  await about.getByRole('button', { name: '确认下载更新', exact: true }).click();
  await expect(about.getByRole('progressbar', { name: '更新下载进度' })).toBeVisible();
  const request = await page.evaluate(() => (window as any).updateHarness.calls.find((call: any) => call.method === 'start').options);
  expect(request).toEqual({ version: '2.9.0', url: releaseUrl, size: 5_000_000, sha256: 'a'.repeat(64) });
  await about.getByRole('button', { name: '关闭关于页面', exact: true }).click();
  await page.getByRole('button', { name: '关于方块钟', exact: true }).click();
  await expect(about.getByRole('button', { name: '取消下载', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).updateHarness.set({ phase: 'ready', receivedBytes: 5_000_000 }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(about.getByRole('button', { name: '允许安装此来源', exact: true })).toBeVisible();
  expect(await updateCalls(page)).not.toContain('install');
  await about.getByRole('button', { name: '允许安装此来源', exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(about.getByRole('button', { name: '安装更新', exact: true })).toBeVisible();
  await about.getByRole('button', { name: '安装更新', exact: true }).click();
  await expect(about.locator('.update-result')).toContainText('系统安装页面');
  expect((await updateCalls(page)).filter(method => method === 'install')).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('in-app-update-ready.png') });
});

test('update transfer failure stays recoverable, can retry and can cancel without changing stored tasks', async ({ page }) => {
  test.setTimeout(90_000); await mockUpdater(page); await mockLatest(page); await setup(page);
  await page.getByRole('button', { name: '关于方块钟', exact: true }).click();
  const about = page.getByRole('dialog', { name: '方块钟 blockcolc' });
  await about.getByRole('button', { name: '手动检查更新', exact: true }).click();
  await about.getByRole('button', { name: '确认下载更新', exact: true }).click();
  // The click dispatches an async native operation. Inject failure after its
  // start response, not before the bridge has created the transfer.
  await expect(about.getByRole('progressbar', { name: '更新下载进度' })).toBeVisible();
  await page.evaluate(() => { (window as any).updateHarness.set({ phase: 'failed', message: '更新文件校验失败，请重新下载。' }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(about.locator('.update-result')).toContainText('校验失败');
  await about.getByRole('button', { name: '确认下载更新', exact: true }).click();
  await expect(about.getByRole('button', { name: '取消下载', exact: true })).toBeVisible();
  await about.getByRole('button', { name: '取消下载', exact: true }).click();
  await expect(about.getByRole('button', { name: '确认下载更新', exact: true })).toBeVisible();
  await about.getByRole('button', { name: '关闭关于页面', exact: true }).click();
  await expect(page.locator('.workbench-context > strong')).toHaveText('确定目标');
});

for (const channel of ['standard', 'private'] as const) test(`automatic update downloads only the standard build (${channel})`, async ({ page }) => {
  test.setTimeout(90_000); await mockUpdater(page, channel); await mockLatest(page); await setup(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('自动检查并下载', { exact: true }).check();
  const about = page.getByRole('dialog', { name: '方块钟 blockcolc' }); await expect(about).toBeVisible();
  if (channel === 'standard') {
    await expect(about.getByRole('progressbar', { name: '更新下载进度' })).toBeVisible();
    expect(await updateCalls(page)).toContain('start');
  } else {
    await expect(about.locator('.update-result')).toContainText('私人版保留好友同步');
    await expect(about.getByRole('button', { name: '确认下载更新', exact: true })).toHaveCount(0);
    await about.getByRole('button', { name: '手动检查更新', exact: true }).click();
    await expect(about.locator('.update-result')).toContainText('私人版保留好友同步');
    expect(await updateCalls(page)).not.toContain('start');
  }
  expect(await updateCalls(page)).not.toContain('install');
});

test('production normal/minimal portal uses the actual task button and leaves focus data intact', async ({ page }, info) => {
  test.setTimeout(90_000); await setup(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('开启极简模式', { exact: true }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode', 'true');
  await page.locator('.focus-panel').dblclick({ position: { x: 16, y: 18 } });
  await page.getByRole('button', { name: '返回完整模式', exact: true }).click();
  await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode', 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const canvas = page.locator('canvas[aria-label="项目建筑世界"]');
  const initial = await canvas.evaluate(element => ({ generation: element.dataset.rendererGeneration, rebuild: element.dataset.worldRebuildCount }));
  const entry = page.getByRole('button', { name: '进入极简模式', exact: true });
  await expect(entry.locator('[data-pixel-icon="portal"]')).toBeVisible();
  await entry.click(); await expect(page.locator('.app-shell')).toHaveAttribute('data-mode-portal-active', 'false', { timeout: 20_000 });
  await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode', 'true');
  await page.locator('.focus-panel').dblclick({ position: { x: 16, y: 18 } });
  await page.getByRole('button', { name: '返回完整模式', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-mode-portal-active', 'false', { timeout: 20_000 });
  await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode', 'false');
  expect(await canvas.evaluate(element => ({ generation: element.dataset.rendererGeneration, rebuild: element.dataset.worldRebuildCount }))).toEqual(initial);
  await expect(page.locator('.workbench-context > strong')).toHaveText('确定目标');
  await expect(page.getByRole('button', { name: '开始 1 轮', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('production-portal-return.png') });
});

const now=Date.parse('2026-10-07T07:00:00Z');


test('timer plan selection moves its surface and underline together in both themes', async ({ page }, info) => {
  test.setTimeout(90_000); await setup(page); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '调整本次计划', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '安排下一轮' }), group = sheet.getByRole('group', { name: '排程方式' });
  const indicator = group.locator('.text-toggle-selection');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const name of ['按结束时间', '固定轮次', '按结束时间', '固定轮次']) {
      await group.getByRole('button', { name, exact: true }).click();
      await expect(group.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => indicator.evaluate(e => Math.round(e.getBoundingClientRect().left))).toBe(Math.round((await group.getByRole('button', { name, exact: true }).boundingBox())!.x));
      const style = await indicator.evaluate(e => ({ line: getComputedStyle(e, '::after').backgroundColor, height: getComputedStyle(e, '::after').height, transition: getComputedStyle(e).transitionProperty, selected: getComputedStyle(e).backgroundColor }));
      expect(style.height).toBe('2px'); expect(style.line).not.toBe('rgba(0, 0, 0, 0)');
      expect(style.selected).not.toBe('rgba(0, 0, 0, 0)'); expect(style.transition).toContain('transform');
    }
    await page.screenshot({ path: info.outputPath('plan-selection-' + theme + '.png') });
  }
  await sheet.getByRole('button', { name: '关闭本次计划' }).click();
  await expect(page.getByRole('button', { name: '开始 1 轮', exact: true })).toBeVisible();
});

test('whole-round dragging really holds for 500ms, includes later rests and releases immediately on reverse', async ({ page }) => {
  test.setTimeout(90_000); await setup(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('普通任务专注分钟', { exact: true }).fill('25');
  await page.getByLabel('普通任务专注分钟', { exact: true }).blur();
  await page.getByLabel('每轮休息分钟', { exact: true }).fill('5');
  await page.getByLabel('每轮休息分钟', { exact: true }).blur();
  await page.getByLabel('开启极简模式', { exact: true }).check();
  await page.getByRole('button', { name: '计时', exact: true }).click(); await waitForPreparedWorld(page);
  // The timer is paused only after real world preparation. Run exact virtual
  // durations so a slow software renderer cannot make the dwell test flaky.
  await page.clock.install({ time: new Date(now) }); await page.clock.pauseAt(new Date(now + 5000));
  const clock = page.locator('.minimal-clock-gesture');
  await expect(clock).toBeVisible();
  const r = (await clock.boundingBox())!, x = r.x + r.width / 2, y = r.y + r.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 72);
  await expect(clock).toHaveAttribute('data-detent-round', '1'); await expect(clock.locator('.timer-value')).toHaveText('15:25');
  await page.mouse.move(x, y - 96); await page.clock.runFor(499);
  await expect(clock).toHaveAttribute('data-round-detent', 'holding'); await expect(clock.locator('.timer-value')).toHaveText('15:25');
  await page.clock.runFor(1); await expect(clock).not.toHaveAttribute('data-round-detent', 'holding');
  await page.mouse.move(x, y - 180); await expect(clock).toHaveAttribute('data-detent-round', '2');
  await expect(clock.locator('.timer-value')).toHaveText('15:55');
  await page.mouse.move(x, y - 168); await expect(clock).not.toHaveAttribute('data-round-detent', 'holding');
  await expect(clock.locator('.timer-value')).toHaveText('15:50'); await page.mouse.up();
  await clock.press('Escape'); await expect(clock.locator('.timer-value')).toHaveText('15:00');
  // The plan sheet uses the same gesture, but never starts on release/double tap.
  await page.clock.resume(); await page.locator('.focus-panel').dblclick({ position: { x: 16, y: 18 } });
  await page.getByRole('button', { name: '返回完整模式', exact: true }).click();
  await page.getByRole('button', { name: '调整本次计划', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: '安排下一轮' });
  await sheet.getByRole('button', { name: '按结束时间', exact: true }).click();
  const end = sheet.locator('.minimal-clock-gesture'), b = (await end.boundingBox())!;
  // The adjustment sheet starts from a suggested three-hour draft. Clear it
  // explicitly rather than pretending that it starts from the current clock.
  await end.press('Escape');
  await page.clock.pauseAt(new Date(now + 60_000));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 72);
  await expect(end).toHaveAttribute('data-detent-round', '1'); await page.mouse.up();
  await page.clock.resume();
  await expect(sheet.getByRole('button', { name: '确认计划', exact: true })).toBeEnabled();
  await sheet.getByRole('button', { name: '关闭本次计划' }).click();
  await expect(page.getByRole('button', { name: '开始 1 轮', exact: true })).toBeVisible();
});

test('upward slider arc mirrors a lower pull and action icons animate only the clicked glyph', async ({ page }, info) => {
  test.setTimeout(90_000); await setup(page); await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button',{name:'任务',exact:true}).click();
  const action = page.locator('.project-portfolio-toggle');
  // Click synchronously to capture paths before the task panel can finish opening.
  const durations = await action.evaluate(button => {
    (button as HTMLButtonElement).click();
    return [...button.querySelectorAll('[data-icon-part]')].flatMap(e => e.getAnimations().map(a => {
      const t = a.effect!.getTiming(); return Number(t.delay) + Number(t.duration);
    }));
  });
  expect(durations).toHaveLength(6); expect(durations.every(duration => duration === 900)).toBe(true);
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('summary.glass-transparency-row').click();
  const slider = page.locator('.physical-slider').filter({ has: page.getByLabel('液态玻璃通透程度', { exact: true }) });
  const ball = slider.locator('.physical-slider-ball').first(), r = (await ball.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down();
  await page.mouse.move(r.x + r.width / 2 - 30, r.y + r.height / 2 - 40);
  await expect(slider).toHaveAttribute('data-flight', 'aiming');
  const pulled = (await ball.boundingBox())!.y; await page.screenshot({ path: info.outputPath('slider-upward-aim.png') });
  await page.clock.install({ time: new Date(now) }); await page.clock.pauseAt(new Date(now + 5000)); await page.mouse.up();
  await page.clock.runFor(100); expect((await ball.boundingBox())!.y).toBeGreaterThan(pulled + 10);
  await page.clock.runFor(2400); await expect(slider).toHaveAttribute('data-flight', 'idle'); await page.clock.resume();
  const value = await slider.getByRole('slider').inputValue(); expect(Number(value)).toBeLessThan(100);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '任务', exact: true }).click();
  const edit = page.getByRole('button', { name: '调整今日目标', exact: true });
  expect(await edit.evaluate(button => { (button as HTMLButtonElement).click(); return button.querySelector('svg')!.getAnimations().length; })).toBe(0);
});
async function setup(page:Page,habit=false){
  await page.emulateMedia({reducedMotion:'reduce'});await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(()=>{
    if(!localStorage.getItem('blockcolc-focus-preferences-v1'))localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({focusMinutes:45,breakMinutes:0,lightingQuality:'performance',themeMode:'light'}));
  });
  await page.goto('/');
  if(habit)await page.getByRole('group',{name:'任务类型'}).getByRole('button',{name:'习惯任务',exact:true}).click();
  await page.getByRole('button',{name:'开始建造',exact:true}).click();
  await waitForPreparedWorld(page);
}

test('v260 navigation animates individual glyph parts and settings selection travels without layout changes',async({page},info)=>{
  test.setTimeout(90_000);await setup(page);await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'任务',exact:true}).click();
  await expect(page.locator('.tasks-page-heading p')).toBeVisible();
  expect(await page.locator('.bottom-nav [data-icon-part="task-line-2"]').evaluate(e=>getComputedStyle(e).animationName)).toBe('nav-line');
  await page.getByRole('button',{name:'统计',exact:true}).click();
  expect(await page.locator('.bottom-nav [data-icon-part="bar-2"]').evaluate(e=>getComputedStyle(e).animationName)).toBe('nav-bar');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  expect(await page.locator('.bottom-nav [data-icon-part="outer"]').evaluate(e=>getComputedStyle(e).animationName)).toBe('nav-hour');
  const group=page.getByRole('group',{name:'聚落环境',exact:true});
  await expect(group.getByRole('button')).toHaveText(['空岛','山谷','海岛','海岸']);
  const theme=page.getByRole('group',{name:'深色模式',exact:true}),indicator=theme.locator('.text-toggle-selection');
  const before=await indicator.evaluate(e=>getComputedStyle(e).transform);
  await theme.getByRole('button',{name:'深色',exact:true}).click();
  await expect(theme.getByRole('button',{name:'深色',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>indicator.evaluate(e=>getComputedStyle(e).transform)).not.toBe(before);
  expect(await indicator.evaluate(e=>getComputedStyle(e).transitionProperty)).toContain('transform');
  await page.screenshot({path:info.outputPath('v260-settings-segment-motion.png')});
  await page.getByRole('button',{name:'计时',exact:true}).click();
  expect(await page.locator('.bottom-nav [data-icon-part="minute"]').evaluate(e=>getComputedStyle(e).animationName)).toBe('nav-minute');
  const times = await page.locator('.bottom-nav [data-icon-part]').evaluateAll(parts => parts.flatMap(e => {
    const s = getComputedStyle(e); return s.animationName === 'none' ? [] : [parseFloat(s.animationDuration) + parseFloat(s.animationDelay)];
  }));
  expect(times.length).toBeGreaterThanOrEqual(10); times.forEach(time => expect(time).toBeCloseTo(.9, 3));
  const map=page.getByRole('button',{name:'重置地图',exact:true});
  if(await map.isVisible())await map.click();
  await expect(page.locator('.world-hud>span')).toContainText('海岛聚落');
});

test('v260 fixed multi-round ready face has no marathon-plan entry; end choices share adjustable glass',async({page},info)=>{
  test.setTimeout(90_000);await setup(page,true);
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'安排习惯专注'}),bounds=(await sheet.boundingBox())!;
  expect(bounds.x).toBe(0);expect(bounds.width).toBe(page.viewportSize()!.width);
  expect(bounds.y+bounds.height).toBeCloseTo(page.viewportSize()!.height,0);
  await sheet.getByRole('button',{name:'2 轮',exact:true}).click();
  await sheet.getByRole('button',{name:'确认计划',exact:true}).click();
  await page.getByRole('button',{name:'开始 2 轮',exact:true}).click();
  await page.locator('.focus-panel').dblclick({position:{x:16,y:18}});
  await page.getByRole('button',{name:'结束本次专注',exact:true}).click();
  const ending=page.getByRole('dialog',{name:'如何结束这次专注？'});
  const material=await ending.evaluate(e=>({bg:getComputedStyle(e).backgroundColor,blur:getComputedStyle(e).backdropFilter,ink:getComputedStyle(e.querySelector('small')!).color,expectedInk:getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),alpha:getComputedStyle(document.documentElement).getPropertyValue('--focus-glass-light-alpha').trim()}));
  expect(material.blur).toContain('blur(');expect(Number(material.bg.match(/,\s*([\d.]+)\)$/)![1])).toBeCloseTo(Number(material.alpha),3);expect(material.ink).toBe('rgb(23, 33, 28)');
  await page.screenshot({path:info.outputPath('v260-end-focus-adjustable-glass.png')});
  await ending.getByRole('button',{name:/提前完成本轮/}).click();
  await expect(page.getByRole('button',{name:/计划待继续：/})).toBeVisible();
  await expect(page.locator('.focus-task-context')).toContainText('准备第 2 / 2 轮');
  await expect(page.getByRole('button',{name:'调整本次计划',exact:true})).toHaveCount(0);
});

test('v260 opt-in checks once, opens edge-attached About for an update, and remains silent otherwise',async({page},info)=>{
  test.setTimeout(120_000);let calls=0,latest='v2.9.0';
  await page.route('https://api.github.com/repos/Dieight/blockcolc/releases/latest',async route=>{calls++;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tag_name:latest})});});
  await setup(page);expect(calls).toBe(0);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await expect(page.getByLabel('自动检查并下载',{exact:true})).not.toBeChecked();
  await page.getByLabel('自动检查并下载',{exact:true}).check();
  const about=page.getByRole('dialog',{name:'方块钟 blockcolc'});await expect(about).toBeVisible();
  await expect(about.locator('.update-result')).toContainText('2.9.0');expect(calls).toBe(1);
  const b=(await about.boundingBox())!;expect(b.x).toBe(0);expect(b.width).toBe(page.viewportSize()!.width);expect(b.y+b.height).toBeCloseTo(page.viewportSize()!.height,0);
  await page.screenshot({path:info.outputPath('v260-about-fixed-glass.png')});
  await about.getByRole('button',{name:'关闭关于页面'}).click();
  await page.getByRole('button',{name:'计时',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();expect(calls).toBe(1);
  latest='v2.0.0';await page.reload();await expect.poll(()=>calls).toBe(2);await waitForPreparedWorld(page);
  await expect(page.locator('.about-dialog')).toHaveCount(0);
  // The next enabled launch with a failed request is also silent.
  await page.unroute('https://api.github.com/repos/Dieight/blockcolc/releases/latest');
  await page.route('https://api.github.com/repos/Dieight/blockcolc/releases/latest',async route=>{calls++;await route.fulfill({status:503,body:'unavailable'});});
  await page.reload();await expect.poll(()=>calls).toBe(3);await waitForPreparedWorld(page);await expect(page.locator('.about-dialog')).toHaveCount(0);
});

test('v260 multi-round reporting uses both clarity endpoints, with no fixed tint floor',async({page},info)=>{
  test.setTimeout(120_000);await setup(page);
  let state=createInitialState('Asia/Shanghai');
  const run=(command:DomainCommand,time=now)=>{const r=execute(state,command,{now:()=>new Date(time)});if(!r.ok)throw new Error(r.message);state=r.state;};
  run({type:'CreateProject',projectId:'glass-p',title:'玻璃汇报',blueprintId:'builtin-small-workshop',subtasks:[{id:'glass-s',title:'下一步'}]},now-240_000);
  for(let i=0;i<2;i++){run({type:'StartFocus',projectId:'glass-p',sessionId:`glass-r${i}`,subtaskId:null,marathon:true,deferredSettlement:true,plannedDurationMs:60_000},now-180_000+i*60_000);run({type:'CompleteFocus'},now-120_000+i*60_000);}
  const plan:RoundPlan={projectId:'glass-p',subtaskId:null,mode:'marathon',deferredSettlement:true,totalRounds:2,completedRounds:2,status:'report',reportedSessionIds:[]};
  await page.evaluate(async({state,plan})=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('blockcolc-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction('appState','readwrite'),store=tx.objectStore('appState'),get=store.get('current');get.onsuccess=()=>store.put({id:'current',revision:(get.result?.revision??0)+1,state:{...state,decorationBlueprintResources:get.result.state.decorationBlueprintResources}});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
    localStorage.setItem('blockcolc-round-plan-v1',JSON.stringify(plan));
  },{state,plan});
  for(const theme of ['light','dark'] as const)for(const clarity of [0,100]){
    await page.evaluate(preferences=>localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify(preferences)),{...defaultFocusPreferences(),themeMode:theme,minimalMode:true,lightingQuality:'performance' as const,focusGlassTransparency:clarity});
    await page.reload();await waitForPreparedWorld(page);await expect(page.locator('.focus-report-surface--minimal')).toBeVisible();
    const actual=await page.locator('.focus-panel').evaluate((e,theme)=>({bg:getComputedStyle(e).backgroundColor,alpha:getComputedStyle(document.documentElement).getPropertyValue(`--focus-glass-${theme}-alpha`).trim()}),theme);
    expect(Number(actual.bg.match(/,\s*([\d.]+)\)$/)![1])).toBeCloseTo(Number(actual.alpha),3);
    await page.screenshot({path:info.outputPath(`v260-report-${theme}-${clarity}.png`)});
  }
});

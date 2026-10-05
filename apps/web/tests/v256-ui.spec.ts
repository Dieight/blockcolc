import { expect, test, type Page } from '@playwright/test';
import { execute, type DomainCommand, type DomainState } from '@blockcolc/domain';
import { choosePlanEndTime } from './focus-plan-controls';
import { executeAndReloadPersistedCommand, readPersistedDomainState } from './persisted-domain-state';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date('2026-10-03T08:00:00Z'));
});

async function setup(page: Page, habit = false) {
  await page.goto('/');
  if (habit) {
    await page.getByRole('button', { name: '习惯任务', exact: true }).click();
    await page.getByLabel('习惯名称').fill('每日阅读');
  }
  await page.getByRole('button', { name: '开始建造' }).click();
  await expect(page.locator('.world-screen')).toBeVisible();
  await expect(page.locator('.focus-workbench-panel')).toBeVisible();
}

function apply(state: DomainState, command: DomainCommand, now = Date.parse('2026-10-03T08:00:01Z')) {
  const result = execute(state, command, { now: () => new Date(now) });
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

for (const habit of [false, true]) test(`v256 plan drafts are isolated and only the button confirms (${habit ? 'habit' : 'finite'})`, async ({ page }, info) => {
  test.setTimeout(60_000);
  await setup(page, habit);
  const label = page.locator('.focus-workbench-panel .timer-label');
  const summary = page.locator('.plan-summary>span').first();
  const original = await summary.innerText();
  await expect(label).toHaveText('每轮时长');
  await page.getByRole('button', { name: '调整本次计划' }).click();
  const sheet = page.getByRole('dialog', { name: habit ? '安排习惯专注' : '安排下一轮' });
  await sheet.getByRole('button', { name: '4 轮', exact: true }).click();
  await sheet.getByRole('button', { name: '按结束时间', exact: true }).click();
  await expect(label).toHaveText('每轮时长');
  await expect(summary).toHaveText(original);
  await sheet.getByRole('button', { name: '关闭本次计划' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(summary).toHaveText(original);
  await expect(page.getByRole('button', { name: '开始 1 轮', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '调整本次计划' }).click();
  await expect(sheet.getByRole('button', { name: '固定轮次' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('button', { name: '1 轮', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: '按结束时间' }).click();
  const slider = sheet.getByRole('slider');
  await slider.dblclick();
  await slider.press('Enter');
  await expect(sheet).toBeVisible();
  expect((await readPersistedDomainState(page)).state.activeFocusSession).toBeNull();
  const before = await slider.locator('.timer-value').innerText();
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 36, { steps: 6 });
  await expect(slider.locator('.timer-value')).not.toHaveText(before);
  const afterUp = await slider.locator('.timer-value').innerText();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(slider.locator('.timer-value')).not.toHaveText(afterUp);
  await choosePlanEndTime(sheet, '18:05');
  await page.screenshot({ path: info.outputPath(`v256-slide-plan-${habit ? 'habit' : 'finite'}.png`) });
  await sheet.getByRole('button', { name: '确认计划', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.locator('.focus-workbench-panel')).toBeVisible();
  await expect(label).toHaveText('剩余总时长');
  await expect(page.getByRole('navigation',{name:'主导航'})).toBeVisible();
  const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!));
  expect(plan).toMatchObject({ mode: 'marathon', status: 'ready', endAt: '2026-10-03T10:05:00.000Z' });
  expect((await readPersistedDomainState(page)).state.activeFocusSession).toBeNull();
});

test('v256 plan menu omits completed tasks and starting uses the unfinished choice', async ({ page }) => {
  await setup(page);
  await page.clock.setFixedTime(new Date('2026-10-03T08:01:00Z'));
  let state = (await readPersistedDomainState(page)).state;
  const project = state.projects.find(project => project.id === state.activeProjectId)!;
  const done = project.subtasks[0]!;
  state = apply(state, { type: 'AddSubtask', subtaskId: 'unfinished-step', title: '剩余施工' });
  state = apply(state, { type: 'StartFocus', sessionId: 'completed-step-round', subtaskId: done.id, plannedDurationMs: 1 });
  state = apply(state, { type: 'CompleteFocus' }, Date.parse('2026-10-03T08:00:01.001Z'));
  await executeAndReloadPersistedCommand(page, state, { type: 'ReportSubtaskProgress', reportId: 'completed-step-report', subtaskId: done.id,
    focusSessionIds: ['completed-step-round'], progressBasisPoints: 10000 }, Date.parse('2026-10-03T08:00:01.002Z'));
  await page.getByRole('button', { name: '调整本次计划' }).click();
  const sheet = page.getByRole('dialog', { name: '安排下一轮' });
  await sheet.locator('.choice-menu-trigger').click();
  await expect(sheet.getByRole('option', { name: new RegExp(done.title) })).toHaveCount(0);
  await expect(sheet.getByRole('option', { name: /剩余施工/ })).toBeVisible();
  await sheet.getByRole('option', { name: /剩余施工/ }).click();
  await sheet.getByRole('button', { name: '确认计划' }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: '开始 1 轮', exact: true }).click();
  expect((await readPersistedDomainState(page)).state.activeFocusSession?.subtaskId).toBe('unfinished-step');
});

test('v256 focus weekdays persist, resist an empty week and recover from save failure', async ({ page }, info) => {
  test.setTimeout(60_000);
  await setup(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const row = page.locator('.planned-days-setting');
  const days = row.getByRole('group', { name: '计划专注日' });
  const prior = (await readPersistedDomainState(page)).state.calendar;
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let fail = true;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'appState' && fail) { fail = false; throw new DOMException('test quota', 'QuotaExceededError'); }
      return put.apply(this, args);
    };
  });
  await days.getByRole('button', { name: '一', exact: true }).click();
  await expect(row.getByRole('alert')).toContainText('未保存');
  expect((await readPersistedDomainState(page)).state.calendar).toEqual(prior);
  for (const name of ['二', '三', '四', '五', '六', '日']) {
    const day = days.getByRole('button', { name, exact: true });
    if (await day.getAttribute('aria-pressed') === 'true') {
      await day.click(); await expect(day).toHaveAttribute('aria-pressed', 'false');
    }
  }
  await expect(row).toContainText('每周 1 天');
  const monday = days.getByRole('button', { name: '一', exact: true });
  await expect(monday).toBeDisabled();
  await expect(monday).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(monday).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('v256-planned-days.png'), fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(row).toContainText('每周 1 天');
  await expect(days.getByRole('button', { name: '一', exact: true })).toBeDisabled();
});

test('v256 debug weather is a themed app menu and off releases its overrides', async ({ page }, info) => {
  await setup(page);
  const canvas = page.locator('.world canvas');
  await expect(canvas).toHaveAttribute('data-weather-kind', /\w+/);
  const normalWeather = await canvas.getAttribute('data-weather-kind');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '临时调试世界' }).check();
  const menu = page.locator('#world-debug-weather');
  await expect(menu.locator('select')).toHaveCount(0);
  for (const theme of ['浅色', '深色']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await menu.getByRole('button').click();
    const list = page.getByRole('listbox', { name: '调试天气' });
    await expect(list.getByRole('option')).toHaveCount(7);
    const navTop = (await page.getByRole('navigation', { name: '主导航' }).boundingBox())!.y;
    const bounds = (await list.boundingBox())!;
    expect(bounds.y).toBeGreaterThanOrEqual(8);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(navTop - 7);
    const last = list.getByRole('option', { name: '雾', exact: true });
    await last.scrollIntoViewIfNeeded();
    expect(await last.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })).toBe(true);
    await page.screenshot({ path: info.outputPath(`v256-debug-weather-${theme}.png`), fullPage: true });
    await last.click();
    await expect(menu.getByRole('button')).toContainText('雾');
    await menu.getByRole('button').click();
    await list.getByRole('option', { name: '雪', exact: true }).click();
    await expect(menu.getByRole('button')).toContainText('雪');
  }
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(page.locator('.world canvas')).toHaveAttribute('data-weather-kind', 'snow');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('checkbox', { name: '临时调试世界' }).uncheck();
  await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-weather-kind', normalWeather!);
});

test('v256 all 36 blueprint entries survive a reload and the UI advertises the same capacity', async ({ page }) => {
  test.setTimeout(60_000);
  await setup(page);
  let state = (await readPersistedDomainState(page)).state;
  const command = (index: number): DomainCommand => ({ type: 'ImportBuildingBlueprint', blueprint: {
    schemaVersion: 1, id: `v256-library-${index}`, title: `第 ${index + 1} 份蓝图`,
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 },
    voxels: [{ x: 0, y: 0, z: 0, materialId: 'stone', stage: 'foundation', buildOrder: 0 }],
  } });
  for (let index = 0; index < 35; index += 1) state = apply(state, command(index));
  await executeAndReloadPersistedCommand(page, state, command(35), Date.parse('2026-10-03T08:00:01Z'));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const library = page.locator('.building-blueprint-panel');
  await expect(library).toContainText('最多 36 份');
  await expect(library.locator('.building-blueprint-list>li')).toHaveCount(36);
  expect((await readPersistedDomainState(page)).state.buildingBlueprintResources).toHaveLength(36);
});

test('v256 minimal statistics use legible ink in both themes at full glass transparency', async ({ page }, info) => {
  test.setTimeout(60_000);
  await setup(page);
  for (const [theme, color] of [['浅色', 'rgb(22, 40, 30)'], ['深色', 'rgb(225, 234, 229)']]) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    const minimalPreference = page.getByRole('checkbox', { name: '开启极简模式' });
    // Exiting the presentation intentionally leaves the saved preference on.
    // A real off/on change resets that temporary exit for the next theme.
    await minimalPreference.uncheck();
    await minimalPreference.check();
    await expect(page.locator('.glass-transparency-value')).toContainText('100%');
    await page.getByRole('button', { name: '计时', exact: true }).click();
    const carousel = page.locator('.minimal-idle-carousel');
    await carousel.press('ArrowRight');
    await expect(carousel).toHaveAttribute('data-page', 'today');
    await expect(page.locator('.minimal-today-heading>div>span')).toHaveCSS('color', color!);
    await page.screenshot({ path: info.outputPath(`v256-minimal-today-${theme}.png`) });
    await carousel.press('ArrowLeft');
    await page.locator('.minimal-exit').focus(); await page.keyboard.press('Enter');
  }
});

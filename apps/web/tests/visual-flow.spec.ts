import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function createDefaultProject(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
}

async function openTasks(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '任务', exact: true }).click();
}

async function startFocus(page: import('@playwright/test').Page, rounds = 1) {
  await page.getByLabel('调整本次计划').click();
  const plan = page.getByRole('dialog', { name: '安排下一轮' });
  if (rounds > 1) await plan.getByRole('button', { name: `${rounds} 轮` }).click();
  await plan.getByRole('button', { name: '确认计划' }).click();
  await page.getByRole('button', { name: `开始 ${rounds} 轮` }).click();
}

async function enableTaskEditing(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '编辑施工清单' }).click();
}

async function replaceSubtasks(page: import('@playwright/test').Page, lines: string[]) {
  const clear = page.getByRole('button', { name: '清空小任务' });
  if (await clear.count()) await clear.click();
  const add = page.getByLabel('新增小任务');
  for (const line of lines) {
    await add.fill(line);
    await add.press('Enter');
  }
}

async function openSubtaskEditor(page: import('@playwright/test').Page, title: string) {
  await page.locator('.task-editor-row').filter({ hasText: title }).dblclick();
}

async function openDailyGoal(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '调整今日目标' }).click();
  return page.getByRole('dialog', { name: '调整今日目标' });
}

async function interruptFocus(page: import('@playwright/test').Page, reason = '不记录') {
  await page.getByRole('button', { name: '结束本次专注' }).click();
  await page.getByRole('button', { name: '中断本轮' }).click();
  await page.getByRole('button', { name: reason }).click();
}

async function confirmSubtaskDeletion(page: import('@playwright/test').Page, title: string) {
  const deleteButton = page.getByRole('button', { name: `删除“${title}”` });
  if (await deleteButton.count() === 0) await openSubtaskEditor(page, title);
  await deleteButton.click();
  const dialog = page.getByRole('alertdialog', { name: '删除这个小任务？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '删除小任务' }).click();
  await expect(dialog).toBeHidden();
}

async function enterUncommittedComposition(
  field: import('@playwright/test').Locator,
  value: string,
) {
  await field.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    setter?.call(input, nextValue);
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: nextValue }));
  }, value);
}

async function enterNativeCompositionWithoutReactChange(
  field: import('@playwright/test').Locator,
  value: string,
) {
  await field.evaluate((element, nextValue) => {
    const input = element as HTMLInputElement | HTMLTextAreaElement;
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    setter?.call(input, nextValue);
  }, value);
}

test('creates a project, renders the world and persists focus state', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '建立你的第一项任务' })).toBeVisible();
  await page.getByRole('button', { name: '开始建造' }).click();
  await expect(page.getByRole('heading', { name: '我的第一座工坊' })).toBeVisible();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(300);
  const canvasPng = await canvas.screenshot();
  expect(canvasPng.byteLength).toBeGreaterThan(2_000);
  await startFocus(page);
  await expect(page.getByRole('button', { name: '结束本次专注' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '结束本次专注' })).toBeVisible();
  await interruptFocus(page);
  await expect(page.getByRole('button', { name: '开始 1 轮' })).toBeVisible();
  const clearOfNavigation = await page.evaluate(() => document.querySelector('.primary')!.getBoundingClientRect().bottom <= document.querySelector('nav')!.getBoundingClientRect().top);
  if ((await page.viewportSize())!.width < 700) expect(clearOfNavigation).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('world-screen.png'), fullPage: true });
});

test('previews three blueprints and persists the selected building', async ({ page }, testInfo) => {
  await page.goto('/');
  const radios = page.getByRole('radio');
  await expect(radios).toHaveCount(3);
  await expect(page.getByRole('radio', { name: /林边工坊/ })).toBeChecked();

  const preview = page.getByRole('img', { name: /完整建筑预览/ });
  await expect(preview).toHaveAttribute('aria-label', /林边工坊/);
  await page.waitForTimeout(300);
  const workshopPreview = await preview.screenshot({ path: testInfo.outputPath('workshop-preview.png') });

  await page.getByRole('radio', { name: /村庄礼拜堂/ }).check();
  await expect(preview).toHaveAttribute('aria-label', /村庄礼拜堂/);
  await expect(page.getByText('蓝图在创建后不可更换，请确认完整预览。')).toBeVisible();
  await page.waitForTimeout(300);
  const chapelPreview = await preview.screenshot({ path: testInfo.outputPath('chapel-preview.png') });
  expect(Buffer.compare(workshopPreview, chapelPreview)).not.toBe(0);
  await page.screenshot({ path: testInfo.outputPath('blueprint-selection.png'), fullPage: true });

  await page.getByLabel('大型任务').fill('完成视觉发布');
  await page.getByRole('button', { name: '开始建造' }).click();
  const summary = page.locator('#world-summary');
  await expect(summary).toContainText('完成视觉发布');
  await expect(summary).toContainText('村庄礼拜堂');
  await page.reload();
  await expect(page.locator('#world-summary')).toContainText('村庄礼拜堂');
  await page.screenshot({ path: testInfo.outputPath('selected-chapel-world.png'), fullPage: true });
});

test('imports a local litematic, previews it and persists its normalized blueprint', async ({ page }, testInfo) => {
  const sample = resolve(process.cwd(), '../../litematic/bd29cade-7000-42b7-adc1-0631ce512c30.litematic');
  test.skip(!existsSync(sample), 'The real Litematic compatibility fixture stays local.');
  await page.goto('/');
  await page.getByLabel('导入 .litematic').setInputFiles(sample);
  await expect(page.getByRole('radio')).toHaveCount(4);
  await expect(page.getByText(/4,301 个方块/)).toBeVisible();
  await expect(page.getByText(/忽略 340 个实体、方块实体或计划刻/)).toBeVisible();
  const selectedImport = page.getByRole('radio').last();
  await expect(selectedImport).toBeChecked();
  await page.getByRole('button', { name: '每日奖励装饰' }).click();
  await expect(page.getByText(/奖励装饰上限为 12 x 12 x 16/)).toBeVisible();
  await expect(page.getByRole('button', { name: '加入装饰池' })).toBeDisabled();
  await page.getByRole('button', { name: '主任务建筑' }).click();

  const preview = page.getByRole('img', { name: /完整建筑预览/ });
  await page.waitForTimeout(300);
  const previewPng = await preview.screenshot({ path: testInfo.outputPath('litematic-preview.png') });
  expect(previewPng.byteLength).toBeGreaterThan(2_000);

  await page.getByLabel('大型任务').fill('导入样例建筑');
  await page.getByRole('button', { name: '开始建造' }).click();
  await expect(page.locator('#world-summary')).toContainText('导入样例建筑');
  await page.reload();
  await expect(page.locator('#world-summary')).toContainText('导入样例建筑');
  await page.waitForTimeout(300);
  const worldPng = await page.getByLabel('项目建筑世界').screenshot({ path: testInfo.outputPath('litematic-world.png') });
  expect(worldPng.byteLength).toBeGreaterThan(2_000);
});

test('renders a monument with the active building and restores both after deletion', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-07-24T08:00:00Z') });
  await page.goto('/');
  await page.getByLabel('大型任务').fill('完成第一栋建筑');
  await replaceSubtasks(page, ['完成全部工作']);
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('普通任务专注分钟').fill('1');
  await page.getByRole('button', { name: '计时' }).click();
  await startFocus(page);
  await page.clock.fastForward(61_000);
  await page.getByRole('button', { name: '完成小任务' }).click();
  await page.getByRole('button', { name: '回到聚落' }).click();

  await expect(page.getByRole('heading', { name: '建立你的第一项任务' })).toBeVisible();
  await page.getByLabel('大型任务').fill('开始第二栋建筑');
  await replaceSubtasks(page, ['完成第二项工作']);
  await page.getByRole('radio', { name: /河岸木屋/ }).check();
  await page.getByRole('button', { name: '开始建造' }).click();

  let summary = page.locator('#world-summary');
  await expect(summary).toContainText('完成第一栋建筑，林边工坊，纪念建筑');
  await expect(summary).toContainText('开始第二栋建筑，河岸木屋，正在建造');
  await expect(page.getByText('林边聚落 · 2 栋')).toBeVisible();

  await openTasks(page);
  await page.getByRole('button', { name: '删除当前任务' }).click();
  await page.getByRole('alertdialog', { name: '删除这项任务？' }).getByRole('button', { name: '删除任务' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByText('删除任务前备份')).toBeVisible();
  await page.getByRole('button', { name: '恢复' }).first().click();
  await page.getByRole('alertdialog', { name: '恢复这份备份？' }).getByRole('button', { name: '恢复备份' }).click();
  await page.getByRole('button', { name: '计时' }).click();
  summary = page.locator('#world-summary');
  await expect(summary).toContainText('完成第一栋建筑，林边工坊，纪念建筑');
  await expect(summary).toContainText('开始第二栋建筑，河岸木屋，正在建造');
});

test('adds and switches unfinished large projects without moving their buildings', async ({ page }) => {
  await createDefaultProject(page);
  await openTasks(page);
  await page.getByRole('button', { name: '新增任务' }).click();
  await expect(page.getByRole('heading', { name: '新增任务' })).toBeVisible();
  await page.getByLabel('大型任务').fill('第二项长期工作');
  await replaceSubtasks(page, ['第二项的第一步', '第二项的第二步']);
  await page.getByRole('radio', { name: /河岸木屋/ }).check();
  await page.getByRole('button', { name: '开始建造' }).click();

  let summary = page.locator('#world-summary');
  await expect(summary).toContainText('我的第一座工坊，林边工坊，暂停建造');
  await expect(summary).toContainText('第二项长期工作，河岸木屋，正在建造');
  await expect(page.getByText('林边聚落 · 2 栋')).toBeVisible();

  await openTasks(page);
  const selector = page.locator('.choice-menu').filter({ has: page.getByText('当前任务', { exact: true }) });
  await selector.getByRole('button').click();
  await selector.getByRole('option', { name: '我的第一座工坊' }).click();
  await page.getByRole('button', { name: '计时' }).click();
  summary = page.locator('#world-summary');
  await expect(summary).toContainText('我的第一座工坊，林边工坊，正在建造');
  await expect(summary).toContainText('第二项长期工作，河岸木屋，暂停建造');

  await startFocus(page);
  await expect(page.locator('.app-shell')).toHaveClass(/focus-immersive/);
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增任务' })).toHaveCount(0);
  await interruptFocus(page);
  await openTasks(page);
  await expect(page.locator('.choice-menu').filter({ has: page.getByText('当前任务', { exact: true }) }).getByRole('button')).toBeEnabled();
  await expect(page.getByRole('button', { name: '新增任务' })).toBeEnabled();
});

test('keeps a new-project draft in memory when returning to the existing world', async ({ page }) => {
  await createDefaultProject(page);
  await openTasks(page);
  await page.getByRole('button', { name: '新增任务' }).click();

  const title = page.getByLabel('大型任务');
  await title.fill('');
  await enterNativeCompositionWithoutReactChange(title, '暂存的中文任务');
  await replaceSubtasks(page, ['整理资料', '开始实现']);
  await page.getByRole('radio', { name: /河岸木屋/ }).check();

  await page.getByRole('button', { name: '计时' }).click();
  await expect(page.getByRole('heading', { name: '我的第一座工坊' })).toBeVisible();

  await openTasks(page);
  await page.getByRole('button', { name: '新增任务' }).click();
  await expect(page.getByLabel('大型任务')).toHaveValue('暂存的中文任务');
  await expect(page.getByLabel('小任务 1')).toHaveValue('整理资料');
  await expect(page.getByLabel('小任务 2')).toHaveValue('开始实现');
  await expect(page.getByRole('radio', { name: /河岸木屋/ })).toBeChecked();

  await page.reload();
  await openTasks(page);
  await page.getByRole('button', { name: '新增任务' }).click();
  await expect(page.getByLabel('大型任务')).toHaveValue('我的第一座工坊');
  await expect(page.getByLabel('小任务 1')).toHaveValue('确定目标');
  await expect(page.getByLabel('小任务 2')).toHaveValue('完成核心工作');
  await expect(page.getByLabel('小任务 3')).toHaveValue('检查并收尾');
});

test('preserves mobile Chinese composition while selecting a project blueprint', async ({ page }) => {
  await createDefaultProject(page);
  await openTasks(page);
  await page.getByRole('button', { name: '新增任务' }).click();

  const title = page.getByLabel('大型任务');
  await title.fill('');
  await enterUncommittedComposition(title, '中文长期任务');
  await page.getByRole('button', { name: '清空小任务' }).click();
  await page.getByLabel('新增小任务').fill('占位');
  await page.getByLabel('新增小任务').press('Enter');
  const row = page.getByLabel('小任务 1');
  await enterUncommittedComposition(row, '调研需求');
  await page.getByRole('radio', { name: /河岸木屋/ }).check();

  await expect(title).toHaveValue('中文长期任务');
  await expect(row).toHaveValue('调研需求');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  if ((await page.viewportSize())!.width < 700) expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await row.dispatchEvent('input');
  await page.getByRole('button', { name: '开始建造' }).click();
  await expect(page.locator('#world-summary')).toContainText('中文长期任务');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator('.topbar')).toBeVisible();
});

test('creates a project when Android IME has not emitted a React change before blueprint selection', async ({ page }) => {
  await createDefaultProject(page);
  await openTasks(page);
  await page.getByRole('button', { name: '新增任务' }).click();

  const title = page.getByLabel('大型任务');
  await title.fill('');
  await enterNativeCompositionWithoutReactChange(title, '中文长期任务');
  await page.getByRole('button', { name: '清空小任务' }).click();
  await page.getByLabel('新增小任务').fill('占位');
  await page.getByLabel('新增小任务').press('Enter');
  const row = page.getByLabel('小任务 1');
  await enterNativeCompositionWithoutReactChange(row, '调研需求');
  await page.getByLabel('新增小任务').fill('完成实现');
  await page.getByLabel('新增小任务').press('Enter');
  await page.getByRole('radio', { name: /河岸木屋/ }).check();

  await expect(title).toHaveValue('中文长期任务');
  await expect(page.getByLabel('小任务 1')).toHaveValue('调研需求');
  await expect(page.getByLabel('小任务 2')).toHaveValue('完成实现');
  await page.getByLabel('小任务 1').dispatchEvent('input');
  await page.getByRole('button', { name: '开始建造' }).click();
  await expect(page.locator('#world-summary')).toContainText('中文长期任务');
});

test('navigation remains usable without overlap', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的第一座工坊' })).toBeVisible();
  await page.getByRole('button', { name: '统计' }).click();
  await expect(page.getByRole('heading', { name: '专注轨迹' })).toBeVisible();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const unobstructed = await page.evaluate(() => { const last = (document.querySelector('.backup-panel') ?? document.querySelector('.setting:last-child'))!.getBoundingClientRect(); const nav = document.querySelector('nav')!.getBoundingClientRect(); return innerWidth >= 700 ? last.left >= nav.right : last.bottom <= nav.top; });
  expect(unobstructed).toBe(true);
});

test('expired focus resumes into progress reporting and grows the building', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-07-23T08:00:00Z') });
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await startFocus(page);
  await page.clock.fastForward(45 * 60 * 1000 + 1_000);
  await expect(page.getByRole('heading', { name: '这次工作推进到哪里？' })).toBeVisible();
  await page.getByRole('button', { name: '推进至 50%' }).click();
  await expect(page.locator('.workbench-context')).toContainText('已完成 50%');
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath('building-50-percent.png'), fullPage: true });
});

test('persists focus and break preferences and exposes period statistics', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('普通任务专注分钟')).toHaveValue('45');
  await expect(page.getByLabel('开启专注完整性')).toBeChecked();
  await expect(page.getByLabel('允许有效离开次数')).toHaveValue('3');
  await page.getByLabel('允许有效离开次数').fill('');
  await expect(page.getByLabel('允许有效离开次数')).toHaveValue('');
  await page.getByRole('heading', { name: '设置' }).click();
  await expect(page.getByLabel('允许有效离开次数')).toHaveValue('1');
  await page.getByLabel('允许有效离开次数').fill('4');
  await expect(page.getByLabel('允许有效离开次数')).toHaveValue('4');
  await page.getByRole('heading', { name: '设置' }).click();
  await expect(page.getByLabel('允许有效离开次数')).toHaveValue('4');
  await page.getByLabel('普通任务专注分钟').fill('');
  await expect(page.getByLabel('普通任务专注分钟')).toHaveValue('');
  await page.getByRole('heading', { name: '设置' }).click();
  await expect(page.getByLabel('普通任务专注分钟')).toHaveValue('1');
  await page.getByLabel('普通任务专注分钟').fill('50');
  await page.getByLabel('每轮休息分钟').fill('10');
  await page.getByLabel('允许有效离开次数').fill('5');
  await expect(page.getByLabel('允许有效离开次数')).toHaveValue('5');
  await expect(page.getByLabel('开启专注完整性')).toBeEnabled();
  await page.getByLabel('开启专注完整性').uncheck();
  await expect(page.getByLabel('允许有效离开次数')).toBeDisabled();
  await expect(page.locator('.integrity-setting')).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('普通任务专注分钟')).toHaveValue('50');
  await expect(page.getByLabel('每轮休息分钟')).toHaveValue('10');
  await expect(page.getByLabel('开启专注完整性')).not.toBeChecked();
  await expect(page.getByLabel('允许有效离开次数')).toHaveValue('5');
  await page.getByRole('button', { name: '统计' }).click();
  await expect(page.getByRole('heading', { name: '近 26 周' })).toBeVisible();
  await expect(page.locator('.focus-heatmap-cell')).toHaveCount(26 * 7);
  await expect(page.getByRole('tab')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('focus-heatmap.png'), fullPage: true });
});

test('runs a configured multi-round focus and break plan', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-07-23T08:00:00Z') });
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('普通任务专注分钟').fill('1');
  await page.getByLabel('每轮休息分钟').fill('1');
  await page.getByRole('button', { name: '计时' }).click();
  await startFocus(page, 2);
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('heading', { name: '这次工作推进到哪里？' })).toBeVisible();
  await page.getByRole('button', { name: '推进至 25%' }).click();
  await expect(page.getByText('休息时间')).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('button', { name: '开始下一轮' })).toBeVisible();
});

test('edits project and subtasks before progress and persists their order', async ({ page }, testInfo) => {
  await createDefaultProject(page);
  await openTasks(page);

  await page.getByRole('button', { name: '修改任务名称' }).click();
  await page.getByRole('textbox', { name: '任务名称', exact: true }).fill('发布方块钟');
  await page.getByRole('button', { name: '保存任务名称' }).click();
  await expect(page.getByRole('heading', { name: '发布方块钟' })).toBeVisible();

  await enableTaskEditing(page);
  await page.getByLabel('新增小任务').fill('整理验证结果');
  await page.getByRole('button', { name: '添加' }).click();
  await page.locator('.task-editor-row').filter({ hasText: '整理验证结果' }).dblclick();
  await page.getByRole('textbox', { name: '小任务名称', exact: true }).fill('发布检查');
  await page.getByRole('button', { name: '保存小任务名称' }).click();
  await page.getByLabel('长按拖动“发布检查”排序；使用方向键微调').press('ArrowUp');
  await page.getByLabel('长按拖动“发布检查”排序；使用方向键微调').press('ArrowUp');
  await expect(page.locator('.task-editor-row strong')).toHaveText([
    '确定目标',
    '发布检查',
    '完成核心工作',
    '检查并收尾',
  ]);

  await page.reload();
  await openTasks(page);
  await expect(page.getByRole('heading', { name: '发布方块钟' })).toBeVisible();
  await enableTaskEditing(page);
  await expect(page.locator('.task-editor-row strong')).toHaveText([
    '确定目标',
    '发布检查',
    '完成核心工作',
    '检查并收尾',
  ]);
  const addControl = page.getByLabel('新增小任务');
  await addControl.scrollIntoViewIfNeeded();
  const clearOfNavigation = await page.evaluate(() => {
    const control = document.querySelector('#new-subtask')!.getBoundingClientRect();
    const nav = document.querySelector('nav')!.getBoundingClientRect();
    return innerWidth >= 700 ? control.left >= nav.right : control.bottom <= nav.top;
  });
  expect(clearOfNavigation).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('task-management.png'), fullPage: true });
});

test('requires confirmation to delete a subtask and protects the final item', async ({ page }) => {
  await createDefaultProject(page);
  await openTasks(page);
  await enableTaskEditing(page);

  await openSubtaskEditor(page, '检查并收尾');
  await page.getByRole('button', { name: '删除“检查并收尾”' }).click();
  let dialog = page.getByRole('alertdialog', { name: '删除这个小任务？' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused();
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('textbox', { name: '小任务名称', exact: true })).toHaveValue('检查并收尾');

  await page.getByRole('button', { name: '删除“检查并收尾”' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('textbox', { name: '小任务名称', exact: true })).toHaveValue('检查并收尾');

  await confirmSubtaskDeletion(page, '检查并收尾');
  await expect(page.getByText('检查并收尾', { exact: true })).toBeHidden();
  await page.reload();
  await openTasks(page);
  await enableTaskEditing(page);
  await expect(page.getByText('检查并收尾', { exact: true })).toBeHidden();

  await confirmSubtaskDeletion(page, '完成核心工作');
  await openSubtaskEditor(page, '确定目标');
  const finalDelete = page.getByRole('button', { name: '删除“确定目标”' });
  await expect(finalDelete).toBeDisabled();
  await expect(finalDelete).toHaveAttribute('title', '至少保留一个小任务');
});

test('keeps zero progress editable and locks structure after positive progress', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-07-23T08:00:00Z') });
  await createDefaultProject(page);

  await startFocus(page);
  await page.clock.fastForward(45 * 60 * 1000 + 1_000);
  await expect(page.getByRole('heading', { name: '这次工作推进到哪里？' })).toBeVisible();
  await page.getByRole('button', { name: '保持 0%' }).click();
  await openTasks(page);
  await enableTaskEditing(page);
  await expect(page.getByLabel('新增小任务')).toBeVisible();
  await expect(page.getByText('已有进度后不能增删，可继续改名和排序。')).toBeHidden();

  await page.getByRole('button', { name: '计时' }).click();
  await startFocus(page);
  await page.clock.fastForward(45 * 60 * 1000 + 1_000);
  await expect(page.getByRole('heading', { name: '这次工作推进到哪里？' })).toBeVisible();
  await page.getByRole('button', { name: '推进至 25%' }).click();
  await openTasks(page);
  await enableTaskEditing(page);

  await expect(page.getByText('已有进度后不能增删，可继续改名和排序。')).toBeVisible();
  await expect(page.getByLabel('新增小任务')).toBeHidden();
  await expect(page.getByRole('button', { name: /删除“/ })).toHaveCount(0);
  await page.locator('.task-editor-row').filter({ hasText: '完成核心工作' }).dblclick();
  await page.getByRole('textbox', { name: '小任务名称', exact: true }).fill('完成核心实现');
  await page.getByRole('button', { name: '保存小任务名称' }).click();
  await page.getByLabel('长按拖动“完成核心实现”排序；使用方向键微调').press('ArrowUp');
  await expect(page.locator('.task-editor-row strong')).toHaveText(['完成核心实现', '确定目标', '检查并收尾']);

  await page.reload();
  await openTasks(page);
  await enableTaskEditing(page);
  await expect(page.getByText('已有进度后不能增删，可继续改名和排序。')).toBeVisible();
  await expect(page.locator('.task-editor-row strong')).toHaveText(['完成核心实现', '确定目标', '检查并收尾']);
});

test('persists daily goal target changes and disabled state', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-07-23T08:00:00Z') });
  await createDefaultProject(page);
  await openTasks(page);

  let goal = await openDailyGoal(page);
  const goalTarget = goal.getByLabel('今日目标次数');
  await expect(goalTarget).toHaveValue('8');
  await expect(goal.getByRole('switch')).toBeChecked();
  await expect(goal.getByRole('button', { name: '保存' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('v13-daily-goal.png'), fullPage: true });
  await goalTarget.fill('2');
  await goalTarget.press('Enter');
  await expect(goal.getByLabel('今日目标次数')).toHaveValue('2');
  await goal.getByRole('button', { name: '关闭今日目标' }).click();
  await expect(page.getByText('今日 0 / 2')).toBeVisible();

  await page.reload();
  await openTasks(page);
  goal = await openDailyGoal(page);
  await expect(goal.getByRole('switch')).toBeChecked();
  await expect(goal.getByLabel('今日目标次数')).toHaveValue('2');

  await goal.getByLabel('今日目标次数').fill('4');
  await goal.getByLabel('今日目标次数').press('Enter');
  await goal.getByRole('button', { name: '关闭今日目标' }).click();
  await expect(page.getByText('今日 0 / 4')).toBeVisible();
  goal = await openDailyGoal(page);
  await goal.getByRole('switch').uncheck();
  await expect(page.getByText('今日已完成 0 轮，目标未开启')).toBeVisible();

  await page.reload();
  await openTasks(page);
  goal = await openDailyGoal(page);
  await expect(goal.getByRole('switch')).not.toBeChecked();
  await expect(goal.getByLabel('今日目标次数')).toHaveValue('4');
  await expect(page.getByText('今日已完成 0 轮，目标未开启')).toBeVisible();
});

test('renames an imported building blueprint without changing its stored snapshot', async ({ page }, testInfo) => {
  const sample = resolve(process.cwd(), '../../litematic/bd29cade-7000-42b7-adc1-0631ce512c30.litematic');
  test.skip(!existsSync(sample), 'The real Litematic compatibility fixture stays local.');
  await createDefaultProject(page);
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('导入 .litematic').setInputFiles(sample);
  await page.getByRole('button', { name: '保存到建筑蓝图库' }).click();

  const rename = page.getByRole('button', { name: /重命名“/ }).first();
  await expect(rename).toBeVisible();
  await rename.click();
  const input = page.getByRole('textbox', { name: /重命名“/ });
  await enterNativeCompositionWithoutReactChange(input, 'V13 阅读大厅');
  await page.getByRole('button', { name: '保存蓝图名称' }).click();
  await expect(page.locator('.building-blueprint-list strong')).toHaveText('V13 阅读大厅');
  await page.screenshot({ path: testInfo.outputPath('v13-blueprint-library.png'), fullPage: true });

  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('.building-blueprint-list strong')).toHaveText('V13 阅读大厅');
});

test('exports, previews, imports, and restores a local backup', async ({ page }, testInfo) => {
  await createDefaultProject(page);
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByRole('heading', { name: '本地备份' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 JSON' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Expected local browser download path');
  await page.getByLabel('选择备份 JSON 文件').setInputFiles(path);
  await expect(page.getByRole('heading', { name: '导入预览' })).toBeVisible();
  await expect(page.getByText(/当前：我的第一座工坊/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('backup-preview.png'), fullPage: true });
  await page.getByRole('button', { name: '确认替换本地数据' }).click();
  await expect(page.getByText('导入完成，已创建回滚备份。')).toBeVisible();
  await expect(page.getByText('导入前备份')).toBeVisible();

  await page.getByRole('button', { name: '恢复' }).first().click();
  const dialog = page.getByRole('alertdialog', { name: '恢复这份备份？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '恢复备份' }).click();
  await expect(page.getByText('已恢复备份，并创建恢复前回滚点。')).toBeVisible();
});

test('keeps large-project deletion unavailable during an immersive active focus', async ({ page }) => {
  await createDefaultProject(page);
  await startFocus(page);
  await expect(page.locator('.app-shell')).toHaveClass(/focus-immersive/);
  await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除当前任务' })).toHaveCount(0);
  await interruptFocus(page);
  await openTasks(page);
  const deleteProject = page.getByRole('button', { name: '删除当前任务' });
  await expect(deleteProject).toBeEnabled();
});

test('leaves immersive UI after lifecycle reconciliation interrupts focus', async ({ page }) => {
  await createDefaultProject(page);
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByLabel('允许有效离开次数').fill('1');
  await page.getByLabel('允许有效离开次数').blur();
  await page.getByRole('button', { name: '计时' }).click();
  await startFocus(page);
  await expect(page.locator('.app-shell')).toHaveClass(/focus-immersive/);

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(3_200);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect(page.locator('.app-shell')).not.toHaveClass(/focus-immersive/);
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByText('本轮专注因达到离开应用次数上限而结束。')).toBeVisible();
});

test('deletes a completed-idle project with rollback and restores it from settings', async ({ page }) => {
  await createDefaultProject(page);
  await openTasks(page);
  await page.getByRole('button', { name: '删除当前任务' }).click();
  const dialog = page.getByRole('alertdialog', { name: '删除这项任务？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '删除任务' }).click();
  await expect(page.getByRole('heading', { name: '建立你的第一项任务' })).toBeVisible();

  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(page.getByText('删除任务前备份')).toBeVisible();
  await page.getByRole('button', { name: '恢复' }).first().click();
  await page.getByRole('alertdialog', { name: '恢复这份备份？' }).getByRole('button', { name: '恢复备份' }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的第一座工坊' })).toBeVisible();
});

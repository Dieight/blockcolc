import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const currentVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

async function createDefaultProject(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
}

test('one-round early completion records the task and ends the plan without a break', async ({ page }, testInfo) => {
  await createDefaultProject(page);
  await page.getByRole('button', { name: '开始 1 轮' }).click();
  await page.getByRole('button', { name: '结束本次专注' }).click();

  const dialog = page.getByRole('dialog', { name: '如何结束这次专注？' });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('end-focus-dialog.png'), fullPage: true });
  await dialog.getByRole('button', { name: /提前完成任务/ }).click();

  await expect(page.getByText('任务已完成 · 休息时间')).toBeHidden();
  await expect(page.locator('.construction-feedback')).toContainText('材料已送达');
  await expect(page.getByRole('button', { name: '开始 1 轮' })).toBeVisible();
  await expect(page.getByText('今日 1 / 8 轮')).toBeVisible();
  await page.getByRole('button', { name: '统计' }).click();
  await expect(page.locator('.stats-grid > div').filter({ hasText: '提前完成' })).toContainText('1');
  await expect(page.locator('.stats-grid > div').filter({ hasText: '完整轮次' })).toContainText('0');
  await expect(page.getByRole('heading', { name: '近 26 周' })).toBeVisible();
  await expect(page.locator('.focus-heatmap-cell')).toHaveCount(26 * 7);
  await expect(page.locator('.activity-chart')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('v8-statistics.png'), fullPage: true });
});

test('one planned round ends directly after its natural progress report', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-03T08:00:00Z') });
  await createDefaultProject(page);
  await page.getByRole('button', { name: '设置' }).click();
  const focusMinutes = page.getByLabel('普通任务专注分钟');
  await focusMinutes.fill('1');
  await focusMinutes.press('Enter');
  const breakMinutes = page.getByLabel('每轮休息分钟');
  await breakMinutes.fill('1');
  await breakMinutes.press('Enter');
  await page.getByRole('button', { name: '计时' }).click();
  await page.getByRole('button', { name: '开始 1 轮' }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('heading', { name: '这次工作推进到哪里？' })).toBeVisible();
  await page.getByRole('button', { name: '推进至 25%' }).click();
  await expect(page.getByText('休息时间')).toBeHidden();
  await expect(page.getByRole('button', { name: '开始 1 轮' })).toBeVisible();
  await page.getByRole('button', { name: '统计' }).click();
  await expect(page.locator('.focus-heatmap-cell.heat-level-1')).toHaveCount(1);
});

test('keeps compact heatmap month labels from overlapping', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-08-11T08:00:00+08:00') });
  await createDefaultProject(page);
  await page.getByRole('button', { name: '统计' }).click();
  await expect(page.locator('.focus-heatmap-cell')).toHaveCount(26 * 7);

  const labels = page.locator('.focus-heatmap-months span');
  const layout = await labels.evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { text: element.textContent ?? '', left: box.left, right: box.right, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
  }));
  expect(layout.map(item => item.text)).not.toContain('2月');
  expect(layout.map(item => item.text)).toContain('3月');
  expect(layout.every(item => item.scrollWidth <= item.clientWidth + 1)).toBe(true);
  for (let index = 1; index < layout.length; index += 1) expect(layout[index - 1]!.right).toBeLessThanOrEqual(layout[index]!.left);
  await page.screenshot({ path: testInfo.outputPath('heatmap-month-spacing.png'), fullPage: true });
});

test('keeps each multi-round progress report before its configured break', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-08-03T08:00:00Z') });
  await createDefaultProject(page);
  await page.getByRole('button', { name: '设置' }).click();
  const focusMinutes = page.getByLabel('普通任务专注分钟');
  await focusMinutes.fill('1');
  await focusMinutes.press('Enter');
  const breakMinutes = page.getByLabel('每轮休息分钟');
  await breakMinutes.fill('1');
  await breakMinutes.press('Enter');
  await page.getByRole('button', { name: '计时' }).click();
  await page.getByRole('button', { name: '调整本次计划' }).click();
  const plan = page.getByRole('dialog', { name: '安排下一轮' });
  await plan.getByRole('button', { name: '2 轮' }).click();
  await plan.getByRole('button', { name: '确认计划' }).click();
  await page.getByRole('button', { name: '开始 2 轮' }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('heading', { name: '这次工作推进到哪里？' })).toBeVisible();
  await page.getByRole('button', { name: '推进至 25%' }).click();
  await expect(page.getByText('休息时间')).toBeVisible();
  await page.clock.fastForward(61_000);
  await page.getByRole('button', { name: '开始下一轮' }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('heading', { name: '这次工作推进到哪里？' })).toBeVisible();
});

test('opens the active task in a restrained world focus and returns to the settlement', async ({ page }, testInfo) => {
  await createDefaultProject(page);
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('v8-tasks.png'), fullPage: true });
  await page.getByRole('button', { name: '查看建筑' }).click();
  await expect(page.getByText('正在查看 · 我的第一座工坊')).toBeVisible();
  const world = page.getByLabel('项目建筑世界');
  await expect(world).toHaveAttribute('data-camera-distance-ratio', /^(0\.[89]|1\.)/);
  await expect(world).toHaveAttribute('data-sky-camera-world-offset', '0.0000');
  await page.screenshot({ path: testInfo.outputPath('v7-focused-world.png'), fullPage: true });
  await page.getByRole('button', { name: '返回完整聚落' }).click();
  await expect(page.getByText('林边聚落 · 1 栋')).toBeVisible();
  await expect(world).toHaveAttribute('data-sky-camera-world-offset', '0.0000');
});

test('keeps the ordinary timer workbench within a mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await createDefaultProject(page);
  await expect(page.locator('.timer')).toHaveCSS('font-size', '48px');
  await page.setViewportSize({ width: 412, height: 915 });
  const primary = page.getByRole('button', { name: '开始 1 轮' });
  const navigation = page.getByRole('button', { name: '计时', exact: true });
  const [primaryBox, navigationBox, pageOffset] = await Promise.all([
    primary.boundingBox(),
    navigation.boundingBox(),
    page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); return window.scrollY; }),
  ]);
  expect(primaryBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(primaryBox!.y + primaryBox!.height).toBeLessThanOrEqual(navigationBox!.y + 1);
  expect(pageOffset).toBe(0);
  await expect(page.locator('.timer')).toHaveCSS('font-size', '64px');
  await page.screenshot({ path: testInfo.outputPath('v8-timer-portrait.png'), fullPage: true });
});

test('shows the complete plan duration before focus and the active stage after start', async ({ page }) => {
  await createDefaultProject(page);
  const timer = page.locator('.timer');
  await expect(timer).toContainText('计划总时长');
  await expect(timer).toContainText('45:00');

  await page.getByRole('button', { name: '调整本次计划' }).click();
  await page.getByRole('button', { name: '2 轮' }).click();
  await page.getByRole('button', { name: '确认计划' }).click();
  await expect(timer).toContainText('1:35:00');

  await page.getByRole('button', { name: '调整本次计划' }).click();
  await page.getByRole('button', { name: '4 轮' }).click();
  await page.getByRole('button', { name: '确认计划' }).click();
  await expect(timer).toContainText('3:15:00');
  await page.getByRole('button', { name: '开始 4 轮' }).click();
  await expect(timer).toContainText('本轮剩余');
  await expect(timer).toContainText('45:00');
});

test('keeps the ordinary timer workbench within a mobile landscape viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await createDefaultProject(page);
  const primary = page.getByRole('button', { name: '开始 1 轮' });
  const [primaryBox, pageOffset, viewportHeight] = await Promise.all([
    primary.boundingBox(),
    page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); return window.scrollY; }),
    page.evaluate(() => window.innerHeight),
  ]);
  expect(primaryBox).not.toBeNull();
  expect(primaryBox!.y + primaryBox!.height).toBeLessThanOrEqual(viewportHeight + 1);
  expect(pageOffset).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('v8-timer-landscape.png'), fullPage: true });
});

test('keeps work-page scroll-end clearance compact above mobile navigation', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await createDefaultProject(page);
  for (const tab of ['任务', '统计', '设置']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    const layout = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const pageElement = document.querySelector<HTMLElement>('main > .page');
      const navigation = document.querySelector<HTMLElement>('.bottom-nav');
      const last = pageElement?.lastElementChild?.getBoundingClientRect();
      const navigationRect = navigation?.getBoundingClientRect();
      return {
        paddingBottom: pageElement ? Number.parseFloat(getComputedStyle(pageElement).paddingBottom) : -1,
        scrollable: document.documentElement.scrollHeight > innerHeight + 1,
        clearance: last && navigationRect ? navigationRect.top - last.bottom : -1,
      };
    });
    expect(layout.paddingBottom).toBe(14);
    if (layout.scrollable) {
      expect(layout.clearance).toBeGreaterThanOrEqual(8);
      expect(layout.clearance).toBeLessThanOrEqual(36);
    }
  }
});

test('keeps the global daily goal above the construction queue and in a secondary sheet', async ({ page }) => {
  await createDefaultProject(page);
  await page.getByRole('button', { name: '任务', exact: true }).click();
  const [goalBox, queueBox] = await Promise.all([
    page.locator('.daily-goal-workbench').boundingBox(),
    page.locator('.task-queue-label').boundingBox(),
  ]);
  expect(goalBox).not.toBeNull();
  expect(queueBox).not.toBeNull();
  expect(goalBox!.y).toBeLessThan(queueBox!.y);
  await page.getByRole('button', { name: '调整今日目标' }).click();
  const dialog = page.getByRole('dialog', { name: '调整今日目标' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('switch')).toBeVisible();
  await expect(dialog.getByLabel('今日目标次数')).toHaveValue('8');
  await expect(dialog.getByRole('switch')).toBeChecked();
  await expect(dialog.getByRole('button', { name: '保存' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭今日目标' }).click();
  await expect(dialog).toBeHidden();
});

test('keeps routine task lists compact and exposes editing only on demand', async ({ page }) => {
  await createDefaultProject(page);
  await page.getByRole('button', { name: '任务', exact: true }).click();

  const rows = page.locator('.task-editor-row');
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole('button', { name: '后续任务 2 项' })).toBeVisible();
  await expect(page.getByLabel('新增小任务')).toHaveCount(0);
  await page.getByRole('button', { name: '后续任务 2 项' }).click();
  await expect(rows).toHaveCount(3);
  await rows.nth(1).dblclick();
  await expect(rows.nth(1).getByRole('textbox', { name: '小任务名称' })).toBeVisible();
  await rows.nth(1).getByRole('button', { name: '取消修改' }).click();

  await page.getByRole('button', { name: '编辑施工清单' }).click();
  await expect(page.locator('.task-drag-handle')).toHaveCount(3);
  await expect(page.getByLabel('新增小任务')).toBeVisible();
  await page.getByRole('button', { name: '结束编辑施工清单' }).click();
  await expect(page.getByLabel('新增小任务')).toHaveCount(0);
});

test('categorized interruption appears in local statistics', async ({ page }) => {
  await createDefaultProject(page);
  await page.getByRole('button', { name: '开始 1 轮' }).click();
  await page.getByRole('button', { name: '结束本次专注' }).click();
  await page.getByRole('button', { name: '中断本轮' }).click();
  await page.getByRole('button', { name: '任务受阻' }).click();

  await expect(page.getByRole('status')).toContainText('本轮已记录');
  await page.waitForTimeout(5_100);
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.getByRole('button', { name: '统计' }).click();
  const reasons = page.getByRole('heading', { name: '中断原因' }).locator('..');
  await expect(reasons).toContainText('任务受阻');
  await expect(reasons).toContainText('1');
});

test('about page exposes local-first, repository and manual update information', async ({ page }, testInfo) => {
  await page.route('https://api.github.com/repos/Dieight/blockcolc/releases/latest', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
  body: JSON.stringify({ tag_name: `v${currentVersion}`, html_url: `https://github.com/Dieight/blockcolc/releases/tag/v${currentVersion}` }),
  }));
  await page.goto('/');
  await page.getByRole('button', { name: '关于方块钟' }).click();

  const dialog = page.getByRole('dialog', { name: '方块钟 Blockcolc' });
  await expect(dialog).toContainText(`版本 ${currentVersion}`);
  await expect(dialog).toContainText('无账号、无云同步、无后台分析');
  await expect(dialog.getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', /github\.com\/Dieight\/blockcolc/);
  await dialog.getByRole('button', { name: '手动检查更新' }).click();
  await expect(dialog.getByRole('status')).toContainText(`当前已是最新版本 ${currentVersion}`);
  await page.screenshot({ path: testInfo.outputPath('about.png'), fullPage: true });
});

test('planned focus days can be changed and persist locally', async ({ page }, testInfo) => {
  await createDefaultProject(page);
  await page.getByRole('button', { name: '设置' }).click();
  const days = page.getByRole('group', { name: '计划专注日' });
  const monday = days.getByRole('button', { name: '一' });
  const saturday = days.getByRole('button', { name: '六' });
  await expect(monday).toHaveAttribute('aria-pressed', 'true');
  await expect(saturday).toHaveAttribute('aria-pressed', 'false');
  await monday.click();
  await expect(monday).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByRole('group', { name: '计划专注日' }).getByRole('button', { name: '一' })).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: testInfo.outputPath('planned-focus-days.png'), fullPage: true });
});

test('zero-minute break persists and early completion ends without a break', async ({ page }) => {
  await createDefaultProject(page);
  await page.getByRole('button', { name: '设置' }).click();
  const breakMinutes = page.getByLabel('每轮休息分钟');
  await breakMinutes.fill('0');
  await breakMinutes.press('Enter');
  await expect(breakMinutes).toHaveValue('0');

  await page.reload();
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.getByLabel('每轮休息分钟')).toHaveValue('0');
  await page.getByRole('button', { name: '计时' }).click();
  await expect(page.getByRole('button', { name: '调整本次计划' })).toContainText('总计 45 分钟');

  await page.getByRole('button', { name: '开始 1 轮' }).click();
  await page.getByRole('button', { name: '结束本次专注' }).click();
  await page.getByRole('button', { name: /提前完成任务/ }).click();
  await expect(page.getByText('任务已完成 · 休息时间')).toBeHidden();
  await expect(page.getByRole('button', { name: '开始 1 轮' })).toBeVisible();
});

test('finishing the final task shows a skippable completion ceremony', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('大型任务').fill('完成整栋建筑');
  await page.getByRole('button', { name: '清空小任务' }).click();
  await page.getByLabel('新增小任务').fill('交付最终成果');
  await page.getByLabel('新增小任务').press('Enter');
  await page.getByRole('button', { name: '开始建造' }).click();
  await page.getByRole('button', { name: '开始 1 轮' }).click();
  await page.getByRole('button', { name: '结束本次专注' }).click();
  await page.getByRole('button', { name: /提前完成任务/ }).click();

  const ceremony = page.getByRole('dialog', { name: '完成整栋建筑' });
  await expect(ceremony).toContainText('主体建筑完成');
  await expect(ceremony).toHaveCSS('background-color', 'rgb(32, 53, 42)');
  await ceremony.getByRole('button', { name: '回到聚落' }).click();
  await expect(ceremony).toBeHidden();
});

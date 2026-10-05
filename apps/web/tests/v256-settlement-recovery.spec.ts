import { expect, test, type Page } from '@playwright/test';
import { readPersistedDomainState } from './persisted-domain-state';
import { expandGlassSetting } from './expand-glass-setting';

async function revealEnd(page: Page) {
  const button = page.getByRole('button', { name: '结束本次专注', exact: true });
  if (await button.isVisible()) return;
  const target = page.locator('.immersive-hint');
  await target.dblclick();
  await expect(button).toBeVisible();
}

test('v256 standard/immersive transitions animate valid visible frames after a hidden settings visit', async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    const frames: Array<{ transform: string; duration: number }> = [];
    Object.assign(window, { __presentationFrames: frames });
    Element.prototype.animate = function (keyframes, options) {
      if (this.matches('.focus-panel') && Array.isArray(keyframes)) {
        frames.push({ transform: String(keyframes[0]?.transform), duration: typeof options === 'object' ? Number(options?.duration) : Number(options) });
      }
      return animate.call(this, keyframes, options);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-opening-reveal-state', /^(completed|cancelled)$/, { timeout: 20_000 });
  await canvas.evaluate(node => node.setAttribute('data-recovery-identity', 'resident'));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await page.getByRole('button', { name: '开始 1 轮', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-presentation-transition-count', '1');
  // A world gesture may cancel the visual transform without replacing the
  // canvas or leaving a fill-mode transform behind after the transition.
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + 90, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-presentation-transition', 'complete');
  await revealEnd(page);
  await page.getByRole('button', { name: '结束本次专注', exact: true }).click();
  await page.getByRole('button', { name: /中断本轮/ }).click();
  await page.getByRole('button', { name: '不记录', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-presentation-transition-count', '2');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-presentation-transition', 'complete');
  await expect(canvas).toHaveAttribute('data-recovery-identity', 'resident');
  expect(await page.evaluate(() => {
    const frames = (window as typeof window & { __presentationFrames: Array<{ transform: string; duration: number }> }).__presentationFrames;
    return { count: frames.length, valid: frames.every(frame => !/NaN|Infinity|scale/.test(frame.transform) && frame.duration === 340) };
  })).toEqual({ count: 2, valid: true });
  await expect(page.locator('.world-stage')).toHaveCSS('transform', 'none');
});

for (const outcome of ['last-task', 'more-tasks', 'interrupted'] as const) {
test(`v256 theme/glass/focus/${outcome} retains the world and never forces setup`, async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '清空小任务' }).click();
  await page.getByLabel('新增小任务', { exact: true }).fill('完成最后一步');
  await page.getByLabel('新增小任务', { exact: true }).press('Enter');
  if (outcome === 'more-tasks') {
    await page.getByLabel('新增小任务', { exact: true }).fill('保留下一步');
    await page.getByLabel('新增小任务', { exact: true }).press('Enter');
  }
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await expect(page.locator('.world-screen')).toBeVisible();
  const before = await readPersistedDomainState(page);
  const projectId = before.state.activeProjectId!;
  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
  await canvas.evaluate(element => element.setAttribute('data-recovery-identity', 'resident'));
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  const glass = await expandGlassSetting(page);
  await glass.fill('25');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await page.getByRole('button', { name: '开始 1 轮', exact: true }).click();
  await revealEnd(page);
  await page.getByRole('button', { name: '结束本次专注', exact: true }).click();
  if (outcome === 'interrupted') {
    await page.getByRole('button', { name: /中断本轮/ }).click();
    await page.getByRole('button', { name: '不记录', exact: true }).click();
  } else await page.getByRole('button', { name: /提前完成任务/ }).click();
  await expect.poll(() => errors).toEqual([]);
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.locator('.setup')).toHaveCount(0);
  await expect(canvas).toHaveAttribute('data-recovery-identity', 'resident');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-presentation-transition-count', /[2-9]/);
  const after = await readPersistedDomainState(page);
  expect(after.state.projects.find(project => project.id === projectId)?.status).toBe(outcome === 'last-task' ? 'monument' : 'active');
  expect(after.state.focusHistory).toHaveLength(1);
  expect(after.state.progressReports).toHaveLength(outcome === 'interrupted' ? 0 : 1);
  if (outcome === 'last-task') await page.getByRole('button', { name: '回到聚落', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.locator('.setup')).toHaveCount(0);
  await page.getByRole('button', { name: '统计', exact: true }).click();
  await expect(page.getByRole('heading', { name: '专注轨迹', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
}

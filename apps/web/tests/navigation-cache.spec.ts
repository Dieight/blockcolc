import { expect, test, type Page } from '@playwright/test';

async function switchAndPaint(page: Page, label: string): Promise<number> {
  return page.evaluate(async (target) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('.bottom-nav button')]
      .find((candidate) => candidate.textContent?.trim() === target);
    if (!button) throw new Error(`Missing navigation button: ${target}`);
    const started = performance.now();
    button.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return performance.now() - started;
  }, label);
}

test('main pages load together during cold start and remain mounted across warm navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-route-modules', 'ready');
  await expect(page.locator('html')).toHaveAttribute('data-route-modules-ready-ms', /^\d+(?:\.\d+)?$/);

  // Every primary page is already resident before its first visit. Cold start
  // pays this cost once instead of exposing three later loading phases.
  await expect(page.locator('[data-route-mounted="true"]')).toHaveCount(3);

  const canvas = page.getByLabel('项目建筑世界');
  await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
  await canvas.evaluate(element => { element.setAttribute('data-residency-probe', 'preserved'); });
  const generation = await canvas.getAttribute('data-renderer-generation');
  const rebuilds = await canvas.getAttribute('data-world-rebuild-count');
  expect(generation).toBe('1');
  expect(rebuilds).toBe('1');

  await page.getByRole('button', { name: '任务', exact: true }).click();
  const tasks = page.locator('[data-route="tasks"]');
  await expect(tasks).toBeVisible();
  await tasks.evaluate((element) => { element.setAttribute('data-residency-probe', 'preserved'); });

  await page.getByRole('button', { name: '统计', exact: true }).click();
  await expect(page.locator('[data-route="stats"]')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('[data-route="settings"]')).toBeVisible();
  await page.getByRole('button', { name: '计时', exact: true }).click();

  // All pages stay resident but hidden; returning to Tasks must reuse
  // the same DOM node rather than remounting its component and projections.
  await expect(page.locator('[data-route-mounted="true"]')).toHaveCount(3);
  await expect(tasks).toHaveAttribute('data-residency-probe', 'preserved');
  await expect(tasks).toBeHidden();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await expect(tasks).toBeVisible();
  await expect(tasks).toHaveAttribute('data-residency-probe', 'preserved');

  const durations: number[] = [];
  for (const label of ['统计', '设置', '任务', '计时', '统计', '任务']) {
    durations.push(await switchAndPaint(page, label));
  }
  console.log(`TAB_SWITCH_INFO ${JSON.stringify({ durationsMs: durations.map((value) => Number(value.toFixed(1))), maximumMs: Number(Math.max(...durations).toFixed(1)) })}`);
  expect(Math.max(...durations)).toBeLessThan(250);
  await expect(canvas).toHaveAttribute('data-residency-probe', 'preserved');
  await expect(canvas).toHaveAttribute('data-renderer-generation', generation!);
  await expect(canvas).toHaveAttribute('data-world-rebuild-count', rebuilds!);
});

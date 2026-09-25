import { expect, test, type Page } from '@playwright/test';
import { readPersistedDomainState } from './persisted-domain-state';

const LOCAL_BUILDINGS = [
  { id: 'builtin-local-advanced-matchbox-plus', title: 'Dieight的高级火柴盒plus' },
  { id: 'builtin-local-advanced-matchbox-pro', title: 'Dieight的高级火柴盒pro' },
  { id: 'builtin-local-advanced-matchbox', title: 'Dieight的高级火柴盒' },
  { id: 'builtin-local-gkr-mansion', title: 'karry_steven的豪宅' },
  { id: 'builtin-local-gyp-mansion-first-floor', title: 'GYPpro的豪宅（一层）' },
  { id: 'builtin-local-gyp-simple-warehouse', title: 'GYPpro的简易小仓库' },
  { id: 'builtin-local-small-villa', title: 'Dieight的小别墅' },
] as const;

const LOCAL_REWARDS = [
  { id: 'builtin-local-mysterious-enchanting-table', title: 'Dieight的神秘附魔台' },
  { id: 'builtin-local-small-water-tank', title: 'Dieight的小水箱' },
  { id: 'builtin-local-wqh-yellow-duck', title: 'm0m0kA_QWQ的小黄鸭' },
] as const;

async function waitForVoxelTestModule(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const windowWithVoxel = window as typeof window & {
      __blockcolcVoxelTest?: unknown;
    };
    return windowWithVoxel.__blockcolcVoxelTest !== undefined;
  });
}

async function readRewardResources(page: Page): Promise<Array<{ id: string; title: string; importedAt: string }>> {
  const { state } = await readPersistedDomainState(page);
  return state.decorationBlueprintResources.map(resource => ({
    id: resource.id,
    title: resource.blueprint.title,
    importedAt: resource.importedAt,
  }));
}

test.describe('packaged local blueprint catalog', () => {
  test('shows seven building choices, excludes rewards, renders a large preview, and persists its full snapshot', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');

    const options = page.locator('label.blueprint-option');
    await expect(options).toHaveCount(10);
    await expect.poll(async () => options.locator('strong').allTextContents()).toEqual([
      '林边工坊',
      '河岸木屋',
      '村庄礼拜堂',
      ...LOCAL_BUILDINGS.map(entry => entry.title),
    ]);
    for (const reward of LOCAL_REWARDS) {
      await expect(options.filter({ hasText: reward.title })).toHaveCount(0);
    }

    const large = LOCAL_BUILDINGS.find(entry => entry.id === 'builtin-local-gyp-mansion-first-floor')!;
    await options.filter({ hasText: large.title }).click();
    const preview = page.locator(`canvas[data-preview-blueprint-id="${large.id}"]`);
    await expect(preview).toBeVisible();
    await expect.poll(async () => Number(await preview.getAttribute('data-render-calls')), { timeout: 30_000 })
      .toBeGreaterThan(0);

    await page.getByLabel('大型任务').fill('本地补充蓝图保留验证');
    await page.getByRole('button', { name: '开始建造' }).click();
    await expect(page.locator('#world-summary')).toContainText('本地补充蓝图保留验证');

    const { state } = await readPersistedDomainState(page);
    const project = state.projects.find(entry => entry.id === state.activeProjectId);
    expect(project).toBeDefined();
    expect(project?.blueprintId).toBe(large.id);
    expect(project?.importedBlueprint?.id).toBe(large.id);
    expect(project?.importedBlueprint?.title).toBe(large.title);
    expect(project?.importedBlueprint?.voxels.length).toBeGreaterThan(8_000);
    expect(project?.importedBlueprint?.voxels.every(voxel => voxel.stage !== undefined)).toBe(true);

    // The project owns a serialized copy, so it remains renderable when the
    // optional catalog resolver no longer knows this local ID.  The renderer
    // rebuild is triggered by changing an ordinary world preference below;
    // importedRef is the production persistence fallback under test.
    await waitForVoxelTestModule(page);
    await page.evaluate((blueprintId) => {
      const windowWithVoxel = window as typeof window & {
        __blockcolcVoxelTest?: { BUILTIN_BLUEPRINTS?: Map<string, unknown> };
      };
      const catalog = windowWithVoxel.__blockcolcVoxelTest?.BUILTIN_BLUEPRINTS;
      if (!catalog || !catalog.delete(blueprintId)) throw new Error('Expected local blueprint resolver entry');
    }, large.id);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('group', { name: '聚落环境' }).getByRole('button', { name: '经典空岛' }).click();
    await page.getByRole('button', { name: '计时', exact: true }).click();
    const canvas = page.getByLabel('项目建筑世界');
    await expect(canvas).toBeVisible();
    await expect.poll(async () => Number(await canvas.getAttribute('data-world-rebuild-count')), { timeout: 30_000 })
      .toBeGreaterThan(0);
    await expect(page.locator('#world-summary')).toContainText(`${large.title}`);
  });

  test('registers all daily reward blueprints once and keeps them idempotent across reload', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');

    await expect.poll(async () => (await readRewardResources(page)).length, { timeout: 15_000 })
      .toBe(LOCAL_REWARDS.length);
    const first = await readRewardResources(page);
    expect(first).toHaveLength(LOCAL_REWARDS.length);
    expect(first.map(resource => resource.id).sort()).toEqual(LOCAL_REWARDS.map(entry => entry.id).sort());
    expect(first.map(resource => resource.title).sort()).toEqual(LOCAL_REWARDS.map(entry => entry.title).sort());
    expect(new Set(first.map(resource => resource.id)).size).toBe(LOCAL_REWARDS.length);

    await page.reload();
    await expect(page.locator('[data-bootstrap-state="ready"]')).toBeAttached();
    const second = await readRewardResources(page);
    expect(second).toEqual(first);
    expect(new Set(second.map(resource => resource.id)).size).toBe(LOCAL_REWARDS.length);
  });
});

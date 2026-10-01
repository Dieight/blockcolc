import { expect, test, type Page } from '@playwright/test';
import { executeAndReloadPersistedCommand, readPersistedDomainState } from './persisted-domain-state';

async function checkEditAlignment(page: Page, locked: boolean, output: (name: string) => string) {
  await page.getByRole('button', { name: '任务', exact: true }).click();
  for (const width of [320, 412, 780]) {
    await page.setViewportSize({ width, height: 900 });
    const projectEdit = await page.getByRole('button', { name: '修改任务名称', exact: true }).boundingBox();
    const checklist = page.locator('.task-section-heading');
    const checklistEdit = page.getByRole('button', { name: '编辑施工清单', exact: true });
    const headingBox = await checklist.boundingBox();
    const editBox = await checklistEdit.boundingBox();
    expect(projectEdit).not.toBeNull();
    expect(Math.abs(projectEdit!.x + projectEdit!.width - editBox!.x - editBox!.width)).toBeLessThan(1);
    expect(editBox!.y).toBeGreaterThanOrEqual(headingBox!.y);
    expect(editBox!.y + editBox!.height).toBeLessThanOrEqual(headingBox!.y + headingBox!.height + 1);
    expect(editBox!.height).toBeGreaterThanOrEqual(44);
    expect(await checklistEdit.evaluate(element => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element
        || element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    if (locked) {
      const note = page.locator('.task-structure-note');
      await expect(note).toBeVisible();
      expect((await note.boundingBox())!.y).toBeGreaterThanOrEqual(editBox!.y + editBox!.height);
    }
    await page.locator('.task-detail-panel').screenshot({ path: output(`checklist-${locked ? 'locked' : 'unlocked'}-${width}.png`) });
  }
  await page.getByRole('button', { name: '编辑施工清单', exact: true }).click();
  await expect(page.getByRole('button', { name: '结束编辑施工清单', exact: true })).toBeVisible();
  if (locked) await expect(page.getByLabel('新增小任务', { exact: true })).toHaveCount(0);
  else await expect(page.getByLabel('新增小任务', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '结束编辑施工清单', exact: true }).click();
}

test('checklist edit stays aligned with project edit before and after progress locks the structure', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await checkEditAlignment(page, false, name => testInfo.outputPath(name));
  let { state } = await readPersistedDomainState(page);
  const project = state.projects.find(project => project.id === state.activeProjectId)!;
  const subtaskId = project.subtasks[0]!.id;
  const now = Date.now();
  ({ state } = await executeAndReloadPersistedCommand(page, state,
    { type: 'StartFocus', sessionId: 'layout-focus', subtaskId, plannedDurationMs: 60_000 }, now));
  ({ state } = await executeAndReloadPersistedCommand(page, state, { type: 'CompleteFocus' }, now + 60_000));
  await executeAndReloadPersistedCommand(page, state, { type: 'ReportSubtaskProgress', reportId: 'layout-report',
    subtaskId, focusSessionIds: ['layout-focus'], progressBasisPoints: 1000 }, now + 61_000);
  await checkEditAlignment(page, true, name => testInfo.outputPath(name));
});

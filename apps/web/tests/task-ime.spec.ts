import { expect, test, type Locator, type Page } from '@playwright/test';

async function setNativeComposition(field: Locator, value: string) {
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

async function createDefaultProject(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
}

async function openTasks(page: Page) {
  await page.getByRole('button', { name: '任务', exact: true }).click();
}

test('persists mixed Chinese composition from new-project subtask rows exactly', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '清空小任务' }).click();
  const add = page.getByLabel('新增小任务');
  await add.fill('占位一');
  await add.press('Enter');
  await add.fill('占位二');
  await add.press('Enter');

  await setNativeComposition(page.getByLabel('小任务 1'), '中文English中文');
  await setNativeComposition(page.getByLabel('小任务 2'), '中文 空格后中文');
  await page.getByRole('button', { name: '开始建造' }).click();

  await openTasks(page);
  await page.getByRole('button', { name: '编辑施工清单' }).click();
  await expect(page.locator('.task-editor-row strong')).toHaveText(['中文English中文', '中文 空格后中文']);
  await page.reload();
  await openTasks(page);
  await page.getByRole('button', { name: '编辑施工清单' }).click();
  await expect(page.locator('.task-editor-row strong')).toHaveText(['中文English中文', '中文 空格后中文']);
});

test('commits native Chinese composition when adding and renaming tasks', async ({ page }) => {
  await createDefaultProject(page);
  await openTasks(page);

  await page.getByRole('button', { name: '修改任务名称' }).click();
  let projectTitle = page.getByRole('textbox', { name: '任务名称', exact: true });
  await setNativeComposition(projectTitle, '英文改成中文');
  await expect(page.getByRole('button', { name: '保存任务名称' })).toBeEnabled();
  await page.getByRole('button', { name: '保存任务名称' }).click();
  await expect(page.getByRole('heading', { name: '英文改成中文' })).toBeVisible();

  await page.getByRole('button', { name: '修改任务名称' }).click();
  projectTitle = page.getByRole('textbox', { name: '任务名称', exact: true });
  await setNativeComposition(projectTitle, '英文改成中文追加中文');
  await page.getByRole('button', { name: '保存任务名称' }).click();
  await expect(page.getByRole('heading', { name: '英文改成中文追加中文' })).toBeVisible();

  await page.getByRole('button', { name: '编辑施工清单' }).click();
  const add = page.getByLabel('新增小任务');
  await setNativeComposition(add, '新增中文小任务');
  await expect(page.getByRole('button', { name: '添加' })).toBeEnabled();
  await page.getByRole('button', { name: '添加' }).click();
  await expect(page.locator('.task-editor-row strong')).toContainText(['新增中文小任务']);

  await page.locator('.task-editor-row').filter({ hasText: '确定目标' }).dblclick();
  const subtaskTitle = page.getByRole('textbox', { name: '小任务名称', exact: true });
  await setNativeComposition(subtaskTitle, '确定目标追加中文');
  await page.getByRole('button', { name: '保存小任务名称' }).click();
  await expect(page.locator('.task-editor-row strong')).toContainText(['确定目标追加中文']);

  await page.reload();
  await openTasks(page);
  await expect(page.getByRole('heading', { name: '英文改成中文追加中文' })).toBeVisible();
  await page.getByRole('button', { name: '编辑施工清单' }).click();
  await expect(page.locator('.task-editor-row strong')).toContainText(['确定目标追加中文', '新增中文小任务']);
});

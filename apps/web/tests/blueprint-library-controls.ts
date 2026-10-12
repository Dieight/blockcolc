import { expect, type Page } from '@playwright/test';

/** Follow the shared catalogue's actual disclosure, not the retired import card. */
export async function openBlueprintLibrary(page: Page) {
  const library = page.locator('.blueprint-library');
  const toggle = library.getByRole('button', { name: /所有图纸/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(library.locator('.library-toolbar')).toBeVisible();
  return library;
}

export async function openImportedBlueprints(page: Page) {
  const library = await openBlueprintLibrary(page);
  const group = library.locator('details').filter({ has: page.locator('summary', { hasText: '自添加图纸' }) });
  if (await group.getAttribute('open') === null) await group.locator('summary').click();
  return group;
}

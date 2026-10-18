import { expect, type Page } from '@playwright/test';

/** Open the actual secondary row before interacting with its contents. */
export async function openSecondarySetting(page:Page,title:string){
  const toggle=page.locator('.settings-page').getByRole('button',{name:new RegExp(`^${title}`)});
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded','true');
}

export async function openBackupActions(page:Page){
  await openSecondarySetting(page,'本地备份');
  const actions=page.locator('.backup-manual');
  if(await actions.getAttribute('data-expanded')!=='true')await actions.locator('summary').click();
  await expect(actions.locator('summary')).toHaveAttribute('aria-expanded','true');
}

export async function openRollbackBackups(page:Page){
  await openSecondarySetting(page,'本地备份');
  const history=page.locator('.backup-rollback-history');
  if(await history.getAttribute('data-expanded')!=='true')await history.locator('summary').click();
  await expect(history.locator('summary')).toHaveAttribute('aria-expanded','true');
}

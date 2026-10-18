import {expect,type Page} from '@playwright/test';

export async function openTaskEditor(page:Page){
  const edit=page.getByRole('button',{name:'编辑施工清单',exact:true});
  await expect(edit.or(page.getByRole('button',{name:'结束编辑施工清单',exact:true}))).toBeVisible();
  if(await edit.isVisible())await edit.click();
  await expect(page.getByRole('button',{name:'结束编辑施工清单',exact:true})).toBeVisible();
}

/** Follow the real other-task portfolio instead of the retired task menu. */
export async function switchTaskProject(page:Page,title:string|RegExp){
  const portfolio=page.locator('.project-portfolio'),toggle=portfolio.locator('.project-portfolio-toggle');
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
  const row=portfolio.locator('.project-portfolio-row').filter({has:page.locator('strong',{hasText:title})});
  await row.getByRole('button',{name:'切换',exact:true}).click();
  await expect(page.locator('.task-project-title h2')).toHaveText(title);
}

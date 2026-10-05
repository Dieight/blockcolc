import { expect,test,type Page } from '@playwright/test';
import { createInitialState,execute } from '@blockcolc/domain';
import { fixBusinessDate } from './fixed-business-date';
import { readPersistedDomainState,executeAndReloadPersistedCommand } from './persisted-domain-state';
import { waitForPreparedWorld } from './world-ready';

async function seed(page:Page){
 await fixBusinessDate(page,new Date('2026-12-25T08:00:00Z'));await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state','ready');
 let state=createInitialState('Asia/Shanghai');const created=execute(state,{type:'CreateProject',projectId:'p',title:'雪夜工作坊',blueprintId:'builtin-small-workshop',subtasks:[{id:'s',title:'铺设木地板'}]},{now:()=>new Date('2026-12-23T08:00:00Z')});if(!created.ok)throw Error(created.message);state=created.state;
 await page.evaluate(async(state)=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('blockcolc-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});await new Promise<void>((resolve,reject)=>{const t=db.transaction('appState','readwrite'),s=t.objectStore('appState'),r=s.get('current');r.onsuccess=()=>s.put({id:'current',revision:(r.result?.revision??0)+1,state:{...state,decorationBlueprintResources:r.result?.state?.decorationBlueprintResources??[]}});t.oncomplete=()=>resolve();t.onabort=()=>reject(t.error);});db.close();localStorage.setItem('blockcolc-first-project-setup-v1','1');localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({themeMode:'light',minimalMode:false,focusGlassTransparency:100}));},state);
 await page.reload();await expect(page.locator('.world-screen')).toBeVisible();return state;
}
test('three festival slots have original pixel emblems, adjacent intro, keyboard/outside dismissal and no heatmap gesture collision',async({page},info)=>{
 test.setTimeout(90_000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await seed(page);await waitForPreparedWorld(page);
 const timer=page.getByRole('button',{name:'圣诞节 · 常青树',exact:true});await expect(timer).toBeVisible();const b=(await timer.boundingBox())!;expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);
 await timer.press('Enter');await expect(page.getByRole('dialog',{name:'圣诞节介绍'})).toBeVisible();await page.screenshot({path:info.outputPath('holiday-timer-intro.png')});await page.keyboard.press('Escape');await expect(page.locator('.holiday-intro')).toHaveCount(0);await expect(timer).toBeFocused();
 await page.getByRole('button',{name:'任务',exact:true}).click();const task=page.getByRole('button',{name:'圣诞节 · 礼盒',exact:true});await expect(task).toBeVisible();await expect(task.locator('svg')).toHaveCSS('width','64px');await task.press('Space');await expect(page.locator('.holiday-intro')).toBeVisible();await page.getByRole('heading',{name:'今日目标',exact:true}).click();await expect(page.locator('.holiday-intro')).toHaveCount(0);
 await page.getByRole('button',{name:'统计',exact:true}).click();const stats=page.getByRole('button',{name:'圣诞节 · 铃铛',exact:true});await expect(stats).toBeVisible();const label=(await page.locator('.stats-duration>span').boundingBox())!,emblem=(await stats.locator('svg').boundingBox())!;expect(Math.abs(label.y+label.height/2-emblem.y-emblem.height/2)).toBeLessThan(2);await stats.click();await page.screenshot({path:info.outputPath('holiday-statistics-light.png')});await page.getByRole('button',{name:'关闭节日介绍'}).click();
 const grid=page.getByRole('grid');await grid.focus();await grid.press('ArrowLeft');expect(await grid.getAttribute('aria-activedescendant')).toContain('2026-12-18');await stats.click();await page.keyboard.press('Escape');expect(await grid.getAttribute('aria-activedescendant')).toContain('2026-12-18');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'深色',exact:true}).click();await page.getByRole('button',{name:'统计',exact:true}).click();await stats.click();await expect(page.locator('.holiday-intro')).toBeVisible();await page.screenshot({path:info.outputPath('holiday-statistics-dark.png')});expect(errors).toEqual([]);
});
test('startup daily history is deduplicated, exports complete state, restores with an independent undo point',async({page},info)=>{
 test.setTimeout(120_000);await seed(page);await page.getByRole('button',{name:'设置',exact:true}).click();const history=page.locator('.daily-backup-history');await history.locator('summary').click();
 await expect(history).toContainText('2026-12-24',{timeout:20_000});await expect(history.locator('li')).toHaveCount(1);await expect(history).toContainText('仅保留一份');await expect(history).toContainText('200 MiB');
 const before=await readPersistedDomainState(page);const [download]=await Promise.all([page.waitForEvent('download'),history.getByRole('button',{name:'导出',exact:true}).click()]);expect(download.suggestedFilename()).toBe('blockcolc-daily-2026-12-24.json');await download.saveAs(info.outputPath('daily-complete.json'));
 await executeAndReloadPersistedCommand(page,before.state,{type:'RenameProject',title:'留档之后的修改'},Date.parse('2026-12-25T08:00:00Z'));await page.getByRole('button',{name:'设置',exact:true}).click();await history.locator('summary').click();await expect(history.locator('li')).toHaveCount(1);
 await history.getByRole('button',{name:'恢复留档',exact:true}).click();const dialog=page.getByRole('alertdialog',{name:'恢复 2026-12-24 留档？'});await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);expect((await readPersistedDomainState(page)).state.projects[0]!.title).toBe('留档之后的修改');
 await history.getByRole('button',{name:'恢复留档',exact:true}).click();await dialog.getByRole('button',{name:'恢复留档',exact:true}).click();await expect(page.locator('.backup-panel .backup-notice')).toContainText('留档已恢复');expect((await readPersistedDomainState(page)).state.projects[0]!.title).toBe('雪夜工作坊');
 await expect(page.locator('.rollback-list')).toContainText('恢复前备份');await page.locator('.rollback-list').getByRole('button',{name:'恢复',exact:true}).first().click();await page.getByRole('alertdialog').getByRole('button',{name:'恢复备份',exact:true}).click();await expect(page.locator('.backup-panel .backup-notice')).toContainText('已恢复备份');expect((await readPersistedDomainState(page)).state.projects[0]!.title).toBe('留档之后的修改');await page.screenshot({path:info.outputPath('daily-restored-and-undone.png')});
});
test('a real holiday focus saves one construction and reloading never duplicates it',async({page})=>{
 test.setTimeout(90_000);await seed(page);await page.getByRole('button',{name:'开始 1 轮',exact:true}).click();await page.locator('.immersive-hint').dblclick();await page.getByRole('button',{name:'结束本次专注',exact:true}).click();await page.getByRole('button',{name:/^提前完成任务/}).click();
 await expect.poll(async()=>(await readPersistedDomainState(page)).state.holidayRewards.length).toBe(1);const fact=(await readPersistedDomainState(page)).state.holidayRewards[0]!;expect(fact).toMatchObject({holidayId:'christmas',year:2026});await page.reload();expect((await readPersistedDomainState(page)).state.holidayRewards).toEqual([fact]);await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-imported-decoration-count',/[1-9]/,{timeout:25_000});
});

test('daily rewards preserve cached terrain, focus around their own pivot, and show a compact acquisition memory',async({page},info)=>{
 test.setTimeout(120_000);await seed(page);
 const before=await readPersistedDomainState(page);
 await executeAndReloadPersistedCommand(page,before.state,{type:'SetDailyGoal',date:'2026-12-25',targetPomodoros:1},Date.parse('2026-12-25T08:00:00Z'));
 await page.evaluate(()=>{const p=JSON.parse(localStorage.getItem('blockcolc-focus-preferences-v1')!);localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({...p,focusMinutes:1,breakMinutes:0,lightingQuality:'performance'}));});
 await page.reload();const canvas=page.getByLabel('项目建筑世界');await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','true');
 const terrain=await canvas.evaluate(element=>({cells:element.dataset.terrainCellCount,key:element.dataset.terrainGenerationCacheKey}));
 await page.getByRole('button',{name:'开始 1 轮',exact:true}).click();
 await page.clock.setFixedTime(new Date('2026-12-25T08:01:05Z'));
 await expect(page.locator('.focus-report-surface')).toBeVisible({timeout:15_000});
 await page.getByRole('button',{name:'保持 0%',exact:true}).click();await expect(page.locator('.focus-report-surface')).toHaveCount(0);
 const saved=(await readPersistedDomainState(page)).state;expect(saved.decorationRewards).toHaveLength(1);
 await expect(canvas).toHaveAttribute('data-terrain-generation-cache-retained','true');await expect(canvas).toHaveAttribute('data-terrain-mesh-cache-hit','true');
 expect(await canvas.evaluate(element=>({cells:element.dataset.terrainCellCount,key:element.dataset.terrainGenerationCacheKey}))).toEqual(terrain);
 const support=JSON.parse((await canvas.getAttribute('data-reward-ground-support'))!) as {id:string;x:number;y:number;z:number}[];
 expect(support).toHaveLength(2);
 const reward=saved.decorationRewards[0]!,key=`${reward.date}:${reward.resourceId}`,position=support.find(p=>p.id===key)!;
 const link=page.getByRole('navigation',{name:'聚落建筑'}).getByRole('button',{name:/查看奖励记忆/}).last();
 await link.focus();await link.press('Enter');
 const memory=page.getByLabel('每日奖励记忆');await expect(memory).toBeVisible();await expect(memory).toContainText('2026.12.25');
 expect(Number(await canvas.getAttribute('data-camera-target-x'))).toBeCloseTo(position.x,2);
 expect(Number(await canvas.getAttribute('data-camera-target-z'))).toBeCloseTo(position.z,2);
 const panel=(await memory.boundingBox())!;expect(panel.height).toBeLessThan(150);
 await link.evaluate(element=>(element as HTMLButtonElement).blur());
 const cameraBefore=await canvas.getAttribute('data-camera-azimuth'),box=(await canvas.boundingBox())!;
 await page.mouse.move(box.x+box.width*.3,box.y+box.height*.3);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.3,{steps:8});await page.mouse.up();
 await expect(canvas).not.toHaveAttribute('data-camera-azimuth',cameraBefore!);
 expect(Number(await canvas.getAttribute('data-camera-target-x'))).toBeCloseTo(position.x,2);
 await page.screenshot({path:info.outputPath('daily-reward-compact-memory.png')});
 await page.getByRole('button',{name:'关闭奖励记忆'}).click();await expect(memory).toHaveCount(0);
 expect(Number(await canvas.getAttribute('data-camera-target-z'))).toBeCloseTo(position.z,2);
 await page.getByRole('button',{name:'重置地图',exact:true}).click();await expect(page.getByLabel('聚落建筑')).toBeAttached();
});

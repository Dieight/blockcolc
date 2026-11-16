import {test,expect,type Page} from '@playwright/test';
import {createInitialState,execute,type DomainState} from '@blockcolc/domain';
import {fixBusinessDate} from './fixed-business-date';
import {readPersistedDomainState} from './persisted-domain-state';
import {waitForPreparedWorld} from './world-ready';

async function publishFixture(page:Page,state:DomainState){
 await page.evaluate(async state=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const open=indexedDB.open('blockcolc-v1');open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('appState','readwrite'),store=tx.objectStore('appState'),get=store.get('current');get.onsuccess=()=>store.put({id:'current',revision:(get.result?.revision??0)+1,state});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
  localStorage.setItem('blockcolc-first-project-setup-v1','1');localStorage.setItem('blockcolc-tutorial-v1','1');localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({focusMinutes:1,breakMinutes:0,minimalMode:false,lightingQuality:'performance',themeMode:'light'}));
 },state);
 await page.reload();await waitForPreparedWorld(page);
}

test('birthday entry grants without focus; reload does not replay; debug confetti never grants',async({page},info)=>{
 test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await fixBusinessDate(page,new Date('2026-10-18T04:00:00Z'));await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state','ready');
 const configured=createInitialState('Asia/Shanghai');configured.birthday={enabled:true,month:10,day:18};
 const created=execute(configured,{type:'CreateProject',projectId:'birthday-project',title:'生日工坊',blueprintId:'builtin-small-workshop',subtasks:[{id:'task',title:'尚未专注'}]},{now:()=>new Date('2026-10-17T04:00:00Z')});if(!created.ok)throw Error(created.message);
 await publishFixture(page,created.state);
 await expect(page.locator('canvas[data-world-canvas="true"]')).toHaveAttribute('data-reward-ground-support',/birthday:2026/);
 await expect.poll(async()=>((await readPersistedDomainState(page)).state.birthdayRewards??[]).length).toBe(1);
 await expect(page.getByRole('button',{name:'生日快乐 · 生日蛋糕',exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath('birthday-entry.png')});
 const saved=(await readPersistedDomainState(page)).state;expect(saved.focusHistory).toEqual([]);
 await page.reload();await waitForPreparedWorld(page);await expect(page.locator('[data-celebration="birthday"]')).toHaveCount(0);
 expect((await readPersistedDomainState(page)).state.birthdayRewards).toEqual(saved.birthdayRewards);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('checkbox',{name:'临时调试世界',exact:true}).check();
 await page.getByRole('button',{name:'播放落成彩纸',exact:true}).click();await expect(page.locator('[data-celebration="preview"]')).toBeVisible();
 expect((await readPersistedDomainState(page)).state.birthdayRewards).toEqual(saved.birthdayRewards);
 await page.getByRole('button',{name:'生日祝福',exact:true}).click();
 await page.getByRole('checkbox',{name:'生日祝福',exact:true}).uncheck();
 await expect.poll(async()=>(await readPersistedDomainState(page)).state.birthday.enabled).toBe(false);
 expect((await readPersistedDomainState(page)).state.birthdayRewards).toEqual(saved.birthdayRewards);
 expect(errors).toEqual([]);
});

test('same-day birthday and festival keep separate emblems and reward rules in both timer layouts',async({page},info)=>{
 test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.clock.setFixedTime(new Date('2026-12-25T04:00:00Z'));await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state','ready');
 const configured=createInitialState('Asia/Shanghai');configured.birthday={enabled:true,month:12,day:25};
 const created=execute(configured,{type:'CreateProject',projectId:'coexist',title:'冬日工坊',blueprintId:'builtin-small-workshop',subtasks:[{id:'s',title:'完成今日施工'}]},{now:()=>new Date('2026-12-24T04:00:00Z')});if(!created.ok)throw Error(created.message);
 await publishFixture(page,created.state);
 const cake=page.getByRole('button',{name:'生日快乐 · 生日蛋糕',exact:true}),festival=page.getByRole('button',{name:'圣诞节 · 常青树',exact:true});
 const adjacent=async()=>{
  await expect(cake).toBeVisible();await expect(festival).toBeVisible();const a=(await festival.boundingBox())!,b=(await cake.boundingBox())!;
  expect(a.width).toBeGreaterThanOrEqual(44);expect(b.width).toBeGreaterThanOrEqual(44);expect(b.x).toBeGreaterThanOrEqual(a.x+a.width);expect(b.x+b.width).toBeLessThanOrEqual((await page.viewportSize())!.width);
  expect(Math.abs(a.y-b.y)).toBeLessThan(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 };
 for(const viewport of [{width:360,height:800},{width:412,height:915},{width:915,height:412},{width:768,height:1024},{width:1440,height:900}]){await page.setViewportSize(viewport);await adjacent();}
 await page.setViewportSize({width:412,height:915});await festival.click();await expect(page.getByRole('dialog',{name:'圣诞节介绍',exact:true})).toBeVisible();
 await cake.click();await expect(page.getByRole('dialog',{name:'生日快乐介绍',exact:true})).toBeVisible();await expect(page.locator('.holiday-intro')).toHaveCount(1);await page.keyboard.press('Escape');
 let saved=(await readPersistedDomainState(page)).state;expect(saved.birthdayRewards).toHaveLength(1);expect(saved.holidayRewards).toEqual([]);expect(saved.focusHistory).toEqual([]);
 await page.getByRole('button',{name:'开始 1 轮',exact:true}).click();await page.clock.setFixedTime(new Date('2026-12-25T04:01:05Z'));
 await expect.poll(async()=>(await readPersistedDomainState(page)).state.holidayRewards.length,{timeout:20000}).toBe(1);
 saved=(await readPersistedDomainState(page)).state;expect(saved.birthdayRewards).toHaveLength(1);expect(saved.holidayRewards[0]).toMatchObject({holidayId:'christmas',year:2026});
 const canvas=page.locator('canvas[data-world-canvas="true"]');await expect(canvas).toHaveAttribute('data-reward-ground-support',/holiday:christmas:2026/);await expect(canvas).toHaveAttribute('data-reward-ground-support',/birthday:2026/);
 const support=JSON.parse((await canvas.getAttribute('data-reward-ground-support'))!) as {id:string;x:number;z:number}[];
 const birthday=support.find(reward=>reward.id==='birthday:2026')!,holiday=support.find(reward=>reward.id==='holiday:christmas:2026')!;
 expect(Math.hypot(birthday.x-holiday.x,birthday.z-holiday.z)).toBeGreaterThan(10);
 await page.reload();await waitForPreparedWorld(page);expect((await readPersistedDomainState(page)).state.birthdayRewards).toEqual(saved.birthdayRewards);expect((await readPersistedDomainState(page)).state.holidayRewards).toEqual(saved.holidayRewards);
 // Replay only presentation preferences, retaining the same durable facts.
 await page.evaluate(()=>{const prefs=JSON.parse(localStorage.getItem('blockcolc-focus-preferences-v1')!);localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({...prefs,minimalMode:true}));});
 await page.reload();await waitForPreparedWorld(page);
 // A pending report intentionally hides idle emblems; settle it before checking the idle layout.
 if(await page.getByRole('button',{name:'保持 0%',exact:true}).isVisible())await page.getByRole('button',{name:'保持 0%',exact:true}).click();
 await expect(page.locator('.holiday-panel-slot>.holiday-emblem-group')).toBeVisible();await adjacent();
 await page.screenshot({path:info.outputPath('birthday-and-festival-minimal.png')});expect(errors).toEqual([]);
});

test('birthday settings are off by default, validate the date and retain translated readable controls',async({page},info)=>{
 test.setTimeout(150000);
 await fixBusinessDate(page,new Date('2026-01-01T04:00:00Z'));
 await page.addInitScript(()=>localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({focusMinutes:45,breakMinutes:5,language:'en',lightingQuality:'performance',themeMode:'system'})));
 await page.emulateMedia({reducedMotion:'reduce',colorScheme:'light'});
 await page.goto('/');await expect(page.locator('html')).toHaveAttribute('lang','en');await page.getByRole('button',{name:'Start building',exact:true}).click();
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 const toggle=page.getByRole('checkbox',{name:'Birthday wishes',exact:true});await expect(toggle).not.toBeChecked();await toggle.check();
 await expect(page.getByText('Save the date to enable',{exact:true})).toBeVisible();
 expect((await readPersistedDomainState(page)).state.birthday.enabled).toBe(false);
 const month=page.getByRole('spinbutton',{name:'Birthday month',exact:true}),day=page.getByRole('spinbutton',{name:'Birthday day',exact:true});
 await month.fill('2');await month.blur();await day.fill('30');await day.blur();await page.getByRole('button',{name:'Save date',exact:true}).click();
 await expect(page.getByText('Please check the birthday date.',{exact:true})).toBeVisible();
 expect((await readPersistedDomainState(page)).state.birthday).toEqual({enabled:false,month:1,day:1});
 await day.fill('29');await day.blur();await page.getByRole('button',{name:'Save date',exact:true}).click();
 await expect.poll(async()=>(await readPersistedDomainState(page)).state.birthday).toEqual({enabled:true,month:2,day:29});
 for(const colorScheme of ['light','dark'] as const){
  await page.emulateMedia({colorScheme});
  for(const viewport of [{width:360,height:800},{width:412,height:915},{width:915,height:412},{width:768,height:1024},{width:1440,height:900}]){
   await page.setViewportSize(viewport);await month.scrollIntoViewIfNeeded();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   const bounds=await month.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width);
  }
  await page.setViewportSize({width:412,height:915});await page.locator('.birthday-setting').screenshot({path:info.outputPath(`birthday-settings-${colorScheme}.png`)});
 }
 expect((await readPersistedDomainState(page)).state.birthdayRewards).toEqual([]);
});

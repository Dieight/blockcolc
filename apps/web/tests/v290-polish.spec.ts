import { expect, test, type Page } from '@playwright/test';
import { execute } from '@blockcolc/domain';
import { readPersistedDomainState, executeAndReloadPersistedCommand } from './persisted-domain-state';
import { waitForPreparedWorld } from './world-ready';
import { openSecondarySetting } from './settings-controls';

async function setup(page:Page){
  await page.addInitScript(()=>{
    localStorage.setItem('blockcolc-tutorial-v1','1');
    if(!localStorage.getItem('blockcolc-focus-preferences-v1'))localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({lightingQuality:'performance',themeMode:'light',focusMinutes:25,breakMinutes:5}));
  });
  await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();await waitForPreparedWorld(page);
}

for(const progressive of [false,true])test(`route preparation follows the startup policy, progressive=${progressive}`,async({page})=>{
  test.setTimeout(120_000);await setup(page);
  await page.evaluate(progressive=>{
    const key='blockcolc-focus-preferences-v1';localStorage.setItem(key,JSON.stringify({...JSON.parse(localStorage.getItem(key)!),progressiveStartup:progressive}));
  },progressive);
  await page.addInitScript(()=>{
    const wait=WebGL2RenderingContext.prototype.clientWaitSync;let released=false;
    WebGL2RenderingContext.prototype.clientWaitSync=function(sync,flags,timeout){return released?wait.call(this,sync,flags,timeout):this.TIMEOUT_EXPIRED;};
    Object.assign(window,{releaseColdWorld:()=>{released=true;}});
  });
  const screenRequests=new Set<string>();
  page.on('request',request=>{const match=/\/src\/(TaskManagement|StatsScreen|SettingsScreen)\.tsx/.exec(request.url());if(match)screenRequests.add(match[1]!);});
  await page.reload();
  try{
    await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','false');
    await expect.poll(()=>page.locator('.boot-page:visible').count()).toBeGreaterThan(0);
    // The held GPU fence makes the two policies observable before world readiness.
    if(progressive){await page.waitForTimeout(1800);await expect(page.locator('[data-route-mounted="true"]')).toHaveCount(0);}
    else await expect(page.locator('[data-route-mounted="true"]')).toHaveCount(3);
    const loading=await page.evaluate(()=>({cold:document.documentElement.dataset.coldStartup,world:document.querySelector('.world-screen')?.getAttribute('data-world-ready'),resources:performance.getEntriesByType('resource').filter(entry=>/\/src\/(TaskManagement|StatsScreen|SettingsScreen)\.tsx/.test(entry.name)).map(entry=>entry.toJSON())}));
    if(progressive)expect(loading.resources,JSON.stringify(loading)).toEqual([]);
    // Request events are not truncated by the browser's resource-timing buffer.
    // Optimized test builds use hashed chunks; the three actual mounted pages
    // above remain the cross-build assertion while the GPU fence is held.
    else if(screenRequests.size)expect([...screenRequests].sort()).toEqual(['SettingsScreen','StatsScreen','TaskManagement']);
  }finally{await page.evaluate(()=>(window as unknown as {releaseColdWorld:()=>void}).releaseColdWorld());}
  await waitForPreparedWorld(page);
  // Progressive preparation intentionally yields to animated software WebGL.
  // Visiting the task route pauses that world and provides a real quiet slot;
  // it must remain immediately usable, not wait for background prefetch.
  await page.getByRole('button',{name:'任务',exact:true}).click();await expect(page.locator('[data-route="tasks"]')).toBeVisible();
  await expect(page.locator('[data-route-mounted="true"]')).toHaveCount(3,{timeout:40_000});
});

test('settings keep peer levels and compact addon summaries across themes and languages',async({page},info)=>{
  test.setTimeout(150_000);await setup(page);await page.getByRole('button',{name:'设置',exact:true}).click();
  const settings=page.locator('.settings-page'),timing=page.locator('[aria-labelledby="settings-group-timing"]');
  await expect(settings.getByRole('spinbutton',{name:'普通任务专注分钟',exact:true})).toBeHidden();
  await expect(timing.getByRole('button',{name:'普通任务',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(settings.locator('[aria-labelledby="settings-group-advanced"] .settings-list>.setting-row').first()).toContainText('新手教程');
  await expect(settings.locator('.weather-setting-status')).toHaveText('本地天气与日月');
  await expect(timing.locator('.settings-list>.settings-disclosure>.settings-disclosure-toggle')).toHaveText([/普通任务/,/习惯任务/,/保护规则与计划日/,/提醒/]);
  await expect(page.locator('[aria-labelledby="settings-group-addons"] .settings-list .settings-list')).toHaveCount(0);
  await expect(page.locator('[aria-labelledby="settings-group-addons"] .settings-list>.setting-row .setting-name>span')).toHaveText(['简易便签']);
  await expect(page.locator('[aria-labelledby="settings-group-addons"] .settings-list>.settings-disclosure>.settings-disclosure-toggle')).toHaveText([/白噪音/,/生日祝福/]);
  await expect(settings.getByRole('checkbox',{name:'自然白噪音',exact:true})).toBeHidden();
  await openSecondarySetting(page,'白噪音');await settings.getByRole('checkbox',{name:'自然白噪音',exact:true}).check();
  await settings.getByRole('radio',{name:'清晨林中鸟鸣',exact:true}).check();
  await expect(settings.getByRole('radio')).toHaveCount(2);
  for(const name of ['晨间鸟鸣','平静海浪'])await expect(settings.getByRole('radio',{name,exact:true})).toHaveCount(0);
  for(const name of ['贴岸小浪','清晨林中鸟鸣']){
    const radio=settings.getByRole('radio',{name,exact:true});await radio.check();
    await expect(radio).toHaveCSS('outline-style','none');
    await expect(radio).toHaveCSS('width','16px');
  }
  await openSecondarySetting(page,'生日祝福');await settings.getByRole('checkbox',{name:'生日祝福',exact:true}).check();
  await settings.getByRole('spinbutton',{name:'生日月份',exact:true}).fill('6');await settings.getByRole('spinbutton',{name:'生日月份',exact:true}).press('Enter');
  await settings.getByRole('spinbutton',{name:'生日日期',exact:true}).fill('18');await settings.getByRole('spinbutton',{name:'生日日期',exact:true}).press('Enter');
  await settings.getByRole('button',{name:'保存日期',exact:true}).click();
  await expect.poll(async()=>(await readPersistedDomainState(page)).state.birthday).toEqual({enabled:true,month:6,day:18});
  await openSecondarySetting(page,'习惯任务');
  for(const theme of ['dark','light'] as const){
    await page.getByRole('group',{name:'深色模式',exact:true}).getByRole('button',{name:theme==='dark'?'深色':'浅色',exact:true}).click();
    const radio=settings.getByRole('radio',{name:'清晨林中鸟鸣',exact:true});
    expect(await radio.evaluate(element=>{const style=getComputedStyle(element);const name=getComputedStyle(element.closest('.setting-row')!.querySelector('.setting-name')!);return style.borderColor===name.color;})).toBe(true);
    for(const width of [360,412,768,1024,1440]){
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({width:412,height:915});
    await page.getByRole('heading',{name:'附加功能',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath(`settings-addons-${theme}.png`)});
  }
  await page.getByRole('group',{name:'界面语言',exact:true}).getByRole('button',{name:'English',exact:true}).click();
  await expect(settings.getByRole('button',{name:'Regular tasks',exact:true})).toBeVisible();
  await expect(settings.getByRole('button',{name:'Birthday wishes',exact:true})).toHaveText(/6 \/ 18/);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  await page.setViewportSize({width:360,height:800});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('heading',{name:'Extras',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath('settings-english-large-text.png')});
});

test('long task catalogs reverse disclosure cleanly and keep the chosen task in its draft until confirmation',async({page},info)=>{
  test.setTimeout(150_000);await setup(page);
  let {state}=await readPersistedDomainState(page);const current=state.activeProjectId!;
  const result=execute(state,{type:'CreateProject',projectId:'long-polish',title:'长期施工计划',blueprintId:'builtin-small-workshop',subtasks:Array.from({length:80},(_,i)=>({id:`long-${i}`,title:`施工阶段 ${i+1}：核对与建造`}))},{now:()=>new Date()});
  if(!result.ok)throw Error(result.message);state=result.state;
  const habitResult=execute(state,{type:'CreateHabitProject',projectId:'polish-habit',title:'阅读习惯',blueprintId:'builtin-small-workshop',targetRounds:10},{now:()=>new Date()});
  if(!habitResult.ok)throw Error(habitResult.message);state=habitResult.state;
  await executeAndReloadPersistedCommand(page,state,{type:'SwitchActiveProject',projectId:current},Date.now());await waitForPreparedWorld(page);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'安排下一轮',exact:true}),project=sheet.locator('.focus-task-project').filter({hasText:'长期施工计划'}),summary=project.locator('summary');
  await summary.click();await expect(summary).toHaveAttribute('aria-expanded','true');
  await expect(project.locator('[data-motion="measured"]')).toHaveCSS('display','block');
  // Rapid reversals must not strand an animation, hide an open list or move focus into a closed list.
  await summary.evaluate(element=>{for(let i=0;i<4;i++)(element as HTMLElement).click();});
  await expect(project.getByRole('button',{name:/施工阶段 1：/})).toBeVisible();
  await expect.poll(()=>project.locator('.content-reveal').evaluate(element=>element.getAnimations().length)).toBe(0);
  const chosen=project.getByRole('button',{name:/施工阶段 80：/});await chosen.click();await expect(chosen).toHaveAttribute('aria-pressed','true');
  await expect(chosen.locator(':scope>svg[data-pixel-icon="check"]')).toHaveCount(1);
  await expect(chosen.locator('.focus-task-choice-mark')).toHaveCount(0);
  await expect(chosen).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  expect((await readPersistedDomainState(page)).state.activeProjectId).toBe(current);
  await page.screenshot({path:info.outputPath('task-choice-selected.png')});
  await sheet.getByRole('button',{name:'确认计划',exact:true}).click();
  await expect(page.locator('.workbench-context strong')).toHaveText('施工阶段 80：核对与建造');
  expect((await readPersistedDomainState(page)).state.activeProjectId).toBe('long-polish');
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});
  const first=page.locator('.focus-task-project').filter({hasText:'长期施工计划'});await first.locator('summary').focus();await page.keyboard.press('Enter');
  await expect(first.locator('summary')).toHaveAttribute('aria-expanded','false');await page.keyboard.press('Enter');
  await expect(first.getByRole('button',{name:/施工阶段 80：/})).toBeVisible();expect(errors).toEqual([]);
  const habit=page.getByRole('button',{name:/阅读习惯 每座 10 轮/});await habit.click();
  await expect(habit).toHaveAttribute('aria-pressed','true');
  await expect(habit.locator(':scope>svg[data-pixel-icon="check"]')).toHaveCount(1);
  await expect(habit.locator('input,.focus-task-choice-mark')).toHaveCount(0);
  await expect(habit).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
});

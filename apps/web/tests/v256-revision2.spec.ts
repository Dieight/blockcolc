import {expect,test,type Page} from '@playwright/test';
import {readPersistedDomainState} from './persisted-domain-state';
import {expandGlassSetting} from './expand-glass-setting';
import {execute, type DomainCommand} from '@blockcolc/domain';
import {executeAndReloadPersistedCommand} from './persisted-domain-state';
import {choosePlanEndTime} from './focus-plan-controls';

async function setup(page:Page,minimal=false,now='2026-10-04T04:00:00Z'){
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.clock.setFixedTime(new Date(now));
 await page.addInitScript(({minimal})=>{
  if(!localStorage.getItem('blockcolc-focus-preferences-v1'))localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({minimalMode:minimal,focusMinutes:1,breakMinutes:0,autoContinueFocus:true,lightingQuality:'performance',themeMode:'light'}));
 },{minimal});
 await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();
 await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-first-nonempty-frame-ms',/\d/,{timeout:25000});
}
async function end(page:Page){
 const button=page.getByRole('button',{name:'结束本次专注',exact:true});
 if(!await button.isVisible())await page.locator('.immersive-hint').dblclick();
 await button.click();
}
test('minimal cold boot never exposes the information band before its world is ready',async({page})=>{
 test.setTimeout(60_000);await setup(page,true);await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
 await page.addInitScript(()=>{
  const samples:{ready:boolean;visible:boolean}[]=[];Object.assign(window,{__coldBandSamples:samples});
  const sample=()=>{
   const world=document.querySelector<HTMLElement>('.world-screen'),panel=world?.querySelector<HTMLElement>('.focus-panel');
   if(world&&panel){const style=getComputedStyle(panel),bounds=panel.getBoundingClientRect();samples.push({ready:world.dataset.worldReady==='true',visible:style.visibility!=='hidden'&&style.display!=='none'&&bounds.height>0});}
  };
  new MutationObserver(sample).observe(document,{subtree:true,attributes:true,childList:true});
 });
 await page.reload();await expect(page.locator('.minimal-clock-gesture')).toBeVisible({timeout:25000});
 const samples=await page.evaluate(()=>(window as typeof window&{__coldBandSamples:{ready:boolean;visible:boolean}[]}).__coldBandSamples);
 expect(samples.some(sample=>!sample.ready)).toBe(true);expect(samples.some(sample=>!sample.ready&&sample.visible)).toBe(false);
});

test('ordinary marathon stays on its workbench until start, then pauses and reports on the shared glass flow without a required note',async({page})=>{
 test.setTimeout(90_000);await setup(page);await expect(page.locator('.focus-workbench-panel')).toBeVisible();
 await page.getByRole('button',{name:'调整本次计划',exact:true}).click();const sheet=page.getByRole('dialog',{name:'安排下一轮'});
 await sheet.getByRole('button',{name:'按结束时间',exact:true}).click();await choosePlanEndTime(sheet,'12:05');await sheet.getByRole('button',{name:'确认计划',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'主导航'})).toBeVisible();await expect(page.locator('.focus-workbench-panel .timer-label')).toHaveText('剩余总时长');
 await page.getByRole('button',{name:'开始到 12:05',exact:true}).click();await expect(page.locator('.focus-task-context')).toContainText('专注中 第1/5轮');
 await end(page);await page.getByRole('button',{name:/中断本轮/}).click();await page.getByRole('button',{name:'不记录',exact:true}).click();
 const ready=page.locator('.minimal-ready-clock');await expect(ready).toBeVisible();await expect(page.getByRole('navigation',{name:'主导航'})).toBeHidden();
 await page.reload();await expect(ready).toBeVisible({timeout:25000});await ready.press('Enter');await expect(page.locator('.focus-task-context')).toContainText('专注中 第1/5轮');
 await end(page);await page.getByRole('button',{name:/提前完成本轮/}).click();await expect(ready).toBeVisible();await ready.press('Enter');
 await expect(page.locator('.focus-task-context')).toContainText('专注中 第2/5轮');await expect(page.locator('.focus-report-surface')).toHaveCount(0);
 await end(page);await page.getByRole('button',{name:/取消整个计划/}).click();const cancel=page.getByRole('dialog',{name:'取消整个多轮计划？'});
 await cancel.getByRole('button',{name:'优先级变化',exact:true}).click();await expect(cancel.locator('textarea')).toHaveValue('');await cancel.getByRole('button',{name:'确认取消整个计划',exact:true}).click();
 await expect(page.locator('.focus-report-surface')).toBeVisible();await expect(page.getByRole('navigation',{name:'主导航'})).toBeHidden();
 expect((await readPersistedDomainState(page)).state.activeFocusSession).toBeNull();
});

for(const outcome of ['early','interrupt'] as const)test(`zero-break automatic minimal focus pauses on manual ${outcome}, reload and explicit restart stay stable`,async({page},info)=>{
 test.setTimeout(90_000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await setup(page,true);
 const clock=page.locator('.minimal-clock-gesture');await expect(clock).toBeVisible();await clock.press('ArrowUp');await expect(clock).toContainText('12:05');await clock.press('Enter');
 try { await expect(page.locator('.focus-task-context')).toContainText('专注中 第1/5轮'); }
 catch(error) {
  await info.attach('start-state',{body:JSON.stringify({errors,domain:await readPersistedDomainState(page),plan:await page.evaluate(()=>localStorage.getItem('blockcolc-round-plan-v1'))},null,2),contentType:'application/json'});
  throw error;
 }
 await end(page);
 if(outcome==='early')await page.getByRole('button',{name:/提前完成本轮/}).click();
 else {await page.getByRole('button',{name:/中断本轮/}).click();await page.getByRole('button',{name:'不记录',exact:true}).click();}
 const ready=page.locator('.minimal-ready-clock');await expect(ready).toBeVisible();
 const assertPaused=async()=>{
  expect((await readPersistedDomainState(page)).state.activeFocusSession).toBeNull();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!))).toMatchObject({status:'ready',completedRounds:outcome==='early'?1:0});
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!).automaticContinuation)).toBeUndefined();
  await expect(page.locator('.focus-report-surface')).toHaveCount(0);await expect(page.locator('.setup')).toHaveCount(0);
 };
 await assertPaused();await page.reload();await expect(ready).toBeVisible({timeout:25000});await assertPaused();
 await ready.press('Enter');await expect(page.locator('.focus-task-context')).toContainText(outcome==='early'?'专注中 第2/5轮':'专注中 第1/5轮');
 await expect(page.locator('.focus-report-surface')).toHaveCount(0);expect((await readPersistedDomainState(page)).state.activeFocusSession).not.toBeNull();expect(errors).toEqual([]);
});

test('font choice and debug clock survive reload; holiday test controls are absent from the final build',async({page},info)=>{
 test.setTimeout(90_000);await setup(page);await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('button',{name:'原字体',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-font','system');
 await page.getByRole('checkbox',{name:'临时调试世界'}).check();
 await page.getByRole('checkbox',{name:'指定时间',exact:true}).check();
 const time=page.getByRole('slider',{name:'世界调试时间'});await expect(time).toBeVisible();expect(await page.locator('.world-debug-settings input[type=time]').count()).toBe(0);
 const before=await time.locator('.timer-value').innerText();await time.press('ArrowUp');await expect(time.locator('.timer-value')).not.toHaveText(before);
 await expect(page.getByText('节日预览',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('listbox',{name:'调试节日'})).toHaveCount(0);
 const prior=(await readPersistedDomainState(page)).state.holidayRewards;
 await page.getByRole('button',{name:'计时',exact:true}).click();
 await expect(page.locator('.world-pane .holiday-emblem[data-holiday=christmas]')).toHaveCount(0);
 await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-imported-decoration-count','0');
 await page.screenshot({path:info.outputPath('holiday-and-system-font.png')});
 expect((await readPersistedDomainState(page)).state.holidayRewards).toEqual(prior);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('checkbox',{name:'临时调试世界'}).uncheck();
 await page.getByRole('button',{name:'计时',exact:true}).click();await expect(page.locator('.holiday-emblem[data-holiday=christmas]')).toHaveCount(0);
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-font','system');
});

test('physical sliders support ordinary drag, predicted slingshot and precise landing',async({page},info)=>{
 test.setTimeout(90_000);await setup(page);await page.emulateMedia({reducedMotion:'no-preference'});
 await page.getByRole('button',{name:'设置',exact:true}).click();
 const input=await expandGlassSetting(page);const physical=input.locator('..');await input.press('Home');for(let i=0;i<10;i++)await input.press('ArrowRight');await expect(input).toHaveValue('50');
 await physical.scrollIntoViewIfNeeded();const rail=physical.locator('.physical-slider-rail'),box=(await rail.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+3);await page.mouse.down();await page.mouse.move(box.x+box.width/2-28,box.y+48,{steps:6});
 await expect(physical).toHaveAttribute('data-flight','aiming');const text=await page.locator('.glass-transparency-value').innerText();const predicted=Number(text.match(/\d+/)![0]);expect(predicted).toBeGreaterThan(50);await expect(physical.locator('output')).toHaveCount(0);
 await page.screenshot({path:info.outputPath('physical-slider-trajectory.png')});await page.mouse.up();
 await expect(physical).toHaveAttribute('data-flight','flying');await expect(input).toHaveValue(String(predicted));await expect(physical).toHaveAttribute('data-flight','idle');
 await page.mouse.move(box.x+box.width*predicted/100,box.y+3);await page.mouse.down();await page.mouse.move(box.x+box.width*.2,box.y+3,{steps:8});await page.mouse.up();await expect(input).toHaveValue('20');
 await page.getByRole('button',{name:'深色',exact:true}).click();await page.locator('.world-color-setting>summary').click();
 await page.screenshot({path:info.outputPath('physical-slider-dark-settings.png'),fullPage:true});
 const color=page.getByLabel('世界饱和度',{exact:true});await color.press('Home');for(let i=0;i<14;i++)await color.press('ArrowRight');await expect(page.locator('.world-color-control output').first()).toHaveText('120%');
});

test('refresh preserves the previous contents and geometry; weekday taps paint before saving',async({page})=>{
 test.setTimeout(60_000);await setup(page);await page.getByRole('button',{name:'设置',exact:true}).click();
 const refresh=page.getByRole('button',{name:'刷新可恢复备份',exact:true}),panel=page.locator('.rollback-list');
 await refresh.scrollIntoViewIfNeeded();const oldText=await panel.innerText(),oldBox=(await panel.boundingBox())!;
 await refresh.click();await expect(refresh).toHaveAttribute('aria-busy','true');expect(await panel.innerText()).toBe(oldText);
 const after=(await panel.boundingBox())!;expect(after.height).toBeCloseTo(oldBox.height,0);await expect(refresh).toHaveAttribute('aria-busy','false');
 const monday=page.getByRole('group',{name:'计划专注日'}).getByRole('button',{name:'一',exact:true});
 await monday.click();await expect(monday).toHaveAttribute('aria-pressed','false');
 await expect.poll(async()=>(await readPersistedDomainState(page)).state.calendar.restWeekdays.includes(1)).toBe(true);
});

test('heatmap legend highlights matching days without changing selection, and marks the longest day',async({page})=>{
 test.setTimeout(60_000);await setup(page,false,'2026-10-02T00:00:00Z');await page.clock.setFixedTime(new Date('2026-10-04T04:00:00Z'));let state=(await readPersistedDomainState(page)).state;
 const subtaskId=state.projects.find(p=>p.id===state.activeProjectId)!.subtasks[0]!.id;
 const apply=(command:DomainCommand,nowMs:number)=>{const result=execute(state,command,{now:()=>new Date(nowMs)});if(!result.ok)throw new Error(result.message);state=result.state;};
 for(const [day,count] of [['02',10],['03',11]] as const)for(let hour=0;hour<count;hour++){
  const now=Date.parse(`2026-10-${day}T00:00:00Z`)+hour*3600_000,id=`legend-${day}-${hour}`;
  apply({type:'StartFocus',sessionId:id,subtaskId,plannedDurationMs:3600_000},now);
  apply({type:'CompleteFocus'},now+3600_000);
  apply({type:'ReportSubtaskProgress',reportId:`report-${id}`,subtaskId,focusSessionIds:[id],progressBasisPoints:0},now+3600_000);
 }
 await executeAndReloadPersistedCommand(page,state,{type:'ConfigureCalendar',timeZone:state.calendar.timeZone,restWeekdays:state.calendar.restWeekdays},Date.parse('2026-10-04T04:00:00Z'));
 await page.getByRole('button',{name:'统计',exact:true}).click();
 const unlock=page.getByRole('dialog',{name:'新的成就'});await expect(unlock).toBeVisible();await unlock.getByRole('button',{name:'全部关闭',exact:true}).click();
 const heatmap=page.locator('.focus-calendar-chart');await expect(heatmap).toBeVisible();
 const prior=await heatmap.getAttribute('aria-activedescendant');
 await page.getByRole('button',{name:'高亮 0–3H',exact:true}).click();
 await expect(page.locator('[data-highlight=dim]').first()).toBeVisible();
 expect(await heatmap.getAttribute('aria-activedescendant')).toBe(prior);
 await page.getByRole('button',{name:'高亮 0–3H',exact:true}).click();await expect(page.locator('[data-highlight]')).toHaveCount(0);
 await page.getByRole('button',{name:'高亮 9–12H',exact:true}).click();await expect(heatmap.locator('[data-highlight=match]')).toHaveCount(2);
 await expect(heatmap.locator('[data-longest]')).toHaveAttribute('data-date','2026-10-03');await expect(page.locator('.calendar-longest-label')).toContainText('11 小时');
 expect(await heatmap.getAttribute('aria-activedescendant')).toBe(prior);
 await heatmap.click({position:{x:20,y:5}});await expect(heatmap).toHaveCSS('box-shadow','none');
});

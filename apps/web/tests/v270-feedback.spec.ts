import {expect,test,type Page} from '@playwright/test';
import {readPersistedDomainState} from './persisted-domain-state';
import {finishPaintedReportReceipt,startNextRound} from './focus-plan-controls';

async function setup(page:Page,preferences:Record<string,unknown>={}){
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(p=>{if(!localStorage.getItem('blockcolc-focus-preferences-v1'))localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({minimalMode:false,focusMinutes:1,breakMinutes:0,autoContinueFocus:false,lightingQuality:'performance',...p}));},preferences);
  await page.goto('/');await page.getByRole('button',{name:/^(开始建造|Start building)$/,exact:true}).click();
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','true',{timeout:45000});
  await expect(page.locator('.boot-page')).toHaveCount(0);
  await expect(page.locator('canvas[data-world-canvas]')).toHaveAttribute('data-opening-reveal-state','completed');
}

test('animated library preview lives outside settings layout and closes without reopening',async({page},info)=>{
  test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();const library=page.locator('.blueprint-library');
  await library.getByRole('button',{name:/所有图纸/}).click();await library.locator('details').first().locator('summary').click();await library.locator('details').first().getByRole('button').first().click();
  const modal=page.getByRole('dialog',{name:'蓝图预览'});await expect(modal.locator('canvas')).toBeVisible();
  expect(await modal.evaluate(el=>el.parentElement?.parentElement===document.body)).toBe(true);
  await modal.locator('h2').click();await expect(modal).toBeVisible();
  await modal.getByRole('button',{name:'关闭蓝图预览'}).click();await expect(modal).toHaveCount(0);
  await library.locator('details').first().getByRole('button').first().click();await expect(modal).toBeVisible();await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);
  await library.getByRole('button',{name:/所有图纸/}).click();await expect(library.locator('.content-reveal')).toHaveAttribute('inert','');
  const transforms=await page.locator('.app-shell,main,.settings-screen').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).transform));expect(transforms.every(t=>t==='none')).toBe(true);
  await library.getByRole('button',{name:/所有图纸/}).click();await library.locator('summary').filter({hasText:'补充图纸'}).click();
  await library.scrollIntoViewIfNeeded();await library.evaluate(el=>Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{}))));
  await page.screenshot({path:info.outputPath('settings-library-integrated.png')});expect(errors).toEqual([]);
});

test('English mode makes both portal trips and end-plan choices stay English',async({page},info)=>{
  test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await setup(page,{language:'en',minimalMode:true});
  await page.locator('.focus-panel').dblclick({position:{x:16,y:18}});await page.getByRole('button',{name:'Full mode',exact:true}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-mode-portal-active','false',{timeout:20000});
  await expect(page.getByRole('button',{name:'Enter minimal mode',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Enter minimal mode',exact:true}).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-mode-portal-active','false',{timeout:20000});
  await expect(page.locator('.minimal-idle-carousel')).toBeVisible();
  expect(await page.locator('.notice').allTextContents()).not.toContain('切换被打断，请重试。');
  await page.locator('.minimal-clock-gesture').press('ArrowUp');await page.locator('.minimal-clock-gesture').press('Enter');
  await expect(page.locator('.focus-task-context')).toBeVisible();
  await page.locator('.immersive-hint').dblclick();await page.getByRole('button',{name:'End this focus',exact:true}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText('Finish round early');
  const text=await dialog.innerText();expect(text.replace(/我的第一座建筑|第一步/g,'')).not.toMatch(/[\u3400-\u9fff]/);
  await dialog.getByRole('button',{name:/Cancel whole plan/}).click();await expect(dialog).toContainText('Priorities changed');
  await page.screenshot({path:info.outputPath('english-end-plan.png')});expect(errors).toEqual([]);
});

for(const rounds of [2,3])test(`manual ${rounds} round plan completes exactly ${rounds} sessions, with stable integrity notice layout`,async({page})=>{
  test.setTimeout(120000);await page.clock.install({time:new Date('2026-10-11T04:00:00Z')});await setup(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('checkbox',{name:'开启专注完整性',exact:true}).check();await page.getByRole('button',{name:'计时',exact:true}).click();
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();const sheet=page.getByRole('dialog',{name:'安排下一轮'});
  await sheet.locator('.round-picker button').filter({hasText:new RegExp(`^${rounds} 轮`)}).click();await sheet.getByRole('button',{name:'确认计划',exact:true}).click();await expect(sheet).toBeHidden();
  await page.getByRole('button',{name:`开始 ${rounds} 轮`,exact:true}).click();
  for(let round=1;round<=rounds;round++){
    await expect.poll(async()=>(await readPersistedDomainState(page)).state.activeFocusSession?.id).toBeTruthy();
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!).completedRounds)).toBe(round-1);
    await expect(page.locator('.focus-integrity-warning')).toBeVisible();
    expect(await page.locator('.focus-integrity-warning').evaluate(el=>getComputedStyle(el).position)).toBe('absolute');
    const face=page.locator('.focus-face').first(),before=(await face.boundingBox())!;
    await page.clock.runFor(6000);const after=(await face.boundingBox())!;expect(Math.abs(after.y-before.y)).toBeLessThan(2);
    await page.clock.fastForward(60000);await expect(page.locator('.progress-report-panel')).toBeVisible();
    await page.getByRole('button',{name:'保持 0%',exact:true}).click();await finishPaintedReportReceipt(page);await expect(page.locator('.progress-report-panel')).toHaveCount(0);
    expect((await readPersistedDomainState(page)).state.focusHistory).toHaveLength(round);
    if(round<rounds){const plan=await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!));expect(plan.completedRounds).toBe(round);expect(plan.totalRounds).toBe(rounds);await startNextRound(page);}
  }
  expect((await readPersistedDomainState(page)).state.progressReports).toHaveLength(rounds);
});

test('notes share both entry points, survive reload and hide without deleting',async({page},info)=>{
  test.setTimeout(120000);await setup(page);
  await page.getByRole('button',{name:'任务',exact:true}).click();await expect(page.locator('.quick-notes')).toHaveCount(0);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('checkbox',{name:'简易便签',exact:true}).check();
  await page.getByRole('button',{name:'任务',exact:true}).click();let notes=page.locator('.quick-notes');
  await notes.getByRole('textbox',{name:'写一条便签'}).fill('Read one chapter');await notes.getByRole('button',{name:'添加便签'}).click();await notes.getByRole('checkbox',{name:'完成便签：Read one chapter'}).click();
  await expect(notes.locator('.quick-notes-completed')).toBeVisible();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('checkbox',{name:'简易便签',exact:true}).uncheck();await page.getByRole('checkbox',{name:'简易便签',exact:true}).check();
  await page.getByRole('checkbox',{name:'开启极简模式',exact:true}).check();await page.getByRole('button',{name:'计时',exact:true}).click();
  const carousel=page.locator('.minimal-idle-carousel');await carousel.press('ArrowLeft');await expect(carousel).toHaveAttribute('data-page','notes');
  notes=carousel.locator('.quick-notes');await notes.locator('.quick-notes-completed summary').click();await expect(notes.getByRole('checkbox')).toBeChecked();await notes.getByRole('checkbox').uncheck();
  await page.reload();await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','true',{timeout:45000});
  await page.locator('.minimal-idle-carousel').press('ArrowLeft');await expect(page.locator('.quick-notes--compact input[type=checkbox]')).not.toBeChecked();
  await page.locator('.minimal-idle-track').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
  await expect(page.locator('.quick-notes--compact h2')).toBeInViewport();
  await page.screenshot({path:info.outputPath('minimal-shared-notes.png')});
});

test('weather clouds have multiple voxel silhouettes and no layout rebuilding on orbit',async({page},info)=>{
  test.setTimeout(90000);await setup(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();const debug=page.locator('.world-debug-settings');
  await debug.getByRole('checkbox',{name:'临时调试世界',exact:true}).check();await debug.locator('.choice-menu-trigger').click();await page.getByRole('option',{name:'多云',exact:true}).click();
  await debug.getByRole('checkbox',{name:'指定时间',exact:true}).check();const time=debug.getByRole('slider',{name:'世界调试时间',exact:true});for(let i=0;i<36;i++)await time.press('ArrowUp');
  await expect(time.locator('.timer-value')).toHaveText('15:00');
  await page.getByRole('button',{name:'计时',exact:true}).click();const reset=page.getByRole('button',{name:'重置地图',exact:true});if(await reset.count())await reset.click();
  const canvas=page.locator('canvas[data-world-canvas]');await expect(canvas).toHaveAttribute('data-cloud-cubic-voxels','true');
  await expect(canvas).toHaveAttribute('data-weather-kind','cloudy');await expect(canvas).toHaveAttribute('data-day-phase',/day|afternoon/);
  expect(await canvas.evaluate(el=>new Date(Number(el.dataset.lightingSampledAtMs)).getHours())).toBe(15);
  expect((await canvas.getAttribute('data-cloud-shape-kinds'))?.split(',').length).toBeGreaterThan(1);
  await expect(canvas).toHaveAttribute('data-environment-transition-active','false');
  await info.attach('cloud-presentation',{body:JSON.stringify(await canvas.evaluate(el=>({phase:el.dataset.dayPhase,astronomyPhase:el.dataset.astronomyPhase,sampleTime:el.dataset.lightingSampledAtMs,weather:el.dataset.weatherKind,shapes:el.dataset.cloudShapeKinds}))),contentType:'application/json'});
  await page.screenshot({path:info.outputPath('voxel-cloud-genera.png')});
  const before=await canvas.getAttribute('data-world-rebuild-count'),box=(await canvas.boundingBox())!;
  await page.mouse.move(box.x+box.width*.35,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.6,{steps:8});await page.mouse.up();
  expect(await canvas.getAttribute('data-world-rebuild-count')).toBe(before);
});

test('manual minimal plan retains its second round until the unified report',async({page})=>{
  test.setTimeout(90000);await page.clock.install({time:new Date('2026-10-11T04:00:00Z')});await setup(page,{minimalMode:true,focusMinutes:5});
  const clock=page.locator('.minimal-clock-gesture');await clock.press('ArrowUp');await clock.press('ArrowUp');await clock.press('Enter');
  await expect(page.locator('.focus-task-context')).toContainText('第1/2轮');await page.clock.fastForward(300000);
  await expect(page.locator('.minimal-ready-clock')).toBeVisible();expect((await readPersistedDomainState(page)).state.focusHistory).toHaveLength(1);
  await startNextRound(page);await expect(page.locator('.focus-task-context')).toContainText('第2/2轮');await page.clock.fastForward(300000);
  await expect(page.locator('.focus-report-surface')).toBeVisible();expect((await readPersistedDomainState(page)).state.focusHistory).toHaveLength(2);
});

test('both reset controls use the same default angles while ordinary reset retains the selected axis',async({page})=>{
  test.setTimeout(90000);await setup(page);const canvas=page.locator('canvas[data-world-canvas]');
  await page.getByRole('button',{name:'任务',exact:true}).click();await page.getByRole('button',{name:'查看建筑',exact:true}).click();
  const map=page.getByRole('button',{name:'重置地图',exact:true}),view=page.getByRole('button',{name:'重置视角',exact:true});await expect(map).toBeVisible();await view.click();await expect(map).toBeVisible();
  const angles=()=>canvas.evaluate(el=>[el.dataset.cameraAzimuth,el.dataset.cameraPitchDegrees]);const selected=await angles();
  await map.click();await expect(map).toHaveCount(0);await expect.poll(angles).toEqual(selected);
  const camera=()=>canvas.evaluate(el=>[el.dataset.cameraDistance,el.dataset.cameraTargetX,el.dataset.cameraTargetY,el.dataset.cameraTargetZ,...[el.dataset.cameraAzimuth,el.dataset.cameraPitchDegrees]]);const defaults=await camera();
  const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+box.width*.45,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.65,{steps:12});await page.mouse.up();
  await expect.poll(angles).not.toEqual(selected);await view.click();await expect.poll(camera).toEqual(defaults);
});

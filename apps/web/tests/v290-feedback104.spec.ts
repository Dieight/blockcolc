import { test, expect, type Page } from '@playwright/test';
import { createInitialState, execute, type DomainCommand, type DomainState } from '@blockcolc/domain';
import { executeAndReloadPersistedCommand, readPersistedDomainState } from './persisted-domain-state';
import { waitForPreparedWorld } from './world-ready';
import { finishPaintedReportReceipt } from './focus-plan-controls';

function data(rounds: number) {
  let state = createInitialState('Asia/Shanghai');
  const at = Date.now() - 30 * 60_000;
  const apply = (command: DomainCommand, now = at) => {
    const result = execute(state, command, { now: () => new Date(now) });
    if (!result.ok) throw Error(result.message); state = result.state;
  };
  apply({ type:'CreateProject',projectId:'work',title:'定点工坊',blueprintId:'builtin-small-workshop',subtasks:[{id:'step',title:'定点小任务'}] });
  apply({ type:'CreateHabitProject',projectId:'habit',title:'阅读习惯',blueprintId:'builtin-small-workshop',targetRounds:10 });
  apply({ type:'CreateProject',projectId:'other',title:'下一件工作',blueprintId:'builtin-small-workshop',subtasks:[{id:'later',title:'下一步'}] });
  apply({ type:'SwitchActiveProject',projectId:'work' });
  for(let i=0;i<rounds;i++){
    apply({type:'StartFocus',sessionId:`batch-${i}`,subtaskId:null,marathon:true,deferredSettlement:true,plannedDurationMs:60_000},at+i*90_000);
    apply({type:'CompleteFocus'},at+i*90_000+60_000);
  }
  return state;
}
async function setup(page:Page,state:DomainState,minimal:boolean,english=false){
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(({minimal,english})=>{
    localStorage.setItem('blockcolc-tutorial-v1','1');
    if(!localStorage.getItem('blockcolc-focus-preferences-v1'))localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({focusMinutes:1,breakMinutes:0,lightingQuality:'performance',themeMode:english?'dark':'light',language:english?'en':'zh-CN',minimalMode:minimal,focusGlassTransparency:100}));
  },{minimal,english});
  await page.goto('/');await page.getByRole('button',{name:/^(开始建造|Start building)$/}).click();await waitForPreparedWorld(page);
  if(state.focusHistory.length)await page.evaluate(()=>localStorage.setItem('blockcolc-round-plan-v1',JSON.stringify({projectId:'work',subtaskId:null,mode:'marathon',deferredSettlement:true,totalRounds:3,completedRounds:3,status:'report',reportedSessionIds:['batch-0','batch-1','batch-2']})));
  await executeAndReloadPersistedCommand(page,state,{type:'SwitchActiveProject',projectId:'work'},Date.now());await waitForPreparedWorld(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme',english?'dark':'light');
  await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode',String(minimal));
}

for(const minimal of [true,false])test(`partial allocation keeps its explanation and completion keeps the intended layout: minimal=${minimal}`,async({page},info)=>{
  test.setTimeout(150_000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await setup(page,data(3),minimal,!minimal);
  await page.clock.install({time:new Date()});await page.clock.pauseAt(new Date(Date.now()+1000));
  const report=page.locator('.marathon-progress-report'),note=report.locator('fieldset > .plan-sheet-note:not([role="alert"])');
  await expect(report).toBeVisible();await expect(note).toContainText('3');
  const work=report.locator('.marathon-settlement-card').filter({hasText:'定点工坊'});
  await work.locator('.marathon-settlement-head').click();await work.getByRole('button',{name:/^(完成|Done)$/}).click();
  await work.locator('.task-round-stepper button').last().click();
  await expect(note).toContainText('2');await page.screenshot({path:info.outputPath('partial-allocation.png')});
  const habit=report.locator('.marathon-settlement-card').filter({hasText:'阅读习惯'});
  await habit.locator('.marathon-settlement-head').click();await habit.locator('.habit-round-stepper button').last().click();
  await expect(note).toContainText('1');await work.locator('.task-round-stepper button').last().click();
  await expect(note).toContainText(/全部轮次|All rounds/);
  await report.locator('.marathon-report-submit').click();
  await expect(report.locator('[data-action-state="success"]')).toBeVisible();
  await finishPaintedReportReceipt(page);await page.clock.resume();
  await expect(page.locator('[role="dialog"][aria-labelledby="ceremony-title"]')).toBeVisible({timeout:15_000});
  await expect.poll(async()=>(await readPersistedDomainState(page)).state.projects.find(p=>p.id==='work')?.status).toBe('monument');
  const ceremony=page.locator('.completion-ceremony');
  if(minimal){
    await expect(ceremony).toHaveClass(/minimal-completion/);await expect(page.locator('.app-shell')).toHaveClass(/focus-immersive/);
    await expect(page.locator('.workspace-rest')).toHaveCount(0);await expect(page.locator('.bottom-nav')).toHaveCount(0);
    for(const viewport of [{width:320,height:740},{width:390,height:844},{width:430,height:932},{width:768,height:1024},{width:1440,height:900}]){
      await page.setViewportSize(viewport);
      const bounds=await ceremony.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height+1);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('minimal-completion.png')});
  } else await expect(ceremony).not.toHaveClass(/minimal-completion/);
  await ceremony.getByRole('button').click();await expect(ceremony).toHaveCount(0);
  if(minimal){await expect(page.locator('.minimal-completed-clock')).toBeVisible();await expect(page.locator('.workspace-rest')).toHaveCount(0);}
  else await expect(page.locator('.workspace-rest')).toBeVisible();
  expect(errors).toEqual([]);
});

test('habit draft selection has no subtask stripe, and its task page has one progress bar',async({page},info)=>{
  test.setTimeout(120_000);await setup(page,data(0),false);
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();
  const sheet=page.locator('.focus-plan-sheet[role="dialog"]'),habit=sheet.locator('.focus-task-habit');
  await habit.click();await expect(habit).toHaveAttribute('aria-pressed','true');
  const work=sheet.locator('.focus-task-project').filter({hasText:'定点工坊'});
  await work.locator('summary').click();await work.locator('summary').click();
  await expect(habit).toHaveCSS('box-shadow','none');await expect(habit.locator('svg[data-pixel-icon="check"]')).toHaveCount(1);
  expect((await readPersistedDomainState(page)).state.activeProjectId).toBe('work');
  await sheet.getByRole('button',{name:'确认计划',exact:true}).click();
  await expect.poll(async()=>(await readPersistedDomainState(page)).state.activeProjectId).toBe('habit');
  await page.getByRole('button',{name:'任务',exact:true}).click();
  await expect(page.locator('.task-detail-panel [role="progressbar"]')).toHaveCount(1);
  await expect(page.locator('.task-building-progress')).toHaveCount(0);
  await expect(page.getByRole('progressbar',{name:'习惯周期进度',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('habit-single-progress.png')});
});

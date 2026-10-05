import { expect, test, type Page } from '@playwright/test';
import { createInitialState, execute, parseDomainState, type DomainCommand } from '@blockcolc/domain';

test.beforeEach(async ({page}) => { await page.emulateMedia({reducedMotion:'reduce'}); });

function memoryFixture() {
  let state=createInitialState('Asia/Shanghai');
  const run=(command:DomainCommand,instant:number)=>{const result=execute(state,command,{now:()=>new Date(instant)});if(!result.ok)throw new Error(result.message);state=result.state;};
  const now=Date.parse('2026-10-01T02:00:00Z');
  run({type:'CreateProject',projectId:'completed',title:'纪念工坊',blueprintId:'builtin-small-workshop',subtasks:[{id:'completed-step',title:'完工'}]},now);
  run({type:'StartFocus',sessionId:'finished-round',subtaskId:'completed-step',plannedDurationMs:60_000},now);
  run({type:'CompleteFocus'},now+60_000);
  run({type:'ReportSubtaskProgress',reportId:'finished-report',subtaskId:'completed-step',focusSessionIds:['finished-round'],progressBasisPoints:10_000},now+60_001);
  run({type:'CreateProject',projectId:'current',title:'可继续工坊',blueprintId:'builtin-small-workshop',subtasks:[{id:'next-step',title:'铺好第一层地板'}]},now+60_002);
  return parseDomainState(state);
}

async function installMemoryFixture(page:Page) {
  await page.evaluate(async nextState=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('blockcolc-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('appState','readwrite');const store=tx.objectStore('appState');const read=store.get('current');read.onsuccess=()=>store.put({id:'current',revision:(read.result?.revision??0)+1,state:{...nextState,decorationBlueprintResources:read.result?.state?.decorationBlueprintResources??nextState.decorationBlueprintResources}});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}
  },memoryFixture());
  await page.reload();
}

function calendarFixture() {
  let state=createInitialState('Asia/Shanghai');
  const run=(command:DomainCommand,instant:number) => {const result=execute(state,command,{now:()=>new Date(instant)});if(!result.ok)throw new Error(result.message);state=result.state;};
  const created=Date.parse('2026-09-01T00:00:00Z');
  for(const id of ['writing','reading']) run({type:'CreateProject',projectId:id,title:id==='writing'?'写作':'阅读',blueprintId:'builtin-small-workshop',subtasks:[{id:`${id}-task`,title:'一个步骤'}]},created);
  for(const [index,round] of [{id:'writing',date:'2026-09-30',minutes:180},{id:'writing',date:'2026-10-01',minutes:60},{id:'reading',date:'2026-10-01',minutes:120},{id:'reading',date:'2026-10-02',minutes:600}].entries()) {
    const now=Date.parse(`${round.date}T00:00:00Z`) + (index===2 ? 2*3_600_000 : 0);
    run({type:'SwitchActiveProject',projectId:round.id},now);
    run({type:'StartFocus',sessionId:`round-${index}`,subtaskId:`${round.id}-task`,plannedDurationMs:round.minutes*60_000},now);
    run({type:'CompleteFocus'},now+round.minutes*60_000);
    run({type:'ReportSubtaskProgress',reportId:`report-${index}`,subtaskId:`${round.id}-task`,focusSessionIds:[`round-${index}`],progressBasisPoints:(index%2+1)*1000},now+round.minutes*60_000+1);
  }
  state.dailyGoals=[{date:'2026-09-30',targetPomodoros:4,enabled:true,reachedAt:null},{date:'2026-10-01',targetPomodoros:99,enabled:false,reachedAt:null},{date:'2026-10-02',targetPomodoros:12,enabled:true,reachedAt:null}];
  return parseDomainState(state);
}

test('pixel calendar selects one day, forward/reverse ranges, cancellation and keyboard with matching totals', async ({page},testInfo) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(new Date('2026-10-02T04:00:00Z'));
  await page.goto('/');
  await page.getByRole('button',{name:'开始建造'}).click();
  await page.evaluate(async nextState => {
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('blockcolc-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try { await new Promise<void>((resolve,reject)=>{const tx=db.transaction('appState','readwrite');const store=tx.objectStore('appState');const read=store.get('current');read.onsuccess=()=>store.put({id:'current',revision:(read.result?.revision??0)+1,state:{...nextState,decorationBlueprintResources:read.result?.state?.decorationBlueprintResources??nextState.decorationBlueprintResources}});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);}); } finally { db.close(); }
  },calendarFixture());
  await page.reload();
  await page.getByRole('button',{name:'统计',exact:true}).click();
  const unlock=page.getByRole('dialog',{name:'新的成就'});
  await expect(unlock).toBeVisible();
  await unlock.getByRole('button',{name:'全部关闭'}).click();
  const overview=page.locator('.stats-overview');
  const chart=page.locator('.focus-calendar-chart');
  await expect(page.locator('.stats-periods,.calendar-range-picker,.stats-reading-note')).toHaveCount(0);
  await expect(page.locator('.stats-page input[type="date"]')).toHaveCount(0);
  await expect(chart.locator('.calendar-selection')).toHaveCount(0);
  const cell=(date:string)=>chart.locator(`[data-date="${date}"] .calendar-day-hit`);
  const expectTotals=async(time:string,rounds:string,activeDays:string)=>{
    await expect(overview.locator('.stats-duration')).toContainText(time);
    await expect(overview.locator('.stats-rounds>strong')).toHaveText(rounds);
    await expect(overview.locator('.stats-key-facts>div').last().locator('strong')).toHaveText(activeDays);
  };
  await expectTotals('10 小时','1 / 12','1');
  await expect(chart.locator('[data-date="2026-09-30"]')).toHaveAttribute('data-level','2');
  await expect(chart.locator('[data-date="2026-10-02"]')).toHaveAttribute('data-level','4');
  await expect(page.locator('.stats-today')).toHaveCount(0);
  await cell('2026-09-30').click();
  await expect(chart).toHaveAttribute('data-selection-input','pointer');
  await expect(chart).toBeFocused();
  // outline:none legitimately computes a medium width; only its style paints.
  await expect(chart).toHaveCSS('outline-style','none');
  await expect(chart).toHaveCSS('box-shadow','none');
  await expectTotals('3 小时','1 / 4','1');
  await expect(page.locator('.allocation-cluster-name')).toHaveText('写作');
  await expect(page.locator('.allocation-cluster-time')).toHaveText('3 小时');
  const start=(await cell('2026-09-30').boundingBox())!;
  const end=(await cell('2026-10-02').boundingBox())!;
  for(const [from,to] of [[start,end],[end,start]]) {
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
    await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:5});await page.mouse.up();
    await expectTotals('16 小时','4 / 16','3');
    await expect(chart.locator('[aria-selected="true"]')).toHaveCount(3);
    await expect(page.locator('[data-allocation-unit="true"]')).toHaveCount(100);
  }
  // Cancelling a native pointer sequence restores the previously committed range.
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();
  await chart.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
  await expectTotals('16 小时','4 / 16','3');
  await chart.focus();await chart.press('Escape');await expectTotals('10 小时','1 / 12','1');
  await expect(chart).toHaveAttribute('data-selection-input','keyboard');
  await expect(chart).not.toHaveCSS('box-shadow','none');
  await chart.press('Shift+ArrowUp');await expectTotals('13 小时','3 / 12','2');
  await chart.press('ArrowUp');await expectTotals('3 小时','2 / 0','1');
  await cell('2026-09-29').click();await expectTotals('0 分钟','0 / 8','0');
  await expect(page.locator('.project-allocation .chart-empty')).toBeVisible();
  await chart.press('End');
  await expectTotals('10 小时','1 / 12','1');
  await page.screenshot({path:testInfo.outputPath('pixel-calendar-light.png'),fullPage:true});
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'深色',exact:true}).click();
  await page.getByRole('button',{name:'统计',exact:true}).click();
  await expectTotals('10 小时','1 / 12','1');
  await page.screenshot({path:testInfo.outputPath('pixel-calendar-dark.png'),fullPage:true});
});

test('compact memory and pixel setup, goal, management and about preserve their original actions', async ({page},testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({width:360,height:800});
  await page.goto('/');
  await expect(page.locator('.setup-kind [data-pixel-icon]')).toHaveCount(2);
  await page.getByRole('button',{name:'开始建造'}).click();
  await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-opening-reveal-state',/^(completed|cancelled)$/,{timeout:20_000});
  await page.getByRole('button',{name:'查看建筑记忆：我的第一座工坊'}).focus();
  await page.getByRole('button',{name:'查看建筑记忆：我的第一座工坊'}).press('Enter');
  const memory=page.getByRole('region',{name:'我的第一座工坊',exact:true});
  await expect(memory.getByRole('button',{name:'继续专注'})).toBeVisible();
  expect(await memory.evaluate(element=>{const host=element.closest('.focus-workbench-panel')!;return host.scrollHeight-host.clientHeight;})).toBeLessThanOrEqual(1);
  await page.screenshot({path:testInfo.outputPath('compact-memory.png')});
  await page.setViewportSize({width:915,height:412});
  await expect(memory).toBeVisible();
  expect(await memory.evaluate(element=>{const host=element.closest('.focus-workbench-panel')!;return host.scrollHeight-host.clientHeight;})).toBeLessThanOrEqual(1);
  await page.screenshot({path:testInfo.outputPath('compact-memory-landscape.png')});
  await page.setViewportSize({width:360,height:800});
  await memory.getByRole('button',{name:'关闭建筑记忆'}).click();
  await page.getByRole('button',{name:'任务',exact:true}).click();
  await page.getByRole('button',{name:/任务总览与管理/}).click();
  await expect(page.getByRole('button',{name:'删除当前任务'})).toBeVisible();
  await expect(page.locator('.task-management-disclosure')).toHaveCount(0);
  await expect(page.locator('.project-portfolio-copy .pixel-progress')).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath('merged-management.png'),fullPage:true});
  await page.getByRole('button',{name:'调整今日目标'}).click();
  const goal=page.getByRole('dialog',{name:'调整今日目标'});
  await expect(goal.locator('[data-pixel-icon="flag"]')).toBeVisible();
  await goal.getByRole('button',{name:'增加目标轮数'}).click();
  await expect(goal.getByLabel('今日目标次数')).toHaveValue('9');
  await page.screenshot({path:testInfo.outputPath('pixel-goal.png')});
  await goal.getByRole('button',{name:'关闭今日目标'}).click();
  await page.getByRole('button',{name:'新增任务',exact:true}).click();
  await expect(page.locator('.setup-title [data-pixel-icon="cube"]')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('pixel-setup.png'),fullPage:true});
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'关于方块钟'}).click();
  const about=page.getByRole('dialog',{name:/方块钟/});
  await expect(about.locator('.about-brand [data-pixel-icon="brand"]')).toBeVisible();
  await expect(about.getByRole('link',{name:'Apache-2.0'})).toHaveAttribute('href',/\/LICENSE$/);
  await expect(about.getByRole('link',{name:'SunCalc · BSD-2-Clause'})).toHaveAttribute('href','licenses/suncalc.txt');
  await page.screenshot({path:testInfo.outputPath('pixel-about.png')});
  await about.getByRole('button',{name:'关闭关于页面'}).click();
});

test('memory fills the workbench for both continuing and memorial buildings',async({page},info)=>{
  test.setTimeout(90_000);
  await page.goto('/');await page.getByRole('button',{name:'开始建造'}).click();
  await installMemoryFixture(page);
  await expect(page.getByLabel('项目建筑世界')).toHaveAttribute('data-opening-reveal-state',/^(completed|cancelled)$/,{timeout:20_000});
  for(const viewport of [{width:360,height:800},{width:412,height:915},{width:915,height:412}]) {
    await page.setViewportSize(viewport);
    for(const title of ['可继续工坊','纪念工坊']) {
      const entry=page.getByRole('button',{name:`查看建筑记忆：${title}`});await entry.focus();await entry.press('Enter');
      const memory=page.getByRole('region',{name:title,exact:true});await expect(memory).toBeVisible();
      const bounds=await memory.evaluate(node=>{
        const host=node.closest('.focus-workbench-panel')!;
        const css=getComputedStyle(host),box=host.getBoundingClientRect(),content=node.getBoundingClientRect();
        const world=document.querySelector('.world-stage')!.getBoundingClientRect();
        const nav=document.querySelector('.bottom-nav')!.getBoundingClientRect();
        return {top:box.top,bottom:box.bottom,contentTop:content.top,contentBottom:content.bottom,paddingTop:parseFloat(css.paddingTop),paddingBottom:parseFloat(css.paddingBottom),worldTop:world.top,worldBottom:world.bottom,navTop:nav.top,overflow:host.scrollHeight-host.clientHeight};
      });
      expect(bounds.overflow).toBeLessThanOrEqual(1);
      expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
      expect(Math.abs(bounds.contentTop-bounds.top-bounds.paddingTop)).toBeLessThanOrEqual(1);
      expect(Math.abs(bounds.bottom-bounds.paddingBottom-bounds.contentBottom)).toBeLessThanOrEqual(1);
      if(viewport.width<700) {
        expect(Math.abs(bounds.top-bounds.worldBottom)).toBeLessThanOrEqual(1);
        expect(Math.abs(bounds.bottom-bounds.navTop)).toBeLessThanOrEqual(1);
      } else {
        expect(Math.abs(bounds.top-bounds.worldTop)).toBeLessThanOrEqual(1);
        expect(Math.abs(bounds.bottom-bounds.worldBottom)).toBeLessThanOrEqual(1);
      }
      await expect(memory.getByRole('button',{name:'继续专注'})).toHaveCount(title==='可继续工坊'?1:0);
      await page.screenshot({path:info.outputPath(`memory-fill-${title}-${viewport.width}.png`)});
      await memory.getByRole('button',{name:'关闭建筑记忆'}).click();
    }
  }
});

for(const kind of ['finite','habit'] as const) test(`pixel plan sheets and paired entry buttons keep their real actions (${kind})`,async({page},info)=>{
  test.setTimeout(75_000);
  await page.clock.setFixedTime(new Date('2026-10-03T08:00:00Z'));
  await page.setViewportSize({width:412,height:915});await page.goto('/');
  if(kind==='habit') {await page.getByRole('button',{name:'习惯任务',exact:true}).click();await page.getByLabel('习惯名称').fill('每日阅读');}
  await page.getByRole('button',{name:'开始建造'}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('checkbox',{name:'开启极简模式'}).check();
  await page.getByRole('button',{name:'计时',exact:true}).click();
  await page.locator('.minimal-exit').focus();await page.keyboard.press('Enter');
  const entries=page.locator('.workbench-heading-actions');
  await expect(entries.locator('.task-switch-action')).toHaveCount(2);
  const boxes=await entries.locator('.task-switch-action').evaluateAll(nodes=>nodes.map(node=>{const hit=node.getBoundingClientRect(),glyph=node.querySelector('svg')!.getBoundingClientRect();return {left:hit.left,right:hit.right,width:hit.width,height:hit.height,glyphLeft:glyph.left,glyphRight:glyph.right,glyphWidth:glyph.width,glyphHeight:glyph.height};}));
  for(const box of boxes)expect([box.width,box.height,box.glyphWidth,box.glyphHeight]).toEqual([44,44,22,22]);
  expect(boxes[1]!.left).toBeGreaterThanOrEqual(boxes[0]!.right);
  expect(boxes[1]!.glyphLeft-boxes[0]!.glyphRight).toBeLessThanOrEqual(16);
  await page.screenshot({path:info.outputPath(`paired-entry-${kind}.png`)});
  await entries.getByRole('button',{name:'切换当前工作',exact:true}).click();
  await expect(page.locator('.tasks-page')).toBeVisible();
  await page.getByRole('button',{name:'计时',exact:true}).click();
  await page.getByRole('button',{name:'进入极简模式',exact:true}).click();
  await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
  await page.locator('.minimal-exit').focus();await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:kind==='finite'?'安排下一轮':'安排习惯专注'});
  await expect(sheet.locator('.sheet-heading [data-pixel-icon="clock"]')).toBeVisible();
  await sheet.getByRole('button',{name:'2 轮',exact:true}).click();
  await expect(sheet.getByRole('button',{name:'2 轮',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:info.outputPath(`pixel-plan-rounds-${kind}.png`)});
  await sheet.getByRole('button',{name:'按结束时间',exact:true}).click();
  const slider=sheet.getByRole('slider',{name:'结束时间，上下滑动或按方向键调整'});
  const original=await slider.locator('.timer-value').innerText();
  await slider.press('ArrowUp');
  await expect(slider.locator('.timer-value')).not.toHaveText(original);
  await slider.press('ArrowDown');
  await expect(slider.locator('.timer-value')).toHaveText(original);
  await slider.press('ArrowUp');
  await slider.press('Enter');
  await expect(sheet).toBeVisible();
  for(const width of [360,412]) {
    await page.setViewportSize({width,height:915});
    expect(await sheet.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    const timeBox=(await slider.locator('.timer-value').boundingBox())!,sliderBox=(await slider.boundingBox())!;
    expect(Math.abs(timeBox.x+timeBox.width/2-sliderBox.x-sliderBox.width/2)).toBeLessThanOrEqual(1);
    await page.screenshot({path:info.outputPath(`pixel-plan-end-${kind}-${width}.png`)});
  }
  await sheet.getByRole('button',{name:'固定轮次',exact:true}).click();
  await sheet.getByRole('button',{name:'确认计划',exact:true}).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();
  await expect(sheet.getByRole('button',{name:'2 轮',exact:true})).toHaveAttribute('aria-pressed','true');
  await sheet.getByRole('button',{name:'关闭本次计划'}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'深色',exact:true}).click();await page.getByRole('button',{name:'计时',exact:true}).click();
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();
  await expect(sheet).toBeVisible();await page.screenshot({path:info.outputPath(`pixel-plan-dark-${kind}.png`)});
  await sheet.getByRole('button',{name:'关闭本次计划'}).click();
});

test('pixel navigation and grouped goals retain readable values across themes and large text', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造' }).click();
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await expect(navigation.locator('[data-pixel-icon]')).toHaveCount(4);
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '调整今日目标' }).click();
  const sheet = page.getByRole('dialog', { name: '调整今日目标', exact: true });
  const input = sheet.getByLabel('今日目标次数');
  await input.fill('56');
  await input.blur();
  await expect(sheet).toContainText('今日已完成 0 / 56 轮');
  await sheet.getByRole('button', { name: '关闭今日目标' }).click();
  const goal = page.getByRole('progressbar', { name: '今日 0 / 56 轮', exact: true });
  await expect(goal).toHaveAttribute('aria-valuemax', '56');
  expect(await goal.locator(':scope > i').count()).toBeLessThanOrEqual(16);
  await expect(page.getByText('每格最多 4 轮')).toBeVisible();
  await expect(page.locator('.task-copy [role="progressbar"]').first()).toHaveAttribute('aria-valuenow', '0');
  await expect(page.locator('.task-current .task-order')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.screenshot({ path: testInfo.outputPath('pixel-tasks-light.png'), fullPage: true });

  await page.getByRole('button', { name: '统计', exact: true }).click();
  await expect(page.locator('.focus-heatmap-card')).toBeVisible();
  await page.getByText('成就', { exact: true }).first().click();
  await expect(page.locator('.achievement-emblem').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('pixel-stats-light.png'), fullPage: true });

  await page.getByRole('button', { name: '设置', exact: true }).click();
  const field = page.locator('.number-field input').first();
  for (const theme of ['浅色', '深色']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.getByRole('heading', { name: '设置', exact: true }).click();
    const idle = await field.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, border: getComputedStyle(element).borderTopColor }));
    expect(idle.background).toBe('rgba(0, 0, 0, 0)');
    expect(idle.border).toBe('rgba(0, 0, 0, 0)');
    await field.focus();
    await expect(field).toBeFocused();
    await expect(field).not.toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await page.getByRole('heading', { name: '设置', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath(`pixel-settings-${theme === '浅色' ? 'light' : 'dark'}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  const width = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  expect(width.page).toBeLessThanOrEqual(width.viewport);
  expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

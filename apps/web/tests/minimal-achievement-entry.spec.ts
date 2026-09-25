import {expect,test,type Locator,type Page} from '@playwright/test';
import type {DomainState} from '@tomato-clock/domain';

// This capability test includes setup, two cold loads and a complete focus /
// settlement loop over software WebGL; keep its budget separate from one-step tests.
test.setTimeout(120_000);

async function snapshot(page:Page):Promise<DomainState>{
 return page.evaluate(async()=>{
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('blockcolc-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  try{return await new Promise<DomainState>((resolve,reject)=>{const request=database.transaction('appState','readonly').objectStore('appState').get('current');request.onsuccess=()=>resolve(request.result.state);request.onerror=()=>reject(request.error);});}
  finally{database.close();}
 });
}
async function setup(page:Page){
 await page.goto('/');
 await page.getByRole('button',{name:'开始建造',exact:true}).click();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('spinbutton',{name:'普通任务专注分钟'}).fill('1');
 await page.getByRole('spinbutton',{name:'普通任务专注分钟'}).blur();
 await page.getByRole('spinbutton',{name:'每轮休息分钟'}).fill('0');
 await page.getByRole('spinbutton',{name:'每轮休息分钟'}).blur();
}
async function expectButtonReceivesPointer(button:Locator){
 const hitTest=await button.evaluate(element=>{
  const rect=element.getBoundingClientRect();
  const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  return {receivesPointer:hit===element||element.contains(hit),target:hit?`${hit.tagName.toLowerCase()}${hit.classList.length?`.${[...hit.classList].join('.')}`:''}`:'none'};
 });
 expect(hitTest.receivesPointer,`Expected the workbench button to receive pointer events, but hit ${hitTest.target}`).toBe(true);
}
async function minimal(page:Page){
 await setup(page);
 await page.getByRole('checkbox',{name:'开启极简模式'}).check();
 await page.getByRole('button',{name:'计时',exact:true}).click();
 await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
}

test('settings launches minimal focus, persists it, settles once and shows real achievements',async({page})=>{
 await page.clock.install({time:new Date('2026-09-06T08:00:00Z')});
 await minimal(page);
 await page.reload();
 await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
 await expect(page.getByRole('navigation',{name:'主导航'})).toBeHidden();
 await page.locator('.minimal-clock-gesture').press('ArrowUp');
 await page.locator('.minimal-clock-gesture').press('Escape');
 expect((await snapshot(page)).activeFocusSession).toBeNull();
 await page.locator('.minimal-clock-gesture').press('ArrowUp');
 await page.locator('.minimal-clock-gesture').press('Enter');
 await expect(page.locator('.focus-task-context')).toContainText(/专注中 第1\/\d+轮/);
 const session=(await snapshot(page)).activeFocusSession!;
 expect(session).toMatchObject({subtaskId:null,marathon:true,deferredSettlement:true});
 // 用户指示：极简专注运行中复用共用沉浸 UI，不再提供"返回完整模式"。
 await expect(page.getByRole('button',{name:'返回完整模式'})).toHaveCount(0);
 const total=await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!).totalRounds as number);
 for(let round=0;round<total;round++){
  await page.clock.fastForward(61_000);
  if(round+1<total)await page.locator('.minimal-break-clock').press('Enter');
 }
 await expect(page.locator('.marathon-progress-report')).toBeVisible();
 await expect(page.getByRole('navigation',{name:'主导航'})).toBeVisible();
 await page.locator('.marathon-progress-report').getByRole('button',{name:'提交本次推进'}).click();
 await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
 expect((await snapshot(page)).focusHistory.every(session=>session.settledAt!==undefined)).toBe(true);
 // DF-UI-05: the idle exit starts veiled but keyboard reachable; focus+Enter 返回完整模式.
 await page.locator(".minimal-exit").focus();
 await page.keyboard.press("Enter"); // DF-UI-05: keyboard path works even while the exit is veiled.
 await page.getByRole('button',{name:'统计',exact:true}).click();
 const unlockDialog=page.getByRole('dialog',{name:'新的成就'});
 await expect(unlockDialog).toBeVisible();
 await unlockDialog.getByRole('button',{name:'全部关闭'}).click();
 await expect(unlockDialog).toHaveCount(0);
 await page.locator('.achievements-disclosure summary').click();
 const achievements=page.locator('.achievements-panel');
 await expect(achievements).toContainText('第一块基石');
 await expect(achievements.locator('.achievement.unlocked').first()).toBeVisible();
 await page.reload();
 await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
 await expect(page.locator('.toast')).toHaveCount(0);
});

test('a failed preference write does not enable minimal mode',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='blockcolc-focus-preferences-v1')throw new Error('synthetic preference write failure');return original.call(this,key,value);};});
 await page.getByRole('checkbox',{name:'开启极简模式'}).click();
 await expect(page.getByRole('checkbox',{name:'开启极简模式'})).not.toBeChecked();
 await expect(page.locator('.toast')).toContainText('设置未保存');
});

test('a failed schedule write preserves the selected clock and never starts domain focus',async({page})=>{
 await minimal(page);
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='blockcolc-round-plan-v1')throw new Error('synthetic schedule write failure');return original.call(this,key,value);};});
 await page.locator('.minimal-clock-gesture').press('ArrowUp');
 await page.locator('.minimal-clock-gesture').press('Enter');
 await expect(page.locator('.minimal-clock-selection')).toBeVisible();
 await expect(page.locator('.minimal-clock-error')).toContainText('synthetic schedule write failure');
 expect((await snapshot(page)).activeFocusSession).toBeNull();
});

test('clock drag and double tap stay isolated from the blank-panel exit gesture',async({page})=>{
 await page.clock.install({time:new Date('2026-09-06T08:00:00Z')});
 await minimal(page);
 const clock=page.locator('.minimal-clock-gesture');
 await clock.dblclick();
 expect((await snapshot(page)).activeFocusSession).toBeNull();
 await expect(page.locator('.minimal-exit')).toHaveClass(/is-veiled/);
 const box=(await clock.boundingBox())!;
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
 await page.mouse.down();
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2-24,{steps:4});
 await page.mouse.up();
 await expect(clock).toHaveAccessibleName(/专注到今天 16:10/);
 expect((await snapshot(page)).activeFocusSession).toBeNull();
 const blank=page.locator('.focus-face-context');
 await blank.dblclick();
 await expect(page.locator('.minimal-exit')).not.toHaveClass(/is-veiled/);
 expect((await snapshot(page)).activeFocusSession).toBeNull();
 await blank.dblclick();
 await expect(page.locator('.minimal-exit')).toHaveClass(/is-veiled/);
 await clock.dblclick();
 await expect(page.locator('.focus-task-context')).toContainText(/专注中 第1\/\d+轮/);
 expect((await snapshot(page)).activeFocusSession).toMatchObject({deferredSettlement:true});
});

test('idle panel swipes to today focus without moving its glass panel or changing the clock draft',async({page})=>{
 await page.clock.install({time:new Date('2026-09-06T08:00:00Z')});
 await minimal(page);
 const carousel=page.locator('.minimal-idle-carousel');
 const panel=page.locator('.focus-panel');
 const before=(await panel.boundingBox())!;
 expect(before.height).toBe(266);
 await expect(page.locator('.minimal-idle-pages')).toHaveCount(0);
 const clock=page.locator('.minimal-clock-gesture');
 const box=(await clock.boundingBox())!;
 const x=box.x+box.width/2, y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-110,y+2,{steps:5});await page.mouse.up();
 await expect(carousel).toHaveAttribute('data-page','today');
 await expect(carousel).toHaveAccessibleName('极简信息面板：今日专注时间轴');
 await expect(carousel.getByRole('status')).toHaveText('今日专注时间轴面板');
 await expect(page.getByRole('region',{name:'今日专注时间轴',exact:true})).toBeVisible();
 await expect(page.locator('.minimal-idle-page').first()).toHaveAttribute('aria-hidden','true');
 await page.screenshot({path:'test-results/minimal-idle-today.png'});
 const geometry=await page.evaluate(()=>{
  const rect=(selector:string)=>{const r=document.querySelector(selector)!.getBoundingClientRect();return{x:r.x,width:r.width,right:r.right};};
  return{panel:rect('.focus-panel'),viewport:rect('.minimal-idle-viewport'),chart:rect('.minimal-today-chart'),rounds:rect('.minimal-today-heading p')};
 });
 expect(geometry.viewport.x-geometry.panel.x).toBeGreaterThanOrEqual(16);
 expect(geometry.panel.right-geometry.viewport.right).toBeGreaterThanOrEqual(16);
 expect(geometry.chart.right).toBeLessThanOrEqual(geometry.viewport.right);
 expect(geometry.rounds.right).toBeLessThanOrEqual(geometry.viewport.right);
 const after=(await panel.boundingBox())!;
 expect(Math.abs(after.x-before.x)).toBeLessThan(1);
 expect(Math.abs(after.y-before.y)).toBeLessThan(1);
 expect(Math.abs(after.height-before.height)).toBeLessThan(1);
  const today=(await page.locator('.minimal-idle-today-page').boundingBox())!;
  const carouselBounds=(await carousel.boundingBox())!;
  // A real thumb often ends beyond the fixed glass panel. The second page
  // must retain the pointer until release or the right-swipe cannot return.
  await page.mouse.move(today.x+today.width*.55,today.y+today.height/2);
  await page.mouse.down();await page.mouse.move(carouselBounds.x+carouselBounds.width+8,today.y+today.height/2,{steps:5});await page.mouse.up();
 await expect(carousel).toHaveAttribute('data-page','clock');
 await expect(page.locator('.minimal-idle-page').first()).toHaveAttribute('aria-hidden','false');
 await expect(clock).toBeVisible();
 await expect(clock).toHaveAccessibleName(/当前时间 16:00/);
 await carousel.focus();
 await page.keyboard.press('ArrowRight');
 await expect(carousel).toHaveAttribute('data-page','today');
 await page.keyboard.press('ArrowLeft');
 await expect(carousel).toHaveAttribute('data-page','clock');
});

test('minimal rest restores its deadline, skips on double tap and returns to remaining-plan time',async({page})=>{
 await page.clock.install({time:new Date('2026-09-06T08:00:00Z')});
 await setup(page);
 await page.getByRole('spinbutton',{name:'每轮休息分钟'}).fill('1');
 await page.getByRole('spinbutton',{name:'每轮休息分钟'}).blur();
 await page.getByRole('checkbox',{name:'开启极简模式'}).check();
 await page.getByRole('button',{name:'计时',exact:true}).click();
 const clock=page.locator('.minimal-clock-gesture');
 await clock.press('ArrowUp');
 await clock.press('ArrowUp');
 await clock.press('Enter');
 await page.clock.fastForward(61_000);
 const rest=page.locator('.minimal-break-clock');
 await expect(rest).toBeVisible();
 const deadline=await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!).breakEndsAt);
 expect(deadline).toBeTruthy();
 await page.reload();
 await expect(rest).toBeVisible();
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!).breakEndsAt)).toBe(deadline);
 await rest.dblclick();
 await expect(page.locator('.focus-task-context')).toContainText(/专注中 第2\/\d+轮/);
 await page.clock.fastForward(61_000);
 await expect(rest).toBeVisible();
 await page.clock.fastForward(61_000);
 await expect(page.locator('.minimal-ready-clock')).toContainText('05:00');
 expect((await snapshot(page)).activeFocusSession).toBeNull();
 await rest.press('Enter');
 await expect(page.locator('.focus-task-context')).toContainText(/专注中 第3\/\d+轮/);
});

test('dragging back to now clears the end-time draft and restores the live clock',async({page})=>{
 await page.clock.install({time:new Date('2026-09-06T08:00:00Z')});
 await minimal(page);
 const clock=page.locator('.minimal-clock-gesture');
 const box=(await clock.boundingBox())!;
 const x=box.x+box.width/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);
 await page.mouse.down();
 await page.mouse.move(x,y-24,{steps:4});
 await expect(clock).toHaveAccessibleName(/16:10/);
 await page.mouse.move(x,y,{steps:4});
 await page.mouse.up();
 await expect(clock).toHaveAccessibleName(/当前时间 16:00/);
 await expect(page.locator('.minimal-clock-selection')).toHaveCount(0);
 await clock.press('ArrowUp');
 await clock.press('ArrowDown');
 await page.clock.fastForward(61_000);
 await expect(clock).toHaveAccessibleName(/当前时间 16:01/);
 await clock.dblclick();
 expect((await snapshot(page)).activeFocusSession).toBeNull();
});

test('interrupting minimal focus preserves the plan and returns through the legal idle path',async({page})=>{
 await page.clock.install({time:new Date('2026-09-06T08:00:00Z')});
 await setup(page);
 await page.getByRole('spinbutton',{name:'每轮休息分钟'}).fill('1');
 await page.getByRole('spinbutton',{name:'每轮休息分钟'}).blur();
 await page.getByRole('checkbox',{name:'开启极简模式'}).check();
 await page.getByRole('button',{name:'计时',exact:true}).click();
 await page.locator('.minimal-clock-gesture').press('ArrowUp');
 await page.locator('.minimal-clock-gesture').press('ArrowUp');
 await page.locator('.minimal-clock-gesture').press('Enter');
 await expect(page.locator('.focus-task-context')).toContainText('专注中 第1/5轮');
 const planBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!));
 await page.clock.fastForward(15_000);
 await page.locator('.immersive-hint').dblclick();
 await page.getByRole('button',{name:'结束本次专注',exact:true}).click();
 await page.getByRole('button',{name:/中断本轮/}).click();
 await page.getByRole('button',{name:'不记录',exact:true}).click();
 await expect(page.locator('.minimal-ready-clock')).toContainText('09:00');
 await expect(page.locator('.minimal-clock-gesture')).toHaveCount(0);
 const planAfter=await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!));
  expect(planAfter).toMatchObject({endAt:planBefore.endAt,totalRounds:5,completedRounds:0,status:'ready',deferredSettlement:true});
  expect((await snapshot(page)).focusHistory.at(-1)?.status).toBe('interrupted');

  // Ready/break keep the shared immersive face and intentionally do not expose
  // a full-mode exit or navigation tabs.  Resume the retained plan and finish
  // it through the normal completion/report path before navigating again.
  await expect(page.getByRole('button',{name:'返回完整模式'})).toHaveCount(0);
  await page.locator('.minimal-ready-clock').dblclick();
  for(let round=0; round<5; round+=1){
   await expect(page.locator('.focus-task-context')).toContainText(`专注中 第${round+1}/5轮`);
   await page.clock.fastForward(61_000);
   if(round<4){
    const breakClock=page.locator('.minimal-break-clock');
    await expect(breakClock).toBeVisible();
    await breakClock.press('Enter');
   }
  }
  await expect(page.locator('.marathon-progress-report')).toBeVisible();
  await page.getByRole('button',{name:'一次提交本次推进'}).click();
  await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
  await page.locator('.minimal-exit').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'进入极简模式'})).toBeVisible();
  const enterMinimal=page.getByRole('button',{name:'进入极简模式'});
  await expectButtonReceivesPointer(enterMinimal);
  await enterMinimal.click();
  await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
  await page.reload();
  await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
  expect((await snapshot(page)).activeFocusSession).toBeNull();
});

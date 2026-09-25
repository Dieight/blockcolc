import {expect,test,type Page,type Locator} from '@playwright/test';
import {gzipSync} from 'node:zlib';
import {testNbt as nbt,writeJavaNbt} from '../../../packages/litematic/test/nbt-fixture.js';

const viewports=[{width:360,height:800},{width:412,height:915},{width:915,height:412},{width:768,height:1024},{width:1440,height:900}];
async function noOverflow(page:Page){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
}

async function material(locator:Locator){
 return locator.evaluate(element=>{const css=getComputedStyle(element);return {background:css.background,filter:css.backdropFilter,border:css.borderColor};});
}
async function touchSwipe(page:Page,from:{x:number;y:number},to:{x:number;y:number}){
 const panel=page.locator('.minimal-idle-carousel');
 await panel.evaluate(element=>{
  const root=element as HTMLElement&{gestureTrace:string[];recordGesture?:EventListener};
  root.gestureTrace=[];
  if(!root.recordGesture){
   root.recordGesture=event=>root.gestureTrace.push(`${event.type}:${(event as PointerEvent).pointerType}`);
   for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture'])root.addEventListener(type,root.recordGesture);
  }
 });
 const cdp=await page.context().newCDPSession(page);
 const point=(x:number,y:number)=>({x,y,id:1,radiusX:1,radiusY:1,force:1});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(from.x,from.y)]});
 for(let step=1;step<=8;step++){
  const progress=step/8;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(from.x+(to.x-from.x)*progress,from.y+(to.y-from.y)*progress)]});
 }
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const trace=await panel.evaluate(element=>(element as HTMLElement&{gestureTrace:string[]}).gestureTrace);
 await cdp.detach();
 return trace;
}
test('glass adjustment affects only immersive clocks, not reading surfaces',async({page})=>{
 test.setTimeout(90_000);
 await page.goto('/');
 await page.getByRole('button',{name:'开始建造',exact:true}).click();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('checkbox',{name:'开启极简模式'}).check();
 const samples=[];
 for(const key of ['Home','End']){
  await page.getByLabel('液态玻璃通透程度').press(key);
  const settings=await material(page.locator('.settings-list').first());
  await page.getByRole('button',{name:'计时',exact:true}).click();
  if(await page.getByRole('button',{name:'进入极简模式'}).isVisible())await page.getByRole('button',{name:'进入极简模式'}).click();
  await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
  const immersive=await material(page.locator('.focus-panel'));
  await page.locator('.minimal-exit').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'调整本次计划'}).click();
  const plan=await material(page.locator('.focus-plan-sheet'));
  await page.getByRole('button',{name:'关闭本次计划'}).click();
  await page.getByRole('button',{name:'任务',exact:true}).click();
  await page.locator('.choice-menu-trigger').click();
  const menu=await material(page.locator('.choice-menu-options'));
  samples.push({settings,immersive,plan,menu});
  await page.getByRole('button',{name:'设置',exact:true}).click();
 }
 expect(samples[0]!.immersive).not.toEqual(samples[1]!.immersive);
 expect(samples[0]!.settings).toEqual(samples[1]!.settings);
 expect(samples[0]!.plan).toEqual(samples[1]!.plan);
 expect(samples[0]!.menu).toEqual(samples[1]!.menu);
 expect(samples[0]!.plan.background).toEqual(samples[0]!.menu.background);
 expect(samples[0]!.plan.filter).toEqual(samples[0]!.menu.filter);
});

test('fixed calendar is outside the range section and task cards share hierarchy',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'开始建造',exact:true}).click();
 await page.getByRole('button',{name:'统计',exact:true}).click();
 const range=page.getByRole('region',{name:'按时间范围统计'});
 await expect(range.locator('.focus-calendar-chart')).toHaveCount(0);
 const calendar=page.locator('.focus-calendar-chart');
 const dates=await calendar.locator('[data-date]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-date')));
 await page.getByRole('button',{name:'近 7 天',exact:true}).click();
 expect(await calendar.locator('[data-date]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-date')))).toEqual(dates);
 await page.getByRole('button',{name:'任务',exact:true}).click();
 const surfaces=await page.locator('.tasks-page .task-surface').evaluateAll(elements=>elements.map(element=>{const css=getComputedStyle(element);return {background:css.backgroundColor,radius:css.borderRadius};}));
 expect(surfaces.length).toBeGreaterThanOrEqual(4);
 expect(surfaces.every(surface=>surface.background===surfaces[0]!.background&&surface.radius===surfaces[0]!.radius)).toBe(true);
 const summary=page.locator('.task-management-disclosure summary');
 await summary.click();
 expect(await summary.evaluate(element=>getComputedStyle(element).getPropertyValue('-webkit-tap-highlight-color'))).toBe('rgba(0, 0, 0, 0)');
 await summary.focus();
 await page.keyboard.press('Tab');
 await page.keyboard.press('Shift+Tab');
 await expect(summary).toHaveCSS('outline-color','rgb(194, 88, 68)');
});

test('minimal idle panel swaps content by horizontal gesture without resizing its glass surface',async({page})=>{
 await page.setViewportSize({width:360,height:800});
 await page.goto('/');
 await page.getByRole('button',{name:'开始建造',exact:true}).click();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('checkbox',{name:'开启极简模式'}).check();
 await page.getByRole('button',{name:'计时',exact:true}).click();
 const panel=page.locator('.minimal-idle-carousel');
 await expect(panel).toHaveAttribute('data-page','clock');
 const bounds=(await panel.boundingBox())!;
 const x=bounds.x+bounds.width/2;
 const y=bounds.y+bounds.height/2;
 await touchSwipe(page,{x,y},{x:x-140,y});
 await expect(panel).toHaveAttribute('data-page','today');
 expect((await panel.boundingBox())!.height).toBe(bounds.height);
 await expect(panel.getByText('今日专注', {exact:false}).first()).toBeVisible();
 const todayBounds=(await page.locator('.minimal-idle-today-page').boundingBox())!;
 await touchSwipe(page,{x:todayBounds.x+todayBounds.width/2,y:todayBounds.y+todayBounds.height/2},{x:todayBounds.x+todayBounds.width/2+12,y:todayBounds.y+todayBounds.height/2+110});
 await expect(panel).toHaveAttribute('data-page','today');
 const returnBounds=(await page.locator('.minimal-idle-today-page').boundingBox())!;
 const currentPanelBounds=(await panel.boundingBox())!;
 const rightTrace=await touchSwipe(page,{x:returnBounds.x+returnBounds.width*.55,y:returnBounds.y+returnBounds.height/2},{x:currentPanelBounds.x+currentPanelBounds.width+8,y:returnBounds.y+returnBounds.height/2+42});
 expect(rightTrace,`the today-page touch stream was ${rightTrace.join(', ')}`).not.toContain('pointercancel:touch');
 expect(rightTrace).toContain('pointerup:touch');
 await expect(panel,`the return swipe did not switch pages: ${rightTrace.join(', ')}`).toHaveAttribute('data-page','clock');
 await panel.focus();
 await page.keyboard.press('ArrowRight');
 await expect(panel).toHaveAttribute('data-page','today');
 await page.keyboard.press('ArrowLeft');
 await expect(panel).toHaveAttribute('data-page','clock');
 await page.locator('.minimal-exit').focus();
 await page.keyboard.press('Enter');
 await expect(panel).toHaveCount(0);
});

test('imported blueprint preview and controls remain legible in dark mode',async({page},info)=>{
 await page.setViewportSize({width:412,height:915});
 await page.goto('/');
 await page.getByRole('button',{name:'开始建造',exact:true}).click();
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('button',{name:'深色',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.getByLabel('导入 .litematic').setInputFiles({
  name:'dark-preview.litematic',mimeType:'application/octet-stream',buffer:tinyLitematic(),
 });

 const candidate=page.locator('.imported-blueprint-role');
 const preview=candidate.locator('.blueprint-preview');
 const canvas=preview.locator('canvas');
 await expect(candidate).toContainText('Dark preview');
 await expect(preview).toBeVisible();
 await expect.poll(async()=>Number(await canvas.getAttribute('data-render-calls')),{timeout:30_000}).toBeGreaterThan(0);
 await expect(preview).toHaveCSS('background-color','rgb(16, 25, 21)');
 await expect(candidate).toHaveCSS('background-color','rgb(23, 33, 28)');
 await expect(candidate).toHaveCSS('color','rgb(230, 239, 233)');
 await candidate.screenshot({path:info.outputPath('dark-blueprint-import-preview.png'),animations:'disabled'});
});

for(const viewport of viewports)for(const theme of ['浅色','深色']){
 test(`redesigned daily screens ${viewport.width}x${viewport.height} ${theme}`,async({page},info)=>{
  test.setTimeout(90_000);
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.getByRole('button',{name:'开始建造',exact:true}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:theme,exact:true}).click();
  await page.getByRole('checkbox',{name:'开启极简模式'}).check();
  await page.getByRole('button',{name:'计时',exact:true}).click();
  const clock=page.locator('.minimal-clock-gesture');
  await expect(clock).toBeVisible();
  const timer=(await clock.locator('.timer').boundingBox())!;
  const panel=(await page.locator('.focus-panel').boundingBox())!;
  expect(Math.abs(timer.y+timer.height/2-panel.y-panel.height/2)).toBeLessThan(3);
  await noOverflow(page);
  await page.screenshot({path:info.outputPath('minimal-idle.png'),fullPage:true,animations:'disabled'});
  await page.locator('.minimal-exit').focus();
  await page.keyboard.press('Enter');
  const group=page.locator('.workbench-heading-actions');
  const entry=(await group.locator('.minimal-entry').boundingBox())!;
  const tasks=(await group.getByRole('button',{name:'切换当前工作'}).boundingBox())!;
  expect(tasks.x-entry.x-entry.width).toBeLessThanOrEqual(12);
  expect(entry.width).toBeGreaterThanOrEqual(44);
  await page.getByRole('button',{name:'统计',exact:true}).click();
  await expect(page.getByRole('heading',{name:'专注轨迹'})).toBeVisible();
  await expect(page.locator('.achievements-disclosure')).not.toHaveAttribute('open','');
  await page.getByRole('button',{name:'近 7 天',exact:true}).click();
  await expect(page.locator('.stats-duration')).toContainText('近 7 天');
  await noOverflow(page);
  await page.screenshot({path:info.outputPath('statistics.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'任务',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看建筑',exact:true})).toBeVisible();
  await page.locator('.task-management-disclosure summary').click();
  await expect(page.getByRole('button',{name:'删除当前任务',exact:true})).toBeVisible();
  await noOverflow(page);
  await page.screenshot({path:info.outputPath('tasks.png'),fullPage:true,animations:'disabled'});
 });
}

function tinyLitematic():Buffer{
 const point=(x:number,y:number,z:number)=>nbt.compound({x:nbt.int(x),y:nbt.int(y),z:nbt.int(z)});
 const region=nbt.compound({
  Size:point(1,1,1),Position:point(0,0,0),
  BlockStatePalette:nbt.list(10,[nbt.compound({Name:nbt.string('minecraft:stone')})]),
  BlockStates:nbt.longArray([0n]),Entities:nbt.list(10,[]),TileEntities:nbt.list(10,[]),
  PendingBlockTicks:nbt.list(10,[]),PendingFluidTicks:nbt.list(10,[]),
 });
 const root=nbt.compound({
  Version:nbt.int(7),SubVersion:nbt.int(1),MinecraftDataVersion:nbt.int(3953),
  Metadata:nbt.compound({Name:nbt.string('Dark preview'),Author:nbt.string('Test'),Description:nbt.string('')}),
  Regions:nbt.compound({preview:region}),
 });
 return gzipSync(writeJavaNbt(root));
}

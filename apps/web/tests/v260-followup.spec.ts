import {test,expect,type Page} from '@playwright/test';
import {waitForPreparedWorld} from './world-ready';
import {createInitialState,execute,type DomainCommand} from '@blockcolc/domain';
async function setup(page:Page){
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({focusMinutes:25,breakMinutes:5,lightingQuality:'performance',themeMode:'light'})));
  await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();return waitForPreparedWorld(page);
}
test('fresh install guide covers six sections once, keeps mandatory creation and can replay from settings',async({page},info)=>{
  test.setTimeout(120000);await page.emulateMedia({reducedMotion:'reduce'});
  await page.addInitScript(()=>{
    if(!sessionStorage.getItem('tutorial-fixture-entered')){localStorage.removeItem('blockcolc-onboarding-v1');sessionStorage.setItem('tutorial-fixture-entered','1');}
    if(!localStorage.getItem('blockcolc-focus-preferences-v1'))localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({lightingQuality:'performance',themeMode:'light'}));
  });
  await page.goto('/');const dialog=page.getByRole('dialog',{name:'把事情建成建筑'});
  await expect(dialog).toBeVisible();await expect(page.locator('.boot-page')).toHaveCount(0);
  const layout=await dialog.evaluate(sheet=>{const rect=sheet.getBoundingClientRect(),style=getComputedStyle(sheet);return {left:rect.left,right:rect.right,bottom:rect.bottom,width:innerWidth,height:innerHeight,radius:style.borderRadius,sideBorder:style.borderLeftWidth,featureBorders:[...sheet.querySelectorAll('.tutorial-features>div')].map(row=>getComputedStyle(row).borderLeftWidth)};});
  expect(layout.left).toBe(0);expect(layout.right).toBe(layout.width);expect(layout.bottom).toBe(layout.height);expect(layout.radius).toBe('0px');expect(layout.sideBorder).toBe('0px');expect(layout.featureBorders).toEqual(['0px','0px','0px']);
  await expect(dialog.locator('.tutorial-feature-index')).toHaveText(['01','02','03']);
  await page.screenshot({path:info.outputPath('first-install-guide.png')});
  for(const title of ['开始、休息、汇报','逛逛你的聚落','让投入留下痕迹','回看时间花在哪里','按自己的习惯调整']){
    await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.getByRole('dialog',{name:title})).toBeVisible();
  }
  await page.getByRole('button',{name:'开始使用',exact:true}).click();await expect(page.getByRole('heading',{name:'建立你的第一项任务'})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('blockcolc-onboarding-v1'))).toBe('1');
  await page.reload();await expect(page.locator('.tutorial-sheet')).toHaveCount(0);await page.getByRole('button',{name:'开始建造',exact:true}).click();await waitForPreparedWorld(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'重新查看',exact:true}).click();await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(page.getByRole('heading',{name:'设置',exact:true})).toBeVisible();
  await page.getByRole('group',{name:'深色模式',exact:true}).getByRole('button',{name:'深色',exact:true}).click();
  await page.getByRole('button',{name:'重新查看',exact:true}).click();await expect(dialog).toBeVisible();
  const glass=await dialog.evaluate(sheet=>({background:getComputedStyle(sheet).backgroundImage,filter:getComputedStyle(sheet).backdropFilter,border:getComputedStyle(sheet).borderLeftWidth}));
  await page.screenshot({path:info.outputPath('dark-edge-guide.png')});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'关于方块钟',exact:true}).click();
  const about=page.getByRole('dialog',{name:'方块钟 blockcolc',exact:true});await expect(about).toBeVisible();
  expect(await about.evaluate(sheet=>({background:getComputedStyle(sheet).backgroundImage,filter:getComputedStyle(sheet).backdropFilter,border:getComputedStyle(sheet).borderLeftWidth}))).toEqual(glass);
  await page.getByRole('button',{name:'关闭关于页面',exact:true}).click();
  await page.reload();await waitForPreparedWorld(page);await expect(dialog).toHaveCount(0);
});
test('calendar sweep uses only gray and the real daily green in both themes',async({page},info)=>{
  test.setTimeout(120000);await page.clock.setFixedTime(new Date('2026-10-08T04:00:00Z'));
  await page.addInitScript(()=>{if(!localStorage.getItem('blockcolc-focus-preferences-v1'))localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({lightingQuality:'performance',themeMode:'light'}));});
  await page.goto('/');await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state','ready');
  let state=createInitialState('Asia/Shanghai');
  const run=(command:DomainCommand,time:number)=>{const result=execute(state,command,{now:()=>new Date(time)});if(!result.ok)throw Error(result.message);state=result.state;};
  const beginning=Date.parse('2026-10-04T04:00:00+08:00');
  run({type:'CreateProject',projectId:'sweep-project',title:'专注的颜色',blueprintId:'builtin-small-workshop',subtasks:[{id:'sweep-work',title:'一天一段'}]},beginning-1000);
  for(const [index,minutes] of [60,240,420,600].entries()){
    const time=beginning+index*86400000,id=`sweep-${index}`;
    run({type:'StartFocus',sessionId:id,subtaskId:'sweep-work',plannedDurationMs:minutes*60000},time);
    run({type:'CompleteFocus'},time+minutes*60000);
    run({type:'ReportSubtaskProgress',reportId:`${id}-report`,subtaskId:'sweep-work',focusSessionIds:[id],progressBasisPoints:(index+1)*2000},time+minutes*60000+1000);
  }
  await page.evaluate(async next=>{
    const database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('blockcolc-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{await new Promise<void>((resolve,reject)=>{const transaction=database.transaction('appState','readwrite'),store=transaction.objectStore('appState'),current=store.get('current');current.onsuccess=()=>store.put({id:'current',revision:(current.result?.revision??0)+1,state:{...next,decorationBlueprintResources:current.result?.state?.decorationBlueprintResources??next.decorationBlueprintResources}});transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});}finally{database.close();}
  },state);
  for(const theme of ['light','dark']){
    await page.reload();await waitForPreparedWorld(page);await page.getByRole('button',{name:'设置',exact:true}).click();
    await page.getByRole('group',{name:'深色模式',exact:true}).getByRole('button',{name:theme==='light'?'浅色':'深色',exact:true}).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme',theme);await page.getByRole('button',{name:'统计',exact:true}).click();
    const achievements=page.getByRole('button',{name:'全部关闭',exact:true});
    if(theme==='light'){await expect(achievements).toBeVisible();await achievements.click();}
    await expect(page.getByRole('dialog',{name:'新的成就'})).toHaveCount(0);
    const chart=page.locator('.focus-calendar-chart');await expect(chart).toHaveClass(/is-revealed/);await chart.scrollIntoViewIfNeeded();
    const samples=await chart.evaluate(svg=>{
      // CSS animations serialize mixed colors as Oklab; compare exact rendered
      // sRGB pixels, not equivalent rgb/color()/oklab() spellings.
      const probe=document.createElement('canvas');probe.width=probe.height=1;const context=probe.getContext('2d')!;
      const rgba=(value:string)=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].join(',');};
      return [0,1,2,3,4].map(level=>{
        const cell=svg.querySelector<SVGRectElement>(`.calendar-day[data-level="${level}"]:not([data-future]) .calendar-pixel`)!;
        const animation=cell.getAnimations()[0]!,timing=animation.effect!.getTiming(),delay=Number(timing.delay),duration=Number(timing.duration);
        animation.pause();animation.currentTime=0;const gray=getComputedStyle(cell).fill;
        animation.currentTime=delay+duration/2;const midway=getComputedStyle(cell).fill;
        animation.currentTime=delay+duration;const final=getComputedStyle(cell).fill;
        const expected=level===0?gray:getComputedStyle(svg.parentElement!.querySelector(`.calendar-legend i[data-level="${level}"]`)!).backgroundColor;
        return {level,gray:rgba(gray),midway:rgba(midway),final:rgba(final),expected:rgba(expected),css:{gray,midway,final,expected}};
      });
    });
    await info.attach(`calendar-${theme}-colors`,{body:JSON.stringify(samples,null,2),contentType:'application/json'});
    expect(new Set(samples.map(sample=>sample.gray)).size,JSON.stringify(samples)).toBe(1);
    for(const sample of samples){expect(sample.midway).toBe(sample.gray);expect(sample.final).toBe(sample.expected);if(sample.level>0)expect(sample.final).not.toBe(sample.gray);}
    await chart.evaluate(svg=>svg.querySelectorAll('.calendar-pixel').forEach(cell=>cell.getAnimations().forEach(animation=>{animation.pause();animation.currentTime=0;})));
    await page.screenshot({path:info.outputPath(`heatmap-${theme}-gray.png`)});
    await chart.evaluate(svg=>svg.querySelectorAll('.calendar-pixel').forEach(cell=>cell.getAnimations().forEach(animation=>{animation.currentTime=Number(animation.effect!.getTiming().delay)+Number(animation.effect!.getTiming().duration);})));
    await page.screenshot({path:info.outputPath(`heatmap-${theme}-green.png`)});
    await page.emulateMedia({reducedMotion:'reduce'});expect(await chart.locator('.calendar-pixel').first().evaluate(cell=>getComputedStyle(cell).animationName)).toBe('none');await page.emulateMedia({reducedMotion:'no-preference'});
  }
});
test('task disclosure keeps both icon centers, portal is the only timer action and edit/brand share small motion',async({page},info)=>{
  test.setTimeout(120000);await setup(page);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await expect(page.getByRole('button',{name:'切换当前工作',exact:true})).toHaveCount(0);
  await expect(page.locator('.workbench-heading-actions')).toBeEmpty();
  await page.getByRole('button',{name:'任务',exact:true}).click();await page.emulateMedia({reducedMotion:'no-preference'});
  const disclosure=page.locator('.project-portfolio-toggle');
  const bounds=()=>disclosure.evaluate(button=>{const parent=button.getBoundingClientRect();return [...button.querySelectorAll(':scope > svg')].map(icon=>{const r=icon.getBoundingClientRect();return{x:r.x-parent.x,y:r.y-parent.y,width:r.width,height:r.height,transform:getComputedStyle(icon).transform};});});
  const initial=await bounds();await disclosure.click();await page.waitForTimeout(1100);
  expect(await bounds()).toEqual(initial);await expect(disclosure).toHaveAttribute('aria-expanded','true');
  expect(await disclosure.locator('.pixel-disclosure-stem').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).d)).toBe(0);
  await disclosure.click();await page.waitForTimeout(1100);expect(await bounds()).toEqual(initial);
  const edit=page.getByRole('button',{name:'调整今日目标',exact:true});
  const editMotion=await edit.evaluate(button=>{(button as HTMLButtonElement).click();return button.querySelector('svg')!.getAnimations().map(a=>(a.effect as KeyframeEffect).getKeyframes());});
  expect(editMotion[0]?.some(k=>String(k.transform).includes('rotate'))).toBe(true);await page.getByRole('button',{name:'关闭今日目标',exact:true}).click();
  const brand=page.getByRole('button',{name:'跳一跳，方块钟'});
  const brandMotion=await brand.evaluate(button=>{(button as HTMLButtonElement).click();return button.querySelector('svg')!.getAnimations().map(a=>(a.effect as KeyframeEffect).getKeyframes());});
  expect(brandMotion[0]?.some(k=>String(k.transform).includes('scale(1.16'))).toBe(true);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('开启极简模式',{exact:true}).check();
  await page.getByRole('button',{name:'计时',exact:true}).click();await page.locator('.focus-panel').dblclick({position:{x:16,y:18}});await page.getByRole('button',{name:'返回完整模式',exact:true}).click();
  await expect(page.locator('.app-shell')).not.toHaveAttribute('data-mode-portal-active','true');
  await expect(page.locator('.workbench-heading-actions > button')).toHaveCount(1);await expect(page.getByRole('button',{name:'进入极简模式',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('timer-single-portal-entry.png')});expect(errors).toEqual([]);
});
test('outline switches retain the world, startup drains its queue, heatmap lights chronologically without replay on selection',async({page},info)=>{
  test.setTimeout(120000);const canvas=await setup(page);
  expect(await canvas.getAttribute('data-initial-gpu-preparation')).toBe('complete');
  const initial={generation:await canvas.getAttribute('data-renderer-generation'),rebuilds:await canvas.getAttribute('data-world-rebuild-count')};
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const outlines=page.getByRole('group',{name:'施工轮廓',exact:true});
  for(const [name,value] of [['全部','all'],['关闭','off'],['当前','current']]){
    await outlines.getByRole('button',{name,exact:true}).click();
    await expect(page.locator('.app-shell')).not.toHaveAttribute('data-world-preparing','true');
    await expect(canvas).toHaveAttribute('data-construction-outline-visibility',value);
    await expect(canvas).toHaveAttribute('data-renderer-generation',initial.generation!);await expect(canvas).toHaveAttribute('data-world-rebuild-count',initial.rebuilds!);
    const count=Number(await canvas.getAttribute('data-planned-outline-voxel-count'));expect(value==='off'?count===0:count>0).toBe(true);
  }
  await page.getByRole('button',{name:'统计',exact:true}).click();await page.emulateMedia({reducedMotion:'no-preference'});
  const chart=page.locator('.focus-calendar-chart');await expect(chart).toHaveClass(/is-revealed/);
  const delays=await chart.locator('.calendar-day:not([data-future]) .calendar-pixel').evaluateAll(cells=>cells.map(e=>Number.parseFloat(getComputedStyle(e).animationDelay)));
  expect(delays.length).toBeGreaterThan(170);expect(delays[0]).toBe(0);expect(delays.at(-1)).toBeCloseTo(.9);
  for(let i=1;i<delays.length;i++)if(i%7===0)expect(delays[i]).toBeGreaterThan(delays[i-1]!);else expect(delays[i]).toBe(delays[i-1]);
  const colors=await chart.evaluate(svg=>{
    const cells=[...svg.querySelectorAll<SVGRectElement>('.calendar-day:not([data-future]) .calendar-pixel')];
    return cells.map(cell=>{const animation=cell.getAnimations()[0]!;animation.pause();animation.currentTime=0;const gray=getComputedStyle(cell).fill;animation.currentTime=Number(animation.effect!.getTiming().delay)+Number(animation.effect!.getTiming().duration);const final=getComputedStyle(cell).fill;const frames=(animation.effect as KeyframeEffect).getKeyframes();animation.play();return {gray,final,easing:getComputedStyle(cell).animationTimingFunction,filters:frames.map(frame=>frame.filter),frames:frames.length};});
  });
  expect(new Set(colors.map(cell=>cell.gray)).size).toBe(1);expect(colors.every(cell=>cell.easing==='steps(1)'&&cell.frames===2&&cell.filters.every(filter=>filter===undefined))).toBe(true);
  await chart.press('ArrowLeft');await expect(chart.locator('[aria-selected="true"]')).toHaveCount(1);
  await page.screenshot({path:info.outputPath('chronological-heatmap.png')});
  await page.emulateMedia({reducedMotion:'reduce'});expect(await chart.locator('.calendar-pixel').first().evaluate(e=>getComputedStyle(e).animationName)).toBe('none');
});

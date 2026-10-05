import {expect,test,type Page} from '@playwright/test';
import {choosePlanEndTime} from './focus-plan-controls';
import {expandGlassSetting} from './expand-glass-setting';
import {readPersistedDomainState} from './persisted-domain-state';

async function setup(page:Page){
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.setFixedTime(new Date('2026-10-04T04:00:00Z'));
  await page.addInitScript(()=>localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({minimalMode:false,focusMinutes:1,breakMinutes:0,lightingQuality:'performance',themeMode:'dark',focusGlassTransparency:100})));
  await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','true',{timeout:30000});
  await expect(page.locator('.boot-page')).toHaveCount(0);
}

test('glass shows one summary percentage and pixel rail fill tracks the predicted landing, not the held ball',async({page},info)=>{
  test.setTimeout(90000);await setup(page);await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const input=await expandGlassSetting(page),physical=input.locator('..'),summary=page.locator('.glass-transparency-value');
  await input.fill('50');await physical.scrollIntoViewIfNeeded();
  const rail=physical.locator('.physical-slider-rail'),rect=(await rail.boundingBox())!;
  await page.mouse.move(rect.x+rect.width/2,rect.y+3);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width/2-25,rect.y+51,{steps:8});
  await expect(summary).toContainText('预计');await expect(physical.locator('output')).toHaveCount(0);
  await expect(page.locator('.glass-transparency-expanded .glass-transparency-value')).toHaveCount(0);
  const predicted=Number((await summary.innerText()).match(/\d+/)![0]);
  expect(predicted).toBeGreaterThan(50);
  const progress=physical.locator('.physical-slider-progress');
  const fill=await progress.evaluate(element=>({width:element.getBoundingClientRect().width,image:getComputedStyle(element).backgroundImage}));
  expect(fill.width).toBeCloseTo(rect.width*predicted/100,0);expect(fill.image).toContain('repeating-linear-gradient');
  await page.screenshot({path:info.outputPath('one-glass-prediction.png')});
  await page.mouse.up();await expect(summary).not.toContainText('预计');
  await expect(physical).toHaveAttribute('data-flight','idle');await expect(input).toHaveValue(String(predicted));
});

test('unstarted marathon confirms and cancels on its stable sheet without reason fields or an immersive flash',async({page},info)=>{
  test.setTimeout(90000);await setup(page);await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();
  const sheet=page.getByRole('dialog',{name:'安排下一轮'});
  await sheet.getByRole('button',{name:'按结束时间',exact:true}).click();await choosePlanEndTime(sheet,'12:05');
  await page.evaluate(()=>{
    const samples:{immersive:boolean;reason:boolean;confirm:boolean;cancel:boolean}[]=[];
    const record=()=>samples.push({immersive:document.querySelector('.app-shell')!.classList.contains('focus-immersive'),reason:Boolean(document.querySelector('[aria-label="取消原因"]')),confirm:Boolean(document.querySelector('.plan-confirm:not(.destructive)')),cancel:Boolean(document.querySelector('.plan-confirm.destructive'))});
    const observer=new MutationObserver(record);observer.observe(document.body,{subtree:true,childList:true,attributes:true});
    Object.assign(window,{__planSheetWatch:{samples,stop:()=>observer.disconnect()}});
  });
  await sheet.getByRole('button',{name:'确认计划',exact:true}).click();await expect(sheet).toBeHidden();
  await expect(page.getByRole('button',{name:'开始到 12:05',exact:true})).toBeVisible();
  const confirmation=await page.evaluate(()=>{const w=window as typeof window&{__planSheetWatch:{samples:unknown[]}};return w.__planSheetWatch.samples.splice(0);}) as {immersive:boolean;reason:boolean;cancel:boolean}[];
  expect(confirmation.some(sample=>sample.immersive||sample.reason||sample.cancel)).toBe(false);
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();
  await expect(sheet.getByRole('button',{name:'取消计划',exact:true})).toBeVisible();
  await expect(sheet.getByLabel('取消原因')).toHaveCount(0);
  await sheet.getByRole('button',{name:'取消计划',exact:true}).click();await expect(sheet).toBeHidden();
  const cancellation=await page.evaluate(()=>{const w=window as typeof window&{__planSheetWatch:{samples:unknown[];stop():void}};w.__planSheetWatch.stop();return w.__planSheetWatch.samples;}) as {immersive:boolean;reason:boolean;confirm:boolean}[];
  expect(cancellation.some(sample=>sample.immersive||sample.reason||sample.confirm)).toBe(false);
  expect((await readPersistedDomainState(page)).state.focusHistory).toHaveLength(0);
  await expect(page.getByRole('button',{name:'开始 1 轮',exact:true})).toBeVisible();
  await info.attach('stable-sheet', {body:JSON.stringify({confirmation,cancellation}),contentType:'application/json'});
});

test('environment busy lifetime covers the new renderer and two warm frames; loader SVG stays static',async({page},info)=>{
  test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await setup(page);await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.evaluate(()=>{
    const samples:{pending:boolean;loader:boolean;busy:boolean;environment?:string;frames?:string;svgAnimations:number;spinner:string}[]=[];
    const sample=()=>{
      const root=document.querySelector<HTMLElement>('.app-shell')!,loader=root.querySelector('.boot-page'),canvas=root.querySelector<HTMLCanvasElement>('[aria-label="项目建筑世界"]');
      samples.push({pending:root.dataset.worldPreparing==='true',loader:Boolean(loader),busy:root.querySelector('[aria-label="聚落环境"] [aria-busy="true"]')!==null,environment:canvas?.dataset.environmentStyle,frames:canvas?.dataset.openingPreparedFrames,
        svgAnimations:loader?[...loader.querySelectorAll('svg *')].filter(element=>getComputedStyle(element).animationName!=='none').length:0,
        spinner:loader?getComputedStyle(loader.querySelector('.boot-page-model')!,'::after').animationName:''});
    };
    const observer=new MutationObserver(sample);observer.observe(document.body,{subtree:true,attributes:true,childList:true});Object.assign(window,{__environmentWatch:{samples,stop:()=>observer.disconnect()}});
  });
  const environments=page.getByRole('group',{name:'聚落环境',exact:true});
  await environments.getByRole('button',{name:'自然山谷',exact:true}).click();
  await expect(environments.getByRole('button',{name:'自然山谷',exact:true})).toHaveAttribute('aria-busy','false',{timeout:45000});
  await expect(page.locator('.app-shell')).not.toHaveAttribute('data-world-preparing','true');
  const canvas=page.getByLabel('项目建筑世界');await expect(canvas).toHaveAttribute('data-environment-style','natural-valley');
  await expect(canvas).toHaveAttribute('data-opening-prepared-frames','2');
  await expect(canvas).toHaveAttribute('data-initial-preparation-render-count','2');
  expect(Number(await canvas.getAttribute('data-initial-shader-preparation-ms'))).toBeGreaterThanOrEqual(0);
  expect(Number(await canvas.getAttribute('data-initial-presentation-preparation-ms'))).toBeGreaterThanOrEqual(Number(await canvas.getAttribute('data-initial-shader-preparation-ms')));
  const samples=await page.evaluate(()=>{const w=window as typeof window&{__environmentWatch:{samples:unknown[];stop():void}};w.__environmentWatch.stop();return w.__environmentWatch.samples;}) as {pending:boolean;loader:boolean;busy:boolean;environment:string;frames:string;svgAnimations:number;spinner:string}[];
  expect(samples.some(sample=>sample.pending&&sample.loader&&sample.busy)).toBe(true);
  expect(samples.some(sample=>sample.loader&&sample.svgAnimations>0)).toBe(false);
  expect(samples.some(sample=>sample.pending&&sample.spinner==='control-spin')).toBe(true);
  const lastPending=samples.reduce((last,sample,index)=>sample.pending?index:last,-1);
  expect(samples.slice(lastPending+1).filter(sample=>!sample.pending).every(sample=>sample.environment==='natural-valley'&&sample.frames==='2')).toBe(true);
  await page.getByRole('button',{name:'计时',exact:true}).click();
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','true');
  await page.screenshot({path:info.outputPath('prepared-valley-after-switch.png')});
  await info.attach('real-scene-preparation', {body:JSON.stringify(samples),contentType:'application/json'});expect(errors).toEqual([]);
});

test('refresh rotates one compositor layer; other busy actions use the shared three-circle mask and the dark brand has no raster backdrop',async({page},info)=>{
  test.setTimeout(90000);await setup(page);await page.emulateMedia({reducedMotion:'no-preference'});
  const brand=page.locator('.app-brand .pixel-brand');await expect(brand.locator('image')).toHaveCount(0);
  await expect(brand).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const refresh=page.getByRole('button',{name:'刷新可恢复备份',exact:true});await refresh.click();
  await expect(refresh).toHaveAttribute('aria-busy','true');
  await expect(refresh.locator('.refresh-motion')).toHaveCSS('animation-name','control-spin');
  await expect(refresh.locator('.refresh-motion')).toHaveCSS('will-change','transform');
  await expect(refresh.locator('[data-pixel-icon=reset]')).toHaveCSS('animation-name','none');
  expect(await refresh.evaluate(element=>getComputedStyle(element,'::after').display)).toBe('none');
  await expect(refresh).toHaveAttribute('aria-busy','false');
  // Inspect the actual shared state skin without invoking a native file picker.
  const exporting=page.getByRole('button',{name:/导出 JSON/}).first();
  const skin=await exporting.evaluate(element=>{element.setAttribute('aria-busy','true');const css=getComputedStyle(element,'::after');const result={animation:css.animationName,mask:css.maskImage,shadow:css.boxShadow,border:css.borderWidth};element.setAttribute('aria-busy','false');return result;});
  expect(skin.animation).toBe('control-spin');expect(skin.mask).toContain('svg');expect(skin.shadow).toBe('none');expect(skin.border).toBe('0px');
  await page.screenshot({path:info.outputPath('dark-settings-brand.png')});
});

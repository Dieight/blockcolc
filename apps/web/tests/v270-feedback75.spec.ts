import {expect,test,type Page,type Locator} from '@playwright/test';
import {readPersistedDomainState} from './persisted-domain-state';

async function setup(page:Page,preferences:Record<string,unknown>={}){
  await page.clock.setFixedTime(new Date('2026-10-11T04:00:00Z'));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(p=>{if(!localStorage.getItem('blockcolc-focus-preferences-v1'))localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({minimalMode:false,focusMinutes:5,breakMinutes:0,lightingQuality:'performance',...p}));},preferences);
  await page.goto('/');await page.getByRole('button',{name:/^(开始建造|Start building)$/,exact:true}).click();
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','true',{timeout:45000});
  await expect(page.locator('.boot-page')).toHaveCount(0);
  await expect(page.locator('canvas[data-world-canvas]')).toHaveAttribute('data-opening-reveal-state','completed');
}
async function touchSwipe(page:Page,target:Locator,direction:1|-1,vertical=8){
  const box=(await target.boundingBox())!;
  const x=box.x+box.width*(direction===1?.22:.78),y=box.y+box.height*.45,dx=box.width*.55*direction;
  const cdp=await page.context().newCDPSession(page);
  try{
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/8,y:y+vertical*i/8}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }finally{await cdp.detach();}
}

test('both language names are stable; all supplemental and reward metadata and preview HUD translate',async({page},info)=>{
  test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();const language=page.getByRole('group',{name:'界面语言',exact:true});
  await expect(language.getByRole('button')).toHaveText(['简体中文','English']);await language.getByRole('button',{name:'English',exact:true}).click();
  await expect(page.getByRole('group',{name:'App language',exact:true}).getByRole('button')).toHaveText(['简体中文','English']);
  const library=page.locator('.blueprint-library');await library.getByRole('button',{name:/All blueprints/}).click();
  await expect(library.locator('details[open]')).toHaveCount(0);
  for(const group of ['Supplemental','Daily rewards']){
    const details=library.locator('details').filter({has:page.locator('summary').filter({hasText:group})});await details.locator('summary').click();
    const names=await details.locator('.library-preview-action strong').allTextContents(),descriptions=await details.locator('.library-preview-action small').allTextContents();
    expect(names.length).toBeGreaterThan(0);expect([...names,...descriptions].join(' ')).not.toMatch(/[\u3400-\u9fff]/);
    await details.locator('.library-preview-action').first().click();const modal=page.getByRole('dialog',{name:'Blueprint preview',exact:true});
    await expect(modal.locator('.preview-hud')).toBeVisible();expect(await modal.locator('.preview-hud').innerText()).not.toMatch(/[\u3400-\u9fff]/);
    await modal.getByRole('button',{name:'Close blueprint preview'}).click();await details.locator('summary').click();
  }
  await page.getByRole('button',{name:'Timer',exact:true}).click();await page.getByRole('button',{name:'Adjust this plan',exact:true}).click();
  const sheet=page.getByRole('dialog');await sheet.getByRole('button',{name:'End time',exact:true}).click();
  await sheet.getByRole('slider').press('ArrowUp');await expect(sheet.locator('.minimal-clock-selection')).toContainText('Ends Today');
  expect(await sheet.locator('.minimal-clock-selection').innerText()).not.toMatch(/[\u3400-\u9fff]/);
  await page.screenshot({path:info.outputPath('english-plan-complete.png')});expect(errors).toEqual([]);
});

test('native Chinese composition commits once by button or Enter, and completed notes fold and restore',async({page},info)=>{
  test.setTimeout(120000);await setup(page,{quickNotesEnabled:true});await page.getByRole('button',{name:'任务',exact:true}).click();
  const notes=page.locator('.quick-notes'),entry=notes.getByRole('textbox',{name:'写一条便签'});
  await expect(notes).not.toContainText('留一件小事慢慢完成');
  const heading=await notes.locator('h2').evaluate(el=>({font:getComputedStyle(el).fontSize,icon:el.querySelector('svg')!.getBoundingClientRect().width}));
  expect(heading).toEqual({font:'17px',icon:20});
  const prevented=await entry.evaluate((input:HTMLInputElement)=>{
    input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value='先读一章';
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'先读一章',isComposing:true}));
    const key=new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true});input.dispatchEvent(key);
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'先读一章'}));
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromComposition',data:'先读一章'}));return key.defaultPrevented;
  });
  expect(prevented).toBe(true);await expect(notes.getByRole('checkbox')).toHaveCount(0);await notes.getByRole('button',{name:'添加便签'}).click();
  await expect(notes.getByRole('checkbox',{name:'完成便签：先读一章',exact:true})).toBeVisible();await expect(entry).toHaveValue('');
  await entry.fill('再写一页');await entry.press('Enter');await expect(notes.getByRole('checkbox')).toHaveCount(2);
  // Completing moves this control into a closed disclosure. Assert the resulting
  // UI rather than asking check() to inspect the now-hidden original control.
  await notes.getByRole('checkbox',{name:'完成便签：先读一章',exact:true}).click();await expect(notes.locator('.quick-notes-completed')).toBeVisible();
  await expect(notes.locator('.quick-notes-completed')).not.toHaveAttribute('open','');await expect(notes.getByRole('checkbox')).toHaveCount(1);
  await notes.locator('.quick-notes-completed summary').click();await notes.getByRole('checkbox',{name:'完成便签：先读一章',exact:true}).uncheck();
  await expect(notes.locator('.quick-notes-completed')).toHaveCount(0);expect((await readPersistedDomainState(page)).state.quickNotes).toHaveLength(2);
  await page.screenshot({path:info.outputPath('pixel-notes-tasks.png')});
});

for(const theme of ['light','dark'])test(`expanded world debug shares settings rows and switches in ${theme} English`,async({page},info)=>{
  test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await setup(page,{language:'en',themeMode:theme});await page.getByRole('button',{name:'Settings',exact:true}).click();
  const debug=page.locator('.world-debug-settings');await debug.getByRole('checkbox',{name:'Temporary world preview',exact:true}).check();
  await debug.getByRole('checkbox',{name:'Set time',exact:true}).check();await debug.getByRole('checkbox',{name:'Set amount',exact:true}).check();
  const switches=await debug.locator('.ios-switch').evaluateAll(elements=>elements.map(el=>{const b=el.getBoundingClientRect();return {right:b.right,width:b.width,height:b.height};}));
  expect(switches).toHaveLength(3);expect(Math.max(...switches.map(s=>s.right))-Math.min(...switches.map(s=>s.right))).toBeLessThan(1);
  expect(new Set(switches.map(s=>`${s.width}:${s.height}`)).size).toBe(1);
  const time=debug.getByRole('slider',{name:'Debug world time',exact:true});await time.press('ArrowUp');await expect(time.locator('.timer-value')).toHaveText('12:05');
  await expect(time.locator('.minimal-clock-selection')).toBeHidden();
  const amount=debug.getByRole('slider',{name:'Debug weathering',exact:true});await amount.press('ArrowRight');
  await expect(debug.locator('output')).toHaveText('55%');
  await debug.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`settings-debug-${theme}.png`)});
  await debug.getByRole('checkbox',{name:'Temporary world preview',exact:true}).uncheck();
  await expect(debug.locator('.content-reveal').first()).toHaveAttribute('inert','');
  expect(errors).toEqual([]);
});

for(const theme of ['light','dark'])test(`real touch swipes return from notes and statistics in ${theme} glass`,async({page},info)=>{
  test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await setup(page,{quickNotesEnabled:true,minimalMode:true,themeMode:theme,focusGlassTransparency:100});
  const panel=page.locator('.minimal-idle-carousel'),height=(await panel.boundingBox())!.height;
  await touchSwipe(page,panel,1);await expect(panel).toHaveAttribute('data-page','notes');
  const notes=panel.locator('.quick-notes');await notes.getByRole('textbox').fill('读书，散步，休息。');await notes.getByRole('button',{name:'添加便签'}).click();
  await expect(notes.getByRole('checkbox')).toBeVisible();await notes.getByRole('textbox').blur();
  await expect.poll(async()=>{const a=(await notes.boundingBox())!,b=(await panel.boundingBox())!;return Math.abs(a.x-b.x);}).toBeLessThan(2);
  await page.screenshot({path:info.outputPath(`pixel-notes-minimal-${theme}.png`)});
  await touchSwipe(page,panel,-1);await expect(panel).toHaveAttribute('data-page','clock');
  await touchSwipe(page,panel,-1);await expect(panel).toHaveAttribute('data-page','today');
  await touchSwipe(page,panel,1);await expect(panel).toHaveAttribute('data-page','clock');
  await touchSwipe(page,panel,1);await expect(panel).toHaveAttribute('data-page','notes');
  expect((await panel.boundingBox())!.height).toBe(height);expect((await readPersistedDomainState(page)).state.quickNotes).toHaveLength(1);expect(errors).toEqual([]);
});

test('nature tracks are exclusive, imported audio replaces the track and rain follows debug weather',async({page},info)=>{
  test.setTimeout(120000);
  await page.addInitScript(()=>{
    const active=new Set<AudioBufferSourceNode>();
    const start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start=function(...args:Parameters<typeof start>){active.add(this);return start.apply(this,args);};
    AudioBufferSourceNode.prototype.stop=function(...args:Parameters<typeof stop>){active.delete(this);return stop.apply(this,args);};
    Object.defineProperty(window,'__testAudioLoops',{get:()=>active.size});
  });
  await setup(page,{language:'en'});await page.getByRole('button',{name:'Settings',exact:true}).click();
  const group=page.locator('.ambient-audio-settings');await group.getByRole('checkbox',{name:'Nature sounds',exact:true}).check();
  await group.getByRole('radio',{name:'Morning birdsong',exact:true}).check();await expect(group.getByRole('radio',{name:'Evening lakeside',exact:true})).toHaveCount(0);
  await group.locator('input[type=file]').setInputFiles('../../apps/web/public/audio/morning-birdsong.wav');
  await expect(group.getByRole('radio',{name:'morning-birdsong.wav',exact:true})).toBeChecked();await expect(group.getByRole('radio',{name:'Morning birdsong',exact:true})).not.toBeChecked();
  await group.getByRole('checkbox',{name:'Rain with the weather',exact:true}).check();
  const debug=page.locator('.world-debug-settings');await debug.getByRole('checkbox',{name:'Temporary world preview',exact:true}).check();
  await debug.locator('.choice-menu-trigger').click();await page.getByRole('option',{name:'Light rain',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-focus-preferences-v1')!).ambience.rainEnabled)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{__testAudioLoops:number}).__testAudioLoops)).toBe(1);
  await debug.locator('.choice-menu-trigger').click();await page.getByRole('option',{name:'Thunderstorm',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{__testAudioLoops:number}).__testAudioLoops)).toBe(1);
  await debug.locator('.choice-menu-trigger').click();await page.getByRole('option',{name:'Clear',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as typeof window&{__testAudioLoops:number}).__testAudioLoops)).toBe(0);
  await group.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('nature-audio-settings.png')});
});

test('calendar sheet travels above the binding and fades behind its original icon',async({page},info)=>{
  test.setTimeout(90000);await setup(page);const icon=page.locator('.today .pixel-calendar'),part=icon.locator('[data-icon-part=turning-page]');
  expect(await part.evaluate(el=>getComputedStyle(el).opacity)).toBe('0');await page.getByRole('button',{name:'关于方块钟',exact:true}).click();
  const frames=await part.evaluate(el=>{
    const animation=el.getAnimations()[0];if(!animation)throw Error('Calendar animation missing');
    animation.pause();animation.currentTime=560;return animation.effect instanceof KeyframeEffect?animation.effect.getKeyframes():[];
  });
  expect(frames.some(frame=>String(frame.transform).includes('rotateX(172deg)'))).toBe(true);
  await page.screenshot({path:info.outputPath('calendar-over-binding.png')});
  await part.evaluate(el=>{for(const animation of el.getAnimations())animation.finish();});
  await expect.poll(()=>part.evaluate(el=>getComputedStyle(el).opacity)).toBe('0');
});

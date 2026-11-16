import { expect, test, type Locator, type Page } from '@playwright/test';
import { waitForPreparedWorld } from './world-ready';
import { readPersistedDomainState, executeAndReloadPersistedCommand } from './persisted-domain-state';
import { holdModeTransition, releaseModeTransition } from './mode-transition-controls';
import { execute,type DomainCommand } from '@blockcolc/domain';
import { chooseDebugWeather } from './world-debug-controls';
import { writeFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({
    focusMinutes: 45, breakMinutes: 5, minimalMode: false, lightingQuality: 'performance', quickNotesEnabled: true,
  })));
});

async function createProject(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await waitForPreparedWorld(page);
}

test('feedback89 localized controls and aligned secondary backup rows',async({page},info)=>{
  test.setTimeout(120_000);await createProject(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();const settings=page.locator('.settings-page');
  await settings.getByRole('button',{name:'本地备份',exact:true}).click();
  const backup=settings.locator('.backup-manual');
  await expect(settings.locator('.backup-setting details>summary')).toHaveText(['导入与导出','操作回滚0 份','每日合并备份0 份 · 0.0 MiB']);
  await expect(backup).toHaveAttribute('data-expanded','false');await expect(backup.getByRole('button',{name:'导出',exact:true})).toBeHidden();
  await backup.locator('summary').click();await settled(backup);
  await expect(settings.locator('.daily-backup-history')).toHaveAttribute('data-expanded','false');
  const rollback=settings.locator('.backup-rollback-history');await rollback.locator('summary').click();await settled(rollback);
  const historyType=await rollback.evaluate(el=>{const h=el.querySelector('h3')!;return{parent:parseFloat(getComputedStyle(el.querySelector('summary')!).fontSize),child:parseFloat(getComputedStyle(h).fontSize),oldCaption:getComputedStyle(h,'::after').content};});
  expect(historyType.child).toBeLessThan(historyType.parent);expect(['none','normal']).toContain(historyType.oldCaption);
  await rollback.locator('summary').click();await expect.poll(()=>rollback.locator('.content-reveal').first().evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(1);
  for(const width of [320,360,412,768,915,1440]){
    await page.setViewportSize({width,height:915});
    const layout=await backup.evaluate(el=>({actions:[...el.querySelectorAll('.backup-file-action')].map(node=>{const r=node.getBoundingClientRect();return{x:r.x,right:r.right,width:r.width,height:r.height};}),
      parent:parseFloat(getComputedStyle(document.querySelector('.backup-setting .setting-name>span')!).fontSize),child:parseFloat(getComputedStyle(el.querySelector('.setting-name>span')!).fontSize),
      scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
    expect(layout.actions[0]!.right).toBeCloseTo(layout.actions[1]!.right,0);expect(layout.actions[0]!.width).toBeCloseTo(layout.actions[1]!.width,0);
    expect(layout.actions.every(r=>r.height>=44)).toBe(true);expect(layout.parent).toBeGreaterThan(layout.child);expect(layout.scroll).toBeLessThanOrEqual(layout.viewport);
  }
  await page.setViewportSize({width:412,height:915});
  const gaps=await settings.locator('.world-debug-settings').evaluate(el=>{const debug=el.querySelector('.setting-row')!.getBoundingClientRect(),coords=el.previousElementSibling!.getBoundingClientRect(),previous=el.previousElementSibling!.previousElementSibling!.getBoundingClientRect();return{debugTop:debug.y-coords.bottom,previousTop:coords.y-previous.bottom,debugHeight:debug.height,coordsHeight:coords.height,padding:getComputedStyle(el.querySelector('.setting-row')!).padding};});
  await info.attach('advanced-row-spacing',{body:JSON.stringify(gaps),contentType:'application/json'});expect(gaps.debugTop).toBeCloseTo(gaps.previousTop,0);
  await backup.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('backup-rows-light.png')});
  await settings.getByRole('button',{name:'English',exact:true}).click();
  await expect(backup).toContainText('Import backup');await expect(backup).not.toContainText('导入');
  await expect(settings.locator('.backup-setting')).not.toContainText(/[\u3400-\u9fff]/);
  expect(await backup.locator('.backup-file-action').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().height))).toEqual([44,44]);
  await expect(settings.getByRole('button',{name:'方块材质包',exact:true})).toHaveCount(0);
  await settings.getByRole('button',{name:'Resource packs',exact:true}).click();
  await expect(settings.locator('.resource-pack-setting .setting-row').last()).toContainText('Import');
  await expect(settings.locator('.resource-pack-setting')).not.toContainText('导入');
  await settings.getByRole('button',{name:'Dark',exact:true}).click();await backup.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('backup-rows-dark-en.png')});
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');await page.setViewportSize({width:320,height:915});
  await backup.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({path:info.outputPath('backup-rows-200-percent.png')});
  await page.evaluate(()=>document.documentElement.style.removeProperty('font-size'));await page.setViewportSize({width:412,height:915});
  await page.getByRole('button',{name:'Timer',exact:true}).click();
  await expect(page.locator('.plan-summary')).toContainText('45 min');await expect(page.locator('.plan-summary')).not.toContainText('分钟');
});

test('post89 backup feedback remains visible when action categories are closed',async({page})=>{
  test.setTimeout(90_000);await createProject(page);await page.getByRole('button',{name:'设置',exact:true}).click();
  const settings=page.locator('.settings-page');await settings.getByRole('button',{name:'本地备份',exact:true}).click();
  const manual=settings.locator('.backup-manual'),rollback=settings.locator('.backup-rollback-history');
  await manual.locator('summary').click();
  await manual.getByLabel('选择备份 JSON 文件',{exact:true}).setInputFiles({name:'invalid-backup.json',mimeType:'application/json',buffer:Buffer.from('{invalid')});
  await expect(settings.locator('.backup-error')).toBeVisible();
  await manual.locator('summary').click();await settled(manual);await expect(settings.locator('.backup-error')).toBeVisible();
  await rollback.locator('summary').click();await settled(rollback);
  await expect(manual).toHaveAttribute('data-expanded','false');await expect(settings.locator('.backup-error')).toBeVisible();
  await expect(settings.locator('.daily-backup-history')).toHaveAttribute('data-expanded','false');
});

for(const theme of ['浅色','深色'])test(`post89 minimal notes use an unboxed entry in ${theme}`,async({page},info)=>{
  test.setTimeout(120_000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await createProject(page);await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:theme,exact:true}).click();
  await page.getByLabel('开启极简模式',{exact:true}).check();await page.getByRole('button',{name:'计时',exact:true}).click();
  const carousel=page.locator('.minimal-idle-carousel');await carousel.press('ArrowLeft');
  await expect(carousel).toHaveAttribute('data-page','notes');
  await carousel.evaluate(el=>(el as HTMLElement).blur());
  const notes=carousel.locator('.quick-notes--compact'),entry=notes.getByRole('textbox',{name:'写一条便签',exact:true});
  for(const width of [320,360,412,768,915,1440]){
    await page.setViewportSize({width,height:915});await settled(carousel);
    const style=await notes.locator('form').evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{
      borders:[s.borderTopStyle,s.borderRightStyle,s.borderBottomStyle,s.borderLeftStyle],background:s.backgroundColor,
      inputHeight:el.querySelector('input')!.getBoundingClientRect().height,inputBackground:getComputedStyle(el.querySelector('input')!).backgroundColor,
      placeholderColor:getComputedStyle(el.querySelector('input')!,'::placeholder').color,inputColor:getComputedStyle(el.querySelector('input')!).color,
      buttonHeight:el.querySelector('button')!.getBoundingClientRect().height,
      left:r.left,right:r.right,viewport:innerWidth,scroll:document.documentElement.scrollWidth,
    };});
    expect(style.borders).toEqual(['solid','none','none','none']);expect(style.background).toBe('rgba(0, 0, 0, 0)');
    expect(style.inputBackground).toBe('rgba(0, 0, 0, 0)');expect(style.placeholderColor).toBe(style.inputColor);
    expect(style.inputHeight).toBeGreaterThanOrEqual(44);expect(style.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(style.left).toBeGreaterThanOrEqual(0);expect(style.right).toBeLessThanOrEqual(width);expect(style.scroll).toBeLessThanOrEqual(width);
    await page.screenshot({path:info.outputPath(`minimal-note-entry-${width}.png`)});
  }
  await page.setViewportSize({width:412,height:915});await entry.fill('今天认真读书');await notes.getByRole('button',{name:'添加便签',exact:true}).click();
  await expect(notes.getByRole('checkbox',{name:'完成便签：今天认真读书',exact:true})).toBeEnabled();
  await carousel.press('ArrowRight');await expect(carousel).toHaveAttribute('data-page','clock');
  await carousel.press('ArrowLeft');await expect(carousel).toHaveAttribute('data-page','notes');
  await expect(notes.getByRole('checkbox',{name:'完成便签：今天认真读书',exact:true})).toBeVisible();
  expect((await readPersistedDomainState(page)).state.quickNotes.map(note=>note.text)).toContain('今天认真读书');expect(errors).toEqual([]);
});

test('post89 backup and minimal notes preserve system font, large text and reduced preferences',async({page},info)=>{
  test.setTimeout(120_000);await page.emulateMedia({reducedMotion:'reduce'});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-reduced-transparency',value:'reduce'}]});
  await createProject(page);await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'原字体',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-font','system');
  await page.getByRole('button',{name:'本地备份',exact:true}).click();const backup=page.locator('.backup-manual');await backup.locator('summary').click();
  await page.locator('html').evaluate(el=>(el as HTMLElement).style.fontSize='200%');
  for(const width of [320,412,768,915,1440]){
    await page.setViewportSize({width,height:915});
    const bounds=await backup.locator('.backup-file-action').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return{right:r.right,height:r.height};}));
    expect(bounds[0]!.right).toBeCloseTo(bounds[1]!.right,0);expect(bounds.every(item=>item.height>=44&&item.right<=width)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({width:320,height:915});await backup.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('backup-system-200-reduced.png')});
  await page.locator('html').evaluate(el=>(el as HTMLElement).style.removeProperty('font-size'));
  await page.getByLabel('开启极简模式',{exact:true}).check();await page.getByRole('button',{name:'计时',exact:true}).click();
  const carousel=page.locator('.minimal-idle-carousel');await carousel.press('ArrowLeft');await expect(carousel).toHaveAttribute('data-page','notes');
  await carousel.evaluate(el=>(el as HTMLElement).blur());await page.locator('html').evaluate(el=>(el as HTMLElement).style.fontSize='200%');
  const notes=carousel.locator('.quick-notes--compact');
  for(const width of [320,412,768,915,1440]){
    await page.setViewportSize({width,height:915});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(notes.getByRole('textbox',{name:'写一条便签',exact:true})).toBeInViewport();
    await expect(notes.getByRole('button',{name:'添加便签',exact:true})).toBeInViewport();
    await expect(notes.locator('form')).toHaveCSS('border-left-style','none');
  }
  await page.setViewportSize({width:320,height:915});await page.screenshot({path:info.outputPath('notes-system-200-reduced.png')});await cdp.detach();
});

test('settings use four existing-sized groups, working secondary rows and unclipped ambient flight',async({page},info)=>{
  test.setTimeout(120_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await createProject(page);await page.getByRole('button',{name:'设置',exact:true}).click();
  const settings=page.locator('.settings-page');
  await expect(settings.locator('.settings-group>h2')).toHaveText(['计时与专注','外观与世界','附加功能','高级与备份']);
  const habit=settings.getByRole('button',{name:/^习惯任务/});await expect(habit).toHaveAttribute('aria-expanded','false');
  await habit.click();await expect(settings.getByLabel('习惯任务专注分钟',{exact:true})).toBeVisible();
  const minutes=settings.getByLabel('习惯任务专注分钟',{exact:true});await minutes.fill('35');await minutes.blur();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-focus-preferences-v1')!).habitFocusMinutes)).toBe(35);
  await habit.click();await expect(minutes).toBeHidden();
  await settings.getByRole('button',{name:'提醒',exact:true}).click();
  const notification=settings.getByRole('button',{name:'刷新通知状态',exact:true});
  const height=await notification.evaluate(el=>el.parentElement!.parentElement!.getBoundingClientRect().height);await notification.click();
  await expect(notification).toBeEnabled();expect(await notification.evaluate(el=>el.parentElement!.parentElement!.getBoundingClientRect().height)).toBe(height);
  await settings.getByRole('button',{name:'白噪音',exact:true}).click();
  await settings.getByLabel('自然白噪音',{exact:true}).check();
  const volume=settings.locator('.ambient-volume-setting .physical-slider');await expect(volume).toBeHidden();
  await settings.getByRole('button',{name:'白噪音音量',exact:true}).click();await volume.scrollIntoViewIfNeeded();
  for(const ancestor of await volume.locator('xpath=ancestor::*[contains(@class,"content-reveal")]').all())await expect(ancestor).toHaveAttribute('data-overflow','visible');
  const rail=await volume.locator('.physical-slider-rail').boundingBox();if(!rail)throw new Error('Volume rail missing');
  const current=Number(await volume.getByRole('slider').inputValue());const x=rail.x+rail.width*current/100,y=rail.y+3;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+30,y-85,{steps:5});
  await expect(volume).toHaveAttribute('data-flight','aiming');
  const visibility=await volume.evaluate(el=>{const ball=el.querySelector('.physical-slider-ball:not(.is-predicted)')!,r=ball.getBoundingClientRect(),v=el.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {outside:r.bottom<v.top,clippedAncestors:[...function*(node:Element|null):Generator<Element>{while(node){yield node;node=node.parentElement;}}(el)].filter(node=>getComputedStyle(node).overflow==='hidden').map(node=>node.className),cover:top?.closest('.ambient-audio-settings')!==null};});
  expect(visibility.outside).toBe(true);expect(visibility.clippedAncestors).toEqual([]);
  await page.screenshot({path:info.outputPath('ambient-ball-outside-row.png')});await page.mouse.up();await expect(volume).toHaveAttribute('data-flight','idle',{timeout:5000});
  await settings.getByRole('button',{name:/^方块材质包/}).click();await expect(settings.getByRole('button',{name:'使用中',exact:true})).toBeVisible();
  await settings.getByRole('button',{name:/^本地备份/}).click();await expect(settings.getByLabel('选择备份 JSON 文件',{exact:true})).toBeAttached();
  await expect(settings.getByLabel('临时调试世界',{exact:true})).toBeVisible();
  await settings.getByLabel('临时调试世界',{exact:true}).check();await expect(settings.locator('#world-debug-weather')).toBeVisible();
  await page.screenshot({path:info.outputPath('advanced-integrated.png')});
  await settings.getByRole('button',{name:'深色',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await settings.getByRole('button',{name:'原字体',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-font','system');
  await settings.getByRole('button',{name:'English',exact:true}).click();
  await expect(settings.locator('.settings-group>h2')).toHaveText(['Timer & focus','Appearance & world','Extras','Advanced & backup']);
  await page.screenshot({path:info.outputPath('settings-dark-english.png')});expect(errors).toEqual([]);
});

test('world unfold/return keeps one renderer, fixed bitmap sizes and releases cancellation/reduced motion',async({page},info)=>{
  test.setTimeout(150_000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await createProject(page);await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByLabel('开启极简模式',{exact:true}).check();await page.getByRole('button',{name:'计时',exact:true}).click();
  await expect(page.locator('.minimal-clock-gesture')).toBeVisible();
  const canvas=page.locator('canvas[data-world-canvas]');await canvas.evaluate(el=>el.dataset.modeResidency='retained');
  await page.locator('.minimal-exit').focus();await page.keyboard.press('Enter');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-mode-transition-active','false',{timeout:20_000});
  await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode','false');
  await holdModeTransition(page);
  await page.getByRole('button',{name:'进入极简模式',exact:true}).evaluate(button=>button.addEventListener('click',()=>{
    const paths=[...button.querySelectorAll('[data-icon-part]')];
    (window as any).entryMotion={parts:paths.length,active:paths.filter(el=>el.getAnimations().length>0).length};
  },{once:true,capture:true}));
  await page.getByRole('button',{name:'进入极简模式',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).entryMotion)).toEqual({parts:5,active:5});
  await expect(page.locator('.app-shell')).toHaveAttribute('data-mode-transition-phase','opening',{timeout:20_000});
  const cover=page.locator('.mode-transition');
  const bitmapSizes=await cover.locator('.mode-transition__world>canvas').evaluateAll(nodes=>nodes.map(node=>({w:(node as HTMLCanvasElement).width,h:(node as HTMLCanvasElement).height,cssW:getComputedStyle(node).width,cssH:getComputedStyle(node).height})));
  expect(bitmapSizes).toHaveLength(2);
  const during=await cover.locator('.mode-transition__world>canvas').evaluateAll(nodes=>nodes.map(node=>({w:(node as HTMLCanvasElement).width,h:(node as HTMLCanvasElement).height,cssW:getComputedStyle(node).width,cssH:getComputedStyle(node).height,transform:getComputedStyle(node).transform})));
  expect(during.map(({transform,...rest})=>rest)).toEqual(bitmapSizes);
  expect(during.every(node=>node.transform==='none'||/^matrix\(1, 0, 0, 1,/.test(node.transform))).toBe(true);
  await page.screenshot({path:info.outputPath('world-unfold-midpoint.png')});
  await releaseModeTransition(page);
  await expect(page.locator('.app-shell')).toHaveAttribute('data-mode-transition-active','false');
  await expect(canvas).toHaveAttribute('data-mode-residency','retained');
  await page.locator('.minimal-exit').focus();await page.keyboard.press('Enter');
  await expect(page.locator('.mode-transition')).toBeVisible();await page.keyboard.press('Escape');
  await expect(page.locator('.mode-transition')).toHaveCount(0);await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode','true');
  expect(await page.locator('.app-shell').evaluate(el=>(el as HTMLElement).inert)).toBe(false);
  await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.minimal-exit').focus();await page.keyboard.press('Enter');
  await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode','false');
  await expect(page.locator('.mode-transition,.mode-portal')).toHaveCount(0);await expect(canvas).toHaveAttribute('data-mode-residency','retained');
  await expect(page.getByRole('button',{name:'调整本次计划',exact:true})).toBeVisible();expect(errors).toEqual([]);
});

async function insertChinese(page: Page, field: Locator, before: string, offset: number, inserted: string) {
  await field.fill(before);
  await field.evaluate((input: HTMLInputElement, at) => {
    input.focus(); input.setSelectionRange(at, at);
    (window as any).editingNode = input;
  }, offset);
  const cdp = await page.context().newCDPSession(page);
  try {
    // Real Chromium IME messages, including repeated candidate replacements.
    for (const candidate of ['ren', '认', inserted]) {
      await cdp.send('Input.imeSetComposition', { text: candidate, selectionStart: candidate.length, selectionEnd: candidate.length });
      await expect(field).toHaveValue(before.slice(0, offset) + candidate + before.slice(offset));
      expect(await field.evaluate(input => input === (window as any).editingNode)).toBe(true);
    }
    await cdp.send('Input.insertText', { text: inserted });
    const committed = before.slice(0, offset) + inserted + before.slice(offset);
    await expect(field).toHaveValue(committed);
    expect(await field.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(offset + inserted.length);
    // Start another composition without repositioning the cursor. Previously
    // whole-string filling tests missed an IME reconnect moving it to the end.
    await cdp.send('Input.imeSetComposition', { text: '地', selectionStart: 1, selectionEnd: 1 });
    const candidateEnter = await field.evaluate(input => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true });
      input.dispatchEvent(event); return event.defaultPrevented;
    });
    expect(candidateEnter).toBe(true);
    await cdp.send('Input.insertText', { text: '地' });
    const expected = before.slice(0, offset) + inserted + '地' + before.slice(offset);
    await expect(field).toHaveValue(expected);
    expect(await field.evaluate((input: HTMLInputElement) => input.selectionStart)).toBe(offset + inserted.length + 1);
    expect(await field.evaluate(input => input === (window as any).editingNode)).toBe(true);
    return expected;
  } finally { await cdp.detach(); }
}

test('Chinese middle edits keep the native caret in creation, project/subtask rename and new subtask fields', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  const title = await insertChinese(page, page.getByRole('textbox', { name: '大型任务', exact: true }), '今天读书计划', 2, '认真');
  const first = await insertChinese(page, page.getByRole('textbox', { name: '小任务 1', exact: true }), '今天读书', 2, '认真');
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await waitForPreparedWorld(page);
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '编辑施工清单', exact: true }).click();
  await page.getByRole('button', { name: '修改任务名称', exact: true }).click();
  const renamed = await insertChinese(page, page.getByRole('textbox', { name: '任务名称', exact: true }), title, 2, '仔细');
  await page.getByRole('button', { name: '保存任务名称', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑施工清单', exact: true }).click();
  await page.locator('.task-editor-row').filter({ hasText: first }).dblclick();
  const subtask = await insertChinese(page, page.getByRole('textbox', { name: '小任务名称', exact: true }), first, 2, '耐心');
  await page.getByRole('button', { name: '保存小任务名称', exact: true }).click();
  const added = await insertChinese(page, page.getByRole('textbox', { name: '新增小任务', exact: true }), '明天写作', 2, '专心');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await expect.poll(async () => {
    const state = (await readPersistedDomainState(page)).state;
    return [state.projects[0]!.title, state.projects[0]!.subtasks.map(task => task.title)];
  }).toEqual([renamed, [subtask, '完成核心工作', '检查并收尾', added]]);
  await page.reload();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
});

test('original timer and adopted task/settings hierarchy work on phone and desktop', async ({ page }, info) => {
  test.setTimeout(120_000);
  await createProject(page);
  for (const viewport of [{width:320,height:800},{width:360,height:800},{width:412,height:915},{width:915,height:412},{width:768,height:1024},{width:1440,height:900}]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: '计时', exact: true }).click();
    await expect(page.locator('.workbench-heading>h1')).toContainText('我的第一座工坊');
    await expect(page.locator('.workbench-project,.workbench-controls,.focus-method')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '调整本次计划', exact: true })).toContainText('调整');
    await expect(page.getByRole('button', { name: '进入极简模式', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`timer-${viewport.width}.png`) });
    await page.getByRole('button', { name: '任务', exact: true }).click();
    await expect(page.locator('.tasks-page-heading p')).toHaveText('把要做的事，排成下一步建造');
    const ordered = await page.locator('.tasks-page').evaluate(page => {
      const goal = page.querySelector('.daily-goal')!, planning = page.querySelector('.task-planning-panel')!;
      return Boolean(goal.compareDocumentPosition(planning) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(ordered).toBe(true);
    await expect(page.locator('.tasks-workspace,.tasks-support')).toHaveCount(0);
    await expect(page.locator('.project-portfolio-toggle')).toContainText('其他任务');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`tasks-${viewport.width}.png`) });
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.locator('.settings-category')).toHaveCount(0);
    await expect(page.locator('.settings-group>h2')).toHaveText(['计时与专注','外观与世界','附加功能','高级与备份']);
    await expect(page.locator('.settings-head p')).toHaveText('专注节奏、聚落外观与本地数据。');
    for (const label of ['普通任务专注分钟', '同步现实天气', '简易便签', '渐进启动']) await expect(page.locator('.settings-page').getByLabel(label, { exact: true })).toHaveCount(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath(`settings-${viewport.width}.png`) });
  }
  await page.setViewportSize({width:360,height:800});
  await page.emulateMedia({reducedMotion:'reduce'});
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-reduced-transparency',value:'reduce'}]});
  await page.locator('html').evaluate(el=>(el as HTMLElement).style.fontSize='200%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('settings-large-text-reduced.png')});
  await cdp.detach();
});

test('notes retain middle Chinese composition, editing, completion and failure recovery in the adopted task surface', async ({ page }) => {
  test.setTimeout(90_000);
  await createProject(page);
  await page.getByRole('button', { name: '任务', exact: true }).click();
  const notes = page.locator('.quick-notes'), entry = notes.getByRole('textbox', { name: '写一条便签' });
  const text = await insertChinese(page, entry, '今天读书', 2, '认真');
  await entry.press('Enter');
  await expect(notes.getByRole('checkbox', { name: `完成便签：${text}` })).toBeEnabled();
  await notes.getByRole('button', { name: `修改便签：${text}` }).dblclick();
  const edited = await insertChinese(page, notes.getByRole('textbox', { name: '修改便签', exact: true }), text, 2, '仔细');
  await notes.getByRole('button', { name: '保存便签', exact: true }).click();
  const check = notes.getByRole('checkbox', { name: `完成便签：${edited}` });
  // Completion immediately moves the row into the collapsed list. Verify that
  // outcome rather than check() re-resolving a now-hidden checkbox.
  await expect(check).toBeEnabled(); await check.click();
  await expect(notes.locator('.quick-notes-completed')).toBeVisible();
  await notes.locator('.quick-notes-completed summary').click();
  await expect(check).toBeChecked();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'appState' && value.state?.quickNotes.some((note: { text: string }) => note.text === '保存失败的草稿')) throw new DOMException('Synthetic failure', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await entry.fill('保存失败的草稿'); await entry.press('Enter');
  await expect(notes.getByRole('button', { name: '修改便签：保存失败的草稿' })).toContainText('未保存');
  expect((await readPersistedDomainState(page)).state.quickNotes.map(note => [note.text, note.completed])).toEqual([[edited, true]]);
});

async function settled(element:Locator){await expect.poll(()=>element.evaluate(el=>el.getAnimations({subtree:true}).filter(animation=>
  Number.isFinite(Number(animation.effect?.getComputedTiming().endTime))&&!['finished','idle'].includes(animation.playState)
).length)).toBe(0);}

async function disclosureMotion(details:Locator){
  await details.evaluate(el=>{
    const samples:{height:number;open:boolean}[]=[],started=performance.now();
    (window as any).disclosureSamples=samples;(window as any).disclosureDone=false;
    const tick=()=>{samples.push({height:el.getBoundingClientRect().height,open:(el as HTMLDetailsElement).open});
      if(performance.now()-started<650)requestAnimationFrame(tick);else (window as any).disclosureDone=true;};tick();
  });
  await details.locator(':scope>summary').click();
  await details.page().waitForFunction(()=>(window as any).disclosureDone);
  return details.page().evaluate(()=>(window as any).disclosureSamples as {height:number;open:boolean}[]);
}

test('feedback87 secondary settings animate both ways, debug expands directly and habit summary stays one line',async({page},info)=>{
  test.setTimeout(120_000);await createProject(page);await page.getByRole('button',{name:'设置',exact:true}).click();
  const settings=page.locator('.settings-page'),debug=settings.getByLabel('临时调试世界',{exact:true});
  await expect(settings.getByRole('button',{name:/^画面调试/})).toHaveCount(0);
  await expect(debug).not.toBeChecked();await expect(settings.locator('#world-debug-weather')).toBeHidden();
  await debug.check();await expect(settings.locator('#world-debug-weather')).toBeVisible();await debug.uncheck();
  await expect(settings.locator('#world-debug-weather')).toBeHidden();
  for(const selector of ['.glass-transparency-setting','.world-color-setting']){
    const details=settings.locator(selector);await details.scrollIntoViewIfNeeded();
    const opening=await disclosureMotion(details),low=opening[0]!.height,high=opening.at(-1)!.height;
    expect(high).toBeGreaterThan(low+30);expect(opening.some(sample=>sample.height>low+2&&sample.height<high-2)).toBe(true);
    const closing=await disclosureMotion(details);expect(closing.at(-1)!.height).toBeCloseTo(low,0);
    expect(closing.some(sample=>sample.open&&sample.height>low+2&&sample.height<high-2)).toBe(true);
    await expect(details).not.toHaveAttribute('open','');
  }
  await settings.getByRole('button',{name:/^本地备份/}).click();
  await expect(settings.locator('.backup-manual>summary')).toHaveText('导入与导出');
  for(const selector of ['.backup-manual','.daily-backup-history','.backup-rollback-history']){
    const details=settings.locator(selector);const opening=await disclosureMotion(details);expect(opening.at(-1)!.height).toBeGreaterThan(opening[0]!.height);
    await disclosureMotion(details);await expect(details.locator('summary')).toHaveAttribute('aria-expanded','false');
  }
  await page.screenshot({path:info.outputPath('backup-hierarchy.png')});
  await settings.getByRole('button',{name:/^蓝图库/}).click();
  const group=settings.locator('.library-groups details').first();await group.locator('summary').click();
  await expect(group.locator('.content-reveal')).toHaveClass(/is-open/);await settled(group);await group.locator('summary').click();await expect(group).not.toHaveAttribute('open','');
  for(const width of [320,360,412]){
    await page.setViewportSize({width,height:850});
    const summary=settings.locator('.habit-setting .settings-disclosure-value>span');
    const row=await summary.evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight),whiteSpace:getComputedStyle(el).whiteSpace}));
    expect(row.whiteSpace).toBe('nowrap');expect(row.height).toBeLessThanOrEqual(row.line+1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  }
  await settings.getByRole('button',{name:'English',exact:true}).click();await expect(settings.locator('.habit-setting')).toContainText('/building');
});

test('feedback87 notes finish the strike before filing, keep failure in place and share the task card material',async({page},info)=>{
  test.setTimeout(90_000);await createProject(page);await page.getByRole('button',{name:'任务',exact:true}).click();
  const notes=page.locator('.tasks-page .quick-notes'),entry=notes.getByRole('textbox',{name:'写一条便签',exact:true});
  expect(await notes.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await page.locator('.task-detail-panel').evaluate(el=>getComputedStyle(el).backgroundColor));
  await expect(notes.locator('[data-pixel-icon="note"]')).toBeVisible();
  await entry.fill('先划线，再收好');await entry.press('Enter');
  const check=notes.getByRole('checkbox',{name:'完成便签：先划线，再收好'});await expect(check).toBeEnabled();
  await page.clock.install();await page.clock.pauseAt(new Date(Date.now()+1000));await check.click();
  await expect(notes.locator('[data-completing="true"]')).toBeVisible();await expect(notes.locator('.quick-notes-completed')).toHaveCount(0);
  await page.clock.runFor(120);await expect(notes.locator('[data-completing="true"]')).toBeVisible();
  await page.clock.runFor(200);await expect(notes.locator('.quick-notes-completed')).toBeVisible();await page.clock.resume();
  const completed=notes.locator('.quick-notes-completed');const motion=await disclosureMotion(completed);expect(motion.at(-1)!.height).toBeGreaterThan(motion[0]!.height);
  await expect(check).toBeChecked();await page.screenshot({path:info.outputPath('notes-completed.png')});
  await entry.fill('保存失败要留下');await entry.press('Enter');const failed=notes.getByRole('checkbox',{name:'完成便签：保存失败要留下'});await expect(failed).toBeEnabled();
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){
    if(this.name==='appState'&&value.state?.quickNotes.some((note:{text:string;completed:boolean})=>note.text==='保存失败要留下'&&note.completed))throw new DOMException('Synthetic failure','QuotaExceededError');
    return key===undefined?put.call(this,value):put.call(this,value,key);};});
  await failed.click();await expect(failed).not.toBeChecked();await expect(failed).toBeEnabled();await expect(notes.getByRole('alert')).toContainText('便签未保存');
  expect((await readPersistedDomainState(page)).state.quickNotes.find(note=>note.text==='保存失败要留下')?.completed).toBe(false);
});

test('feedback88 task choices live in the timer plan and commit only after confirmation',async({page},info)=>{
  test.setTimeout(120_000);await createProject(page);await page.getByRole('button',{name:'任务',exact:true}).click();
  await expect(page.locator('.daily-goal')).not.toContainText('所有任务合计');
  await page.getByRole('button',{name:'新增任务',exact:true}).click();
  const kind=page.getByRole('group',{name:'任务类型',exact:true});await expect(kind.locator('.text-toggle-selection')).toHaveCount(1);
  const start=await kind.locator('.text-toggle-selection').evaluate(el=>getComputedStyle(el).transform);
  await kind.getByRole('button',{name:'习惯任务',exact:true}).click();await expect(kind.getByRole('button',{name:'习惯任务',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>kind.locator('.text-toggle-selection').evaluate(el=>getComputedStyle(el).transform)).not.toBe(start);
  await kind.getByRole('button',{name:'普通大型任务',exact:true}).click();await page.getByRole('textbox',{name:'大型任务',exact:true}).fill('第二项工程');
  await page.getByRole('button',{name:'开始建造',exact:true}).click();await waitForPreparedWorld(page);
  await page.getByRole('button',{name:'任务',exact:true}).click();await expect(page.getByRole('button',{name:'切换大任务',exact:true})).toHaveCount(0);
  const {state}=await readPersistedDomainState(page),project=state.projects.find(project=>project.title==='我的第一座工坊')!;
  const selected=project.subtasks[1]!;await page.getByRole('button',{name:'计时',exact:true}).click();
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();const sheet=page.getByRole('dialog',{name:'安排下一轮',exact:true});
  const original=sheet.locator('.focus-task-project').filter({hasText:'我的第一座工坊'});await original.locator('summary').click();
  await original.getByRole('button',{name:new RegExp(selected.title)}).click();
  expect((await readPersistedDomainState(page)).state.activeProjectId).toBe(state.activeProjectId);
  await sheet.locator('.round-picker button').filter({hasText:/^2 轮/}).click();await sheet.getByRole('button',{name:'确认计划',exact:true}).click();
  await expect(page.locator('.workbench-context strong')).toHaveText(selected.title);
  expect((await readPersistedDomainState(page)).state.activeProjectId).toBe(project.id);
  // Ordinary fixed-round confirmation changes the draft; persistence starts
  // with StartFocus. Check the actual saved plan and domain session then.
  await page.getByRole('button',{name:'开始 2 轮',exact:true}).click();
  const plan=await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-round-plan-v1')!));expect(plan.subtaskId).toBe(selected.id);expect(plan.totalRounds).toBe(2);
  expect((await readPersistedDomainState(page)).state.activeFocusSession?.subtaskId).toBe(selected.id);
  await page.screenshot({path:info.outputPath('selected-task-focus.png')});
});

test('feedback88 habit and ordinary catalog groups retain their place and canceled drafts do not switch the active project',async({page},info)=>{
  test.setTimeout(120_000);await createProject(page);let {state}=await readPersistedDomainState(page);const first=state.activeProjectId!;
  for(const command of [
    {type:'CreateHabitProject',projectId:'habit88',title:'每日阅读',blueprintId:'builtin-small-workshop',targetRounds:10},
    {type:'CreateProject',projectId:'other88',title:'另一项工程',blueprintId:'builtin-small-workshop',subtasks:[{id:'p88a',title:'查阅资料'},{id:'p88b',title:'整理成果'}]},
  ] as DomainCommand[]){const result=execute(state,command,{now:()=>new Date()});if(!result.ok)throw Error(result.message);state=result.state;}
  await executeAndReloadPersistedCommand(page,state,{type:'SwitchActiveProject',projectId:first},Date.now());await waitForPreparedWorld(page);
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();
  const picker=page.locator('.focus-task-picker');await expect(picker.locator('.focus-task-project strong')).toHaveText(['我的第一座工坊','每日阅读','另一项工程']);
  await expect(picker.locator('details[open]')).toHaveCount(1);
  const habit=picker.getByRole('button',{name:/每日阅读/});await expect(habit).not.toHaveAttribute('aria-expanded');await habit.click();
  await expect(page.getByRole('dialog',{name:'安排习惯专注',exact:true})).toBeVisible();await expect(habit).toHaveAttribute('aria-pressed','true');
  const titleSizes=await picker.evaluate(el=>({project:parseFloat(getComputedStyle(el.querySelector('summary strong')!).fontSize),task:parseFloat(getComputedStyle(el.querySelector('.focus-task-options>button')!).fontSize)}));expect(titleSizes.project).toBeGreaterThan(titleSizes.task);
  await page.screenshot({path:info.outputPath('task-catalog.png')});
  await page.getByRole('button',{name:'关闭本次计划',exact:true}).click();expect((await readPersistedDomainState(page)).state.activeProjectId).toBe(first);
  await page.getByRole('button',{name:'调整本次计划',exact:true}).click();await habit.click();
  await page.getByRole('button',{name:'确认计划',exact:true}).click();await expect(page.locator('.workbench-heading h1')).toHaveText('每日阅读');
  await page.getByRole('button',{name:'开始 1 轮',exact:true}).click();
  const session=(await readPersistedDomainState(page)).state.activeFocusSession;expect(session).toMatchObject({projectId:'habit88',subtaskId:null});
  expect(session?.plannedDurationMs).toBe(45*60_000);await page.screenshot({path:info.outputPath('habit-selected.png')});
});

test('feedback89 Android script commits respect the caret and persist middle edits in the same input',async({page})=>{
  await page.addInitScript(()=>Object.assign(window,{BlockcolcNativeInput:{}}));
  await createProject(page);await page.getByRole('button',{name:'任务',exact:true}).click();
  const notes=page.locator('.tasks-page .quick-notes'),input=notes.getByRole('textbox',{name:'写一条便签',exact:true});await input.fill('今天读书');
  const commit=async(field:Locator,start:number,end:number,text:string,append:boolean)=>{
    await field.focus();await field.evaluate((el,args)=>{const input=el as HTMLInputElement,base=input.value;input.setSelectionRange(args.start,args.end);
      (window as any).editing88=input;
      // OEM commit: script assignment, no composition/beforeinput/input events.
      input.value=args.append?base+args.text:base.slice(0,args.start)+args.text+base.slice(args.end);
    },{start,end,text,append});
    expect(await field.evaluate(el=>el===(window as any).editing88&&el===document.activeElement)).toBe(true);
  };
  await commit(input,2,2,'认真',true);await expect(input).toHaveValue('今天认真读书');
  expect(await input.evaluate(el=>(el as HTMLInputElement).selectionStart)).toBe(4);
  await commit(input,4,4,'地',false);await expect(input).toHaveValue('今天认真地读书');await input.press('Enter');
  const edit=notes.getByRole('button',{name:'修改便签：今天认真地读书',exact:true});await edit.dblclick();
  const editor=notes.getByRole('textbox',{name:'修改便签',exact:true});await commit(editor,2,4,'仔细',true);await expect(editor).toHaveValue('今天仔细地读书');
  await notes.getByRole('button',{name:'保存便签',exact:true}).click();await expect(notes).toContainText('今天仔细地读书');
  expect((await readPersistedDomainState(page)).state.quickNotes.map(note=>note.text)).toEqual(['今天仔细地读书']);
});

test('feedback88 merged setting descriptions, separators and timer actions align; desktop disclosure frame samples are recorded',async({page},info)=>{
  test.setTimeout(120_000);await createProject(page);await page.getByRole('button',{name:'设置',exact:true}).click();const settings=page.locator('.settings-page');
  const groups=settings.locator('.settings-disclosure-toggle');
  for(const control of await groups.all())await expect(control.locator('.setting-name small')).not.toBeEmpty();
  for(const width of [320,412,768]){await page.setViewportSize({width,height:900});
    const missing=await settings.locator('.settings-list').evaluateAll(lists=>lists.flatMap(list=>Array.from(list.children).slice(1).filter(el=>getComputedStyle(el).display!=='none'&&parseFloat(getComputedStyle(el.matches('.settings-inner-group')?el.querySelector('.setting-row')!:el).borderTopWidth)<1).map(el=>el.className)));
    expect(missing).toEqual([]);
  }
  const metrics=[];
  const idle=await page.evaluate(()=>new Promise<{scenario:string;frames:number;p95Ms:number;maxMs:number}>(resolve=>{
    const started=performance.now(),frames:number[]=[];const tick=(now:number)=>{frames.push(now);if(now-started<650)requestAnimationFrame(tick);else{const gaps=frames.slice(1).map((x,i)=>x-frames[i]!).sort((a,b)=>a-b);resolve({scenario:'idle',frames:frames.length,p95Ms:gaps[Math.floor(gaps.length*.95)]??0,maxMs:Math.max(...gaps)});}};requestAnimationFrame(tick);
  }));metrics.push(idle);
  const listStyles=await settings.locator('.settings-list').evaluateAll(nodes=>nodes.map(el=>({style:(el as HTMLElement).style.cssText,filter:getComputedStyle(el).backdropFilter})));
  for(const scenario of ['normal','with-realtime-backdrop']){
  if(scenario==='with-realtime-backdrop')await settings.locator('.settings-list').evaluateAll(nodes=>nodes.forEach(el=>{(el as HTMLElement).style.backdropFilter='var(--settings-glass-filter)';(el as HTMLElement).style.setProperty('-webkit-backdrop-filter','var(--settings-glass-filter)');}));
  for(const selector of ['.habit-setting','.glass-transparency-setting','.world-color-setting']){
    const details=settings.locator(selector),button=details.locator(selector==='.habit-setting'?'.settings-disclosure-toggle':':scope>summary');await button.scrollIntoViewIfNeeded();
    await button.evaluate(el=>el.addEventListener('click',()=>{const start=performance.now(),frames:number[]=[];(window as any).motion88={start,frames,done:false};
      const tick=(now:number)=>{frames.push(now);if(now-start<650)requestAnimationFrame(tick);else(window as any).motion88.done=true;};requestAnimationFrame(tick);},{once:true}));
    await button.click();await page.waitForFunction(()=>(window as any).motion88.done);
    metrics.push({scenario,selector,...await page.evaluate(()=>{const m=(window as any).motion88,gaps=m.frames.slice(1).map((x:number,i:number)=>x-m.frames[i]).sort((a:number,b:number)=>a-b);return{frames:m.frames.length,p95Ms:gaps[Math.floor(gaps.length*.95)],maxMs:Math.max(...gaps),gapsOver50:gaps.filter((x:number)=>x>50).length};})});
    await button.click();await expect.poll(()=>details.locator('.content-reveal').first().evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(1);
  }
  }
  await page.screenshot({path:info.outputPath('settings-realtime-reference.png')});
  await settings.locator('.settings-list').evaluateAll((nodes,styles)=>nodes.forEach((el,i)=>(el as HTMLElement).style.cssText=styles[i]!.style),listStyles);
  const report=info.outputPath('desktop-disclosure-frames.json');await writeFile(report,JSON.stringify(metrics,null,2));
  await info.attach('desktop-disclosure-frames.json',{path:report,contentType:'application/json'});
  await page.screenshot({path:info.outputPath('settings-descriptions.png')});
  await settings.getByLabel('开启极简模式',{exact:true}).check();await page.getByRole('button',{name:'计时',exact:true}).click();
  const back=page.getByRole('button',{name:'返回完整模式',exact:true});await back.focus();await back.press('Enter');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-mode-transition-active','false',{timeout:20_000});
  await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode','false');
  await expect(page.locator('.workbench-context')).not.toContainText('今日');
  const entry=page.getByRole('button',{name:'进入极简模式',exact:true}),adjust=page.locator('.plan-summary>span:last-child');
  for(const width of [320,412,768]){await page.setViewportSize({width,height:900});const a=await entry.boundingBox(),b=await adjust.boundingBox();expect(a&&b).toBeTruthy();expect(Math.abs(a!.x+a!.width-b!.x-b!.width)).toBeLessThan(2);expect(Math.abs(a!.height-b!.height)).toBeLessThan(2);}
  await page.screenshot({path:info.outputPath('timer-aligned.png')});
});

test('feedback87 memorial details animate and show a clear hierarchy on small, large and dark views',async({page},info)=>{
  test.setTimeout(120_000);await createProject(page);let {state}=await readPersistedDomainState(page);const at=Date.now()-600_000;
  const command=(command:DomainCommand,offset:number)=>{const result=execute(state,command,{now:()=>new Date(at+offset)});if(!result.ok)throw Error(result.message);state=result.state;};
  command({type:'CreateProject',projectId:'memory87',title:'纪念藏书馆',blueprintId:'builtin-small-workshop',subtasks:[{id:'ma',title:'整理目录'},{id:'mb',title:'摆放藏书'}]},0);
  for(const [index,id] of ['ma','mb'].entries()){
    command({type:'StartFocus',sessionId:`mem-${index}`,subtaskId:id,plannedDurationMs:60_000},index*70_000+1000);
    command({type:'CompleteFocus'},index*70_000+61_000);
    command({type:'ReportSubtaskProgress',reportId:`rep-${index}`,subtaskId:id,focusSessionIds:[`mem-${index}`],progressBasisPoints:10000},index*70_000+62_000);
  }
  await executeAndReloadPersistedCommand(page,state,{type:'SetDailyGoal',date:'2026-10-15',targetPomodoros:8},Date.now());
  await waitForPreparedWorld(page);await page.getByRole('button',{name:'统计',exact:true}).click();
  await page.getByRole('dialog',{name:'新的成就'}).getByRole('button',{name:'全部关闭',exact:true}).click();
  const section=page.locator('.monument-statistics');const movement=await disclosureMotion(section);expect(movement.at(-1)!.height).toBeGreaterThan(movement[0]!.height);
  const monument=page.locator('.monument-list details').filter({hasText:'纪念藏书馆'});await monument.locator(':scope>summary').click();await expect(monument.locator('.monument-total')).toContainText('2 分钟');
  await expect(monument.locator('.monument-facts')).toContainText('2 轮');await expect(monument.locator('.monument-task-bars>li')).toHaveCount(2);
  const achievements=page.locator('.achievements-disclosure');await achievements.locator('summary').click();await expect(achievements.locator('.content-reveal')).toHaveClass(/is-open/);await settled(achievements);
  for(const width of [320,412,768]){await page.setViewportSize({width,height:900});await settled(monument);await monument.scrollIntoViewIfNeeded();
    expect(await monument.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
    const alignment=await monument.locator(':scope>summary').evaluate(el=>{const icon=el.querySelector('svg')!.getBoundingClientRect(),arrow=el.querySelector('.pixel-disclosure')!.getBoundingClientRect();return Math.abs(icon.top-arrow.top);});expect(alignment).toBeLessThan(2);
    await monument.screenshot({path:info.outputPath(`memorial-${width}.png`)});}
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');await monument.screenshot({path:info.outputPath('memorial-dark.png')});
});

test('feedback87 bottom sheets and native building memory play the shared entry motion and honor reduced motion',async({page},info)=>{
  test.setTimeout(90_000);await createProject(page);
  for(const entry of [{open:'关于方块钟',sheet:'.about-dialog',close:'关闭关于页面'},{open:'调整本次计划',sheet:'.focus-plan-sheet',close:'关闭本次计划'}]){
    await page.getByRole('button',{name:entry.open,exact:true}).click();const sheet=page.locator(entry.sheet);
    expect(await sheet.evaluate(el=>getComputedStyle(el).animationName)).toBe('sheet-rise');await settled(sheet);await sheet.getByRole('button',{name:entry.close,exact:true}).click();
  }
  const memory=page.getByRole('button',{name:'查看建筑记忆：我的第一座工坊',exact:true});await memory.focus();await memory.press('Enter');
  const panel=page.locator('.building-memory-panel');expect(await panel.evaluate(el=>getComputedStyle(el).animationName)).toBe('sheet-rise');await settled(panel);await page.screenshot({path:info.outputPath('memory-entry.png')});
  await panel.getByRole('button',{name:'关闭建筑记忆',exact:true}).click();
  await page.getByRole('button',{name:'任务',exact:true}).click();await page.getByRole('button',{name:'调整今日目标',exact:true}).click();
  const goal=page.getByRole('dialog',{name:'调整今日目标',exact:true});expect(await goal.evaluate(el=>getComputedStyle(el).animationName)).toBe('sheet-rise');
  await expect(goal.getByRole('switch')).toHaveCount(0);await settled(goal);await goal.getByRole('button',{name:'关闭今日目标',exact:true}).click();
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'调整今日目标',exact:true}).click();expect(await goal.evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
});

test('feedback87 mist reaches the foreground across all lighting profiles without rebuilding geometry',async({page},info)=>{
  test.setTimeout(120_000);await createProject(page);await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByLabel('临时调试世界',{exact:true}).check();await chooseDebugWeather(page,'mist');
  await page.getByLabel('指定时间',{exact:true}).check();
  await page.getByRole('button',{name:'计时',exact:true}).click();await waitForPreparedWorld(page);
  const canvas=page.locator('canvas[data-world-canvas]');await expect(canvas).toHaveAttribute('data-weather-kind','mist');
  for(const quality of ['流畅','均衡','精致']){
    await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('group',{name:'光影质量',exact:true}).getByRole('button',{name:quality,exact:true}).click();
    await page.getByRole('button',{name:'计时',exact:true}).click();await waitForPreparedWorld(page);
    expect(Number(await canvas.getAttribute('data-fog-near'))).toBe(0);expect(Number(await canvas.getAttribute('data-fog-far'))).toBeGreaterThan(24);
    await canvas.screenshot({path:info.outputPath(`mist-${quality}.png`)});
  }
  await page.getByRole('button',{name:'设置',exact:true}).click();await chooseDebugWeather(page,'clear');
  await page.getByRole('button',{name:'计时',exact:true}).click();await waitForPreparedWorld(page);expect(Number(await canvas.getAttribute('data-fog-near'))).toBeGreaterThan(0);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('临时调试世界',{exact:true}).uncheck();await expect(page.locator('#world-debug-weather')).toBeHidden();
});

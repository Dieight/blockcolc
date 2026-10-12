import { expect, test } from '@playwright/test';
import { readPersistedDomainState } from './persisted-domain-state';
import { choosePlanEndTime } from './focus-plan-controls';
import { waitForPreparedWorld } from './world-ready';

for (const minimal of [true, false]) test(`automatic ${minimal ? 'minimal' : 'marathon'} advances every round at its absolute boundary`, async ({page}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.clock.install({time:new Date('2026-10-11T04:00:00Z')});
  await page.addInitScript(({minimal}) => localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({
    minimalMode:minimal, focusMinutes:1, breakMinutes:minimal?1:2, autoContinueFocus:true, lightingQuality:'performance',
  })),{minimal});
  await page.goto('/');
  await page.getByRole('button',{name:'开始建造',exact:true}).click();
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','true');
  if(minimal) {
    const clock=page.locator('.minimal-clock-gesture');
    await clock.press('ArrowUp'); await clock.press('Enter');
  } else {
    await page.getByRole('button',{name:'调整本次计划',exact:true}).click();
    const sheet=page.getByRole('dialog',{name:'安排下一轮'});
    await sheet.getByRole('button',{name:'按结束时间',exact:true}).click();
    await choosePlanEndTime(sheet,'12:10');
    await sheet.getByRole('button',{name:'确认计划',exact:true}).click();
    await page.getByRole('button',{name:'开始到 12:10',exact:true}).click();
  }
  await expect(page.locator('.focus-task-context')).toContainText('第1/3轮');
  for(let round=1;round<3;round++) {
    await page.clock.fastForward(60_000);
    await expect(page.locator('.timer-break')).toBeVisible();
    await page.clock.fastForward(minimal?60_000:120_000);
    await expect(page.locator('.focus-task-context')).toContainText(`第${round+1}/3轮`);
    const state=(await readPersistedDomainState(page)).state;
    expect(state.focusHistory).toHaveLength(round);
    expect(state.activeFocusSession).toBeTruthy();
  }
  await page.clock.fastForward(60_000);
  await expect(page.locator('.focus-report-surface')).toBeVisible();
  expect((await readPersistedDomainState(page)).state.focusHistory).toHaveLength(3);
});

test('language and fonts switch live without rewriting task names or rebuilding the world',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
  await page.getByRole('button',{name:'开始建造',exact:true}).click();
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready','true');
  const state=(await readPersistedDomainState(page)).state;
  const canvas=page.locator('canvas[data-world-canvas]'),generation=await canvas.getAttribute('data-renderer-generation');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'English',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
  await page.getByRole('group',{name:'Font',exact:true}).getByRole('button',{name:'System',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-font','system');
  await page.getByRole('button',{name:'Pixel',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-font','pixel');
  await page.screenshot({path:'../../artifacts/verification-ui/v270-followup-english.png',fullPage:true});
  await page.getByRole('button',{name:'Timer',exact:true}).click();
  expect((await readPersistedDomainState(page)).state.projects).toEqual(state.projects);
  await expect(canvas).toHaveAttribute('data-renderer-generation',generation!);
  await page.reload();await expect(page.locator('html')).toHaveAttribute('lang','en');
  await waitForPreparedWorld(page);
  await expect(page.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
});

test('library previews native and hidden holiday blueprints, with reversible disclosures',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const library=page.locator('.blueprint-library');
  await library.getByRole('button',{name:/所有图纸/}).click();
  await library.locator('details').first().locator('summary').click();
  await expect(library.locator('details').first().getByRole('button')).toHaveCount(3);
  await library.locator('details').first().getByRole('button').first().click();
  const preview=page.getByRole('dialog',{name:'蓝图预览',exact:true});await expect(preview.locator('canvas')).toBeVisible();
  await preview.getByRole('button',{name:'关闭蓝图预览'}).click();
  await library.locator('summary').filter({hasText:'节日奖励'}).click();
  await library.getByRole('button',{name:/\?\?\?/}).first().click();
  await expect(preview.getByRole('img',{name:'尚未发现的节日建筑'})).toBeVisible();
  await expect(preview).toContainText('也许在某些特定节日启动方块钟会发现它');
  await expect(preview.locator('canvas')).toHaveCount(0);
  await preview.getByRole('button',{name:'关闭蓝图预览'}).click();
  await library.getByRole('button',{name:/所有图纸/}).click();await expect(library.locator('.content-reveal')).toHaveAttribute('inert','');
});

test('ambience is opt-in, accepts imported audio and removes it without touching domain data',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'开始建造',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  const before=(await readPersistedDomainState(page)).state;
  const group=page.locator('.ambient-audio-settings');await expect(group.getByRole('checkbox',{name:'自然白噪音',exact:true})).not.toBeChecked();
  await group.getByRole('checkbox',{name:'自然白噪音',exact:true}).check();
  await group.locator('input[type=file]').setInputFiles('../../apps/web/public/audio/morning-birdsong.wav');
  await expect(group.getByRole('radio',{name:'morning-birdsong.wav',exact:true})).toBeChecked();
  await expect(group.getByRole('radio',{name:'晚间湖畔',exact:true})).toHaveCount(0);
  await group.getByRole('button',{name:'删除音频：morning-birdsong.wav',exact:true}).click();await expect(group.getByRole('radio',{name:'morning-birdsong.wav',exact:true})).toHaveCount(0);
  await group.getByRole('checkbox',{name:'自然白噪音',exact:true}).uncheck();
  const prefs=await page.evaluate(()=>JSON.parse(localStorage.getItem('blockcolc-focus-preferences-v1')!));expect(prefs.ambience).toMatchObject({enabled:false,primary:'morning-birdsong'});
  const after=(await readPersistedDomainState(page)).state;expect(after.projects).toEqual(before.projects);expect(after.focusHistory).toEqual(before.focusHistory);
});

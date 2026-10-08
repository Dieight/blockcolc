import { test, expect, type Page } from '@playwright/test';

async function layout(page: Page) {
  return page.locator('.world-stage').evaluate(element => {
    const rect = element.getBoundingClientRect(), canvas = element.querySelector('canvas[aria-label="项目建筑世界"]') as HTMLCanvasElement;
    return { width: rect.width, height: rect.height, transform: getComputedStyle(canvas).transform, generation: canvas.dataset.rendererGeneration, rebuilds: canvas.dataset.worldRebuildCount };
  });
}

test('formal portal builds clockwise, waits through purple energy and opens a circular return without stretching the world', async ({ page }, info) => {
  test.setTimeout(180_000); await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date('2026-10-07T07:00:00Z'));
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const evidence: unknown[] = [];
  for (const theme of ['light', 'dark']) {
    await page.goto(`/review-2.6.0-app.html?theme=${theme}&quality=performance`);
    await expect(page.locator('body')).toHaveAttribute('data-review-ready', 'true', { timeout: 90_000 });
    const shell = page.locator('.app-shell'), world = page.locator('.world-screen');
    await expect(world).toHaveAttribute('data-minimal-mode', 'false');
    const normal = await layout(page); expect(normal.height).toBeLessThan(422); expect(normal.transform).toBe('none');
    await page.evaluate(() => {
      const target = window as any; target.portalCanvas = document.querySelector('canvas[aria-label="项目建筑世界"]'); target.portalHandoffs = [];
      new MutationObserver(records => {
        if (!records.some(record => record.attributeName === 'data-minimal-mode')) return;
        const entering = document.querySelector('.world-screen')?.getAttribute('data-minimal-mode') === 'true';
        const cover = document.querySelector(entering ? '.mode-portal__door' : '.mode-portal__backdrop');
        const rect = cover?.getBoundingClientRect();
        target.portalHandoffs.push({ mode: String(entering), phase: document.body.dataset.modePortalPhase, opacity: cover ? getComputedStyle(cover).opacity : null, coverage: rect ? { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom } : null });
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-minimal-mode'] });
      target.portalFreezeEnter = true; target.portalFreezeLeave = true; target.portalFreezeIgnition = true; target.portalFreezeExpansion = true;
      target.portalHoldVortex = true; target.portalHoldFlame = true;
      new MutationObserver(() => {
        const direction = document.querySelector('.mode-portal')?.getAttribute('data-direction');
        if (target.portalFreezeIgnition && document.body.dataset.modePortalPhase === 'igniting-portal') {
          for (const element of document.querySelectorAll('.mode-portal__field,.mode-portal__flame')) for (const animation of element.getAnimations()) { animation.pause(); animation.currentTime = 140; }
          target.portalFreezeIgnition = false; target.portalIgnitionPaused = true;
        }
        if (target.portalFreezeExpansion && direction === 'leave' && document.body.dataset.modePortalPhase === 'expanding') {
          for (const element of document.querySelectorAll('.mode-portal__field,.mode-portal__frame,.mode-portal__flame')) { const animation=element.getAnimations().at(-1)!; animation.pause(); animation.currentTime = 140; }
          target.portalFreezeExpansion = false; target.portalExpansionPaused = true;
        }
        if (document.body.dataset.modePortalPhase === 'revealing' &&
          (direction === 'enter' ? target.portalFreezeEnter : target.portalFreezeLeave)) {
          for (const element of document.querySelectorAll('.mode-portal__door,.mode-portal__vortex,.mode-portal__burn-rim')) {
            for (const animation of element.getAnimations()) { animation.pause(); animation.currentTime = 250; }
          }
          if (direction === 'enter') target.portalFreezeEnter = false; else target.portalFreezeLeave = false;
          target.portalRevealPaused = direction;
        }
        if ((target.portalHoldVortex && document.body.dataset.modePortalPhase === 'loading-vortex') ||
          (target.portalHoldFlame && document.body.dataset.modePortalPhase === 'loading-flame')) {
          const root = document.querySelector<HTMLElement>('.app-shell')!;
          if (root.dataset.presentationTransition !== 'fixture-hold') root.dataset.presentationTransition = 'fixture-hold';
        }
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-mode-portal-phase', 'data-presentation-transition'] });
    });
    await page.getByRole('button', { name: '进入极简模式', exact: true }).evaluate(element => {
      (element as HTMLButtonElement).click();
      document.querySelectorAll('.mode-portal__stone').forEach(stone => stone.getAnimations().forEach(animation => {
        animation.pause(); animation.currentTime = 480;
      }));
    });
    await expect(shell).toHaveAttribute('data-mode-portal-active', 'true');
    expect(await shell.evaluate(element => (element as HTMLElement).inert)).toBe(true);
    const portal = await page.locator('.mode-portal').evaluate(e => ({
      block: parseFloat(getComputedStyle(e).getPropertyValue('--portal-block')), purple: getComputedStyle(e).getPropertyValue('--portal-field').trim(),
      edgeMotion: getComputedStyle(e.querySelector('.mode-portal__field')!, '::before').animationName,
      swirlMotion: getComputedStyle(e.querySelector('.mode-portal__vortex')!, '::before').animationName,
      doorTransform: getComputedStyle(e.querySelector('.mode-portal__door')!).transform,
      fieldHidden: (e.querySelector('.mode-portal__field') as HTMLElement).hidden,
      stones: [...e.querySelectorAll<HTMLElement>('.mode-portal__stone')].map(stone => ({
        side: stone.dataset.side, opacity: getComputedStyle(stone).opacity, width: stone.offsetWidth, height: stone.offsetHeight,
        end: Number(stone.getAnimations()[0]!.effect!.getTiming().delay) + Number(stone.getAnimations()[0]!.effect!.getTiming().duration),
      })),
    }));
    expect(portal.purple).toBe(theme === 'light' ? '#76459c' : '#684088');
    expect(portal.edgeMotion).toBe('none'); expect(portal.swirlMotion).toBe('mode-portal-vortex');
    expect(portal.doorTransform).toBe('none'); expect(portal.fieldHidden).toBe(true);
    expect(portal.stones.every(s => s.width === s.height)).toBe(true);
    expect(portal.stones[0]!.side).toBe('left'); expect(portal.stones.at(-1)!.side).toBe('bottom');
    expect(portal.stones.at(-1)!.end).toBe(1000);
    const visibleStones = portal.stones.filter(s => s.opacity === '1');
    expect(visibleStones.length).toBeGreaterThan(8); expect(visibleStones.length).toBeLessThan(portal.stones.length);
    expect(portal.stones.slice(0, visibleStones.length).every(s => s.opacity === '1')).toBe(true);
    await expect(world).toHaveAttribute('data-minimal-mode', 'false');
    await page.screenshot({ path: info.outputPath(`formal-${theme}-building-frame.png`), scale: 'css' });
    await page.locator('.mode-portal__frame').evaluate(element => element.querySelectorAll('.mode-portal__stone').forEach(stone => stone.getAnimations().forEach(animation => animation.play())));
    await page.waitForFunction(() => (window as any).portalIgnitionPaused === true);
    await expect(shell).toHaveAttribute('data-mode-portal-phase', 'igniting-portal');
    const frame = page.locator('.mode-portal__frame');
    const litFrame = await frame.evaluate(e => [...e.children].map(stone => ({ opacity: getComputedStyle(stone).opacity, transform: getComputedStyle(stone).transform, rect: stone.getBoundingClientRect().toJSON() })));
    for (const time of [0, 70, 140, 280, 400]) {
      await page.locator('.mode-portal__field').evaluate((e, time) => { e.getAnimations().forEach(animation => { animation.currentTime = time; }); }, time);
      expect(await frame.evaluate(e => [...e.children].map(stone => ({ opacity: getComputedStyle(stone).opacity, transform: getComputedStyle(stone).transform, rect: stone.getBoundingClientRect().toJSON() })))).toEqual(litFrame);
    }
    expect(litFrame.every(stone => stone.opacity === '1' && stone.transform === 'none')).toBe(true);
    await page.locator('.mode-portal__field').evaluate(e => e.getAnimations().forEach(a => { a.currentTime = 140; }));
    await page.screenshot({ path: info.outputPath(`formal-${theme}-gradual-ignition.png`), scale: 'css' });
    await page.locator('.mode-portal__door').evaluate(e => e.querySelectorAll('.mode-portal__field,.mode-portal__flame').forEach(child => child.getAnimations().forEach(a => a.play())));
    await expect(shell).toHaveAttribute('data-mode-portal-phase', 'loading-vortex');
    await page.waitForTimeout(600); await expect(shell).toHaveAttribute('data-mode-portal-phase', 'loading-vortex');
    await page.screenshot({ path: info.outputPath(`formal-${theme}-vortex-awaiting-world.png`), scale: 'css' });
    await page.evaluate(() => { (window as any).portalHoldVortex = false; document.querySelector<HTMLElement>('.app-shell')!.dataset.presentationTransition = 'complete'; });
    await page.waitForFunction(() => (window as any).portalRevealPaused === 'enter', null, { timeout: 15_000 });
    const collapse = await page.locator('.mode-portal__door').evaluate(e => ({
      rect: e.getBoundingClientRect().toJSON(), duration: e.getAnimations().at(-1)!.effect!.getTiming().duration,
      clip: getComputedStyle(e).clipPath, transform: getComputedStyle(e).transform,
    }));
    expect(collapse.duration).toBe(500); expect(collapse.rect.width).toBe(390); expect(collapse.rect.height).toBe(844);
    expect(collapse.clip).toMatch(/^circle\([\d.]+px at 50% 50%\)$/); expect(collapse.transform).toBe('none');
    await page.screenshot({ path: info.outputPath(`formal-${theme}-center-collapse.png`), scale: 'css' });
    await page.locator('.mode-portal').evaluate(e => e.querySelectorAll('.mode-portal__door,.mode-portal__vortex').forEach(element => element.getAnimations().forEach(animation => animation.play())));
    await expect(shell).toHaveAttribute('data-mode-portal-active', 'false', { timeout: 20_000 });
    await expect(world).toHaveAttribute('data-minimal-mode', 'true');
    const minimal = await layout(page); expect(minimal.height).toBe(844); expect(minimal.transform).toBe('none');
    expect(minimal.generation).toBe(normal.generation); expect(minimal.rebuilds).toBe(normal.rebuilds);
    await page.screenshot({ path: info.outputPath(`formal-${theme}-minimal.png`), scale: 'css' });
    await page.getByRole('button', { name: '返回完整模式', exact: true }).evaluate(element => {
      (element as HTMLButtonElement).click();
      const animation = document.querySelector('.mode-portal__flame')!.getAnimations()[0]!;
      animation.pause(); animation.currentTime = 180;
    });
    await expect(shell).toHaveAttribute('data-mode-portal-phase', 'igniting');
    expect(await page.locator('.mode-portal__vortex').evaluate(e => getComputedStyle(e).display)).toBe('none');
    await page.screenshot({ path: info.outputPath(`formal-${theme}-flame.png`), scale: 'css' });
    await page.locator('.mode-portal__flame').evaluate(element => element.getAnimations().forEach(animation => animation.play()));
    await expect(shell).toHaveAttribute('data-mode-portal-phase', 'loading-flame');
    // Artificial preparation latency, not a production minimum animation wait.
    await page.waitForTimeout(800); await expect(shell).toHaveAttribute('data-mode-portal-phase', 'loading-flame');
    expect(await page.locator('.mode-portal__flame-body').evaluate(e => getComputedStyle(e).transform)).toBe('none');
    await expect(page.locator('.mode-portal__veil')).toHaveCount(0);
    const frozen = await page.locator('.mode-portal__backdrop').evaluate(host => {
      const canvas = host.shadowRoot!.querySelector('canvas')!, pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      const colors = new Set<string>(); let opaque = 0;
      for (let i = 0; i < pixels.length; i += 400) { if (pixels[i + 3] === 255) opaque++; colors.add(`${pixels[i]}:${pixels[i + 1]}:${pixels[i + 2]}`); }
      return { width: canvas.width, height: canvas.height, colors: colors.size, opaque, opacity: getComputedStyle(host).opacity, rect: host.getBoundingClientRect().toJSON(), text: host.shadowRoot!.textContent };
    });
    expect(frozen.width).toBe(390); expect(frozen.height).toBe(844);
    expect(frozen.colors).toBeGreaterThan(30); expect(frozen.opaque).toBeGreaterThan(1000); expect(frozen.opacity).toBe('1');
    expect(frozen.text).toContain('返回完整');
    expect(await page.locator('.mode-portal__flame').evaluate(e => e.getBoundingClientRect().width)).toBeGreaterThanOrEqual(152);
    const burn = await page.locator('.mode-portal__flame').evaluate(e => {
      const body=e.querySelector('.mode-portal__flame-body')!,base=body.getBoundingClientRect();
      const tips=[...e.querySelectorAll('.mode-portal__flame-tongue')];
      const differences=tips.map(tip=>{const animation=tip.getAnimations()[0]!;animation.pause();const values=[0,220,450,670].map(time=>{animation.currentTime=time;const rect=tip.getBoundingClientRect();return {height:rect.height,bottom:rect.bottom};});animation.play();return {height:Math.max(...values.map(v=>v.height))-Math.min(...values.map(v=>v.height)),bottom:Math.max(...values.map(v=>v.bottom))-Math.min(...values.map(v=>v.bottom))};});
      return {count:tips.length,transform:getComputedStyle(body).transform,baseHeight:base.height,differences};
    });
    expect(burn.count).toBe(3);expect(burn.transform).toBe('none');
    for(const tip of burn.differences){expect(tip.height).toBeGreaterThan(20);expect(tip.bottom).toBeLessThan(.1);}
    await page.screenshot({ path: info.outputPath(`formal-${theme}-fire-awaiting-world.png`), scale: 'css' });
    await page.evaluate(() => { (window as any).portalHoldFlame = false; document.querySelector<HTMLElement>('.app-shell')!.dataset.presentationTransition = 'complete'; });
    await page.waitForFunction(() => (window as any).portalExpansionPaused === true, null, { timeout: 15_000 });
    const expansion=await page.locator('.mode-portal').evaluate(root=>{
      const flame=root.querySelector('.mode-portal__flame')!,field=root.querySelector('.mode-portal__field')!;
      const scale=new DOMMatrix(getComputedStyle(flame).transform),texture=getComputedStyle(field,'::before');
      return {scaleX:scale.a,scaleY:scale.d,flameFrames:(flame.getAnimations().at(-1)!.effect as KeyframeEffect).getKeyframes(),fieldFrames:(field.getAnimations().at(-1)!.effect as KeyframeEffect).getKeyframes(),textureSize:texture.backgroundSize,fieldTransform:getComputedStyle(field).transform,clip:getComputedStyle(field).clipPath};
    });
    expect(expansion.scaleX).toBe(1);expect(expansion.scaleY).toBe(1);
    expect(expansion.flameFrames.every(frame=>frame.transform===undefined)).toBe(true);
    expect(expansion.fieldFrames.every(frame=>frame.transform===undefined)).toBe(true);
    expect(expansion.textureSize).toBe('96px 96px');expect(expansion.fieldTransform).toBe('none');expect(expansion.clip).toContain('circle(');
    await page.screenshot({path:info.outputPath(`formal-${theme}-material-expansion.png`),scale:'css'});
    await page.locator('.mode-portal').evaluate(root=>root.querySelectorAll('.mode-portal__field,.mode-portal__frame,.mode-portal__flame').forEach(element=>element.getAnimations().at(-1)!.play()));
    await page.waitForFunction(() => (window as any).portalRevealPaused === 'leave', null, { timeout: 15_000 });
    const opening = await page.locator('.mode-portal__door').evaluate(e => ({
      clip: getComputedStyle(e).clipPath, transform: getComputedStyle(e).transform,
      duration: e.getAnimations().at(-1)!.effect!.getTiming().duration,
      acceptsHole: CSS.supports('clip-path', getComputedStyle(e).clipPath),
      keyframes:(e.getAnimations().at(-1)!.effect as KeyframeEffect).getKeyframes().length,
    }));
    expect(opening.clip).toContain('polygon(evenodd,'); expect(opening.transform).toBe('none');
    expect(opening.duration).toBe(500); expect(opening.acceptsHole).toBe(true);
    expect(opening.keyframes).toBe(9);
    const burningRim=page.locator('.mode-portal__burn-rim');
    await expect(burningRim).toBeVisible();
    expect(await burningRim.evaluate(e=>CSS.supports('clip-path',getComputedStyle(e).clipPath))).toBe(true);
    await page.screenshot({ path: info.outputPath(`formal-${theme}-circular-return.png`), scale: 'css' });
    await page.locator('.mode-portal').evaluate(e=>e.querySelectorAll('.mode-portal__door,.mode-portal__burn-rim').forEach(element=>element.getAnimations().at(-1)!.play()));
    await expect(shell).toHaveAttribute('data-mode-portal-active', 'false', { timeout: 20_000 });
    await expect(world).toHaveAttribute('data-minimal-mode', 'false'); expect(await layout(page)).toEqual(normal);
    expect(await page.locator('canvas[aria-label="项目建筑世界"]').evaluate(element => element === (window as any).portalCanvas)).toBe(true);
    const handoffs = await page.evaluate(() => (window as any).portalHandoffs);
    expect(handoffs).toHaveLength(2);
    for (const handoff of handoffs) {
      expect(handoff.phase).toBe(handoff.mode === 'true' ? 'loading-vortex' : 'loading-flame');
      expect(handoff.opacity).toBe('1'); expect(handoff.coverage).toEqual({ x: 0, y: 0, right: 390, bottom: 844 });
    }
    await expect(page.locator('.mode-portal')).toHaveCount(0);
    expect(await shell.evaluate(element => (element as HTMLElement).inert)).toBe(false);
    evidence.push({ theme, normal, minimal, handoffs });
    // Escape before the handoff cancels only the visual, never changes the mode.
    await page.getByRole('button', { name: '进入极简模式', exact: true }).evaluate(element => {
      (element as HTMLButtonElement).click(); document.querySelectorAll('.mode-portal__stone').forEach(stone => stone.getAnimations().forEach(a => a.pause()));
    });
    await page.keyboard.press('Escape'); await expect(shell).toHaveAttribute('data-mode-portal-active', 'false');
    await expect(world).toHaveAttribute('data-minimal-mode', 'false');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: '进入极简模式', exact: true }).click();
    await expect(world).toHaveAttribute('data-minimal-mode', 'true'); await expect(page.locator('.mode-portal')).toHaveCount(0);
    await page.getByRole('button', { name: '返回完整模式', exact: true }).click(); await expect(world).toHaveAttribute('data-minimal-mode', 'false');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  await info.attach('formal-portal-layout', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('mosaic coast shore and block spruce stay legible in a twenty-four-building real world', async ({ page }, info) => {
  test.setTimeout(120_000); await page.setViewportSize({ width: 1200, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.clock.setFixedTime(new Date('2026-10-07T07:00:00Z'));
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/review-2.6.0-app.html?environment=mosaic-coast&buildings=24&quality=performance');
  await expect(page.locator('body')).toHaveAttribute('data-review-ready', 'true', { timeout: 90_000 });
  await page.getByRole('button', { name: '重置地图', exact: true }).evaluate(e => (e as HTMLButtonElement).click());
  await page.getByRole('button', { name: '进入极简模式', exact: true }).click();
  await expect(page.locator('.world-screen')).toHaveAttribute('data-minimal-mode', 'true');
  await expect(page.locator('.world-screen')).toHaveAttribute('data-world-ready', 'true');
  const canvas = page.locator('canvas[aria-label="项目建筑世界"]');
  await expect(canvas).toHaveAttribute('data-world-rebuild-count', /\d/);
  await page.screenshot({ path: info.outputPath('coast-24-buildings.png'), animations: 'disabled' });
  await info.attach('coast-real-render', { body: JSON.stringify(await canvas.evaluate(element => { const e = element as HTMLCanvasElement; return { dimensions: { width: e.width, height: e.height }, generation: e.dataset.rendererGeneration, rebuilds: e.dataset.worldRebuildCount }; })), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('tomato grows once, repeats fruit only, lands then rebounds before disappearing and pauses in background', async ({ page }, info) => {
  await page.goto('/review-2.6.0-loading.html?scene=tomato&theme=light');
  await expect(page.locator('.boot-tomato')).toBeVisible();
  const samples = [
    { time: 400, visible: ['萌芽'] }, { time: 1500, visible: ['完整茎'] },
    { time: 2800, visible: ['完整茎', '青番茄'] }, { time: 4500, visible: ['完整茎', '成熟'] },
    { time: 6100, visible: ['完整茎', '落果'] }, { time: 7720, visible: ['完整茎', '落果'] },
    { time: 8100, visible: ['完整茎'] }, { time: 8500, visible: ['完整茎', '青番茄'] },
  ];
  for (const sample of samples) {
    const visible = await page.evaluate(time => {
      document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = time; });
      return [...document.querySelectorAll<HTMLElement>('[data-tomato-stage]')].filter(element => Number(getComputedStyle(element).opacity) > .9).map(element => element.dataset.tomatoStage);
    }, sample.time);
    expect(visible).toEqual(sample.visible);
    await page.locator('.boot-page-inner').screenshot({ path: info.outputPath(`tomato-${sample.time}.png`) });
  }
  await page.evaluate(() => document.getAnimations().forEach(animation => { animation.currentTime = 6820; }));
  const contact = await page.evaluate(() => ({ fruit: document.querySelector('.tomato-fall .tomato-fruit-red')!.getBoundingClientRect().bottom, soil: document.querySelector('.tomato-soil')!.getBoundingClientRect().top }));
  expect(Math.abs(contact.fruit - contact.soil)).toBeLessThan(2);
  await page.evaluate(() => document.getAnimations().forEach(animation => { animation.currentTime = 7150; }));
  const rebound = await page.locator('.tomato-fall .tomato-fruit-red').evaluate(e => e.getBoundingClientRect().bottom);
  expect(rebound).toBeLessThan(contact.fruit - 3);
  await page.evaluate(() => document.getAnimations().forEach(animation => { animation.currentTime = 7480; }));
  const landed = await page.locator('.tomato-fall .tomato-fruit-red').evaluate(e => e.getBoundingClientRect().bottom);
  expect(Math.abs(landed - contact.soil)).toBeLessThan(2);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('.boot-scene')).toHaveAttribute('data-paused', 'true');
  expect(await page.locator('.tomato-fall').evaluate(element => getComputedStyle(element).animationPlayState)).toBe('paused');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.tomato-ripe-layer').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  expect(await page.locator('.tomato-sprout').evaluate(element => getComputedStyle(element).opacity)).toBe('0');
  await page.goto('/review-2.6.0-loading.html?scene=tomato&theme=dark');
  await page.screenshot({ path: info.outputPath('tomato-dark-static.png') });
});

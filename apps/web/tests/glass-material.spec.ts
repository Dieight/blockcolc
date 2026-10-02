import { expect, test } from '@playwright/test';
import { fixBusinessDate } from './fixed-business-date';

for (const theme of ['light', 'dark'] as const) for (const clarity of [0, 50, 100]) {
  test(`${theme} glass ${clarity}: GPU scattering respects the panel, orbit input and solid fallback`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('console', message => { if (/Shader Error|THREE.WebGLProgram|GL_INVALID|compositor unavailable/.test(message.text())) errors.push(message.text()); });
    await fixBusinessDate(page, new Date('2026-10-01T12:00:00+08:00'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(({ theme, clarity }) => localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({
      focusMinutes: 45, breakMinutes: 5, themeMode: theme, focusGlassTransparency: clarity, minimalMode: true, lightingQuality: 'balanced',
    })), { theme, clarity });
    await page.goto('/'); await page.getByRole('button', { name: '开始建造', exact: true }).click();
    const world = page.getByLabel('项目建筑世界'), panel = page.locator('.focus-panel');
    await expect(world).toHaveAttribute('data-glass-material', 'gpu');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(panel).toHaveCSS('backdrop-filter', 'none');
    const height = (await panel.boundingBox())!.height;
    const rebuild = await world.getAttribute('data-world-rebuild-count');
    const before = Number(await world.getAttribute('data-glass-gpu-copy-count'));
    const box = (await world.boundingBox())!;
    await page.mouse.move(box.x + box.width * .3, box.y + box.height * .2); await page.mouse.down();
    await page.mouse.move(box.x + box.width * .65, box.y + box.height * .25, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => Number(await world.getAttribute('data-glass-gpu-copy-count'))).toBeGreaterThan(before);
    await expect(world).toHaveAttribute('data-world-rebuild-count', rebuild!);
    expect((await panel.boundingBox())!.height).toBe(height);
    const clock = page.locator('.minimal-clock-gesture'); await clock.press('ArrowUp'); await clock.press('Escape');
    await expect(clock).toHaveCSS('outline-style', 'none');
    expect(await clock.evaluate(node => getComputedStyle(node, '::after').opacity)).toBe('1');
    expect(await clock.evaluate(node => getComputedStyle(node, '::after').height)).toBe('2px');
    expect(await clock.evaluate(node => getComputedStyle(node, '::after').transitionProperty)).toBe('none');
    await clock.click();
    expect(await clock.evaluate(node => getComputedStyle(node, '::after').opacity)).toBe('0');
    await clock.press('ArrowUp');
    expect(await clock.evaluate(node => getComputedStyle(node, '::after').opacity)).toBe('1');
    await clock.press('Escape'); await clock.click();
    expect(await clock.evaluate(node => getComputedStyle(node, '::after').opacity)).toBe('0');
    await page.screenshot({ path: info.outputPath(`glass-${theme}-${clarity}.png`) });
    await info.attach('glass-frame', { body: JSON.stringify(await world.evaluate(node => ({ ...node.dataset }))), contentType: 'application/json' });
    if (theme === 'light' && clarity === 50) {
      await page.setViewportSize({ width: 915, height: 412 });
      await expect(world).toHaveAttribute('data-glass-material', 'gpu');
      await expect.poll(async () => (await panel.boundingBox())!.x).toBeGreaterThan(400);
      const band = (await panel.boundingBox())!;
      expect(band.x + band.width).toBeCloseTo(915, 0);
      expect(band.height).toBeCloseTo(412, 0);
      await page.screenshot({ path: info.outputPath('glass-light-50-landscape.png') });
      await page.setViewportSize({ width: 412, height: 915 });
      await expect.poll(async () => (await panel.boundingBox())!.height).toBe(height);
    }
    if (clarity === 50) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
      await expect(world).toHaveAttribute('data-glass-material', 'solid');
      await expect(world).toHaveAttribute('data-glass-gpu-region', '1x1');
      const copies = await world.getAttribute('data-glass-gpu-copy-count');
      await clock.press('ArrowUp'); await clock.press('Escape');
      expect((await panel.boundingBox())!.height).toBe(height);
      expect(await world.getAttribute('data-glass-gpu-copy-count')).toBe(copies);
      await page.screenshot({ path: info.outputPath(`glass-${theme}-solid.png`) });
      await cdp.detach();
    }
    expect(errors).toEqual([]);
  });
}

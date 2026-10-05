import { expect, test, type Page } from '@playwright/test';
import { createInitialState, execute, type DomainCommand } from '@blockcolc/domain';
import { readPersistedDomainState } from './persisted-domain-state';
import { fixBusinessDate } from './fixed-business-date';
import { waitForPreparedWorld } from './world-ready';

const at = Date.parse('2026-10-03T12:00:00+08:00');
async function seed(page: Page, minimal: boolean, theme: 'light' | 'dark' = minimal ? 'light' : 'dark', displayTime = at + 70_000) {
  let state = createInitialState('Asia/Shanghai');
  const run = (command: DomainCommand, time: number) => {
    const result = execute(state, command, { now: () => new Date(time) });
    if (!result.ok) throw Error(result.message); state = result.state;
  };
  run({ type: 'CreateProject', projectId: 'p', title: '设计一座钟', blueprintId: 'builtin-small-workshop',
    subtasks: [{ id: 's', title: '绘制表盘' }] }, at);
  run(minimal ? { type: 'StartFocus', sessionId: 'r', projectId: 'p', subtaskId: null, marathon: true, deferredSettlement: true, plannedDurationMs: 60_000 }
    : { type: 'StartFocus', sessionId: 'r', subtaskId: 's', plannedDurationMs: 60_000 }, at);
  run({ type: 'CompleteFocus' }, at + 60_000);
  await fixBusinessDate(page, new Date(displayTime));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.evaluate(async ({ state, minimal, theme }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('appState', 'readwrite'), store = tx.objectStore('appState'), current = store.get('current');
        current.onsuccess = () => store.put({ id: 'current', revision: (current.result?.revision ?? 0) + 1,
          state: { ...state, decorationBlueprintResources: current.result?.state?.decorationBlueprintResources ?? state.decorationBlueprintResources } });
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
    localStorage.setItem('blockcolc-first-project-setup-v1', '1');
    localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({ focusMinutes: 1, breakMinutes: 1, themeMode: theme, minimalMode: minimal, focusGlassTransparency: 100 }));
    if (minimal) localStorage.setItem('blockcolc-round-plan-v1', JSON.stringify({ projectId: 'p', subtaskId: null, mode: 'marathon', deferredSettlement: true,
      totalRounds: 1, completedRounds: 1, status: 'report', reportedSessionIds: [] }));
  }, { state, minimal, theme });
  await page.reload();
  await expect(page.locator('.focus-report-surface')).toBeVisible();
  const canvas = await waitForPreparedWorld(page);
  await canvas.evaluate(element => element.setAttribute('data-receipt-identity', 'resident'));
  return canvas;
}

for (const theme of ['light', 'dark'] as const) test(`v256 ${theme} report stays readable over a real night world without a second backdrop`, async ({ page }, info) => {
  test.setTimeout(60_000);
  const canvas = await seed(page, true, theme, Date.parse('2026-10-04T00:00:00+08:00'));
  await expect(canvas).toHaveAttribute('data-day-phase', 'night');
  const report = page.locator('.focus-report-surface--minimal'), panel = page.locator('.focus-panel');
  await report.getByRole('button', { name: /设计一座钟/ }).click();
  await expect(report).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(report).toHaveCSS('text-shadow', 'none');
  const style = await panel.evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
  const rgba = (value: string) => value.match(/[\d.]+/g)!.map(Number);
  const [r, g, b, alpha] = rgba(style.background);
  const worstWorld = theme === 'light' ? 0 : 255;
  const background = [r!, g!, b!].map(v => v * alpha! + worstWorld * (1 - alpha!));
  const luminance = (rgb: number[]) => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [ .2126, .7152, .0722 ][i]!, 0);
  const expectedInk = theme === 'light' ? 'rgb(23, 33, 28)' : 'rgb(230, 239, 233)';
  for (const selector of ['.minimal-report-caption', '.minimal-report-help', '.marathon-settlement-copy strong', '.marathon-settlement-toggle', '.minimal-report-allocation']) {
    const text = report.locator(selector).first();
    await expect(text).toHaveCSS('color', expectedInk);
    await expect(text).toHaveCSS('text-shadow', 'none');
    const foregroundL = luminance(rgba(expectedInk)), backgroundL = luminance(background);
    expect((Math.max(foregroundL, backgroundL) + .05) / (Math.min(foregroundL, backgroundL) + .05)).toBeGreaterThanOrEqual(4.5);
  }
  await info.attach('reading-contrast', {body: JSON.stringify({ theme, ...style, worstWorld, background }), contentType: 'application/json'});
  await page.screenshot({path: info.outputPath(`night-report-${theme}.png`)});
});

for (const minimal of [false, true]) test(`v256 ${minimal ? 'minimal multi-round' : 'ordinary'} receipt follows persistence and lasts two seconds inside glass`, async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const canvas = await seed(page, minimal), report = page.locator('.focus-report-surface');
  if (minimal) {
    await report.getByRole('button', { name: /设计一座钟/ }).click();
    await report.getByRole('button', { name: '推进至 25%', exact: true }).click();
    await report.getByRole('button', { name: /^增加.*计入轮数$/ }).click();
    expect(await page.locator('.marathon-report-footer').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  }
  expect(await report.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await report.evaluate(element => {
    const stamps = { shownAt: 0, endedAt: 0 };
    (window as typeof window & { __receiptStamps?: typeof stamps }).__receiptStamps = stamps;
    const observe = new MutationObserver(() => {
      if (!stamps.shownAt && element.textContent?.includes('材料已送达')) stamps.shownAt = performance.now();
      if (stamps.shownAt && !element.isConnected) { stamps.endedAt = performance.now(); observe.disconnect(); }
    });
    observe.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const before = await readPersistedDomainState(page);
  await report.getByRole('button', { name: minimal ? '一次提交本次推进' : '推进至 25%', exact: true }).click();
  const received = report.getByRole('button', { name: '材料已送达！', exact: true });
  await expect(received).toBeVisible(); await expect(received).toBeDisabled();
  await expect(received).toHaveAttribute('aria-busy', 'false');
  expect((await readPersistedDomainState(page)).state.progressReports).toHaveLength(before.state.progressReports.length + 1);
  await received.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(report).toHaveCount(0);
  const stamps = await page.evaluate(() => (window as typeof window & { __receiptStamps: { shownAt: number; endedAt: number } }).__receiptStamps);
  expect(stamps.endedAt - stamps.shownAt).toBeGreaterThanOrEqual(1_900);
  expect((await readPersistedDomainState(page)).state.progressReports).toHaveLength(before.state.progressReports.length + 1);
  await expect(canvas).toHaveAttribute('data-receipt-identity', 'resident');
  await expect(canvas).toHaveAttribute('data-precipitation-ground-cache-hit', 'true');
  await expect(page.locator('.construction-feedback')).toHaveCount(0);
  await expect(page.locator('.setup')).toHaveCount(0); expect(errors).toEqual([]);
  await testInfo.attach('receipt-lifetime', { body: JSON.stringify({ minimal, durationMs: stamps.endedAt - stamps.shownAt }), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath(`v256-${minimal ? 'minimal' : 'ordinary'}-after-receipt.png`) });
});

test('v256 world colour edits persist, grade actual frames and reset without a world rebuild', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const canvas = await seed(page, false);
  // A report is an immersive state: settle it before navigating to the settings.
  await page.getByRole('button', { name: '保持 0%', exact: true }).click();
  await expect(page.locator('.focus-report-surface')).toHaveCount(0);
  const rebuilds = await canvas.getAttribute('data-world-rebuild-count');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText('世界色彩', { exact: true }).click();
  await page.getByLabel('世界饱和度', { exact: true }).fill('135');
  await page.getByLabel('世界亮度', { exact: true }).fill('90');
  await page.getByLabel('世界对比度', { exact: true }).fill('110');
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-world-color-pass', 'active');
  expect(await canvas.getAttribute('data-world-rebuild-count')).toBe(rebuilds);
  await page.reload();
  await expect(canvas).toHaveAttribute('data-world-color-pass', 'active', { timeout: 25_000 });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText('世界色彩', { exact: true }).click();
  await expect(page.getByLabel('世界饱和度', { exact: true })).toHaveValue('135');
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.getByRole('button', { name: '计时', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-world-color-pass', 'neutral');
  await page.getByRole('button', { name: '关于方块钟', exact: true }).click();
  await expect(page.getByRole('link', { name: /缝合像素/ })).toHaveAttribute('href', 'licenses/fusion-pixel/OFL.txt');
  await page.screenshot({ path: testInfo.outputPath('v256-font-about.png') });
});

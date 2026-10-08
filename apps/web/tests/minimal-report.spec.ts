import { expect, test, type Page } from '@playwright/test';
import { createInitialState, execute, type DomainCommand } from '@blockcolc/domain';
import type { RoundPlan } from '../src/round-plan';
import { readPersistedDomainState } from './persisted-domain-state';
import { fixBusinessDate } from './fixed-business-date';
import { defaultFocusPreferences } from '../src/focus-preferences';
import { waitForPreparedWorld } from './world-ready';

const now = Date.parse('2026-10-01T12:00:00+08:00');
async function reportFixture(page: Page, theme: 'light' | 'dark') {
  // Each theme restores at the mobile baseline; the assertions below then
  // visit every viewport. Do not inherit the previous loop's desktop size.
  await page.setViewportSize({ width: 412, height: 915 });
  let state = createInitialState('Asia/Shanghai');
  const run = (command: DomainCommand, at = now) => {
    const result = execute(state, command, { now: () => new Date(at) });
    if (!result.ok) throw new Error(result.message);
    state = result.state;
  };
  run({ type: 'CreateProject', projectId: 'report-p', title: '把很长的工作分成容易开始的事情', blueprintId: 'builtin-small-workshop',
    subtasks: [{ id: 'report-s', title: '整理本周资料和完成一份足够长的文档名称' }] });
  run({ type: 'CreateHabitProject', projectId: 'report-h', title: '阅读', blueprintId: 'builtin-small-workshop', targetRounds: 10 });
  for (let i = 0; i < 2; i++) {
    run({ type: 'StartFocus', projectId: 'report-p', sessionId: `report-r${i}`, subtaskId: null, marathon: true,
      deferredSettlement: true, plannedDurationMs: 60_000 }, now + i * 60_000);
    run({ type: 'CompleteFocus' }, now + (i + 1) * 60_000);
  }
  const plan: RoundPlan = { projectId: 'report-p', subtaskId: null, mode: 'marathon', deferredSettlement: true,
    totalRounds: 2, completedRounds: 2, status: 'report', reportedSessionIds: [] };
  await fixBusinessDate(page, new Date(now + 180_000));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.evaluate(async ({ state, plan, preferences }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('blockcolc-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('appState', 'readwrite'), store = tx.objectStore('appState'), current = store.get('current');
      current.onsuccess = () => store.put({ id: 'current', revision: (current.result?.revision ?? 0) + 1,
        // This fixture restores reporting facts, not a fresh catalog import.
        state: { ...state, decorationBlueprintResources: current.result?.state?.decorationBlueprintResources
          ?? state.decorationBlueprintResources } });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); db.close();
    localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify(preferences));
    localStorage.setItem('blockcolc-round-plan-v1', JSON.stringify(plan));
  }, { state, plan, preferences: { ...defaultFocusPreferences(), minimalMode: true, themeMode: theme, lightingQuality: 'performance' } });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  // Storage readiness precedes real world/GPU preparation. The report must
  // stay hidden during that preparation, just like the idle minimal panel.
  await waitForPreparedWorld(page);
}

test('minimal glass reporting stays usable in both themes and five viewports, retaining a failed draft', async ({ page }, info) => {
  test.setTimeout(150_000);
  for (const theme of ['light', 'dark'] as const) {
    await reportFixture(page, theme);
    const report = page.locator('.focus-report-surface--minimal');
    await expect(report).toBeVisible();
    await expect(report).toContainText('2 轮专注已结束');
    await expect(report.locator('h2')).toHaveText('2 分钟');
    await expect(report).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(report).toHaveCSS('border-top-width', '0px');
    await report.getByRole('button', { name: /把很长的工作/ }).click();
    await report.getByRole('button', { name: '保持 0%', exact: true }).click();
    await report.getByRole('button', { name: /增加 .*计入轮数/ }).click();
    await expect(report.locator('.minimal-report-allocation')).toContainText('已分配 1 / 2 轮');
    const mutedColor = await report.evaluate(el => {
      const probe = document.createElement('span'); probe.style.color = 'var(--muted)'; el.append(probe);
      const color = getComputedStyle(probe).color; probe.remove(); return color;
    });
    await expect(report.locator('.minimal-report-allocation')).toHaveCSS('color', mutedColor);
    const before = await readPersistedDomainState(page);
    for (const [label, width, height] of [['compact', 360, 800], ['phone', 412, 915], ['landscape', 915, 412], ['tablet', 768, 1024], ['desktop', 1440, 900]] as const) {
      await page.setViewportSize({ width, height });
      const submit = report.getByRole('button', { name: '一次提交本次推进', exact: true });
      await submit.scrollIntoViewIfNeeded();
      await expect(submit).toBeVisible();
      expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const layout = await report.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth,
        offscreen: el.getBoundingClientRect().right > innerWidth + 1 }));
      expect(layout.scroll).toBeLessThanOrEqual(layout.client + 1); expect(layout.offscreen).toBe(false);
      await page.screenshot({ path: info.outputPath(`report-${theme}-${label}.png`) });
    }
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
        if (this.name === 'appState') { IDBObjectStore.prototype.put = put; throw new Error('synthetic report storage failure'); }
        return put.apply(this, args);
      };
    });
    await report.getByRole('button', { name: '一次提交本次推进', exact: true }).click();
    // The storage adapter deliberately exposes an atomic-save failure, not
    // the synthetic inner exception or implementation details of IndexedDB.
    await expect(page.locator('.toast')).toContainText('Could not atomically save application state');
    await expect(report).toBeVisible();
    await expect(report.getByRole('button', { name: '保持 0%', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(report.locator('.minimal-report-allocation')).toContainText('已分配 1 / 2 轮');
    expect(await readPersistedDomainState(page)).toEqual(before);
    await report.getByRole('button', { name: '一次提交本次推进', exact: true }).click();
    await expect(report).toBeHidden();
    const after = (await readPersistedDomainState(page)).state;
    expect(after.progressReports).toHaveLength(before.state.progressReports.length + 1);
    expect(after.focusHistory.every(s => s.settledAt)).toBe(true);
    expect(after.projects.find(p => p.id === 'report-p')!.subtasks[0]!.progressBasisPoints).toBe(0);
    await page.reload(); await waitForPreparedWorld(page); await expect(report).toBeHidden();
  }
});

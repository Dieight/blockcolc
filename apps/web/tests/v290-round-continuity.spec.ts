import { expect, test, type Page } from '@playwright/test';
import { choosePlanEndTime, finishPaintedReportReceipt, startNextRound } from './focus-plan-controls';
import { readPersistedDomainState } from './persisted-domain-state';
import { waitForPreparedWorld } from './world-ready';
import type { RoundPlan } from '../src/round-plan';

async function setup(page: Page, autoContinueFocus = false, restored = false) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(autoContinueFocus => {
    localStorage.setItem('blockcolc-tutorial-v1', '1');
    localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({
      lightingQuality: 'performance', themeMode: 'light', focusMinutes: 1,
      breakMinutes: 0, autoContinueFocus,
    }));
  }, autoContinueFocus);
  await page.goto('/');
  await page.getByRole('button', { name: '开始建造', exact: true }).click();
  await waitForPreparedWorld(page);
  if (restored) {
    // Model an existing restored database, including its durable replacement fence.
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('blockcolc-v1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('metadata', 'readwrite');
          transaction.objectStore('metadata').put({ id: 'last-domain-replacement', revision: 7 });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      } finally { db.close(); }
    });
    await page.reload();
    await waitForPreparedWorld(page);
  }
  // Pause only after rendering is ready; schedule arithmetic then has an exact clock.
  await page.clock.install({ time: new Date('2026-10-23T08:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-23T08:00:01Z'));
}

async function savedPlan(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('blockcolc-round-plan-v1') ?? 'null') as RoundPlan | null);
}

for (const restored of [false, true]) for (const auto of [false, true]) for (const mode of ['rounds', 'marathon'] as const) {
  test(`${mode} preserves multiple rounds: restored=${restored}, auto=${auto}`, async ({ page }) => {
    test.setTimeout(120_000);
    await setup(page, auto, restored);
    await page.getByRole('button', { name: '调整本次计划', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '安排下一轮', exact: true });
    if (mode === 'rounds') await sheet.getByRole('button', { name: '3 轮', exact: true }).click();
    else {
      await sheet.getByRole('button', { name: '按结束时间', exact: true }).click();
      await choosePlanEndTime(sheet, '16:05');
    }
    await sheet.getByRole('button', { name: '确认计划', exact: true }).click();
    await page.clock.runFor(300);
    await expect(sheet).toHaveCount(0);
    const total = mode === 'rounds' ? 3 : (await savedPlan(page))!.totalRounds;
    expect(total).toBeGreaterThan(1);
    await page.getByRole('button', { name: mode === 'rounds' ? '开始 3 轮' : /^开始到/ }).click();
    await page.clock.runFor(1000);
    await expect.poll(async () => (await readPersistedDomainState(page)).state.activeFocusSession?.id).toBeTruthy();
    for (let completed = 0; completed < total; completed += 1) {
      await expect.poll(() => savedPlan(page)).toMatchObject({ totalRounds: total, status: 'focus', completedRounds: completed });
      const current = (await readPersistedDomainState(page)).state.activeFocusSession!;
      const remaining = await page.evaluate(end => Date.parse(end) - Date.now(), current.endsAt);
      await page.clock.fastForward(Math.max(0, remaining) + 1);
      await expect.poll(async () => (await readPersistedDomainState(page)).state.focusHistory.length).toBe(completed + 1);
      if (mode === 'rounds') {
        await expect(page.locator('.progress-report-panel')).toBeVisible();
        expect((await savedPlan(page))?.totalRounds).toBe(total);
        await page.getByRole('button', { name: '保持 0%', exact: true }).click();
        await finishPaintedReportReceipt(page);
      }
      if (completed + 1 < total) {
        await expect.poll(() => savedPlan(page)).toMatchObject({ totalRounds: total, completedRounds: completed + 1, status: auto ? 'focus' : 'ready' });
        await expect(page.locator('.marathon-progress-report')).toHaveCount(0);
        if (!auto) await startNextRound(page);
      }
    }
    const state = (await readPersistedDomainState(page)).state;
    expect(state.focusHistory).toHaveLength(total);
    expect(new Set(state.focusHistory.map(session => session.id)).size).toBe(total);
    expect(state.activeFocusSession).toBeNull();
    if (mode === 'rounds') expect(await savedPlan(page)).toBeNull();
    else {
      await expect.poll(() => savedPlan(page)).toMatchObject({ totalRounds: total, completedRounds: total, status: 'report' });
      await expect(page.locator('.marathon-progress-report')).toBeVisible();
    }
  });
}

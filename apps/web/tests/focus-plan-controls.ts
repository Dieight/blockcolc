import { expect, type Locator, type Page } from '@playwright/test';
import { readPersistedDomainState } from './persisted-domain-state';

/** Advance the saved report's painted receipt only when this test owns a fake clock. */
export async function finishPaintedReportReceipt(page: Page) {
  const report = page.locator('.focus-report-surface');
  await expect.poll(async () => await report.count() === 0
    || await report.locator('[data-action-state="success"]').isVisible()).toBe(true);
  if (await report.count() === 0) return;
  // Acknowledge is scheduled after two paint opportunities, then lasts 2 s.
  // This drives that presentation contract, not an arbitrary wall-time sleep.
  await page.clock.runFor(64);
  await page.clock.fastForward(2_000);
  await expect(report).toHaveCount(0);
}

/** Exercise the shared five-minute slider through its accessible keyboard path. */
export async function choosePlanEndTime(sheet: Locator, time: string) {
  const slider = sheet.getByRole('slider', { name: '结束时间，上下滑动或按方向键调整' });
  const current = await slider.locator('.timer-value').innerText();
  const minutes = (text: string) => {
    const [hour, minute] = text.split(':').map(Number);
    return hour! * 60 + minute!;
  };
  const delta = minutes(time) - minutes(current);
  if (!Number.isFinite(delta) || delta % 5 !== 0) throw new Error(`Unsupported slider fixture: ${current} -> ${time}`);
  for (let step = 0; step < Math.abs(delta) / 5; step += 1)
    await slider.press(delta > 0 ? 'ArrowUp' : 'ArrowDown');
  await expect(slider.locator('.timer-value')).toHaveText(time);
}

/** App-owned reason menu; a note is optional. */
export async function preparePlanCancellation(sheet: Locator) {
  const confirm = sheet.getByRole('button', { name: '确认取消整个计划', exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeDisabled();
  await sheet.locator('.choice-menu').filter({hasText:'取消原因'}).locator('.choice-menu-trigger').click();
  await sheet.getByRole('option', { name: '优先级变化', exact: true }).click();
  await expect(confirm).toBeEnabled();
  return confirm;
}

/** Shared immersive ready is confirmed by double-tap or Enter, never by a single clock tap. */
export async function startNextRound(page: Page) {
  const clock = page.locator('.minimal-ready-clock');
  await expect(clock).toBeVisible();
  await clock.press('Enter');
  await expectRunningRound(page);
}

/** Explicit rest-clock confirmation skips the rest AND starts the next round. */
export async function continueFromRest(page: Page) {
  const clock = page.locator('.minimal-break-clock:not(.minimal-ready-clock)');
  await expect(clock).toBeVisible();
  await clock.press('Enter');
  await expectRunningRound(page);
}

async function expectRunningRound(page: Page) {
  await expect.poll(async () => (await readPersistedDomainState(page)).state.activeFocusSession?.id).toBeTruthy();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('blockcolc-round-plan-v1') ?? 'null')?.status)).toBe('focus');
}

/** One real double-tap, then await its reveal; never toggle it again while it animates. */
export async function revealFocusControls(page: Page) {
  const controls = page.locator('.immersive-controls');
  const end = page.getByRole('button', { name: '结束本次专注', exact: true });
  await expect(controls).not.toHaveClass(/is-leaving/);
  if (await end.isVisible()) return;
  await page.locator('.immersive-hint').dblclick();
  await expect(end).toBeVisible();
  await expect(controls).not.toHaveClass(/is-leaving/);
}

/** Rest retains its adjustment sheet; ready deliberately has no plan entry. */
export async function openRetainedPlan(page: Page) {
  const button = page.getByRole('button', { name: '调整本次计划', exact: true });
  await button.focus();
  await button.press('Enter');
  const sheet = page.getByRole('dialog', { name: /安排下一轮|安排习惯专注/ });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Resume a ready plan, then cancel via the active round's end sheet. */
export async function prepareReadyPlanCancellation(page: Page) {
  await expect(page.getByRole('button', { name: '调整本次计划', exact: true })).toHaveCount(0);
  await startNextRound(page);
  await revealFocusControls(page);
  await page.getByRole('button', { name: '结束本次专注', exact: true }).click();
  await page.getByRole('button', { name: /取消整个计划/ }).click();
  const sheet=page.getByRole('dialog', { name: '取消整个多轮计划？' });
  const confirm=sheet.getByRole('button', { name: '确认取消整个计划', exact: true });
  await expect(confirm).toBeDisabled();
  await sheet.getByRole('button', { name: '优先级变化', exact: true }).click();
  await expect(confirm).toBeEnabled();
  return confirm;
}

/** Marathon and minimal settlement share the same quiet immersive presentation. */
export async function waitForMarathonReport(page: Page) {
  const report = page.locator('.marathon-progress-report');
  await expect(report).toBeVisible();
  await expect(report).toHaveAttribute('data-focus-report-variant', 'minimal');
  await expect(report.getByRole('heading')).toHaveText(/\d+.*(?:分钟|小时)/);
  await expect(report.locator('.minimal-report-caption')).toHaveText('把专注留在做过的事上');
  await expect(page.locator('.world-screen')).toHaveClass(/is-focusing/);
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeHidden();
  return report;
}

import { expect, test } from "@playwright/test";
import type { DomainState } from "@blockcolc/domain";
import { waitForPreparedWorld } from './world-ready';

// V22 follow-up: exhausting the effective-excursion limit ends the session and
// the notice plays the same bounded fade-out as the other transient controls.

async function createDefaultProject(page: import("@playwright/test").Page) {
  // Keep real lifecycle/fade timers and a scoped 75 s budget. This case
  // checks integrity, not cinematic rendering on the software-WebGL runner.
  await page.addInitScript(() => localStorage.setItem('blockcolc-focus-preferences-v1', JSON.stringify({ lightingQuality: 'performance' })));
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  await waitForPreparedWorld(page);
}

async function persistedState(page: import("@playwright/test").Page): Promise<DomainState> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("blockcolc-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<DomainState>((resolve, reject) => {
        const request = database.transaction("appState", "readonly").objectStore("appState").get("current");
        request.onsuccess = () => resolve(request.result.state as DomainState);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
}

test("the app-switch-limit notice appears once and fades out like other controls", async ({ page }, testInfo) => {
  // This scenario intentionally spends roughly 15 s in real lifecycle/fade timers;
  // leave enough headroom for software-WebGL startup on a busy release runner.
  test.setTimeout(75_000);
  await createDefaultProject(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('checkbox',{name:'开启专注完整性'}).check();
  await expect.poll(async () => (await persistedState(page)).focusIntegrityPolicy.enabled).toBe(true);
  await page.getByRole('button',{name:'计时',exact:true}).click();
  await page.getByRole("button", { name: "开始 1 轮" }).click();
  await expect(page.locator(".timer-value")).toBeVisible();
  await expect.poll(async () => (await persistedState(page)).activeFocusSession !== null).toBe(true);
  await page.evaluate(() => {
    const observations: unknown[] = [];
    (window as unknown as { integrityObservations: unknown[] }).integrityObservations = observations;
    window.addEventListener('blockcolc:application-state-changed', event => observations.push({ hidden: document.hidden, detail: (event as CustomEvent).detail }));
    const lifetime = { shownAt: 0, endedAt: 0 };
    (window as unknown as { integrityNoticeLifetime: typeof lifetime }).integrityNoticeLifetime = lifetime;
    const observer = new MutationObserver(() => {
      const present = document.querySelector('.focus-integrity-ended');
      if (present && !lifetime.shownAt) lifetime.shownAt = performance.now();
      if (!present && lifetime.shownAt) { lifetime.endedAt = performance.now(); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  // Three web-visibility excursions reach the default max of three; each
  // background/foreground pair must exceed the 3 s grace to count.
  for (let round = 1; round <= 3; round += 1) {
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // The visibility handler enqueues an asynchronous durable command. Start
    // the real 3.2 s dwell after that command commits, not after dispatch alone.
    try {
      await expect.poll(async () => (await persistedState(page)).activeFocusSession?.integrity.backgroundReason).toBe("web-visibility");
    } catch (error) {
      await testInfo.attach('integrity-lifecycle', { contentType: 'application/json', body: JSON.stringify({ state: (await persistedState(page)).activeFocusSession?.integrity, observations: await page.evaluate(() => (window as unknown as { integrityObservations: unknown[] }).integrityObservations) }) });
      throw error;
    }
    await page.waitForTimeout(3_200);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    if (round < 3) {
      // A durable write precedes the processed foreground receipt. Wait for
      // that receipt and its UI frame before simulating the next departure;
      // otherwise the previous foreground reconciliation races the fixture.
      await expect.poll(() => page.evaluate(() => (window as unknown as { integrityObservations: unknown[] }).integrityObservations.length)).toBe(round);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect.poll(async () => {
        const integrity = (await persistedState(page)).activeFocusSession?.integrity;
        return { excursions: integrity?.effectiveExcursions, backgroundedAt: integrity?.backgroundedAt };
      }).toEqual({ excursions: round, backgroundedAt: null });
    }
  }

  await expect(page.locator(".focus-integrity-ended")).toBeVisible();
  await expect(page.locator(".toast,.session-kind")).toHaveCount(0);
  const [notice,start] = await Promise.all([
    page.locator(".focus-integrity-ended").boundingBox(),
    page.getByRole("button", { name: /^开始 \d+ 轮$/ }).boundingBox(),
  ]);
  expect(notice).not.toBeNull();
  expect(start).not.toBeNull();
  expect(notice!.y + notice!.height).toBeLessThanOrEqual(start!.y + 0.5);

  // Observe the real dismissal instead of adding another full dwell after
  // layout checks have already consumed part of it. Still verify the 5 s
  // minimum from the actual insertion/removal, with no simulated timers.
  await expect(page.locator(".focus-integrity-ended")).toHaveCount(0, { timeout: 10_000 });
  const lifetime = await page.evaluate(() => (window as unknown as { integrityNoticeLifetime: { shownAt: number; endedAt: number } }).integrityNoticeLifetime);
  expect(lifetime.shownAt).toBeGreaterThan(0);
  expect(lifetime.endedAt - lifetime.shownAt).toBeGreaterThanOrEqual(5_000);
});

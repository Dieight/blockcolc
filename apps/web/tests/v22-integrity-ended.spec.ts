import { expect, test } from "@playwright/test";
import type { DomainState } from "@blockcolc/domain";

// V22 follow-up: exhausting the effective-excursion limit ends the session and
// the notice plays the same bounded fade-out as the other transient controls.

async function createDefaultProject(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  await expect(page.locator(".world-screen")).toBeVisible();
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
  // This scenario intentionally spends 16.4 s in real lifecycle/fade timers;
  // leave enough headroom for software-WebGL startup on a busy release runner.
  test.setTimeout(45_000);
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
      await expect.poll(async () => (await persistedState(page)).activeFocusSession?.integrity.effectiveExcursions).toBe(round);
      await expect.poll(async () => (await persistedState(page)).activeFocusSession?.integrity.backgroundedAt).toBeNull();
    }
  }

  await expect(page.locator(".focus-integrity-ended")).toBeVisible();
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(page.locator(".session-kind")).toHaveCount(0);
  const notice = await page.locator(".focus-integrity-ended").boundingBox();
  const start = await page.getByRole("button", { name: /^开始 \d+ 轮$/ }).boundingBox();
  expect(notice).not.toBeNull();
  expect(start).not.toBeNull();
  expect(notice!.y + notice!.height).toBeLessThanOrEqual(start!.y + 0.5);

  // The notice auto-dismisses after the shared 5 s dwell plus its fade-out.
  await page.waitForTimeout(5_600);
  await expect(page.locator(".focus-integrity-ended")).toHaveCount(0);
});

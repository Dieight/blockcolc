import { test } from "@playwright/test";
test("reports page load diagnostics on preview", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push("PAGE:" + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("CONSOLE:" + m.text().slice(0, 200));
  });
  page.on("requestfailed", (r) => errors.push("REQFAIL:" + r.url().slice(0, 160)));
  await page.goto("/?__immersiveRightBand=0.35");
  await page.getByRole('button', { name: '开始建造' }).click();
  const canvas = page.getByLabel('项目建筑世界');
  await canvas.waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('canvas[aria-label="项目建筑世界"]')?.getAttribute('data-first-nonempty-frame-ms'));
  const info = await page.evaluate(() => ({
    scripts: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
    sw: navigator.serviceWorker ? "present" : "none",
    bootstrapDurationMs: Number(document.documentElement.dataset.bootstrapDurationMs),
    appShellFrameMs: Number(document.documentElement.dataset.appShellFrameMs),
    firstNonemptyFrameMs: Number(document.querySelector('canvas[aria-label="项目建筑世界"]')?.getAttribute('data-first-nonempty-frame-ms')),
    worldRebuildCount: Number(document.querySelector('canvas[aria-label="项目建筑世界"]')?.getAttribute('data-world-rebuild-count')),
    worldRebuildLastMs: Number(document.querySelector('canvas[aria-label="项目建筑世界"]')?.getAttribute('data-world-rebuild-last-ms')),
  }));
  console.log("LOAD_INFO " + JSON.stringify(info));
  console.log("LOAD_ERRORS " + JSON.stringify(errors));
});

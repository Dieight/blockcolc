import { expect, test } from "@playwright/test";

// V20 contract: the world may run an ambient loop (cloud drift, tree sway) only
// while its pane is visible and the tab is foreground; a hidden pane must stop it.
// The construction reveal is a bounded one-shot ceremony driven by the same pump.
// Both are deterministic to assert via datasets: the pump writes its gate every
// tick, and reveal counters are independent of the GPU.

async function createDefaultProject(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
}

async function completeOneRoundEarly(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "开始 1 轮" }).click();
  const endButton = page.getByRole("button", { name: "结束本次专注" });
  if (!(await endButton.isVisible().catch(() => false))) {
    const hint = page.locator(".immersive-hint");
    const box = (await hint.boundingBox()) ?? (await page.locator(".focus-panel").boundingBox());
    if (!box) throw new Error("Focus panel has no layout box");
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  }
  await expect(endButton).toBeVisible({ timeout: 3_000 });
  await endButton.click();
  const dialog = page.getByRole("dialog", { name: "如何结束这次专注？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /提前完成任务/ }).click();
  // V21: the materials-delivered toast waits for a committed progress choice and
  // is not triggered by an early completion; the construction reveal still runs.
  await expect(page.locator(".construction-feedback")).toHaveCount(0);
}

test("hides the ambient motion pump the moment the world pane is not visible", async ({ page }) => {
  await createDefaultProject(page);
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-continuous-rendering", "false");
  await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 15_000 });
  // The pump reports its gate on every tick; the world pane is visible here, so
  // the dataset must exist (its value may be false on the performance tier).
  await expect
    .poll(async () => await canvas.getAttribute("data-ambient-motion-active"), { timeout: 5_000 })
    .not.toBeNull();
  // Switching to another tab hides the world pane: the gate must close.
  await page.getByRole("button", { name: "任务" }).click();
  await expect
    .poll(async () => await canvas.getAttribute("data-ambient-motion-active"), { timeout: 5_000 })
    .toBe("false");
  await page.getByRole("button", { name: "计时" }).click();
  await expect
    .poll(async () => await canvas.getAttribute("data-ambient-motion-active"), { timeout: 5_000 })
    .not.toBeNull();
});

test("reduced motion closes the ambient gate and skips the construction reveal", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await createDefaultProject(page);
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-reduced-motion", "true");
  await expect
    .poll(async () => await canvas.getAttribute("data-ambient-motion-active"), { timeout: 5_000 })
    .toBe("false");
  await completeOneRoundEarly(page);
  // Under reduced motion the increment pops in whole: no reveal waves, no pulse
  // (the pulse counter is only written when a pulse actually plays).
  await expect(canvas).not.toHaveAttribute("data-construction-pulse-count", /[1-9]/);
  await expect(canvas).toHaveAttribute("data-construction-reveal-count", "0");
});

test("the finished increment grows block by block and settles fully", async ({ page }, testInfo) => {
  await createDefaultProject(page);
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
  // Subscribe before committing progress. A late driver poll can miss a
  // transient on a busy software GPU; keep only samples from actual new-world
  // frames, not from the pre-render diagnostic update during rebuilding.
  await canvas.evaluate(node => {
    const element = node as HTMLCanvasElement;
    const baseline = Number(element.dataset.worldRebuildCount);
    const frames: Array<{ frame: number; remaining: number }> = [];
    (window as typeof window & { __constructionFrames?: typeof frames }).__constructionFrames = frames;
    const observer = new MutationObserver(() => {
      const d = element.dataset;
      if (Number(d.worldRebuildCount) <= baseline || d.worldRebuildCount !== d.renderedWorldRebuildCount) return;
      const frame = Number(d.renderFrameCount);
      if (frames.at(-1)?.frame !== frame) frames.push({ frame, remaining: Number(d.constructionRevealCount) });
    });
    observer.observe(element, { attributes: true, attributeFilter: [
      'data-render-frame-count', 'data-rendered-world-rebuild-count', 'data-construction-reveal-count',
    ] });
  });
  await completeOneRoundEarly(page);
  const readFrames = () => page.evaluate(() =>
    (window as typeof window & { __constructionFrames?: Array<{ frame: number; remaining: number }> }).__constructionFrames ?? []);
  // Require multiple real frames and a decreasing positive count, so latching
  // a single synchronous rebuild mutation cannot masquerade as animation.
  await expect.poll(async () => {
    const remaining = (await readFrames()).map(frame => frame.remaining).filter(count => count > 0);
    return remaining.length >= 2 && Math.max(...remaining) > Math.min(...remaining);
  }, { timeout: 10_000 }).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("v20-reveal-mid.png"), fullPage: true });
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-construction-reveal-count") ?? "0"), { timeout: 10_000 })
    .toBe(0);
  await testInfo.attach('rendered-construction-frames', { contentType: 'application/json', body: JSON.stringify(await readFrames()) });
  await page.screenshot({ path: testInfo.outputPath("v20-reveal-settled.png"), fullPage: true });
});

test("moves clouds and trees across idle frames when the ambient gate is open", async ({ page }, testInfo) => {
  await createDefaultProject(page);
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-initial-reveal-completed-count", "1", { timeout: 15_000 });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByLabel("临时调试世界", { exact: true }).check();
  await page.getByLabel("指定时间", { exact: true }).check();
  await page.getByLabel("世界调试时间", { exact: true }).fill("13:00");
  await page.getByLabel("天气", { exact: true }).selectOption("cloudy");
  await page.getByRole("button", { name: "计时", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-weather-kind", "cloudy");
  await canvas.dispatchEvent("wheel", { deltaY: 2_000, deltaMode: 0 });
  await expect.poll(async () => Number(await canvas.getAttribute("data-camera-distance-ratio"))).toBeGreaterThan(1);
  await expect
    .poll(async () => await canvas.getAttribute("data-ambient-motion-active"), { timeout: 5_000 })
    .not.toBeNull();
  // The performance tier disables idle ambient motion by design: skip the pixel
  // proof there instead of asserting against a gate that is allowed to be closed.
  if (await canvas.getAttribute("data-ambient-motion-active") !== "true") return;
  await page.waitForTimeout(1_400);
  const first = await canvas.screenshot({ path: testInfo.outputPath("ambient-before.png") });
  const firstDrift = Number(await canvas.getAttribute("data-cloud-drift-ms"));
  const firstRenderedFrames = Number(await canvas.getAttribute("data-render-frame-count"));
  const firstCloudPosition = await canvas.getAttribute("data-cloud-first-block-position");
  await page.waitForTimeout(3_000);
  await expect.poll(async () => Number(await canvas.getAttribute("data-cloud-drift-ms"))).toBeGreaterThan(firstDrift + 2_000);
  const second = await canvas.screenshot({ path: testInfo.outputPath("ambient-after.png") });
  const secondRenderedFrames = Number(await canvas.getAttribute("data-render-frame-count"));
  expect(secondRenderedFrames).toBeGreaterThan(firstRenderedFrames);
  expect(await canvas.getAttribute("data-cloud-first-block-position")).not.toBe(firstCloudPosition);
  expect(first.byteLength).toBeGreaterThan(2_000);
  expect(second.byteLength).toBeGreaterThan(2_000);
});

test("leaves the reveal quiet on the initial world load", async ({ page }) => {
  test.setTimeout(60_000);
  await createDefaultProject(page);
  const canvas = page.getByLabel("项目建筑世界");
  // Wait for the renderer diagnostic to exist instead of coercing a missing
  // attribute to zero. Software WebGL can attach the canvas slowly after a
  // long single-worker release run, but the first real value must still be 0.
  await expect(canvas).toHaveAttribute("data-construction-reveal-count", "0", { timeout: 15_000 });
  // And the tab itself keeps the no-continuous-loop guarantee.
  await expect(canvas).toHaveAttribute("data-continuous-rendering", "false");
  // V21 dropped the per-digit rise animation, so the timer is one static string.
  const timer = page.locator(".timer");
  await expect(timer.locator(".timer-value")).toContainText(/^4[45]:\d{2}$/);
});

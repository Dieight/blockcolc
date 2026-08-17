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
  await expect(page.locator(".construction-feedback")).toContainText("材料已送达");
}

test("hides the ambient motion pump the moment the world pane is not visible", async ({ page }) => {
  await createDefaultProject(page);
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-continuous-rendering", "false");
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
  await completeOneRoundEarly(page);
  // The first wave pops ~240 ms after the rebuild and the whole reveal takes
  // ~3.5 s: the counter must rise above zero and return to zero by itself.
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-construction-reveal-count") ?? "0"), { timeout: 2_000 })
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("v20-reveal-mid.png"), fullPage: true });
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-construction-reveal-count") ?? "0"), { timeout: 10_000 })
    .toBe(0);
  await page.screenshot({ path: testInfo.outputPath("v20-reveal-settled.png"), fullPage: true });
});

test("moves clouds and trees across idle frames when the ambient gate is open", async ({ page }) => {
  await createDefaultProject(page);
  const canvas = page.getByLabel("项目建筑世界");
  await expect
    .poll(async () => await canvas.getAttribute("data-ambient-motion-active"), { timeout: 5_000 })
    .not.toBeNull();
  // The performance tier disables idle ambient motion by design: skip the pixel
  // proof there instead of asserting against a gate that is allowed to be closed.
  if (await canvas.getAttribute("data-ambient-motion-active") !== "true") return;
  await page.waitForTimeout(1_400);
  const first = await canvas.screenshot();
  await page.waitForTimeout(1_400);
  const second = await canvas.screenshot();
  expect(Buffer.compare(first, second)).not.toBe(0);
});

test("leaves the reveal quiet on the initial world load", async ({ page }) => {
  await createDefaultProject(page);
  const canvas = page.getByLabel("项目建筑世界");
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-construction-reveal-count") ?? "0"), { timeout: 3_000 })
    .toBe(0);
  // And the tab itself keeps the no-continuous-loop guarantee.
  await expect(canvas).toHaveAttribute("data-continuous-rendering", "false");
  // FX-01: the clock renders as per-character digits so changed digits can
  // transition independently; "45:00" is five characters.
  const timer = page.locator(".timer");
  await expect(timer.locator(".timer-value")).toContainText(/^4[45]:\d{2}$/);
  await expect(timer.locator(".timer-value .timer-digit")).toHaveCount(5);
});

import { expect, test } from "@playwright/test";

// with no phantom rounds and no auto-advance wording (remove before release).

const PREFS = JSON.stringify({ focusMinutes: 1, habitFocusMinutes: 1, habitTargetRounds: 10, breakMinutes: 0, lightingQuality: "auto", constructionOutlineVisibility: "current", themeMode: "light" });

async function revealFocusControls(page: import("@playwright/test").Page) {
  const endButton = page.getByRole("button", { name: "结束本次专注" });
  const hint = page.locator(".immersive-hint");
  const box = (await hint.boundingBox()) ?? (await page.locator(".focus-panel").boundingBox());
  if (!box) throw new Error("Focus panel has no layout box");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    try {
      await expect(endButton).toBeVisible({ timeout: 1_500 });
      return;
    } catch {
      await page.waitForTimeout(300);
    }
  }
  throw new Error("Focus controls did not reveal");
}

test("marathon settlement shows exactly the plan rounds with no auto-advance wording", async ({ page }) => {
  test.setTimeout(90_000);
  await page.clock.install({ time: new Date("2026-08-03T09:56:00Z") }); // local 17:56 -> 3 rounds
  await page.addInitScript((prefs) => localStorage.setItem("blockcolc-focus-preferences-v1", prefs), PREFS);
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  await page.getByRole("button", { name: "计时", exact: true }).click();
  await page.getByRole("button", { name: "调整本次计划" }).click();
  const sheet = page.getByRole("dialog", { name: "安排下一轮" });
  await sheet.getByRole("button", { name: "按结束时间" }).click();
  await expect(sheet).toContainText("3 轮");
  await sheet.getByRole("button", { name: "确认计划" }).click();
  await page.getByRole("button", { name: /^开始到/ }).click();
  for (let round = 1; round < 3; round += 1) {
    await page.clock.fastForward(61_000);
    await expect(page.getByRole("button", { name: "开始下一轮" })).toBeVisible();
    await page.getByRole("button", { name: "开始下一轮" }).click();
  }
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("heading", { name: "把这次推进汇报给哪些任务？" })).toBeVisible();
  const report = page.locator(".marathon-progress-report");
  await expect(report.locator(".eyebrow")).toContainText("3 轮专注已结束");
  await expect(report).not.toContainText("自动推进");
  await page.screenshot({ path: "test-results/v24-marathon-normal.png", fullPage: true });
  await page.locator(".marathon-settlement-head").first().click();
  await page.locator(".marathon-report-row").first().getByRole("button", { name: /推进至 50%/ }).click();
  await page.getByRole("button", { name: "提交本次推进" }).click();
  await expect(report).toBeHidden();
});
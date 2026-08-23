import { expect, test } from "@playwright/test";

// V23 ③④: appearance settings (light/dark/system) and heatmap day detail on click.

async function createDefaultProject(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  await expect(page.locator(".world-screen")).toBeVisible();
}

test("dark theme toggles the document theme from settings", async ({ page }) => {
  await createDefaultProject(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const dark = page.getByRole("button", { name: "深色" });
  await dark.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("clicking a heatmap cell shows that day's focus detail", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-05T08:00:00Z") });
  await createDefaultProject(page);
  // 1-minute round, no break, so one round completes quickly.
  await page.getByRole("button", { name: "设置" }).click();
  const focusMinutes = page.getByLabel("普通任务专注分钟");
  await focusMinutes.fill("1");
  await focusMinutes.press("Enter");
  const breakMinutes = page.getByLabel("每轮休息分钟");
  await breakMinutes.fill("0");
  await breakMinutes.press("Enter");
  await page.getByRole("button", { name: "计时" }).click();
  await page.getByRole("button", { name: /^开始 \d+ 轮/ }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: /完成/ })).toBeVisible();
  await page.getByRole("button", { name: /完成/ }).click();

  await page.getByRole("button", { name: "统计", exact: true }).click();
  const activeCell = page.locator('.focus-heatmap-cell[title^="2026年8月5日"]');
  await activeCell.click();
  const tip = page.locator(".focus-heatmap-tip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("2026年8月5日");
  await expect(tip).toContainText("有效专注");
  await expect(tip).toContainText("专注次数");
  await expect(tip).toContainText("1 次");
  // Re-click closes the tip.
  await activeCell.click();
  await expect(tip).toHaveCount(0);
});

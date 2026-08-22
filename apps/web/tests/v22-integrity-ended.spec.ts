import { expect, test } from "@playwright/test";

// V22 follow-up: exhausting the effective-excursion limit ends the session and
// the notice plays the same bounded fade-out as the other transient controls.

async function createDefaultProject(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  await expect(page.locator(".world-screen")).toBeVisible();
}

test("the app-switch-limit notice appears once and fades out like other controls", async ({ page }) => {
  await createDefaultProject(page);
  await page.getByRole("button", { name: "开始 1 轮" }).click();
  await expect(page.locator(".session-kind")).toContainText(/第 1 \/ 1 轮专注/);

  // Three web-visibility excursions exceed the default max of three; each
  // background/foreground pair must exceed the 3 s grace to count.
  for (let round = 1; round <= 3; round += 1) {
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(3_200);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(400);
  }

  await expect(page.locator(".focus-integrity-ended")).toBeVisible();
  await expect(page.locator(".session-kind")).toHaveCount(0);

  // The notice auto-dismisses after the shared 5 s dwell plus its fade-out.
  await page.waitForTimeout(5_600);
  await expect(page.locator(".focus-integrity-ended")).toHaveCount(0);
});
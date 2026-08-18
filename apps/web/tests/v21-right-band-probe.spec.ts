import { expect, test } from "@playwright/test";

// V21 diagnostic: verify the landscape/right-column band aiming via the camera's
// real projection. With a right band of r, the settlement should land at
// NDC x = -r (visible window center left of the side panel).

async function createDefaultProject(page: import("@playwright/test").Page) {
  await page.goto("/?__immersiveRightBand=0.35");
  await page.getByRole("button", { name: "开始建造" }).click();
  await expect(page.locator(".world-screen")).toBeVisible();
}

test("renders the settlement at NDC x = -right when the right band is set", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-03T08:00:00Z") });
  await createDefaultProject(page);
  await page.getByRole("button", { name: "开始 1 轮" }).click();
  const canvas = page.getByLabel("项目建筑世界");
  await expect.poll(async () => {
    const right = await canvas.getAttribute("data-immersive-right-band-fraction");
    return right === null ? null : Number(right);
  }, { timeout: 8_000 }).toBe(0.35);
  console.log("DEBUG:", await canvas.getAttribute("data-right-aim-debug"), "PROJX:", await canvas.getAttribute("data-settlement-projected-x"));
  await expect.poll(async () => {
    const x = await canvas.getAttribute("data-settlement-projected-x");
    return x === null ? null : Number(x);
  }, { timeout: 8_000 }).toBeCloseTo(-0.35, 2);
  await expect.poll(async () => {
    const y = await canvas.getAttribute("data-settlement-projected-y");
    return y === null ? null : Number(y);
  }, { timeout: 8_000 }).toBeCloseTo(0, 2);
  console.log("RIGHT-BAND-OK");
  expect(true).toBe(true);
});

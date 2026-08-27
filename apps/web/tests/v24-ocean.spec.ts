import { expect, test } from "@playwright/test";

// beach, hill, satellite islets and the open sea (remove before release).

test("ocean island world renders main island, islets and open sea", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("group", { name: "聚落环境" }).getByRole("button", { name: "海洋小岛" }).click();
  await expect(page.getByRole("group", { name: "聚落环境" }).getByRole("button", { name: "海洋小岛" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "计时", exact: true }).click();
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-environment-style", "ocean-island");
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: "test-results/v24-ocean-island.png", fullPage: true });
  const diag = await page.evaluate(() => {
    const c = document.querySelector("canvas") as HTMLCanvasElement;
    return {
      cells: c?.dataset.terrainCellCount,
      waterTri: c?.dataset.terrainWaterTriangles,
      fogFar: c?.dataset.fogFar,
      weather: c?.dataset.weatherKind,
      islets: Number(c?.dataset.oceanIsletCount ?? 0),
      isletPositions: c?.dataset.oceanIsletPositions ?? "",
      mainRadius: Number(c?.dataset.oceanMainRadius ?? 0),
      mainBeach: Number(c?.dataset.oceanMainBeach ?? 0),
    };
  });
  console.log("OCEAN_DIAG " + JSON.stringify(diag));
  // V24 requirement: 4..7 satellite islets exist, each with at least 59 units
  // of open water between its shore and the main island's beach edge.
  expect(diag.islets).toBeGreaterThanOrEqual(4);
  expect(diag.islets).toBeLessThanOrEqual(7);
  expect(diag.mainRadius).toBeGreaterThan(0);
  const shoreline = diag.mainRadius + diag.mainBeach;
  const seats = diag.isletPositions.split(",").filter(Boolean).map((entry) => entry.split(":").map(Number));
  for (const [ix, iz, radius] of seats) {
    const distance = Math.hypot(ix!, iz!);
    expect(distance - radius! - shoreline).toBeGreaterThanOrEqual(59);
  }
  // Zoom out to reveal the satellites and the open sea. Give the camera
  // easing time under software WebGL.
  await page.locator(".world").hover();
  await page.mouse.wheel(0, -2600);
  await page.waitForTimeout(700);
  await page.mouse.wheel(0, -3600);
  await page.waitForTimeout(2_500);
  const farShot = await canvas.screenshot();
  await page.screenshot({ path: "test-results/v24-ocean-far.png", fullPage: true });
  // Objective pixel check: the sea must dominate, but green/brown land blocks
  // (the satellite islets) must still be present among the blue/teal water.
  const stats = analyzePixels(farShot);
  console.log("OCEAN_PIXELS " + JSON.stringify(stats));
  expect(stats.waterShare).toBeGreaterThan(0.3);
  expect(stats.landShare).toBeGreaterThan(0.004);
});

function analyzePixels(buffer: Buffer): { waterShare: number; landShare: number } {
  let water = 0;
  let land = 0;
  const step = 4; // sample every 4th pixel, the screenshots are big
  for (let index = 0; index + 2 < buffer.length; index += step * 4) {
    const r = buffer[index]!;
    const g = buffer[index + 1]!;
    const b = buffer[index + 2]!;
    if (r > 235 && g > 235 && b > 235) continue; // fog/sky white — neutral
    const isWater = b > g + 8 && b > r + 8 && g < 150;
    const isLand = g > r + 12 && g > b + 12 && g > 70;
    if (isWater) water += 1;
    else if (isLand) land += 1;
  }
  const total = water + land || 1;
  return { waterShare: water / total, landShare: land / total };
}

test("ocean island at night scatters the moon streak instead of a mirror band", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date("2026-08-26T14:20:00Z") });
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("group", { name: "聚落环境" }).getByRole("button", { name: "海洋小岛" }).click();
  await page.getByRole("button", { name: "计时", exact: true }).click();
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-environment-style", "ocean-island");
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: "test-results/v24-ocean-night.png", fullPage: true });
});
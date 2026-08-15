import { expect, test, type Locator } from "@playwright/test";

test("keeps the complete natural terrain inside safe clip planes at maximum zoom", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-07-26T12:00:00+08:00") });
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-terrain-generation-version", "4");
  // Clouds span the full visible terrain, not just the settlement core (V16 regression guard).
  await expect.poll(async () => Number(await canvas.getAttribute("data-cloud-span-x"))).toBeGreaterThan(600);
  await canvas.dispatchEvent("wheel", { deltaY: 4_000, deltaMode: 0 });
  await expect.poll(async () => Number(await canvas.getAttribute("data-camera-distance-ratio"))).toBeGreaterThanOrEqual(1.13);

  const box = await canvas.boundingBox();
  if (!box) throw new Error("World canvas has no layout box");
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height * 0.55;
  const captures: Buffer[] = [];
  for (let index = 0; index < 4; index += 1) {
    const beforeAzimuth = Number(await canvas.getAttribute("data-camera-azimuth"));
    const pointerId = 61 + index * 10;
    await pointer(canvas, "pointerdown", pointerId, centerX - 72, centerY);
    await pointer(canvas, "pointermove", pointerId, centerX + 72, centerY);
    await pointer(canvas, "pointerup", pointerId, centerX + 72, centerY);
    await expect.poll(async () => Math.abs(Number(await canvas.getAttribute("data-camera-azimuth")) - beforeAzimuth)).toBeGreaterThan(1.2);
    await expect(canvas).toHaveAttribute("data-visibility-near-clip-safe", "true");
    await expect(canvas).toHaveAttribute("data-visibility-far-clip-safe", "true");
    const near = Number(await canvas.getAttribute("data-camera-near"));
    const far = Number(await canvas.getAttribute("data-camera-far"));
    const nearestTerrain = Number(await canvas.getAttribute("data-visibility-nearest-distance"));
    const farthestTerrain = Number(await canvas.getAttribute("data-visibility-farthest-distance"));
    expect(near).toBeLessThanOrEqual(Math.max(0.5, nearestTerrain * 0.72) + 0.01);
    expect(far - farthestTerrain).toBeGreaterThanOrEqual(23.99);
    captures.push(await canvas.screenshot({ path: testInfo.outputPath(`maximum-zoom-rotation-${index + 1}.png`) }));
  }
  expect(captures.every((capture) => capture.byteLength > 2_000)).toBe(true);
  expect(new Set(captures.map((capture) => capture.toString("base64"))).size).toBe(4);
  await expect(canvas).toHaveAttribute("data-continuous-rendering", "false");
});

async function pointer(locator: Locator, type: string, pointerId: number, clientX: number, clientY: number): Promise<void> {
  await locator.dispatchEvent(type, {
    pointerId,
    pointerType: "touch",
    isPrimary: true,
    clientX,
    clientY,
    buttons: type === "pointerup" ? 0 : 1,
  });
}

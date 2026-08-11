import { expect, test, type Locator } from "@playwright/test";

test("renders the current compact world and supports bounded rotate and pinch gestures", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-07-26T12:00:00+08:00") });
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();
  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-quality-tier", /^(low|balanced|high)$/);
  await expect(canvas).toHaveAttribute("data-world-root-members", "terrain,roads,buildingsAndDecorations,worldLightRig,atmosphere");
  await expect(canvas).toHaveAttribute("data-shadow-auto-update", "false");
  const activeLighting = await canvas.getAttribute("data-active-lighting-quality");
  await expect(canvas).toHaveAttribute("data-fullscreen-pass-count", activeLighting === "cinematic" ? "4" : "0");
  await expect(canvas).toHaveAttribute("data-continuous-rendering", "false");
  await expect(canvas).toHaveAttribute("data-shader-detail", /^(low|balanced|high)$/);
  await expect(canvas).toHaveAttribute("data-terrain-generation-version", "3");
  expect(Number(await canvas.getAttribute("data-terrain-near-cell-count"))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute("data-terrain-middle-cell-count"))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute("data-terrain-far-cell-count"))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute("data-terrain-hydrology-network-count"))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute("data-terrain-hydrology-basin-count"))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute("data-terrain-far-extent"))).toBeGreaterThanOrEqual(720);
  expect(Number(await canvas.getAttribute("data-local-light-count"))).toBeLessThanOrEqual(2);
  await expect.poll(async () => Number(await canvas.getAttribute("data-render-triangles"))).toBeGreaterThan(1_000);
  const initial = await canvas.screenshot({ path: testInfo.outputPath("v2-world-initial.png") });
  expect(initial.byteLength).toBeGreaterThan(2_000);
  const initialCameraAzimuth = Number(await canvas.getAttribute("data-camera-azimuth"));
  const initialShadowRefreshes = Number(await canvas.getAttribute("data-shadow-refresh-count"));

  const box = await canvas.boundingBox();
  if (!box) throw new Error("World canvas has no layout box");
  await pointer(canvas, "pointerdown", 1, box.x + box.width * 0.38, box.y + box.height * 0.55);
  await pointer(canvas, "pointermove", 1, box.x + box.width * 0.68, box.y + box.height * 0.44);
  await pointer(canvas, "pointerup", 1, box.x + box.width * 0.68, box.y + box.height * 0.44);
  await expect.poll(async () => Number(await canvas.getAttribute("data-camera-azimuth"))).not.toBe(initialCameraAzimuth);
  await expect(canvas).toHaveAttribute("data-world-rotation", "0.0000");
  expect(Number(await canvas.getAttribute("data-cached-shadow-transform-syncs"))).toBe(0);
  expect(Number(await canvas.getAttribute("data-shadow-refresh-count"))).toBe(initialShadowRefreshes);
  const rotated = await canvas.screenshot({ path: testInfo.outputPath("v2-world-rotated.png") });
  expect(Buffer.compare(initial, rotated)).not.toBe(0);
  const pitch = Number(await canvas.getAttribute("data-camera-pitch-degrees"));
  expect(pitch).toBeGreaterThanOrEqual(24);
  expect(pitch).toBeLessThanOrEqual(64);

  await page.getByRole("button", { name: "重置视角" }).click();
  await expect.poll(async () => Number(await canvas.getAttribute("data-camera-azimuth"))).toBeCloseTo(Math.PI / 4, 3);
  const beforePinch = Number(await canvas.getAttribute("data-camera-distance-ratio"));
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await pointer(canvas, "pointerdown", 11, centerX - 25, centerY);
  await pointer(canvas, "pointerdown", 12, centerX + 25, centerY);
  await pointer(canvas, "pointermove", 11, centerX - 75, centerY);
  await pointer(canvas, "pointermove", 12, centerX + 75, centerY);
  await pointer(canvas, "pointerup", 11, centerX - 75, centerY);
  await pointer(canvas, "pointerup", 12, centerX + 75, centerY);
  await expect.poll(async () => Number(await canvas.getAttribute("data-camera-distance-ratio"))).toBeLessThan(beforePinch);
  const zoomRatio = Number(await canvas.getAttribute("data-camera-distance-ratio"));
  expect(zoomRatio).toBeGreaterThanOrEqual(0.5);
  expect(zoomRatio).toBeLessThanOrEqual(1.14);
  const zoomed = await canvas.screenshot({ path: testInfo.outputPath("v2-world-pinched.png") });
  expect(Buffer.compare(rotated, zoomed)).not.toBe(0);

  await page.getByRole("button", { name: "重置视角" }).click();
  const beforeZoomOut = Number(await canvas.getAttribute("data-camera-distance-ratio"));
  await pointer(canvas, "pointerdown", 21, centerX - 75, centerY);
  await pointer(canvas, "pointerdown", 22, centerX + 75, centerY);
  await pointer(canvas, "pointermove", 21, centerX - 8, centerY);
  await pointer(canvas, "pointermove", 22, centerX + 8, centerY);
  await pointer(canvas, "pointerup", 21, centerX - 8, centerY);
  await pointer(canvas, "pointerup", 22, centerX + 8, centerY);
  await expect.poll(async () => Number(await canvas.getAttribute("data-camera-distance-ratio"))).toBeGreaterThan(beforeZoomOut);
  const zoomedOutRatio = Number(await canvas.getAttribute("data-camera-distance-ratio"));
  expect(zoomedOutRatio).toBeLessThanOrEqual(1.14);
  const zoomedOut = await canvas.screenshot({ path: testInfo.outputPath("v2-world-zoomed-out.png") });
  expect(zoomedOut.byteLength).toBeGreaterThan(2_000);

  expect(Number(await canvas.getAttribute("data-render-calls"))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute("data-render-calls"))).toBeLessThan(120);
  expect(Number(await canvas.getAttribute("data-pixel-ratio"))).toBeLessThanOrEqual(1.75);
});

async function pointer(locator: Locator, type: string, pointerId: number, clientX: number, clientY: number): Promise<void> {
  await locator.dispatchEvent(type, {
    pointerId,
    pointerType: "touch",
    isPrimary: pointerId % 10 === 1,
    clientX,
    clientY,
    buttons: type === "pointerup" ? 0 : 1,
  });
}

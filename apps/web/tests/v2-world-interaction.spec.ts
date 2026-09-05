import { expect, test, type CDPSession } from "@playwright/test";

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
  await expect(canvas).toHaveAttribute("data-terrain-generation-version", "4");
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
  let initialShadowRefreshes = -1;
  let shadowStableSince = Date.now();
  await expect.poll(async () => {
    const current = Number(await canvas.getAttribute("data-shadow-refresh-count"));
    if (current !== initialShadowRefreshes) {
      initialShadowRefreshes = current;
      shadowStableSince = Date.now();
    }
    return Date.now() - shadowStableSince;
  }, { timeout: 5_000, intervals: [100] }).toBeGreaterThanOrEqual(500);

  const box = await canvas.boundingBox();
  if (!box) throw new Error("World canvas has no layout box");
  const cdp = await page.context().newCDPSession(page);
  await touch(cdp, "touchStart", [{ id: 1, x: box.x + box.width * 0.38, y: box.y + box.height * 0.55 }]);
  await touch(cdp, "touchMove", [{ id: 1, x: box.x + box.width * 0.68, y: box.y + box.height * 0.44 }]);
  await touch(cdp, "touchEnd", []);
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
  await touch(cdp, "touchStart", [
    { id: 11, x: centerX - 25, y: centerY },
    { id: 12, x: centerX + 25, y: centerY },
  ]);
  await touch(cdp, "touchMove", [
    { id: 11, x: centerX - 75, y: centerY },
    { id: 12, x: centerX + 75, y: centerY },
  ]);
  await touch(cdp, "touchEnd", []);
  await expect.poll(async () => Number(await canvas.getAttribute("data-camera-distance-ratio"))).toBeLessThan(beforePinch);
  const zoomRatio = Number(await canvas.getAttribute("data-camera-distance-ratio"));
  expect(zoomRatio).toBeGreaterThanOrEqual(0.5);
  expect(zoomRatio).toBeLessThanOrEqual(1.14);
  const zoomed = await canvas.screenshot({ path: testInfo.outputPath("v2-world-pinched.png") });
  expect(Buffer.compare(rotated, zoomed)).not.toBe(0);

  await page.getByRole("button", { name: "重置视角" }).click();
  const beforeZoomOut = Number(await canvas.getAttribute("data-camera-distance-ratio"));
  await touch(cdp, "touchStart", [
    { id: 21, x: centerX - 75, y: centerY },
    { id: 22, x: centerX + 75, y: centerY },
  ]);
  await touch(cdp, "touchMove", [
    { id: 21, x: centerX - 8, y: centerY },
    { id: 22, x: centerX + 8, y: centerY },
  ]);
  await touch(cdp, "touchEnd", []);
  await expect.poll(async () => Number(await canvas.getAttribute("data-camera-distance-ratio"))).toBeGreaterThan(beforeZoomOut);
  const zoomedOutRatio = Number(await canvas.getAttribute("data-camera-distance-ratio"));
  expect(zoomedOutRatio).toBeLessThanOrEqual(1.14);
  const zoomedOut = await canvas.screenshot({ path: testInfo.outputPath("v2-world-zoomed-out.png") });
  expect(zoomedOut.byteLength).toBeGreaterThan(2_000);
  await expect(canvas).toHaveAttribute("data-visibility-near-clip-safe", "true");
  await expect(canvas).toHaveAttribute("data-visibility-far-clip-safe", "true");
  const cameraNear = Number(await canvas.getAttribute("data-camera-near"));
  const cameraFar = Number(await canvas.getAttribute("data-camera-far"));
  const nearestTerrain = Number(await canvas.getAttribute("data-visibility-nearest-distance"));
  const farthestTerrain = Number(await canvas.getAttribute("data-visibility-farthest-distance"));
  expect(cameraNear).toBeLessThanOrEqual(Math.max(0.5, nearestTerrain * 0.72) + 0.01);
  expect(cameraFar - farthestTerrain).toBeGreaterThanOrEqual(23.99);

  expect(Number(await canvas.getAttribute("data-render-calls"))).toBeGreaterThan(0);
  expect(Number(await canvas.getAttribute("data-render-calls"))).toBeLessThan(120);
  expect(Number(await canvas.getAttribute("data-pixel-ratio"))).toBeLessThanOrEqual(1.75);
});

async function touch(
  session: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  touchPoints: Array<{ id: number; x: number; y: number }>,
): Promise<void> {
  await session.send("Input.dispatchTouchEvent", { type, touchPoints });
}

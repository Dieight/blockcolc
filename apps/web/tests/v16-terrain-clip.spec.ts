import { expect, test as base, type Locator } from "@playwright/test";
import { showWorldOverview } from './world-overview';
import { selectValleyFixture } from './valley-fixture';

// Initial construction and the four camera checks have separate, bounded
// budgets. A slow software-WebGL setup must not consume the gesture deadline.
const test = base.extend<{ zoomedTerrain: Locator }>({
  zoomedTerrain: [async ({ page }, use) => {
    await page.clock.install({ time: new Date("2026-07-26T12:00:00+08:00") });
    await page.goto("/");
    await page.getByRole("button", { name: "开始建造" }).click();
    await selectValleyFixture(page);
    const canvas = page.getByLabel("项目建筑世界");
    await expect(canvas).toHaveAttribute("data-terrain-generation-version", "4");
    // Clouds span the full visible terrain, not just the settlement core (V16 regression guard).
    await expect.poll(async () => Number(await canvas.getAttribute("data-cloud-span-x"))).toBeGreaterThan(600);
    await showWorldOverview(page);
    await canvas.dispatchEvent("wheel", { deltaY: 4_000, deltaMode: 0 });
    await expect(canvas).toHaveAttribute('data-camera-maximum-distance-ratio', '0.9000');
    await expect.poll(async () => Number(await canvas.getAttribute("data-camera-distance-ratio"))).toBeCloseTo(.9, 3);
    await use(canvas);
  }, { timeout: 30_000 }],
});

test("keeps the complete natural terrain inside safe clip planes at maximum zoom", async ({ zoomedTerrain: canvas }, testInfo) => {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("World canvas has no layout box");
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height * 0.55;
  const captures: Buffer[] = [];
  const readFrame = () => canvas.evaluate(element => {
    const d = (element as HTMLCanvasElement).dataset;
    return { azimuth: Number(d.cameraAzimuth), nearSafe: d.visibilityNearClipSafe,
      farSafe: d.visibilityFarClipSafe, near: Number(d.cameraNear), far: Number(d.cameraFar),
      nearestTerrain: Number(d.visibilityNearestDistance), farthestTerrain: Number(d.visibilityFarthestDistance) };
  });
  for (let index = 0; index < 4; index += 1) {
    await test.step(`rotate and inspect view ${index + 1} of 4`, async () => {
      let frame = await readFrame();
      const beforeAzimuth = frame.azimuth;
      const pointerId = 61 + index * 10;
      await canvas.evaluate((node, gesture) => {
        for (const [type, x, buttons] of [['pointerdown', gesture.x - 72, 1], ['pointermove', gesture.x + 72, 1], ['pointerup', gesture.x + 72, 0]] as const) {
          node.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: gesture.id, pointerType: 'touch',
            isPrimary: true, clientX: x, clientY: gesture.y, buttons }));
        }
      }, { id: pointerId, x: centerX, y: centerY });
      await expect.poll(async () => {
        frame = await readFrame();
        return Math.abs(frame.azimuth - beforeAzimuth);
      }).toBeGreaterThan(1.2);
      // Keep every assertion on the same rendered frame; extra protocol reads
      // add GPU contention and may mix different easing positions.
      expect(frame.nearSafe).toBe("true");
      expect(frame.farSafe).toBe("true");
      const { near, far, nearestTerrain, farthestTerrain } = frame;
      expect(near).toBeLessThanOrEqual(Math.max(0.5, nearestTerrain * 0.72) + 0.01);
      expect(far - farthestTerrain).toBeGreaterThanOrEqual(23.99);
      captures.push(await canvas.screenshot({ path: testInfo.outputPath(`maximum-zoom-rotation-${index + 1}.png`) }));
    });
  }
  expect(captures.every((capture) => capture.byteLength > 2_000)).toBe(true);
  expect(new Set(captures.map((capture) => capture.toString("base64"))).size).toBe(4);
  await expect(canvas).toHaveAttribute("data-continuous-rendering", "false");
});

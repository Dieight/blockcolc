import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("turns a real blueprint lamp glow on only at night and keeps it attached while rotating", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-07-26T12:00:00+08:00") });
  await page.goto("/");
  const rendererPath = resolve(process.cwd(), "../../packages/voxel/src/renderer.ts").replaceAll("\\", "/");
  const rendererModuleUrl = `/@fs/${rendererPath}`;

  const mountLampScene = async () => {
    await page.evaluate(async (moduleUrl) => {
      const previous = (window as unknown as { __lampRenderer?: { dispose(): void } }).__lampRenderer;
      previous?.dispose();
      document.body.innerHTML = '<canvas aria-label="灯具光晕验证" style="display:block;width:100vw;height:100vh"></canvas>';
      const load = new Function("moduleUrl", "return import(moduleUrl)") as (moduleUrl: string) => Promise<{
        createVoxelRenderer(canvas: HTMLCanvasElement, options: unknown): {
          setWorld(world: unknown): void; resize(): void; dispose(): void;
        };
      }>;
      const { createVoxelRenderer } = await load(moduleUrl);
      const voxels = [] as Array<Record<string, unknown>>;
      for (let x = -3; x <= 3; x += 1) for (let z = -3; z <= 3; z += 1) {
        voxels.push({ x, y: 0, z, materialId: "stone", buildOrder: 0, sourceBlockId: "minecraft:stone_bricks" });
      }
      for (let y = 1; y <= 3; y += 1) for (let x = -3; x <= 3; x += 1) for (const z of [-3, 3]) {
        voxels.push({ x, y, z, materialId: "wood", buildOrder: 0, sourceBlockId: "minecraft:oak_planks" });
      }
      voxels.push(
        { x: 0, y: 3, z: 0, materialId: "accent", buildOrder: 0, sourceBlockId: "minecraft:lantern", emissiveKind: "lantern", emissiveLevel: 15 },
        { x: -2, y: 2, z: -2, materialId: "glass", buildOrder: 0, sourceBlockId: "minecraft:glass" },
        { x: 2, y: 2, z: -2, materialId: "accent", buildOrder: 0, sourceBlockId: "minecraft:iron_block" },
      );
      const blueprint = {
        schemaVersion: 1, id: "e2e-lamp-house", title: "灯具验证屋",
        bounds: { minX: -3, maxX: 3, minY: 0, maxY: 3, minZ: -3, maxZ: 3 }, voxels,
      };
      const canvas = document.querySelector("canvas") as HTMLCanvasElement;
      const renderer = createVoxelRenderer(canvas, { blueprint });
      renderer.setWorld({
        projectId: "e2e-lamp", blueprintId: blueprint.id, buildingCompletionBasisPoints: 10_000,
        buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 0,
      });
      renderer.resize();
      (window as unknown as { __lampRenderer?: typeof renderer }).__lampRenderer = renderer;
    }, rendererModuleUrl);
  };

  await mountLampScene();
  const canvas = page.getByLabel("灯具光晕验证");
  await expect(canvas).toHaveAttribute("data-visible-glow-sprite-count", "0");
  const noon = await canvas.screenshot({ path: testInfo.outputPath("lamp-noon.png") });

  await page.clock.setSystemTime(new Date("2026-07-26T23:00:00+08:00"));
  await mountLampScene();
  await expect.poll(async () => Number(await canvas.getAttribute("data-glow-sprite-count"))).toBeGreaterThanOrEqual(1);
  expect(Number(await canvas.getAttribute("data-glow-sprite-count"))).toBeLessThanOrEqual(2);
  await expect(canvas).toHaveAttribute("data-glow-texture-shape", "soft-square");
  expect(Number(await canvas.getAttribute("data-glow-sprite-maximum-scale"))).toBeLessThanOrEqual(1.12);
  await expect(canvas).toHaveAttribute("data-terrain-water-opaque", "true");
  await expect.poll(async () => Number(await canvas.getAttribute("data-visible-glow-sprite-count"))).toBeGreaterThanOrEqual(1);
  const night = await canvas.screenshot({ path: testInfo.outputPath("lamp-night.png") });
  expect(Buffer.compare(noon, night)).not.toBe(0);
  expect(night.byteLength).toBeGreaterThan(2_000);

  const box = await canvas.boundingBox();
  if (!box) throw new Error("Lamp canvas has no layout box");
  const y = box.y + box.height * 0.5;
  await canvas.dispatchEvent("pointerdown", { pointerId: 92, pointerType: "touch", isPrimary: true, clientX: box.x + box.width * 0.2, clientY: y, buttons: 1 });
  await canvas.dispatchEvent("pointermove", { pointerId: 92, pointerType: "touch", isPrimary: true, clientX: box.x + box.width * 0.7, clientY: y, buttons: 1 });
  await canvas.dispatchEvent("pointerup", { pointerId: 92, pointerType: "touch", isPrimary: true, clientX: box.x + box.width * 0.7, clientY: y, buttons: 0 });
  await expect.poll(async () => Number(await canvas.getAttribute("data-visible-glow-sprite-count"))).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => Math.abs(Number(await canvas.getAttribute("data-camera-azimuth")))).toBeGreaterThan(2);
  const rotated = await canvas.screenshot({ path: testInfo.outputPath("lamp-night-rotated.png") });
  expect(Buffer.compare(night, rotated)).not.toBe(0);
});

test("renders distinct day phases with a bounded optional post-process and no continuous loop", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-07-26T06:30:00+08:00") });
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();

  const canvas = page.getByLabel("项目建筑世界");
  const captures: Buffer[] = [];
  const phases = [
    ["dawn", "2026-07-26T06:30:00+08:00", "dawn"],
    ["noon", "2026-07-26T12:00:00+08:00", "day"],
    ["dusk", "2026-07-26T18:00:00+08:00", "dusk"],
    ["night", "2026-07-26T23:00:00+08:00", "night"],
  ] as const;

  for (const [name, time, phase] of phases) {
    await page.clock.setSystemTime(new Date(time));
    await page.reload();
    await expect(canvas).toHaveAttribute("data-active-lighting-quality", /^(performance|balanced|cinematic)$/);
    const activeLighting = await canvas.getAttribute("data-active-lighting-quality");
    await expect(canvas).toHaveAttribute("data-fullscreen-pass-count", activeLighting === "cinematic" ? "4" : "0");
    await expect(canvas).toHaveAttribute("data-continuous-rendering", "false");
    await expect(canvas).toHaveAttribute("data-day-phase", phase);
    await expect(canvas).toHaveAttribute("data-sky-layer-count", "3");
    await expect(canvas).toHaveAttribute("data-glow-texture-size", "32");
    await expect(canvas).toHaveAttribute("data-glow-texture-shape", "soft-square");
    await expect(canvas).toHaveAttribute("data-terrain-water-opaque", "true");
    expect(Number(await canvas.getAttribute("data-glow-sprite-count"))).toBeLessThanOrEqual(2);
    await expect.poll(async () => Number(await canvas.getAttribute("data-cloud-block-count"))).toBeGreaterThan(0);
    await expect.poll(async () => Number(await canvas.getAttribute("data-render-triangles"))).toBeGreaterThan(1_000);
    if (name === "noon") {
      expect(Number(await canvas.getAttribute("data-sun-visibility"))).toBeGreaterThan(0.9);
      expect(Number(await canvas.getAttribute("data-moon-visibility"))).toBeLessThan(0.1);
      expect(Number(await canvas.getAttribute("data-visible-star-count"))).toBe(0);
    }
    if (name === "night") {
      expect(Number(await canvas.getAttribute("data-sun-visibility"))).toBeLessThan(0.1);
      expect(Number(await canvas.getAttribute("data-moon-visibility"))).toBeGreaterThan(0.9);
      expect(Number(await canvas.getAttribute("data-visible-star-count"))).toBeGreaterThan(0);
    }
    captures.push(await canvas.screenshot({ path: testInfo.outputPath(`lighting-${name}.png`) }));
    if (name === "night") {
      const moonBefore = Number(await canvas.getAttribute("data-moon-screen-x"));
      const moonBeforeZoomY = Number(await canvas.getAttribute("data-moon-screen-y"));
      const box = await canvas.boundingBox();
      if (!box) throw new Error("World canvas has no layout box");
      await canvas.dispatchEvent("wheel", { deltaY: 2_000, deltaMode: 0 });
      await expect.poll(async () => Number(await canvas.getAttribute("data-camera-distance-ratio"))).toBeGreaterThan(1);
      await expect.poll(async () => Number(await canvas.getAttribute("data-star-near-clip-ratio"))).toBeGreaterThanOrEqual(1.49);
      expect(Number(await canvas.getAttribute("data-visible-star-count"))).toBeGreaterThan(0);
      const moonAfterZoomY = Number(await canvas.getAttribute("data-moon-screen-y"));
      expect(Math.abs(moonAfterZoomY - moonBeforeZoomY)).toBeLessThan(0.02);
      expect(Number(await canvas.getAttribute("data-sky-radius"))).toBeGreaterThanOrEqual(120);
      await canvas.screenshot({ path: testInfo.outputPath("lighting-night-max-distance.png") });
      const y = box.y + box.height * 0.5;
      const startX = box.x + (box.width > 600 ? 120 : box.width * 0.15);
      const endX = box.x + (box.width > 600 ? 405 : box.width * 0.85);
      await canvas.dispatchEvent("pointerdown", { pointerId: 91, pointerType: "touch", isPrimary: true, clientX: startX, clientY: y, buttons: 1 });
      await canvas.dispatchEvent("pointermove", { pointerId: 91, pointerType: "touch", isPrimary: true, clientX: endX, clientY: y, buttons: 1 });
      await canvas.dispatchEvent("pointerup", { pointerId: 91, pointerType: "touch", isPrimary: true, clientX: endX, clientY: y, buttons: 0 });
      await expect.poll(async () => Math.abs(Number(await canvas.getAttribute("data-camera-azimuth")))).toBeGreaterThan(3);
      await expect.poll(async () => Number(await canvas.getAttribute("data-moon-screen-x"))).not.toBe(moonBefore);
      const rotatedNight = await canvas.screenshot({ path: testInfo.outputPath("lighting-night-moon.png") });
      expect(Buffer.compare(captures.at(-1)!, rotatedNight)).not.toBe(0);
    }
  }

  for (let index = 1; index < captures.length; index += 1) {
    expect(Buffer.compare(captures[index - 1]!, captures[index]!)).not.toBe(0);
  }
});

test("keeps a deterministic mist day readable and rotates clouds with the world", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-07-28T12:00:00+08:00") });
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();

  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-weather-kind", "mist");
  await expect(canvas).toHaveAttribute("data-requested-lighting-quality", "auto");
  await expect(canvas).toHaveAttribute("data-atmosphere-follows-world", "true");
  const fogNear = Number(await canvas.getAttribute("data-fog-near"));
  const fogFar = Number(await canvas.getAttribute("data-fog-far"));
  expect(fogNear).toBeGreaterThan(40);
  expect(fogFar - fogNear).toBeGreaterThan(60);
  const before = await canvas.screenshot({ path: testInfo.outputPath("mist-readable-before.png") });
  expect(before.byteLength).toBeGreaterThan(2_000);

  const box = await canvas.boundingBox();
  if (!box) throw new Error("Mist canvas has no layout box");
  const y = box.y + box.height * 0.52;
  await canvas.dispatchEvent("pointerdown", { pointerId: 93, pointerType: "touch", isPrimary: true, clientX: box.x + box.width * 0.2, clientY: y, buttons: 1 });
  await canvas.dispatchEvent("pointermove", { pointerId: 93, pointerType: "touch", isPrimary: true, clientX: box.x + box.width * 0.72, clientY: y, buttons: 1 });
  await canvas.dispatchEvent("pointerup", { pointerId: 93, pointerType: "touch", isPrimary: true, clientX: box.x + box.width * 0.72, clientY: y, buttons: 0 });
  await expect.poll(async () => Math.abs(Number(await canvas.getAttribute("data-camera-azimuth")))).toBeGreaterThan(2);
  await expect(canvas).toHaveAttribute("data-atmosphere-follows-world", "true");
  const rotated = await canvas.screenshot({ path: testInfo.outputPath("mist-readable-rotated.png") });
  expect(Buffer.compare(before, rotated)).not.toBe(0);
});

test("moves rain across frames without a permanent render loop", async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date("2026-07-30T12:00:00+08:00") });
  await page.goto("/");
  await page.getByRole("button", { name: "开始建造" }).click();

  const canvas = page.getByLabel("项目建筑世界");
  await expect(canvas).toHaveAttribute("data-weather-kind", "rain");
  await expect(canvas).toHaveAttribute("data-continuous-rendering", "false");
  await canvas.screenshot({ path: testInfo.outputPath("rain-before.png") });
  // Rain is advanced by scheduled frames (no continuous loop). Software WebGL
  // does not reliably flush timer-scheduled frames to a capturable buffer, so
  // the phase stamp in the renderer diagnostic is the deterministic signal:
  // it only moves when the scheduled rain update actually runs.
  await expect(canvas).toHaveAttribute("data-rain-phase-ms", "0");
  await page.clock.fastForward(320);
  await expect.poll(async () => Number(await canvas.getAttribute("data-rain-phase-ms"))).toBeGreaterThan(0);
  await canvas.screenshot({ path: testInfo.outputPath("rain-after.png") });
});

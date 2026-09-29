import { expect, test } from '@playwright/test';
import type { BlueprintV1, BlueprintVoxel, VoxelRenderer } from '@blockcolc/voxel';

/** Synthetic original-only geometry board; no Minecraft texture/model data. */
function geometryBoard(): { blueprint: BlueprintV1; samples: BlueprintVoxel[] } {
  const samples: BlueprintVoxel[] = [];
  const add = (column: number, row: number, sourceBlockId: string,
    sourceBlockState: Record<string, string>, materialId: BlueprintVoxel['materialId'] = 'stone', y = 1) => {
    samples.push({ x: column * 3, y, z: row * 3, materialId, sourceBlockId, sourceBlockState, buildOrder: 0 });
  };
  const stairShapes = ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'];
  stairShapes.forEach((shape, column) => {
    add(column, 0, 'minecraft:oak_stairs', { facing: 'north', half: 'bottom', shape }, 'plank');
    add(column, 1, 'minecraft:stone_stairs', { facing: 'east', half: 'top', shape });
  });
  ['bottom', 'top', 'double'].forEach((type, column) => add(column, 2, 'minecraft:oak_slab', { type }, 'plank'));
  for (const [column, open, hinge] of [[3, 'false', 'left'], [4, 'true', 'left'], [5, 'true', 'right']] as const) {
    for (const half of ['lower', 'upper']) add(column, 2, 'minecraft:oak_door',
      { facing: 'north', open, hinge, half }, 'plank', half === 'lower' ? 1 : 2);
  }
  const disconnected = { north: 'false', east: 'false', south: 'false', west: 'false' };
  add(0, 3, 'minecraft:oak_fence', disconnected, 'plank');
  add(1, 3, 'minecraft:oak_fence', { ...disconnected, north: 'true', south: 'true' }, 'plank');
  add(2, 3, 'minecraft:oak_fence', { north: 'true', east: 'true', south: 'true', west: 'true' }, 'plank');
  add(3, 3, 'minecraft:cobblestone_wall', { up: 'false', north: 'low', south: 'low', east: 'none', west: 'none' });
  add(4, 3, 'minecraft:cobblestone_wall', { up: 'true', north: 'low', south: 'none', east: 'tall', west: 'none' });
  add(5, 3, 'minecraft:glass_pane', { ...disconnected, north: 'true', south: 'true' }, 'glass');
  add(0, 4, 'minecraft:iron_bars', { north: 'true', east: 'true', south: 'true', west: 'true' });
  add(1, 4, 'minecraft:oak_trapdoor', { facing: 'north', open: 'false', half: 'bottom' }, 'plank');
  add(2, 4, 'minecraft:oak_trapdoor', { facing: 'east', open: 'false', half: 'top' }, 'plank');
  add(3, 4, 'minecraft:oak_trapdoor', { facing: 'north', open: 'true', half: 'bottom' }, 'plank');
  add(4, 4, 'minecraft:ladder', { facing: 'east' }, 'plank');
  // A plausible suffix must not turn an unknown source into an invented model.
  add(5, 4, 'minecraft:not_a_real_stairs', { facing: 'north', half: 'bottom', shape: 'straight' });
  for (const [column, facing, open, inWall] of [
    [0, 'north', 'false', 'false'], [1, 'north', 'true', 'false'],
    [2, 'east', 'false', 'false'], [3, 'east', 'true', 'false'],
    [4, 'north', 'false', 'true'], [5, 'north', 'true', 'true'],
  ] as const) {
    add(column, 5, 'minecraft:oak_fence_gate', { facing, open, in_wall: inWall, powered: 'false' }, 'plank');
  }
  const supports: BlueprintVoxel[] = [];
  const support = (column: number, row: number, dx: number, dy: number, dz: number) => {
    supports.push({ x: column * 3 + dx, y: 1 + dy, z: row * 3 + dz,
      materialId: 'stone', sourceBlockId: 'minecraft:stone', buildOrder: 0 });
  };
  for (const [column, face, facing, powered] of [
    [0, 'floor', 'north', 'false'], [1, 'floor', 'north', 'true'],
    [2, 'wall', 'north', 'false'], [3, 'wall', 'north', 'true'],
    [4, 'ceiling', 'east', 'false'], [5, 'ceiling', 'east', 'true'],
  ] as const) {
    add(column, 6, 'minecraft:stone_button', { face, facing, powered });
    // Buttons have actual supporting blocks, not floating test-only planes.
    if (face === 'wall') support(column, 6, 0, 0, 1);
    if (face === 'ceiling') support(column, 6, 0, 1, 0);
  }
  add(0, 7, 'minecraft:stone_pressure_plate', { powered: 'false' });
  add(1, 7, 'minecraft:stone_pressure_plate', { powered: 'true' });
  add(2, 7, 'minecraft:light_weighted_pressure_plate', { power: '0' }, 'accent');
  add(3, 7, 'minecraft:light_weighted_pressure_plate', { power: '15' }, 'accent');
  add(4, 7, 'minecraft:heavy_weighted_pressure_plate', { power: '0' });
  add(5, 7, 'minecraft:heavy_weighted_pressure_plate', { power: '15' });
  const floor: BlueprintVoxel[] = [];
  for (let z = -1; z <= 22; z += 1) for (let x = -1; x <= 16; x += 1) {
    floor.push({ x, y: 0, z, materialId: 'stone', sourceBlockId: 'minecraft:stone', buildOrder: 0 });
  }
  const voxels = [...floor, ...supports, ...samples].map((voxel, index, all) => ({ ...voxel,
    buildOrder: Math.floor(index * 10_000 / (all.length - 1)) }));
  return { samples, blueprint: { schemaVersion: 1, id: 'original-static-geometry-board', title: '原创形状诊断',
    bounds: { minX: -1, maxX: 16, minY: 0, maxY: 2, minZ: -1, maxZ: 22 }, voxels } };
}

test('records an original-only board including open gates, supported buttons and pressed plates', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const shaderErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && /THREE.WebGLProgram|shader error|INVALID_OPERATION/i.test(message.text())) {
      shaderErrors.push(message.text());
    }
  });
  const fixture = geometryBoard();
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as typeof window & { __blockcolcVoxelTest?: unknown }).__blockcolcVoxelTest));
  await page.evaluate(blueprint => {
    const target = window as typeof window & { __blockcolcVoxelTest: typeof import('@blockcolc/voxel');
      __originalStaticAuditRenderer?: VoxelRenderer };
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', '原创静态形状诊断');
    // Match the production .world/.blueprint-preview canvas touch policy;
    // otherwise native page pan/pinch cancels the renderer's pointer stream.
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none';
    document.body.append(canvas);
    const renderer = target.__blockcolcVoxelTest.createVoxelRenderer(canvas,
      { blueprint, previewMode: true, lightingQuality: 'balanced', worldSeed: 'original-static-board' });
    renderer.setReducedMotion(true);
    renderer.setWorld({ projectId: 'original-static-board', blueprintId: blueprint.id,
      buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000,
      isMonument: false, settlementIndex: 0 });
    renderer.setEnvironmentDebugOverride({ date: Date.parse('2026-09-27T12:00:00+08:00'),
      weather: { kind: 'clear', cloudIntensity: 0, precipitationIntensity: 0 } });
    target.__originalStaticAuditRenderer = renderer;
  }, fixture.blueprint);
  const canvas = page.getByLabel('原创静态形状诊断');
  try {
    await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count')))
      .toBe(fixture.samples.length - 1);
    await canvas.screenshot({ path: testInfo.outputPath('original-static-shapes-oblique.png') });
    // Keep the wide frame, then use a hit-checked real pinch to inspect the
    // same production geometry more closely, without replacing the scene.
    const wideRatio = Number(await canvas.getAttribute('data-camera-distance-ratio'));
    const bounds = (await canvas.boundingBox())!;
    const points = (distance: number) => [
      { id: 51, x: bounds.x + bounds.width / 2 - distance / 2, y: bounds.y + bounds.height * 0.55, force: 1 },
      { id: 52, x: bounds.x + bounds.width / 2 + distance / 2, y: bounds.y + bounds.height * 0.55, force: 1 },
    ];
    expect(await canvas.evaluate((element, coordinates) => coordinates.every(({ x, y }) =>
      document.elementFromPoint(x, y) === element), [...points(48), ...points(240)])).toBe(true);
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(48) });
      for (let step = 1; step <= 8; step += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(48 + 192 * step / 8) });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await cdp.detach(); }
    await expect.poll(async () => Number(await canvas.getAttribute('data-camera-distance-ratio'))).toBeLessThan(wideRatio);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    await canvas.screenshot({ path: testInfo.outputPath('original-static-shapes-close.png') });
    const diagnostics = await page.evaluate(() => (window as typeof window & { __originalStaticAuditRenderer: VoxelRenderer })
      .__originalStaticAuditRenderer.getDiagnostics());
    expect(shaderErrors).toEqual([]);
    await testInfo.attach('original-static-shape-board', { body: Buffer.from(JSON.stringify({ diagnostics,
      samples: fixture.samples, shaderErrors, visuallyReviewed: false,
      scope: 'Original-only production geometry on a synthetic board; count and screenshot capture do not prove vanilla visual equivalence or device acceptance.' }, null, 2)),
      contentType: 'application/json' });
  } finally {
    await page.evaluate(() => {
      const target = window as typeof window & { __originalStaticAuditRenderer?: VoxelRenderer };
      target.__originalStaticAuditRenderer?.dispose();
      delete target.__originalStaticAuditRenderer;
      document.querySelector('canvas[aria-label="原创静态形状诊断"]')?.remove();
    });
  }
});

for (const blueprintId of ['builtin-small-workshop', 'builtin-timber-house', 'builtin-village-chapel']) {
  test(`records both gable sides of the completed ${blueprintId} preview`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const shaderErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error' && /THREE.WebGLProgram|shader error|INVALID_OPERATION/i.test(message.text())) {
        shaderErrors.push(message.text());
      }
    });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
    await page.waitForFunction(() => Boolean((window as typeof window & { __blockcolcVoxelTest?: unknown }).__blockcolcVoxelTest));
    await page.evaluate(id => {
      const target = window as typeof window & { __blockcolcVoxelTest: typeof import('@blockcolc/voxel');
        __starterGableAuditRenderer?: VoxelRenderer };
      const blueprint = target.__blockcolcVoxelTest.resolveBuiltinBlueprint(id);
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', '初始建筑山墙诊断');
      canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none';
      const gesture = { down: 0, move: 0, up: 0, cancel: 0 };
      canvas.addEventListener('pointerdown', () => { gesture.down += 1; });
      canvas.addEventListener('pointermove', () => { gesture.move += 1; });
      canvas.addEventListener('pointerup', () => { gesture.up += 1; });
      canvas.addEventListener('pointercancel', () => { gesture.cancel += 1; });
      Object.assign(target, { __starterGableGestureAudit: gesture });
      document.body.append(canvas);
      const renderer = target.__blockcolcVoxelTest.createVoxelRenderer(canvas,
        { blueprint, previewMode: true, lightingQuality: 'balanced', worldSeed: 'starter-gable-audit' });
      renderer.setReducedMotion(true);
      renderer.setWorld({ projectId: id, blueprintId: id,
        buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000,
        isMonument: false, settlementIndex: 0 });
      renderer.setEnvironmentDebugOverride({ date: Date.parse('2026-09-27T12:00:00+08:00'),
        weather: { kind: 'clear', cloudIntensity: 0, precipitationIntensity: 0 } });
      target.__starterGableAuditRenderer = renderer;
    }, blueprintId);
    const canvas = page.getByLabel('初始建筑山墙诊断');
    try {
      await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
      const rebuildCount = (await canvas.getAttribute('data-world-rebuild-count'))!;
      await expect(canvas).toHaveAttribute('data-rendered-world-rebuild-count', rebuildCount);
      await canvas.screenshot({ path: testInfo.outputPath('starter-gable-oblique.png') });
      const beforeAzimuth = Number(await canvas.getAttribute('data-camera-azimuth'));
      const bounds = (await canvas.boundingBox())!;
      const point = (x: number) => ({ id: 61, x, y: bounds.y + bounds.height * 0.6, force: 1 });
      const from = bounds.x + bounds.width * 0.25;
      // Two real drags total approximately half a turn at the production
      // 0.011 rad/CSS-pixel sensitivity, revealing the opposite gable sides.
      const to = from + Math.PI / (2 * 0.011);
      expect(await canvas.evaluate((element, coordinates) => coordinates.every(({ x, y }) =>
        document.elementFromPoint(x, y) === element), [point(from), point(to)])).toBe(true);
      const cdp = await page.context().newCDPSession(page);
      try {
        for (let drag = 0; drag < 2; drag += 1) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from)] });
          for (let step = 1; step <= 12; step += 1) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(from + (to - from) * step / 12)] });
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
      } finally { await cdp.detach(); }
      const gesture = await page.evaluate(() => (window as typeof window & {
        __starterGableGestureAudit: { down: number; move: number; up: number; cancel: number };
      }).__starterGableGestureAudit);
      await testInfo.attach('starter-gable-gesture', {
        body: Buffer.from(JSON.stringify(gesture)), contentType: 'application/json',
      });
      expect(gesture).toMatchObject({ down: 2, up: 2, cancel: 0 });
      expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
      await expect.poll(async () => Number(await canvas.getAttribute('data-camera-azimuth')) - beforeAzimuth)
        .toBeGreaterThan(Math.PI - 0.1);
      await canvas.screenshot({ path: testInfo.outputPath('starter-gable-rotated.png') });
      expect(await canvas.getAttribute('data-world-rebuild-count')).toBe(rebuildCount);
      expect(shaderErrors).toEqual([]);
      await testInfo.attach('starter-gable-observation', {
        body: Buffer.from(JSON.stringify({ blueprintId,
          beforeAzimuth, afterAzimuth: Number(await canvas.getAttribute('data-camera-azimuth')),
          diagnostics: await page.evaluate(() => (window as typeof window & { __starterGableAuditRenderer: VoxelRenderer })
            .__starterGableAuditRenderer.getDiagnostics()), visuallyReviewed: false,
          scope: 'Completed production preview and real touch rotation; requires visual review, not historical progress or device acceptance.' }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      await page.evaluate(() => {
        const target = window as typeof window & { __starterGableAuditRenderer?: VoxelRenderer };
        target.__starterGableAuditRenderer?.dispose();
        delete target.__starterGableAuditRenderer;
        delete (target as typeof target & { __starterGableGestureAudit?: unknown }).__starterGableGestureAudit;
        document.querySelector('canvas[aria-label="初始建筑山墙诊断"]')?.remove();
      });
    }
  });
}

import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { deflateSync, gzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { parseJava16xResourcePack } from '@blockcolc/resource-pack';
import type { BlueprintV1, BlueprintVoxel, VoxelRenderer, WorldEnvironmentDebugOverride } from '@blockcolc/voxel';
import { strToU8, zipSync } from 'fflate';
import { fixBusinessDate } from './fixed-business-date';
import { testNbt as nbt, writeJavaNbt } from '../../../packages/litematic/test/nbt-fixture.js';

function genuinePropertylessLitematic(): Uint8Array {
  const values = [0, 1];
  const longs = packPaletteIndices(values, 2);
  const palette = ['minecraft:red_carpet', 'minecraft:moss_carpet'].map(name => nbt.compound({ Name: nbt.string(name) }));
  const region = nbt.compound({
    Size: nbt.compound({ x: nbt.int(2), y: nbt.int(1), z: nbt.int(1) }),
    Position: nbt.compound({ x: nbt.int(0), y: nbt.int(1), z: nbt.int(0) }),
    BlockStatePalette: nbt.list(10, palette), BlockStates: nbt.longArray(longs),
    Entities: nbt.list(10, []), TileEntities: nbt.list(10, []),
    PendingBlockTicks: nbt.list(10, []), PendingFluidTicks: nbt.list(10, []),
  });
  const root = nbt.compound({ Version: nbt.int(7), SubVersion: nbt.int(1), MinecraftDataVersion: nbt.int(3953),
    Metadata: nbt.compound({ Name: nbt.string('Propertyless carpets'), Author: nbt.string('diagnostic'), Description: nbt.string('') }),
    Regions: nbt.compound({ carpets: region }) });
  return new Uint8Array(gzipSync(writeJavaNbt(root)));
}

function packPaletteIndices(values: number[], bits: number): bigint[] {
  const longs = Array<bigint>(Math.ceil(values.length * bits / 64)).fill(0n);
  const mask = (1n << BigInt(bits)) - 1n;
  values.forEach((value, index) => { const offset = index * bits; longs[0] = BigInt.asUintN(64, longs[0]! | ((BigInt(value) & mask) << BigInt(offset))); });
  return longs.map(value => BigInt.asIntN(64, value));
}

const dyes = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

function featureBoard(): { blueprint: BlueprintV1; samples: BlueprintVoxel[] } {
  const samples: BlueprintVoxel[] = [];
  const add = (x: number, z: number, sourceBlockId: string, sourceBlockState?: Record<string, string>, y = 1) => {
    const voxel: BlueprintVoxel = { x, y, z, materialId: sourceBlockId.includes('carpet') ? 'accent' : 'stone',
      sourceBlockId, buildOrder: 0, ...(sourceBlockState === undefined ? {} : { sourceBlockState }) };
    samples.push(voxel);
  };
  // One genuinely property-less imported carpet; the remaining dye variants
  // deliberately retain an explicit empty map.
  dyes.forEach((dye, index) => add(index * 2, 0, `minecraft:${dye}_carpet`, index === 14 ? undefined : {}));
  add(32, 0, 'minecraft:moss_carpet');
  let slot = 0;
  for (const face of ['floor', 'wall', 'ceiling'] as const) for (const facing of ['north', 'east', 'south', 'west'] as const)
    for (const powered of ['false', 'true'] as const) {
      const x = (slot % 8) * 2;
      const z = 3 + Math.floor(slot / 8) * 2;
      add(x, z, 'minecraft:lever', { face, facing, powered });
      if (face === 'wall') {
        const support = { north: [0, 1], east: [-1, 0], south: [0, -1], west: [1, 0] }[facing]!;
        add(x + support[0]!, z + support[1]!, 'minecraft:stone');
      }
      if (face === 'ceiling') add(x, z, 'minecraft:stone', undefined, 2);
      slot += 1;
    }
  slot = 0;
  for (const id of ['minecraft:lantern', 'minecraft:soul_lantern'])
    for (const hanging of ['false', 'true'] as const) for (const waterlogged of ['false', 'true'] as const) {
      const x = 18 + (slot % 4) * 2;
      const z = 3 + Math.floor(slot / 4) * 2;
      add(x, z, id, { hanging, waterlogged });
      if (hanging) add(x, z, 'minecraft:stone', undefined, 2);
      slot += 1;
    }
  const byPosition = new Map(samples.map(voxel => [`${voxel.x}:${voxel.y}:${voxel.z}`, voxel]));
  const floor: BlueprintVoxel[] = [];
  for (let z = -1; z <= 10; z += 1) for (let x = -1; x <= 33; x += 1) {
    const key = `${x}:0:${z}`;
    if (!byPosition.has(key)) floor.push({ x, y: 0, z, materialId: 'stone', sourceBlockId: 'minecraft:stone', buildOrder: 0 });
  }
  const voxels = [...floor, ...samples].map((voxel, index, all) => ({ ...voxel, buildOrder: Math.floor(index * 10_000 / (all.length - 1)) }));
  return { samples, blueprint: { schemaVersion: 1, id: 'original-carpet-lever-lantern', title: '原创地毯拉杆灯笼诊断',
    bounds: { minX: -1, maxX: 33, minY: 0, maxY: 2, minZ: -1, maxZ: 10 }, voxels } };
}

function syntheticPack(missingModel = false): { zip: Buffer; manifest: ReturnType<typeof parseJava16xResourcePack>; id: string } {
  const files: Record<string, Uint8Array> = {
    'pack.mcmeta': strToU8(JSON.stringify({ pack: { pack_format: 97, description: 'Authored original-shape route probe' } })),
    'assets/minecraft/blockstates/red_carpet.json': strToU8(JSON.stringify({ variants: { '': { model: missingModel
      ? 'minecraft:block/intentionally_missing_original_probe' : 'minecraft:block/original_probe' } } })),
    'assets/minecraft/models/block/original_probe.json': strToU8(JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/probe' } })),
    'assets/minecraft/textures/block/probe.png': tinyPng(),
  };
  const zip = Buffer.from(zipSync(files, { level: 6 }));
  return { zip, manifest: parseJava16xResourcePack(zip), id: `sha256:${createHash('sha256').update(zip).digest('hex')}` };
}

function tinyPng(): Uint8Array {
  const raw = new Uint8Array(16 * 65);
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) raw.set([220, 45 + x * 3, 70 + y * 2, 255], y * 65 + 1 + x * 4);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 16); new DataView(ihdr.buffer).setUint32(4, 16); ihdr.set([8, 6, 0, 0, 0], 8);
  return concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr),
    pngChunk('IDAT', new Uint8Array(deflateSync(raw))), pngChunk('IEND', new Uint8Array()));
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const name = strToU8(type); const output = new Uint8Array(data.length + 12); const view = new DataView(output.buffer);
  view.setUint32(0, data.length); output.set(name, 4); output.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of concat(name, data)) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  view.setUint32(data.length + 8, (crc ^ 0xffffffff) >>> 0); return output;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(arrays.reduce((sum, bytes) => sum + bytes.length, 0)); let offset = 0;
  for (const bytes of arrays) { output.set(bytes, offset); offset += bytes.length; } return output;
}

async function installScene(page: Page, blueprint: BlueprintV1, previewMode = true): Promise<Locator> {
  await page.evaluate(({ value, isPreview }) => {
    const target = window as typeof window & { __blockcolcVoxelTest: typeof import('@blockcolc/voxel'); __originalShapeAudit?: VoxelRenderer;
      __originalShapeInputAudit?: { down: number; move: number; up: number; cancel: number; lost: number; restored: number } };
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', '地毯拉杆灯笼原创形状诊断');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none'; document.body.append(canvas);
    const input = { down: 0, move: 0, up: 0, cancel: 0, lost: 0, restored: 0 };
    canvas.addEventListener('pointerdown', () => { input.down += 1; });
    canvas.addEventListener('pointermove', () => { input.move += 1; });
    canvas.addEventListener('pointerup', () => { input.up += 1; });
    canvas.addEventListener('pointercancel', () => { input.cancel += 1; });
    canvas.addEventListener('webglcontextlost', () => { input.lost += 1; });
    canvas.addEventListener('webglcontextrestored', () => { input.restored += 1; });
    target.__originalShapeInputAudit = input;
    const renderer = target.__blockcolcVoxelTest.createVoxelRenderer(canvas,
      { blueprint: value, previewMode: isPreview, lightingQuality: 'performance', worldSeed: 'original-carpet-lever-lantern' });
    renderer.setReducedMotion(true);
    renderer.setWorld({ projectId: value.id, blueprintId: value.id, buildingCompletionBasisPoints: 10_000,
      buildingConditionBasisPoints: 10_000, isMonument: false, settlementIndex: 0 });
    renderer.focusProject(value.id);
    renderer.setEnvironmentDebugOverride({ date: Date.parse('2026-09-27T12:00:00+08:00'),
      weather: { kind: 'clear', cloudIntensity: 0, precipitationIntensity: 0 } });
    target.__originalShapeAudit = renderer;
  }, { value: blueprint, isPreview: previewMode });
  return page.getByLabel('地毯拉杆灯笼原创形状诊断');
}

function detailBoard(family: 'carpet' | 'lever' | 'lantern'): BlueprintV1 {
  const samples: BlueprintVoxel[] = [];
  const add = (x: number, y: number, z: number, sourceBlockId: string, sourceBlockState?: Record<string, string>, materialId: BlueprintVoxel['materialId'] = 'stone') => {
    samples.push({ x, y, z, materialId, buildOrder: 10_000, sourceBlockId,
      ...(sourceBlockState === undefined ? {} : { sourceBlockState }) });
  };
  if (family === 'carpet') {
    dyes.forEach((dye, index) => add(index % 5 * 2, 1, Math.floor(index / 5) * 2, `minecraft:${dye}_carpet`, {}, 'accent'));
    add(8, 1, 6, 'minecraft:moss_carpet', {}, 'stone');
  } else if (family === 'lever') {
    let index = 0;
    for (const face of ['floor', 'wall', 'ceiling'] as const) for (const facing of ['north', 'east', 'south', 'west'] as const)
      for (const powered of ['false', 'true'] as const) {
        const x = index % 4 * 3; const z = Math.floor(index / 4) * 3;
        add(x, 1, z, 'minecraft:lever', { face, facing, powered });
        if (face === 'wall') {
          const support = { north: [0, 1], east: [-1, 0], south: [0, -1], west: [1, 0] }[facing]!;
          add(x + support[0]!, 1, z + support[1]!, 'minecraft:stone');
        }
        if (face === 'ceiling') add(x, 2, z, 'minecraft:stone');
        index += 1;
      }
  } else {
    let index = 0;
    for (const id of ['minecraft:lantern', 'minecraft:soul_lantern']) for (const hanging of ['false', 'true'] as const)
      for (const waterlogged of ['false', 'true'] as const) {
        const x = index % 4 * 2; const z = Math.floor(index / 4) * 2;
        add(x, 1, z, id, { hanging, waterlogged });
        if (hanging) add(x, 2, z, 'minecraft:stone');
        index += 1;
      }
  }
  const xs = samples.map(voxel => voxel.x); const zs = samples.map(voxel => voxel.z);
  const minX = Math.min(...xs) - 1; const maxX = Math.max(...xs) + 1;
  const minZ = Math.min(...zs) - 1; const maxZ = Math.max(...zs) + 1;
  const floor: BlueprintVoxel[] = [];
  for (let z = minZ; z <= maxZ; z += 1) for (let x = minX; x <= maxX; x += 1) {
    if (!samples.some(voxel => voxel.x === x && voxel.y === 0 && voxel.z === z))
      floor.push({ x, y: 0, z, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' });
  }
  const voxels = [...floor, ...samples].map((voxel, index, all) => ({ ...voxel, buildOrder: Math.floor(index * 10_000 / (all.length - 1)) }));
  return { schemaVersion: 1, id: `original-detail-${family}`, title: `原创${family}近景小板`,
    bounds: { minX, maxX, minY: 0, maxY: family === 'lever' ? 2 : 2, minZ, maxZ }, voxels };
}

function budgetBoard(kind: 'mixed-topology' | 'material-overflow'): BlueprintV1 {
  if (kind === 'material-overflow') {
    const voxels = Array.from({ length: 65 }, (_, index): BlueprintVoxel => ({ x: index, y: 1, z: 0,
      materialId: 'accent', buildOrder: Math.floor(index * 10_000 / 64), sourceBlockId: 'minecraft:red_carpet',
      sourceBlockState: {}, emissiveKind: `budget-group-${index}`, emissiveLevel: 1 }));
    for (let x = -1; x <= 65; x += 1) voxels.push({ x, y: 0, z: 0, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' });
    return { schemaVersion: 1, id: 'original-budget-material-overflow', title: 'Material group overflow board',
      bounds: { minX: -1, maxX: 65, minY: 0, maxY: 1, minZ: 0, maxZ: 0 }, voxels };
  }
  const samples = featureBoard().samples.map(voxel => ({ ...voxel }));
  for (let code = 0; code < 81; code += 1) {
    let digits = code; const state: Record<string, string> = { up: code % 2 === 0 ? 'false' : 'true' };
    for (const side of ['north', 'east', 'south', 'west'] as const) { state[side] = ['none', 'low', 'tall'][digits % 3]!; digits = Math.floor(digits / 3); }
    if (state.up === 'false' && ['north', 'east', 'south', 'west'].every(side => state[side] === 'none')) state.up = 'true';
    samples.push({ x: 40 + code % 9, y: 1, z: Math.floor(code / 9), materialId: 'stone', buildOrder: 10_000,
      sourceBlockId: 'minecraft:cobblestone_wall', sourceBlockState: state });
  }
  for (let code = 0; code < 8; code += 1) samples.push({ x: 50 + code, y: 1, z: 0, materialId: 'stone', buildOrder: 10_000,
    sourceBlockId: 'minecraft:oak_stairs', sourceBlockState: { facing: ['north', 'east', 'south', 'west'][code % 4]!,
      half: code < 4 ? 'bottom' : 'top', shape: ['straight', 'inner_left'][Math.floor(code / 4)]! } });
  const floor: BlueprintVoxel[] = [];
  for (let z = -1; z <= 10; z += 1) for (let x = -1; x <= 59; x += 1) floor.push({ x, y: 0, z, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' });
  const voxels = [...floor, ...samples];
  return { schemaVersion: 1, id: kind, title: 'Mixed new and legacy topology overflow board',
    bounds: { minX: -1, maxX: 59, minY: 0, maxY: 2, minZ: -1, maxZ: 10 }, voxels };
}

function lanternEmissionBoard(): BlueprintV1 {
  const voxels: BlueprintVoxel[] = [
    { x: 0, y: 1, z: 0, materialId: 'stone', buildOrder: 10_000, sourceBlockId: 'minecraft:lantern',
      sourceBlockState: { hanging: 'false', waterlogged: 'false' } },
    { x: 2, y: 1, z: 0, materialId: 'stone', buildOrder: 10_000, sourceBlockId: 'minecraft:lantern',
      sourceBlockState: { hanging: 'false', waterlogged: 'false' }, emissiveLevel: 0 },
    { x: 4, y: 1, z: 0, materialId: 'stone', buildOrder: 10_000, sourceBlockId: 'minecraft:soul_lantern',
      sourceBlockState: { hanging: 'false', waterlogged: 'false' } },
    { x: 6, y: 1, z: 0, materialId: 'stone', buildOrder: 10_000, sourceBlockId: 'minecraft:lantern',
      sourceBlockState: { hanging: 'false', waterlogged: 'false' }, emissiveKind: 'legacy-redstone', emissiveLevel: 7 },
    { x: -1, y: 0, z: 0, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' },
    { x: 0, y: 0, z: 0, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' },
    { x: 1, y: 0, z: 0, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' },
    { x: 2, y: 0, z: 0, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' },
    { x: 3, y: 0, z: 0, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' },
    { x: 4, y: 0, z: 0, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' },
    { x: 5, y: 0, z: 0, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' },
    { x: 6, y: 0, z: 0, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' },
    { x: 7, y: 0, z: 0, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' },
  ];
  return { schemaVersion: 1, id: 'original-lantern-emission-priority', title: 'Lantern emission priority board',
    bounds: { minX: -1, maxX: 7, minY: 0, maxY: 1, minZ: 0, maxZ: 0 }, voxels };
}

function mixedEmissionBoard(): BlueprintV1 {
  const voxels: BlueprintVoxel[] = [];
  for (let x = -1; x <= 2; x += 1) voxels.push({ x, y: 0, z: 0, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' });
  voxels.push(
    { x: 0, y: 1, z: 0, materialId: 'stone', buildOrder: 10_000, sourceBlockId: 'minecraft:oak_slab',
      sourceBlockState: { type: 'bottom' }, emissiveKind: 'torch' },
    { x: 1, y: 1, z: 0, materialId: 'stone', buildOrder: 10_000, sourceBlockId: 'minecraft:oak_slab',
      sourceBlockState: { type: 'bottom' }, emissiveKind: 'torch', emissiveLevel: 0 },
  );
  return { schemaVersion: 1, id: 'original-mixed-emission', title: 'Mixed emission identity board',
    bounds: { minX: -1, maxX: 2, minY: 0, maxY: 1, minZ: 0, maxZ: 0 }, voxels };
}

function representativeDetailBoard(): BlueprintV1 {
  const voxels: BlueprintVoxel[] = [];
  const add = (x: number, y: number, z: number, sourceBlockId: string, sourceBlockState?: Record<string, string>) => {
    voxels.push({ x, y, z, materialId: 'stone', buildOrder: 10_000, sourceBlockId,
      ...(sourceBlockState === undefined ? {} : { sourceBlockState }) });
  };
  for (let z = -3; z <= 3; z += 1) for (let x = -3; x <= 3; x += 1)
    voxels.push({ x, y: 0, z, materialId: 'stone', buildOrder: 0, sourceBlockId: 'minecraft:stone' });
  add(-2, 1, 0, 'minecraft:lever', { face: 'wall', facing: 'north', powered: 'true' });
  add(-2, 1, 1, 'minecraft:stone');
  add(2, 1, 0, 'minecraft:lever', { face: 'wall', facing: 'east', powered: 'false' });
  add(1, 1, 0, 'minecraft:stone');
  add(0, 1, -1, 'minecraft:lever', { face: 'floor', facing: 'south', powered: 'false' });
  add(0, 1, 1, 'minecraft:lever', { face: 'ceiling', facing: 'west', powered: 'true' });
  add(0, 2, 1, 'minecraft:stone');
  add(-1, 1, -2, 'minecraft:lantern', { hanging: 'false', waterlogged: 'false' });
  add(1, 1, -2, 'minecraft:soul_lantern', { hanging: 'false', waterlogged: 'false' });
  add(-1, 1, 2, 'minecraft:lantern', { hanging: 'true', waterlogged: 'false' });
  add(-1, 2, 2, 'minecraft:stone');
  add(1, 1, 2, 'minecraft:soul_lantern', { hanging: 'true', waterlogged: 'false' });
  add(1, 2, 2, 'minecraft:stone');
  return { schemaVersion: 1, id: 'original-representative-detail', title: 'Mixed original detail board',
    bounds: { minX: -3, maxX: 3, minY: 0, maxY: 2, minZ: -3, maxZ: 3 }, voxels };
}

async function pinch(page: Page, canvas: Locator, start: number, end: number) {
  const rect = (await canvas.boundingBox())!; const y = rect.y + rect.height * 0.62; const center = rect.x + rect.width / 2;
  const points = (distance: number) => [
    { id: 71, x: center - distance / 2, y, radiusX: 1, radiusY: 1, force: 1 },
    { id: 72, x: center + distance / 2, y, radiusX: 1, radiusY: 1, force: 1 },
  ];
  await expect.poll(() => canvas.evaluate((element, coords) => coords.every(({ x, y }) => document.elementFromPoint(x, y) === element),
    [...points(start), ...points(end)])).toBe(true);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(start) });
    for (let i = 1; i <= 10; i += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(start + (end - start) * i / 10) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
}

test('routes all 49 carpet, lever and lantern states through bounded production rendering and real touch', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const shaderErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error' && /THREE.WebGLProgram|shader error|INVALID_OPERATION/i.test(message.text())) shaderErrors.push(message.text()); });
  await fixBusinessDate(page, new Date('2026-09-27T12:00:00+08:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.waitForFunction(() => Boolean((window as typeof window & { __blockcolcVoxelTest?: unknown }).__blockcolcVoxelTest));
  const fixture = featureBoard(); const canvas = await installScene(page, fixture.blueprint);
  const observations: Record<string, unknown>[] = [];
  try {
    await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 30_000 });
    expect(await canvas.evaluate(element => getComputedStyle(element).touchAction)).toBe('none');
    const baseline = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit.getDiagnostics());
    expect(baseline.originalStaticShapeVoxelCount).toBe(49);
    expect(baseline.originalStaticShapeTopologyCount).toBeLessThanOrEqual(64);
    expect(baseline.originalStaticShapeMaterialGroupCount).toBeLessThanOrEqual(64);
    expect(baseline.originalStaticShapeBudgetFallbackVoxelCount).toBe(0);
    expect(baseline.sourceLanternPointLightCount).toBe(8);
    const noPackRebuilds = Number(await canvas.getAttribute('data-world-rebuild-count'));
    observations.push({ stage: 'no-pack', diagnostics: baseline, rebuilds: noPackRebuilds });
    await canvas.screenshot({ path: testInfo.outputPath('original-carpet-lever-lantern-no-pack.png') });

    const complete = syntheticPack(false);
    await page.evaluate(async ({ id, manifest }) => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
      .__originalShapeAudit.setResourcePack({ id, manifest }), { id: complete.id, manifest: complete.manifest });
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(48);
    const completeState = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit.getDiagnostics());
    observations.push({ stage: 'valid-model-pack', diagnostics: completeState,
      manifest: { modelCount: complete.manifest.models.length, textureCount: complete.manifest.textures.length } });
    await canvas.screenshot({ path: testInfo.outputPath('original-carpet-lever-lantern-valid-pack.png') });

    const partial = syntheticPack(true);
    await page.evaluate(async ({ id, manifest }) => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
      .__originalShapeAudit.setResourcePack({ id, manifest }), { id: partial.id, manifest: partial.manifest });
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(49);
    const missingState = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit.getDiagnostics());
    observations.push({ stage: 'missing-model-fallback', diagnostics: missingState,
      manifest: { modelCount: partial.manifest.models.length, textureCount: partial.manifest.textures.length } });
    await canvas.screenshot({ path: testInfo.outputPath('original-carpet-lever-lantern-missing-model.png') });

    await page.evaluate(async () => (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit.setResourcePack(null));
    await expect.poll(async () => Number(await canvas.getAttribute('data-original-static-shape-voxel-count'))).toBe(49);
    const restoredRebuilds = Number(await canvas.getAttribute('data-world-rebuild-count'));
    expect(restoredRebuilds).toBeGreaterThan(noPackRebuilds);
    const restored = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit.getDiagnostics());
    observations.push({ stage: 'cancel-restore', diagnostics: restored, rebuilds: restoredRebuilds });

    const beforeZoom = Number(await canvas.getAttribute('data-camera-distance'));
    await pinch(page, canvas, 48, 230);
    const close = Number(await canvas.getAttribute('data-camera-distance'));
    expect(close).toBeLessThan(beforeZoom);
    await canvas.screenshot({ path: testInfo.outputPath('original-carpet-lever-lantern-near.png') });
    await pinch(page, canvas, 230, 180);
    const middle = Number(await canvas.getAttribute('data-camera-distance'));
    expect(middle).toBeGreaterThan(close);
    await canvas.screenshot({ path: testInfo.outputPath('original-carpet-lever-lantern-middle.png') });
    await pinch(page, canvas, 230, 48);
    const far = Number(await canvas.getAttribute('data-camera-distance'));
    expect(far).toBeGreaterThan(middle);
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    await canvas.screenshot({ path: testInfo.outputPath('original-carpet-lever-lantern-far.png') });

    const beforeAzimuth = Number(await canvas.getAttribute('data-camera-azimuth'));
    const rect = (await canvas.boundingBox())!; const from = rect.x + rect.width * 0.28; const y = rect.y + rect.height * 0.58;
    const distance = Math.PI / (2 * 0.011); const point = (x: number) => ({ id: 73, x, y, force: 1 });
    expect(await canvas.evaluate((element, coords) => coords.every(({ x, y }) => document.elementFromPoint(x, y) === element),
      [point(from), point(from + distance)])).toBe(true);
    const cdp = await page.context().newCDPSession(page);
    try {
      for (let turn = 0; turn < 2; turn += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from)] });
        for (let i = 1; i <= 12; i += 1) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(from + distance * i / 12)] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
    } finally { await cdp.detach(); }
    const afterAzimuth = Number(await canvas.getAttribute('data-camera-azimuth'));
    expect(afterAzimuth - beforeAzimuth).toBeGreaterThan(Math.PI - 0.1);
    await canvas.screenshot({ path: testInfo.outputPath('original-carpet-lever-lantern-half-turn.png') });
    const reverseCdp = await page.context().newCDPSession(page);
    try {
      for (let turn = 0; turn < 2; turn += 1) {
        await reverseCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from + distance)] });
        for (let i = 1; i <= 12; i += 1) await reverseCdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(from + distance * (1 - i / 12))] });
        await reverseCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
    } finally { await reverseCdp.detach(); }
    await expect.poll(async () => Math.abs(Number(await canvas.getAttribute('data-camera-azimuth')) - beforeAzimuth)).toBeLessThan(0.1);
    const afterReverseAzimuth = Number(await canvas.getAttribute('data-camera-azimuth'));
    await canvas.screenshot({ path: testInfo.outputPath('original-carpet-lever-lantern-opposite-return.png') });

    const pitchBefore = Number(await canvas.getAttribute('data-camera-pitch-degrees'));
    const tiltRect = (await canvas.boundingBox())!; const tiltX = tiltRect.x + tiltRect.width * 0.30;
    const tiltFromY = tiltRect.y + tiltRect.height * 0.38;
    const tiltToY = Math.min(tiltRect.y + tiltRect.height * 0.82, tiltFromY + Math.max(32, (64 - pitchBefore) / 0.0045));
    const tiltPoint = (y: number) => ({ id: 74, x: tiltX, y, force: 1 });
    expect(await canvas.evaluate((element, coords) => coords.every(({ x, y }) => document.elementFromPoint(x, y) === element),
      [tiltPoint(tiltFromY), tiltPoint(tiltToY)])).toBe(true);
    const tiltCdp = await page.context().newCDPSession(page);
    try {
      await tiltCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tiltPoint(tiltFromY)] });
      for (let i = 1; i <= 12; i += 1) await tiltCdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tiltPoint(tiltFromY + (tiltToY - tiltFromY) * i / 12)] });
      await tiltCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await tiltCdp.detach(); }
    await expect.poll(async () => Number(await canvas.getAttribute('data-camera-pitch-degrees'))).toBeGreaterThan(62);
    await canvas.screenshot({ path: testInfo.outputPath('original-carpet-lever-lantern-overhead.png') });

    const rebuildBeforeQuality = Number(await canvas.getAttribute('data-world-rebuild-count'));
    const quality = await page.evaluate(() => {
      const renderer = (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit;
      const initial = renderer.getDiagnostics().activeLightingQuality;
      const lowAccepted = renderer.setLightingQuality('performance'); const low = renderer.getDiagnostics().activeLightingQuality;
      const highAccepted = renderer.setLightingQuality('cinematic'); const high = renderer.getDiagnostics().activeLightingQuality;
      const returnAccepted = renderer.setLightingQuality(initial); return { initial, lowAccepted, low, highAccepted, high, returnAccepted,
        returned: renderer.getDiagnostics().activeLightingQuality };
    });
    expect(quality.lowAccepted && quality.highAccepted && quality.returnAccepted).toBe(true);
    expect(quality.low).toBe('performance'); expect(quality.high).toBe('cinematic'); expect(quality.returned).toBe(quality.initial);
    expect(Number(await canvas.getAttribute('data-world-rebuild-count'))).toBe(rebuildBeforeQuality);
    const environment = (date: string): WorldEnvironmentDebugOverride => ({ date: Date.parse(date),
      weather: { kind: 'clear', cloudIntensity: 0, precipitationIntensity: 0 } });
    await page.evaluate(value => (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit.setEnvironmentDebugOverride(value),
      environment('2026-09-27T02:00:00+08:00'));
    await expect.poll(async () => canvas.getAttribute('data-astronomy-phase')).toBe('night');
    const nightLowLights = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit.getDiagnostics());
    expect(nightLowLights.sourceLanternPointLightCount).toBe(8);
    expect(nightLowLights.localLightCreatedCount).toBeGreaterThan(0);
    expect(nightLowLights.visibleLocalLightCount).toBe(0);
    const nightHighAccepted = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
      .__originalShapeAudit.setLightingQuality('cinematic'));
    expect(nightHighAccepted).toBe(true);
    await expect.poll(async () => (await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
      .__originalShapeAudit.getDiagnostics())).visibleLocalLightCount).toBeGreaterThan(0);
    const nightHighLights = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit.getDiagnostics());
    expect(nightHighLights.activeLightingQuality).toBe('cinematic');
    expect(nightHighLights.visibleLocalLightCount).toBeGreaterThan(0);
    await canvas.screenshot({ path: testInfo.outputPath('original-carpet-lever-lantern-night-high-lights.png') });
    const nightReturnedAccepted = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
      .__originalShapeAudit.setLightingQuality('performance'));
    expect(nightReturnedAccepted).toBe(true);
    await expect.poll(async () => (await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
      .__originalShapeAudit.getDiagnostics())).visibleLocalLightCount).toBe(0);
    const nightFingerprint = await canvas.getAttribute('data-lighting-fingerprint');
    await canvas.screenshot({ path: testInfo.outputPath('original-carpet-lever-lantern-night.png') });
    await page.evaluate(value => (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit.setEnvironmentDebugOverride(value),
      environment('2026-09-27T12:00:00+08:00'));
    await expect.poll(async () => canvas.getAttribute('data-astronomy-phase')).toBe('day');
    const dayFingerprint = await canvas.getAttribute('data-lighting-fingerprint');
    expect(dayFingerprint).not.toBe(nightFingerprint);
    const finalDiagnostics = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit.getDiagnostics());
    expect(finalDiagnostics.originalStaticShapeVoxelCount).toBe(49);
    expect(finalDiagnostics.sourceLanternPointLightCount).toBe(8);
    expect(finalDiagnostics.worldRebuildCount).toBe(rebuildBeforeQuality);
    const inputAudit = await page.evaluate(() => (window as typeof window & { __originalShapeInputAudit: { down: number; move: number; up: number;
      cancel: number; lost: number; restored: number } }).__originalShapeInputAudit);
    expect(inputAudit.down).toBeGreaterThanOrEqual(10); expect(inputAudit.move).toBeGreaterThan(0);
    expect(inputAudit.up).toBeGreaterThanOrEqual(10); expect(inputAudit.cancel).toBe(0);
    const glAudit = await page.evaluate(() => {
      const canvas = document.querySelector('canvas[aria-label="地毯拉杆灯笼原创形状诊断"]') as HTMLCanvasElement;
      const gl = canvas.getContext('webgl2');
      return { lostEvents: (window as typeof window & { __originalShapeInputAudit: { lost: number; restored: number } }).__originalShapeInputAudit.lost,
        restoredEvents: (window as typeof window & { __originalShapeInputAudit: { lost: number; restored: number } }).__originalShapeInputAudit.restored,
        contextLost: gl?.isContextLost() ?? null };
    });
    expect(glAudit).toEqual({ lostEvents: 0, restoredEvents: 0, contextLost: false });
    expect(shaderErrors).toEqual([]);
    observations.push({ stage: 'touch-quality-day-night-complete', beforeAzimuth, afterAzimuth, afterReverseAzimuth,
      forwardHalfTurn: afterAzimuth - beforeAzimuth, reverseHalfTurn: afterReverseAzimuth - afterAzimuth,
      pitchBefore, pitchAfter: Number(await canvas.getAttribute('data-camera-pitch-degrees')),
      zoomDistances: { before: beforeZoom, near: close, middle, far }, nightFingerprint, dayFingerprint,
      nightLocalLights: { low: nightLowLights.visibleLocalLightCount, high: nightHighLights.visibleLocalLightCount,
        lowAgain: (await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer }).__originalShapeAudit.getDiagnostics())).visibleLocalLightCount },
      inputAudit, glAudit, quality, finalDiagnostics,
      visualViewportScale: await page.evaluate(() => window.visualViewport?.scale ?? 1), shaderErrors,
      scope: 'Production renderer on 49-state synthetic board. Pack route is an in-memory parsed authored ZIP manifest; not a real Minecraft pack. Screenshots require independent visual review.' });
    await page.evaluate(() => { const target = window as typeof window & { __originalShapeAudit?: VoxelRenderer };
      target.__originalShapeAudit?.dispose(); delete target.__originalShapeAudit;
      document.querySelector('canvas[aria-label="地毯拉杆灯笼原创形状诊断"]')?.remove(); });
    const reworkObservations: Record<string, unknown>[] = [];
    for (const kind of ['mixed-topology', 'material-overflow'] as const) {
      const board = budgetBoard(kind); const budgetCanvas = await installScene(page, board);
      await expect(budgetCanvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 30_000 });
      const diagnostics = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
        .__originalShapeAudit.getDiagnostics());
      if (kind === 'mixed-topology') {
        expect(diagnostics.originalStaticShapeTopologyCount).toBe(64);
        expect(diagnostics.originalStaticShapeTopologyOverflow).toBeGreaterThan(0);
        expect(diagnostics.originalStaticShapeBudgetFallbackVoxelCount).toBeGreaterThan(0);
        expect(diagnostics.originalStaticShapeVoxelCount + diagnostics.originalStaticShapeBudgetFallbackVoxelCount).toBe(138);
      } else {
        expect(diagnostics.originalStaticShapeTopologyCount).toBe(1);
        expect(diagnostics.originalStaticShapeMaterialGroupCount).toBe(64);
        expect(diagnostics.originalStaticShapeMaterialGroupOverflow).toBe(1);
        expect(diagnostics.originalStaticShapeVoxelCount + diagnostics.originalStaticShapeBudgetFallbackVoxelCount).toBe(65);
      }
      reworkObservations.push({ stage: kind, boardShapeVoxelCount: kind === 'mixed-topology' ? 138 : 65, diagnostics,
        atomicVoxelRouteCount: diagnostics.originalStaticShapeVoxelCount + diagnostics.originalStaticShapeBudgetFallbackVoxelCount });
      await page.evaluate(() => { const target = window as typeof window & { __originalShapeAudit?: VoxelRenderer };
        target.__originalShapeAudit?.dispose(); delete target.__originalShapeAudit;
        document.querySelector('canvas[aria-label="地毯拉杆灯笼原创形状诊断"]')?.remove(); });
    }
    const emissionCanvas = await installScene(page, lanternEmissionBoard());
    await expect(emissionCanvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 30_000 });
    const emissionDiagnostics = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
      .__originalShapeAudit.getDiagnostics());
    expect(emissionDiagnostics.originalStaticShapeVoxelCount).toBe(4);
    expect(emissionDiagnostics.sourceLanternPointLightCount).toBe(2);
    reworkObservations.push({ stage: 'emission-explicit-absent-zero-legacy-positive-source-warm-cool', diagnostics: emissionDiagnostics,
      expectedStaticMaterialGroups: { explicitZeroUnlit: true, sourceWarm: true, sourceSoulCool: true, legacyRedstone: true } });
    await page.screenshot({ path: testInfo.outputPath('original-lantern-emission-priority.png') });
    await page.evaluate(() => { const target = window as typeof window & { __originalShapeAudit?: VoxelRenderer };
      target.__originalShapeAudit?.dispose(); delete target.__originalShapeAudit;
      document.querySelector('canvas[aria-label="地毯拉杆灯笼原创形状诊断"]')?.remove(); });
    const mixedCanvas = await installScene(page, mixedEmissionBoard());
    await expect(mixedCanvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 30_000 });
    const mixedBeforeZoom = Number(await mixedCanvas.getAttribute('data-camera-distance'));
    await pinch(page, mixedCanvas, 72, 180);
    const mixedAfterZoom = Number(await mixedCanvas.getAttribute('data-camera-distance'));
    expect(mixedAfterZoom).toBeLessThan(mixedBeforeZoom);
    const mixedDiagnostics = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
      .__originalShapeAudit.getDiagnostics());
    expect(mixedDiagnostics.originalStaticShapeVoxelCount).toBe(2);
    expect(mixedDiagnostics.originalStaticShapeMaterialGroupCount).toBe(2);
    expect(mixedDiagnostics.originalStaticShapeEmissiveMaterialGroupCount).toBe(1);
    expect(mixedDiagnostics.originalStaticShapeBudgetFallbackVoxelCount).toBe(0);
    const mixedScreenshot = testInfo.outputPath('original-mixed-emission-near.png');
    await mixedCanvas.screenshot({ path: mixedScreenshot });
    await testInfo.attach('original-mixed-emission-near', { path: mixedScreenshot });
    reworkObservations.push({ stage: 'production-kind-only-versus-explicit-zero-same-oak-slab-state', mixedBeforeZoom,
      mixedAfterZoom, diagnostics: mixedDiagnostics,
      adoptedMaterialGroups: { total: mixedDiagnostics.originalStaticShapeMaterialGroupCount,
        emissive: mixedDiagnostics.originalStaticShapeEmissiveMaterialGroupCount, dark: 1 },
      screenshot: 'original-mixed-emission-near.png' });
    await page.evaluate(() => { const target = window as typeof window & { __originalShapeAudit?: VoxelRenderer };
      target.__originalShapeAudit?.dispose(); delete target.__originalShapeAudit;
      document.querySelector('canvas[aria-label="地毯拉杆灯笼原创形状诊断"]')?.remove(); });
    for (const family of ['carpet', 'lever', 'lantern'] as const) for (const mode of ['preview', 'main-world'] as const) {
      const board = detailBoard(family); const detailCanvas = await installScene(page, board, mode === 'preview');
      await expect(detailCanvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 30_000 });
      const beforeDetailZoom = Number(await detailCanvas.getAttribute('data-camera-distance'));
      await pinch(page, detailCanvas, 72, 180);
      const afterDetailZoom = Number(await detailCanvas.getAttribute('data-camera-distance'));
      expect(afterDetailZoom).toBeLessThan(beforeDetailZoom);
      const detailDiagnostics = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
        .__originalShapeAudit.getDiagnostics());
      const expected = family === 'carpet' ? 17 : family === 'lever' ? 24 : 8;
      expect(detailDiagnostics.originalStaticShapeVoxelCount).toBe(expected);
      expect(detailDiagnostics.originalStaticShapeBudgetFallbackVoxelCount).toBe(0);
      const screenshotName = `original-detail-${family}-${mode}-near.png`;
      await detailCanvas.screenshot({ path: testInfo.outputPath(screenshotName) });
      reworkObservations.push({ stage: 'readable-detail-board', family, mode, beforeDetailZoom, afterDetailZoom,
        visualViewportScale: await page.evaluate(() => window.visualViewport?.scale ?? 1), screenshotName, diagnostics: detailDiagnostics });
      await page.evaluate(() => { const target = window as typeof window & { __originalShapeAudit?: VoxelRenderer };
        target.__originalShapeAudit?.dispose(); delete target.__originalShapeAudit;
      document.querySelector('canvas[aria-label="地毯拉杆灯笼原创形状诊断"]')?.remove(); });
    }
    for (const mode of ['preview', 'main-world'] as const) {
      const representativeCanvas = await installScene(page, representativeDetailBoard(), mode === 'preview');
      await expect(representativeCanvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 30_000 });
      const representativeBeforeZoom = Number(await representativeCanvas.getAttribute('data-camera-distance'));
      await pinch(page, representativeCanvas, 48, 280);
      const representativeAfterZoom = Number(await representativeCanvas.getAttribute('data-camera-distance'));
      expect(representativeAfterZoom).toBeLessThan(representativeBeforeZoom);
      const representativeDiagnostics = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
        .__originalShapeAudit.getDiagnostics());
      expect(representativeDiagnostics.originalStaticShapeVoxelCount).toBe(8);
      expect(representativeDiagnostics.originalStaticShapeBudgetFallbackVoxelCount).toBe(0);
      const screenshotName = `original-representative-detail-${mode}-near.png`;
      const representativeScreenshot = testInfo.outputPath(screenshotName);
      await representativeCanvas.screenshot({ path: representativeScreenshot });
      await testInfo.attach(`original-representative-detail-${mode}-near`, { path: representativeScreenshot });
      reworkObservations.push({ stage: 'compact-lever-lantern-detail-board-near', mode, representativeBeforeZoom,
        representativeAfterZoom, diagnostics: representativeDiagnostics,
        sample: 'wall north+east with back supports, floor+ceiling lever, warm+soul standing+hanging lanterns', screenshotName });
      await page.evaluate(() => { const target = window as typeof window & { __originalShapeAudit?: VoxelRenderer };
        target.__originalShapeAudit?.dispose(); delete target.__originalShapeAudit;
        document.querySelector('canvas[aria-label="地毯拉杆灯笼原创形状诊断"]')?.remove(); });
    }
    // Import through the real first-run setup, then persist the validated
    // blueprint snapshot with the normal CreateProject command.
    const litematicInput = page.locator('.litematic-import input[type="file"][accept=".litematic,application/octet-stream"]');
    await expect(litematicInput).toBeVisible();
    await litematicInput.setInputFiles({ name: 'propertyless-carpet.litematic', mimeType: 'application/octet-stream',
      buffer: Buffer.from(genuinePropertylessLitematic()) });
    await expect(page.locator('.litematic-summary')).toBeVisible();
    await expect(page.locator('.litematic-summary')).toContainText('2 x 1 x 1');
    await page.getByRole('button', { name: '开始建造' }).click();
    await expect(page.locator('main')).toHaveAttribute('data-active-route', 'world');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
    await page.waitForFunction(() => Boolean((window as typeof window & { __blockcolcVoxelTest?: unknown }).__blockcolcVoxelTest));
    const persistedBlueprint = await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('blockcolc-v1');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        const record = await new Promise<{ state?: { buildingBlueprintResources?: Array<{ blueprint: unknown }>;
          projects?: Array<{ importedBlueprint?: unknown }> } } | undefined>((resolve, reject) => {
      const request = database.transaction('appState', 'readonly').objectStore('appState').get('current');
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
        });
        return record?.state?.projects?.[0]?.importedBlueprint ?? null;
      } finally { database.close(); }
    });
    expect(persistedBlueprint).not.toBeNull();
    const stored = persistedBlueprint as BlueprintV1 & { voxels: Array<BlueprintVoxel & { stage?: string }> };
    expect(stored.title).toBe('Propertyless carpets');
    expect(stored.voxels.map(voxel => voxel.sourceBlockId)).toEqual(['minecraft:red_carpet', 'minecraft:moss_carpet']);
    expect(stored.voxels.every(voxel => !Object.hasOwn(voxel, 'sourceBlockState'))).toBe(true);
    const restoredVoxels = stored.voxels.map(raw => { const { stage: _stage, ...voxel } = raw as BlueprintVoxel & { stage?: string }; return voxel; });
    const restoredBlueprint: BlueprintV1 = { ...stored, voxels: restoredVoxels };
    const importedCanvas = await installScene(page, restoredBlueprint);
    await expect(importedCanvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/, { timeout: 30_000 });
    const importedRoute = await page.evaluate(() => (window as typeof window & { __originalShapeAudit: VoxelRenderer })
      .__originalShapeAudit.getDiagnostics());
    expect(importedRoute.originalStaticShapeVoxelCount).toBe(2);
    expect(importedRoute.originalStaticShapeBudgetFallbackVoxelCount).toBe(0);
    await importedCanvas.screenshot({ path: testInfo.outputPath('original-propertyless-import-restored-production-route.png') });
    reworkObservations.push({ stage: 'genuine-propertyless-litematic-validated-persisted-restored-production-route',
      import: { entry: 'UI file input → parseLitematic → BlueprintV1 validation → CreateProject validation → actual app IndexedDB save → full reload → IndexedDB read',
        stateIds: stored.voxels.map(voxel => voxel.sourceBlockId), omittedStatesAfterReload: stored.voxels.every(voxel => !Object.hasOwn(voxel, 'sourceBlockState')) },
      renderer: importedRoute,
      sourceStatesStillOmitted: restoredBlueprint.voxels.every(voxel => !Object.hasOwn(voxel, 'sourceBlockState')) });
    const screenshotIndex = readdirSync(testInfo.outputDir).filter(name => name.toLowerCase().endsWith('.png')).map(name => {
      const path = testInfo.outputPath(name); const bytes = readFileSync(path);
      return { name, outputPath: path, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length };
    });
    await testInfo.attach('original-carpet-lever-lantern-screenshot-index', { body: Buffer.from(JSON.stringify(screenshotIndex, null, 2)),
      contentType: 'application/json' });
    await testInfo.attach('original-carpet-lever-lantern-observations', { body: Buffer.from(JSON.stringify({ samples: fixture.samples,
      observations, reworkObservations, shaderErrors, visualViewportScale: await page.evaluate(() => window.visualViewport?.scale ?? 1) }, null, 2)), contentType: 'application/json' });
  } finally {
    await page.evaluate(() => { const target = window as typeof window & { __originalShapeAudit?: VoxelRenderer };
      target.__originalShapeAudit?.dispose(); delete target.__originalShapeAudit;
      delete (target as typeof target & { __originalShapeInputAudit?: unknown }).__originalShapeInputAudit;
      document.querySelector('canvas[aria-label="地毯拉杆灯笼原创形状诊断"]')?.remove(); });
  }
});

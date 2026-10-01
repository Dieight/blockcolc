import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveBlockGeometry, resolveBlockTextures, type BlockTextureManifest, type ResolvedBlockGeometry } from '@blockcolc/resource-pack';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { BlueprintV1, BlueprintVoxel, VoxelRenderer } from '@blockcolc/voxel';
import { fixBusinessDate } from './fixed-business-date';
import { originalStaticShapeForVoxel } from '../../../packages/voxel/src/original-static-shapes';

const PINNED_CLIENT_JAR = resolve(
  process.env.BLOCKCOLC_MC263_CLIENT_JAR
    ?? 'C:/Users/james/AppData/Roaming/.minecraft/versions/26.3/26.3.jar',
);
const PINNED_CLIENT_SHA256 = '4508d006323f24fa02876310c192d739af56516eb259000ac50f0909a68c9a2d';
const RESOURCE_PACK_DATABASE = 'blockcolc-resource-packs-v1';
const BUTTON_FACINGS = ['north', 'east', 'south', 'west'] as const;
const BUTTON_FACES = ['floor', 'wall', 'ceiling'] as const;

type ButtonFace = (typeof BUTTON_FACES)[number];
type ButtonFacing = (typeof BUTTON_FACINGS)[number];
type Sample = Pick<BlueprintVoxel, 'x' | 'y' | 'z' | 'sourceBlockId' | 'sourceBlockState'>;
type GeometrySummary = {
  id: string;
  state: Record<string, string>;
  status: 'resolved_geometry';
  modelId: string;
  elementCount: number;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  faces: string[];
};

function buttonBoard(): { blueprint: BlueprintV1; buttons: Sample[]; directional: Sample[] } {
  const voxels: BlueprintVoxel[] = [];
  const buttons: Sample[] = [];
  const directional: Sample[] = [];
  const floorMinX = -8;
  const floorMaxX = 8;
  for (let z = -4; z <= 6; z += 1) {
    for (let x = floorMinX; x <= floorMaxX; x += 1) {
      voxels.push({ x, y: 0, z, materialId: 'stone', sourceBlockId: 'example:diagnostic_support', buildOrder: 0 });
    }
  }

  const support = (x: number, y: number, z: number) => {
    voxels.push({ x, y, z, materialId: 'stone', sourceBlockId: 'example:diagnostic_support', buildOrder: 0 });
  };
  BUTTON_FACES.forEach((face, row) => {
    BUTTON_FACINGS.forEach((facing, facingIndex) => {
      for (const [pressedIndex, powered] of ['false', 'true'].entries()) {
        const x = (facingIndex * 2 + pressedIndex) * 2 - 7;
        const z = (row - 1) * 2;
        const state = { face, facing, powered };
        const sample: Sample = { x, y: 1, z, sourceBlockId: 'minecraft:stone_button', sourceBlockState: state };
        buttons.push(sample);
        voxels.push({ ...sample, materialId: 'stone', buildOrder: 0 });
        if (face === 'wall') {
          if (facing === 'north') support(x, 1, z + 1);
          else if (facing === 'east') support(x - 1, 1, z);
          else if (facing === 'south') support(x, 1, z - 1);
          else support(x + 1, 1, z);
        }
        if (face === 'ceiling') support(x, 2, z);
      }
    });
  });

  const addDirectional = (x: number, id: string, state: Record<string, string>, materialId: BlueprintVoxel['materialId']) => {
    const sample: Sample = { x, y: 1, z: 5, sourceBlockId: id, sourceBlockState: state };
    directional.push(sample);
    voxels.push({ ...sample, materialId, buildOrder: 0 });
  };
  addDirectional(-6, 'minecraft:oak_log', { axis: 'x' }, 'wood');
  addDirectional(-4, 'minecraft:oak_log', { axis: 'y' }, 'wood');
  addDirectional(-2, 'minecraft:oak_log', { axis: 'z' }, 'wood');
  addDirectional(2, 'minecraft:stripped_spruce_log', { axis: 'x' }, 'wood');
  addDirectional(4, 'minecraft:oak_trapdoor', { facing: 'east', half: 'bottom', open: 'true' }, 'plank');
  addDirectional(6, 'minecraft:observer', { facing: 'up', powered: 'false' }, 'stone');

  const orderedVoxels = voxels.map((voxel, index) => ({
    ...voxel,
    buildOrder: Math.floor(index * 10_000 / Math.max(1, voxels.length - 1)),
  }));
  const blueprint: BlueprintV1 = {
    schemaVersion: 1,
    id: 'blockstate-rotation-client-263-board',
    title: 'Blockstate rotation visual diagnostic',
    bounds: { minX: -8, maxX: 8, minY: 0, maxY: 2, minZ: -4, maxZ: 6 },
    voxels: orderedVoxels,
  };
  assertBlueprintBoundsAndSupports(blueprint, [...buttons, ...directional]);
  return {
    buttons,
    directional,
    blueprint,
  };
}

function assertBlueprintBoundsAndSupports(blueprint: BlueprintV1, samples: readonly Sample[]): void {
  const { minX, maxX, minY, maxY, minZ, maxZ } = blueprint.bounds;
  const coordinates = new Set<string>();
  for (const voxel of blueprint.voxels) {
    expect(Number.isInteger(voxel.x) && voxel.x >= minX && voxel.x <= maxX, `x bound ${voxel.x}`).toBe(true);
    expect(Number.isInteger(voxel.y) && voxel.y >= minY && voxel.y <= maxY, `y bound ${voxel.y}`).toBe(true);
    expect(Number.isInteger(voxel.z) && voxel.z >= minZ && voxel.z <= maxZ, `z bound ${voxel.z}`).toBe(true);
    const key = `${voxel.x},${voxel.y},${voxel.z}`;
    expect(coordinates.has(key), `unique voxel coordinate ${key}`).toBe(false);
    coordinates.add(key);
  }
  const floorCoordinates = new Set(blueprint.voxels.filter(({ y }) => y === 0).map(({ x, z }) => `${x},${z}`));
  for (const sample of samples) {
    expect(floorCoordinates.has(`${sample.x},${sample.z}`), `${sample.sourceBlockId} has a floor support`).toBe(true);
  }
}

function stateFor(sample: Sample): Record<string, string> {
  return sample.sourceBlockState ?? {};
}

function geometrySummary(id: string, state: Record<string, string>, result: ResolvedBlockGeometry): GeometrySummary {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const faces = new Set<string>();
  for (const element of result.elements) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, element.from[axis]!, element.to[axis]!);
      max[axis] = Math.max(max[axis]!, element.from[axis]!, element.to[axis]!);
    }
    for (const face of Object.keys(element.faces)) faces.add(face);
  }
  return { id, state, status: result.status, modelId: result.modelId, elementCount: result.elements.length,
    bounds: { min, max }, faces: [...faces].sort() };
}

function resolveSelectedModelGeometry(manifest: BlockTextureManifest, samples: readonly Sample[]): GeometrySummary[] {
  const results: GeometrySummary[] = [];
  for (const sample of samples) {
    const id = sample.sourceBlockId!;
    const state = stateFor(sample);
    const resolved = resolveBlockGeometry(manifest, id, state, sample);
    expect(resolved.status, `${id} ${JSON.stringify(state)}`).toBe('resolved_geometry');
    if (resolved.status !== 'resolved_geometry') continue;
    results.push(geometrySummary(id, state, resolved));
  }
  return results;
}

function resolveFullCubeTextureSamples(manifest: BlockTextureManifest, samples: readonly Sample[]) {
  return samples.map((sample) => {
    const id = sample.sourceBlockId!;
    const state = stateFor(sample);
    const resolved = resolveBlockTextures(manifest, id, state, sample);
    if (resolved.status !== 'resolved') throw new Error(`Expected full-cube texture resolution for ${id} ${JSON.stringify(state)}.`);
    return { id, state, modelId: resolved.modelId, faces: Object.entries(resolved.faces).sort(([a], [b]) => a.localeCompare(b)) };
  });
}

function officialSelections(manifest: BlockTextureManifest, samples: readonly Sample[]) {
  return samples.map((sample) => {
    const id = sample.sourceBlockId!;
    const state = stateFor(sample);
    const blockState = manifest.blockStates.find((entry) => entry.resourceId === id);
    expect(blockState, `official JAR blockstate ${id}`).toBeDefined();
    const variant = blockState!.variants.find((entry) => (
      Object.keys(entry.conditions).length === Object.keys(state).length
      && Object.entries(entry.conditions).every(([key, value]) => state[key] === value)
    ));
    expect(variant, `official JAR variant ${id} ${JSON.stringify(state)}`).toBeDefined();
    expect(variant!.choices.length).toBeGreaterThan(0);
    return { id, state, variantKey: variant!.key, choices: variant!.choices };
  });
}

function boundsFor(summary: GeometrySummary): { min: number[]; max: number[] } {
  return summary.bounds;
}

function assertButtonMountingAndPressGeometry(buttons: readonly GeometrySummary[]): void {
  const find = (face: ButtonFace, facing: ButtonFacing, powered: boolean) => {
    const selected = buttons.find((entry) => entry.state.face === face && entry.state.facing === facing
      && entry.state.powered === String(powered));
    expect(selected, `${face}/${facing}/${powered}`).toBeDefined();
    return boundsFor(selected!);
  };
  for (const facing of BUTTON_FACINGS) {
    const floor = find('floor', facing, false);
    const pressedFloor = find('floor', facing, true);
    const ceiling = find('ceiling', facing, false);
    const pressedCeiling = find('ceiling', facing, true);
    expect(floor.min[1]).toBe(0);
    expect(ceiling.max[1]).toBe(16);
    expect(floor.max[1]! - floor.min[1]!).toBeGreaterThan(pressedFloor.max[1]! - pressedFloor.min[1]!);
    expect(ceiling.max[1]! - ceiling.min[1]!).toBeGreaterThan(pressedCeiling.max[1]! - pressedCeiling.min[1]!);
  }
  const wallSupportAxis: Record<ButtonFacing, [number, 'min' | 'max']> = {
    north: [2, 'max'], east: [0, 'min'], south: [2, 'min'], west: [0, 'max'],
  };
  for (const facing of BUTTON_FACINGS) {
    const [axis, bound] = wallSupportAxis[facing];
    const unpressed = find('wall', facing, false);
    const pressed = find('wall', facing, true);
    expect(unpressed[bound][axis]).toBe(bound === 'min' ? 0 : 16);
    expect(pressed[bound][axis]).toBe(unpressed[bound][axis]);
    expect(unpressed.max[axis]! - unpressed.min[axis]!).toBeGreaterThan(pressed.max[axis]! - pressed.min[axis]!);
  }
}

async function rotateHalfTurn(page: Page, canvas: Locator): Promise<{ before: number; after: number; gesture: unknown }> {
  const before = Number(await canvas.getAttribute('data-camera-azimuth'));
  const gestureBefore = await canvas.evaluate((element) => (
    (element as HTMLCanvasElement & { __rotationGesture?: Record<string, number> }).__rotationGesture ?? null
  ));
  expect(gestureBefore).not.toBeNull();
  const bounds = (await canvas.boundingBox())!;
  const y = bounds.y + bounds.height * 0.55;
  const delta = Math.PI / 0.011;
  const from = bounds.x + bounds.width / 2 - delta / 2;
  const to = from + delta;
  const point = (x: number) => ({ id: 71, x, y, radiusX: 1, radiusY: 1, force: 1 });
  expect(await canvas.evaluate((element, points) => points.every(({ x, y: pointY }) => (
    document.elementFromPoint(x, pointY) === element
  )), [point(from), point(to)])).toBe(true);
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(from)] });
    for (let step = 1; step <= 12; step += 1) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [point(from + (to - from) * step / 12)],
      });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
  await expect.poll(async () => {
    const after = Number(await canvas.getAttribute('data-camera-azimuth'));
    return Math.abs(angleDistance(after, before) - Math.PI);
  }).toBeLessThan(0.1);
  const gesture = await canvas.evaluate((element) => {
    const audit = (element as HTMLCanvasElement & { __rotationGesture?: Record<string, number> }).__rotationGesture;
    return audit ? { ...audit } : null;
  });
  expect(gesture).not.toBeNull();
  expect(gesture!.down - gestureBefore!.down).toBe(1);
  expect(gesture!.up - gestureBefore!.up).toBe(1);
  expect(gesture!.cancel - gestureBefore!.cancel).toBe(0);
  expect(gesture!.move - gestureBefore!.move).toBe(12);
  return { before, after: Number(await canvas.getAttribute('data-camera-azimuth')), gesture };
}

function angleDistance(left: number, right: number): number {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

async function captureFrame(canvas: Locator, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name);
  await canvas.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function waitForRenderedWorldRebuild(
  page: Page,
  rendererKey: 'main' | 'buttons-only',
  minimumWorldRebuildCount = 1,
): Promise<{ world: number; rendered: number }> {
  const read = () => page.evaluate(({ key, minimum }) => {
    const target = window as typeof window & {
      __blockstateRotationRenderer?: VoxelRenderer;
      __blockstateRotationButtonRouteRenderer?: VoxelRenderer;
    };
    const renderer = key === 'main' ? target.__blockstateRotationRenderer : target.__blockstateRotationButtonRouteRenderer;
    if (!renderer) return null;
    const diagnostics = renderer.getDiagnostics();
    return { world: diagnostics.worldRebuildCount, rendered: diagnostics.renderedWorldRebuildCount,
      ready: diagnostics.worldRebuildCount >= minimum && diagnostics.worldRebuildCount > 0
        && diagnostics.renderedWorldRebuildCount === diagnostics.worldRebuildCount };
  }, { key: rendererKey, minimum: minimumWorldRebuildCount });
  await expect.poll(async () => (await read())?.ready ?? false, { timeout: 30_000 }).toBe(true);
  const diagnostics = await read();
  if (!diagnostics) throw new Error(`Missing ${rendererKey} renderer during frame-commit wait.`);
  return { world: diagnostics.world, rendered: diagnostics.rendered };
}

async function sampleCanvasGlErrors(
  page: Page,
  ariaLabel: string,
  key: string,
): Promise<{ contextAvailable: boolean; samples: number; codes: number[] }> {
  return page.evaluate(({ label, sampleKey }) => {
    const target = window as typeof window & {
      __blockstateRotationGlObservation?: {
        sampleCanvas: (canvas: HTMLCanvasElement, key: string, limit: number) => {
          contextAvailable: boolean; samples: number; codes: number[];
        };
      };
    };
    const canvas = document.querySelector<HTMLCanvasElement>(`canvas[aria-label="${label}"]`);
    if (!canvas || !target.__blockstateRotationGlObservation) {
      return { contextAvailable: false, samples: 0, codes: [] };
    }
    return target.__blockstateRotationGlObservation.sampleCanvas(canvas, sampleKey, 4);
  }, { label: ariaLabel, sampleKey: key });
}

test('compares fixed 26.3 blockstate rotation on the production renderer with real supported-button touch turns', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(!existsSync(PINNED_CLIENT_JAR), 'Pinned Minecraft Java 26.3 client JAR is not available locally.');
  const observations: Record<string, unknown> = {};
  let consoleErrorCount = 0;
  let consoleErrorOverflow = 0;
  const consoleErrorSamples: Array<{ length: number; sha256: string }> = [];
  let pageErrorCount = 0;
  let pageErrorOverflow = 0;
  const pageErrorSamples: Array<{ length: number; sha256: string }> = [];
  try {
  const jarBytes = readFileSync(PINNED_CLIENT_JAR);
  const jarSha256 = createHash('sha256').update(jarBytes).digest('hex');
  observations.sourceIdentity = { sha256: jarSha256, bytes: jarBytes.byteLength };
  expect(jarSha256).toBe(PINNED_CLIENT_SHA256);

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const value = message.text();
      consoleErrorCount += 1;
      if (consoleErrorSamples.length < 8) {
        consoleErrorSamples.push({ length: value.length, sha256: createHash('sha256').update(value).digest('hex') });
      } else consoleErrorOverflow += 1;
    }
  });
  page.on('pageerror', (error) => {
    pageErrorCount += 1;
    if (pageErrorSamples.length < 8) {
      pageErrorSamples.push({ length: error.message.length, sha256: createHash('sha256').update(error.message).digest('hex') });
    } else pageErrorOverflow += 1;
  });
  await page.addInitScript(() => {
    localStorage.setItem('blockcolc-first-project-setup-v1', '1');
  });
  await page.addInitScript(() => {
    const counts: Record<string, number> = {
      shaderCompileCalls: 0, shaderCompileChecks: 0, programLinkChecks: 0, programValidationChecks: 0, glErrorChecks: 0,
      shaderCompileFailures: 0, programLinkFailures: 0, programValidationFailures: 0,
      glErrors: 0, contextLost: 0, contextRestored: 0,
    };
    const samples: Array<{ kind: string; code: number }> = [];
    const canvasSamples: Record<string, { samples: number; codes: number[] }> = {};
    const contexts = new WeakMap<HTMLCanvasElement, WebGLRenderingContext | WebGL2RenderingContext>();
    let overflow = 0;
    const record = (kind: string, code = 0) => {
      counts[kind] = (counts[kind] ?? 0) + 1;
      if (samples.length < 32) samples.push({ kind, code });
      else overflow += 1;
    };
    document.addEventListener('webglcontextlost', () => record('contextLost'), true);
    document.addEventListener('webglcontextrestored', () => record('contextRestored'), true);
    const patch = (prototype: object, method: string, wrap: (original: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown) => {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
      if (!descriptor || typeof descriptor.value !== 'function') return;
      Object.defineProperty(prototype, method, { ...descriptor, value: wrap(descriptor.value as (...args: unknown[]) => unknown) });
    };
    for (const prototype of new Set([WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype])) {
      patch(prototype, 'compileShader', (original) => function (this: WebGLRenderingContext | WebGL2RenderingContext, ...args: unknown[]) {
        counts.shaderCompileCalls += 1;
        return original.apply(this, args);
      });
      patch(prototype, 'getShaderParameter', (original) => function (this: WebGLRenderingContext | WebGL2RenderingContext, ...args: unknown[]) {
        const result = original.apply(this, args);
        if (args[1] === this.COMPILE_STATUS) {
          counts.shaderCompileChecks += 1;
          if (result === false) record('shaderCompileFailures', Number(args[1]));
        }
        return result;
      });
      patch(prototype, 'getProgramParameter', (original) => function (this: WebGLRenderingContext | WebGL2RenderingContext, ...args: unknown[]) {
        const result = original.apply(this, args);
        if (args[1] === this.LINK_STATUS) {
          counts.programLinkChecks += 1;
          if (result === false) record('programLinkFailures', Number(args[1]));
        }
        if (args[1] === this.VALIDATE_STATUS) {
          counts.programValidationChecks += 1;
          if (result === false) record('programValidationFailures', Number(args[1]));
        }
        return result;
      });
      patch(prototype, 'getError', (original) => function (this: WebGLRenderingContext | WebGL2RenderingContext, ...args: unknown[]) {
        const result = Number(original.apply(this, args));
        counts.glErrorChecks += 1;
        if (result !== this.NO_ERROR) record('glErrors', result);
        return result;
      });
    }
    patch(HTMLCanvasElement.prototype, 'getContext', (original) => function (this: HTMLCanvasElement, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (result && typeof result === 'object' && 'getError' in result) {
        contexts.set(this, result as WebGLRenderingContext | WebGL2RenderingContext);
      }
      return result;
    });
    const sampleCanvas = (canvas: HTMLCanvasElement, label: string, requestedLimit: number) => {
      const context = contexts.get(canvas);
      const limit = Math.min(4, Math.max(0, Math.floor(requestedLimit)));
      const codes: number[] = [];
      if (context) {
        for (let index = 0; index < limit; index += 1) codes.push(Number(context.getError()));
      }
      canvasSamples[label] = { samples: codes.length, codes };
      return { contextAvailable: Boolean(context), samples: codes.length, codes };
    };
    (window as typeof window & { __blockstateRotationGlObservation?: unknown }).__blockstateRotationGlObservation = {
      counts, samples, canvasSamples, sampleCanvas, get overflowCount() { return overflow; },
    };
  });
  await fixBusinessDate(page, new Date('2026-09-28T12:00:00+08:00'));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-bootstrap-state', 'ready');
  await page.waitForFunction(() => Boolean((window as typeof window & { __blockcolcVoxelTest?: unknown }).__blockcolcVoxelTest));
  const fixture = buttonBoard();
  const buttonOnlyBlueprint: BlueprintV1 = {
    ...fixture.blueprint,
    id: `${fixture.blueprint.id}-buttons-only`,
    voxels: fixture.blueprint.voxels.filter((voxel) => (
      voxel.sourceBlockId === 'minecraft:stone_button' || voxel.sourceBlockId === 'example:diagnostic_support'
    )),
  };
  assertBlueprintBoundsAndSupports(buttonOnlyBlueprint, fixture.buttons);
  const buttonOnlySupportVoxelCount = buttonOnlyBlueprint.voxels.length - fixture.buttons.length;
  const originalShapeSamples = [
    ...fixture.buttons,
    ...fixture.directional.filter((sample) => sample.sourceBlockId === 'minecraft:oak_trapdoor'),
  ];
  const fullCubeTextureSamples = fixture.directional.filter((sample) => sample.sourceBlockId !== 'minecraft:oak_trapdoor');
  expect(fixture.buttons).toHaveLength(24);
  expect(originalShapeSamples).toHaveLength(25);
  expect([...new Set(originalShapeSamples.map((sample) => sample.sourceBlockId))].sort())
    .toEqual(['minecraft:oak_trapdoor', 'minecraft:stone_button']);
  expect(originalShapeSamples.every((sample) => (
    originalStaticShapeForVoxel(sample).kind === 'original-approximation'
  ))).toBe(true);
  expect(fullCubeTextureSamples.every((sample) => (
    originalStaticShapeForVoxel(sample).kind === 'cube-fallback'
  ))).toBe(true);
  expect(fullCubeTextureSamples).toHaveLength(5);
  const world = { projectId: fixture.blueprint.id, blueprintId: fixture.blueprint.id,
    buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000,
    isMonument: false, settlementIndex: 0 };
  await page.evaluate(({ blueprint, world: initialWorld }) => {
    const target = window as typeof window & {
      __blockcolcVoxelTest: typeof import('@blockcolc/voxel');
      __blockstateRotationRenderer?: VoxelRenderer;
    };
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', 'Blockstate rotation renderer diagnostic');
    // Match production world and blueprint-preview hit policy for real CDP input.
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9999;touch-action:none';
    const gesture = { down: 0, move: 0, up: 0, cancel: 0 };
    canvas.addEventListener('pointerdown', () => { gesture.down += 1; });
    canvas.addEventListener('pointermove', () => { gesture.move += 1; });
    canvas.addEventListener('pointerup', () => { gesture.up += 1; });
    canvas.addEventListener('pointercancel', () => { gesture.cancel += 1; });
    Object.assign(canvas, { __rotationGesture: gesture });
    document.body.append(canvas);
    const renderer = target.__blockcolcVoxelTest.createVoxelRenderer(canvas,
      { blueprint, previewMode: true, lightingQuality: 'balanced', worldSeed: 'fixed-26.3-blockstate-board' });
    renderer.setReducedMotion(true);
    renderer.setWorld(initialWorld);
    renderer.setEnvironmentDebugOverride({ date: new Date().getTime(),
      weather: { kind: 'clear', cloudIntensity: 0, precipitationIntensity: 0 } });
    target.__blockstateRotationRenderer = renderer;
  }, { blueprint: fixture.blueprint, world });

  const canvas = page.getByLabel('Blockstate rotation renderer diagnostic');
    await expect(canvas).toHaveAttribute('data-first-nonempty-frame-ms', /\d/);
    const originalRebuild = await waitForRenderedWorldRebuild(page, 'main');
    const originalMainGlSample = await sampleCanvasGlErrors(page, 'Blockstate rotation renderer diagnostic', 'main');
    expect(originalMainGlSample.contextAvailable).toBe(true);
    expect(originalMainGlSample.samples).toBe(4);
    observations.webglCanvasSamples = { main: originalMainGlSample };
    const originalDiagnostics = await page.evaluate(() => {
      const diagnostics = (window as typeof window & { __blockstateRotationRenderer: VoxelRenderer })
        .__blockstateRotationRenderer.getDiagnostics();
      return {
        activeResourcePackId: diagnostics.activeResourcePackId,
        originalStaticShapeVoxelCount: diagnostics.originalStaticShapeVoxelCount,
        geometryVoxelCount: diagnostics.geometryVoxelCount,
        fallbackVoxelCount: diagnostics.fallbackVoxelCount,
        atlasPageCount: diagnostics.atlasPageCount,
        firstNonemptyFrameMs: diagnostics.firstNonemptyFrameMs,
      };
    });
    expect(originalDiagnostics.activeResourcePackId).toBeNull();
    expect(originalDiagnostics.originalStaticShapeVoxelCount).toBe(originalShapeSamples.length);
    expect(originalDiagnostics.geometryVoxelCount).toBe(0);
    expect(originalDiagnostics.fallbackVoxelCount).toBe(0);
    expect(originalDiagnostics.atlasPageCount).toBe(0);
    observations.originalDiagnostics = originalDiagnostics;
    observations.originalRebuild = originalRebuild;
    observations.originalShapeSamples = originalShapeSamples.map((sample) => ({
      id: sample.sourceBlockId, state: sample.sourceBlockState,
    }));
    await captureFrame(canvas, testInfo, 'original-no-pack-front.png');
    const originalTurn = await rotateHalfTurn(page, canvas);
    observations.originalTurn = originalTurn;
    await captureFrame(canvas, testInfo, 'original-no-pack-opposite.png');
    await canvas.evaluate((element) => { element.style.pointerEvents = 'none'; element.style.opacity = '0'; });
    await page.evaluate(() => (window as typeof window & { __blockstateRotationRenderer: VoxelRenderer })
      .__blockstateRotationRenderer.setVisible(false));

    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByLabel('导入 Java 资源包 ZIP').setInputFiles(PINNED_CLIENT_JAR);
    await expect(page.locator('.resource-pack-panel .backup-notice'))
      .toContainText('已导入并启用', { timeout: 150_000 });
    const selectedPack = await page.evaluate(async (databaseName) => {
      const database = await new Promise<IDBDatabase>((resolveDatabase, rejectDatabase) => {
        const request = indexedDB.open(databaseName, 1);
        request.onsuccess = () => resolveDatabase(request.result);
        request.onerror = () => rejectDatabase(request.error);
      });
      try {
        const transaction = database.transaction(['metadata', 'resourcePacks'], 'readonly');
        const active = await new Promise<{ packId: string | null }>((resolveRecord, rejectRecord) => {
          const request = transaction.objectStore('metadata').get('active-pack');
          request.onsuccess = () => resolveRecord(request.result as { packId: string | null });
          request.onerror = () => rejectRecord(request.error);
        });
        if (!active?.packId) throw new Error('The imported client JAR did not become the active resource pack.');
        const record = await new Promise<{ id: string; manifest: any; archive: Uint8Array }>((resolveRecord, rejectRecord) => {
          const request = transaction.objectStore('resourcePacks').get(active.packId!);
          request.onsuccess = () => resolveRecord(request.result as { id: string; manifest: any; archive: Uint8Array });
          request.onerror = () => rejectRecord(request.error);
        });
        if (!record?.manifest || record.id !== active.packId) throw new Error('The selected parsed manifest is missing.');
        const wanted = new Set(['minecraft:stone_button', 'minecraft:oak_log', 'minecraft:stripped_spruce_log', 'minecraft:oak_trapdoor', 'minecraft:observer']);
        const blockStates = record.manifest.blockStates.filter((entry: { resourceId: string }) => wanted.has(entry.resourceId));
        const modelById = new Map<string, any>(record.manifest.models.map((model: any) => [model.resourceId, model]));
        const neededModels = new Map<string, any>();
        const pending = blockStates.flatMap((entry: any) => [
          ...entry.variants.flatMap((variant: any) => variant.choices.map((choice: any) => choice.model)),
          ...(entry.multipart ?? []).flatMap((part: any) => part.apply.map((choice: any) => choice.model)),
        ]);
        while (pending.length > 0) {
          const modelId = pending.pop()!;
          const model = modelById.get(modelId);
          if (!model || neededModels.has(modelId)) continue;
          neededModels.set(modelId, model);
          if (model.parent) pending.push(model.parent);
        }
        return {
          id: record.id,
          packFormat: record.manifest.pack.packFormat,
          archiveFileCount: record.manifest.summary.archiveFileCount,
          textureCount: record.manifest.textures.length,
          blockStateCount: record.manifest.blockStates.length,
          modelCount: record.manifest.models.length,
          issues: record.manifest.summary.issues.length,
          selectedBlockStateCount: blockStates.length,
          selectedModelCount: neededModels.size,
          geometryManifest: {
            blockStates,
            models: [...neededModels.values()],
            textures: record.manifest.textures.map((texture: { resourceId: string }) => ({ resourceId: texture.resourceId })),
          },
          importedArchiveByteLength: record.archive.byteLength,
        };
      } finally {
        database.close();
      }
    }, RESOURCE_PACK_DATABASE);
    expect(selectedPack.importedArchiveByteLength).toBe(jarBytes.byteLength);
    expect(selectedPack.archiveFileCount).toBeGreaterThan(0);
    expect(selectedPack.selectedBlockStateCount).toBe(5);
    expect(selectedPack.selectedModelCount).toBeGreaterThan(0);
    observations.sourceSummary = {
      sha256: jarSha256, bytes: jarBytes.byteLength, packFormat: selectedPack.packFormat,
      archiveFileCount: selectedPack.archiveFileCount, textureCount: selectedPack.textureCount,
      blockStateCount: selectedPack.blockStateCount, modelCount: selectedPack.modelCount,
      parserIssueCount: selectedPack.issues, selectedBlockStateCount: selectedPack.selectedBlockStateCount,
      selectedModelCount: selectedPack.selectedModelCount,
    };

    const buttonSamples = fixture.buttons;
    const directionalSamples = fixture.directional;
    const selections = officialSelections(selectedPack.geometryManifest, [...buttonSamples, ...directionalSamples]);
    const findSelection = (id: string, state: Record<string, string>) => selections.find((entry) => (
      entry.id === id && Object.entries(state).every(([key, value]) => entry.state[key] === value)
    ))!;
    expect(findSelection('minecraft:stone_button', { face: 'wall', facing: 'north', powered: 'false' }).choices[0])
      .toMatchObject({ x: 90, y: 0 });
    expect(findSelection('minecraft:stone_button', { face: 'wall', facing: 'east', powered: 'false' }).choices[0])
      .toMatchObject({ x: 90, y: 90 });
    expect(findSelection('minecraft:stone_button', { face: 'ceiling', facing: 'east', powered: 'false' }).choices[0])
      .toMatchObject({ x: 180, y: 270 });
    expect(findSelection('minecraft:oak_log', { axis: 'x' }).choices[0]).toMatchObject({ x: 90, y: 90 });
    expect(findSelection('minecraft:observer', { facing: 'up', powered: 'false' }).choices[0])
      .toMatchObject({ x: 270, y: 0 });
    const geometry = resolveSelectedModelGeometry(selectedPack.geometryManifest, [...buttonSamples, ...directionalSamples]);
    const genericTextureSelections = resolveFullCubeTextureSamples(selectedPack.geometryManifest, fullCubeTextureSamples);
    expect(genericTextureSelections).toHaveLength(5);
    for (const selection of genericTextureSelections) {
      expect(new Set(selection.faces.map(([face]) => face)).size, `${selection.id} resolved texture faces`).toBe(6);
    }
    observations.officialSelections = selections;
    observations.geometry = geometry;
    observations.genericTextureSelections = genericTextureSelections;
    const buttonGeometry = geometry.filter((entry) => entry.id === 'minecraft:stone_button');
    assertButtonMountingAndPressGeometry(buttonGeometry);
    const compositeStateKeys = [
      ['minecraft:stone_button', { face: 'wall', facing: 'east', powered: 'false' }],
      ['minecraft:stone_button', { face: 'wall', facing: 'east', powered: 'true' }],
      ['minecraft:stone_button', { face: 'ceiling', facing: 'east', powered: 'false' }],
      ['minecraft:stone_button', { face: 'ceiling', facing: 'east', powered: 'true' }],
      ['minecraft:oak_log', { axis: 'x' }],
      ['minecraft:stripped_spruce_log', { axis: 'x' }],
    ] as const;
    const compositeCases = compositeStateKeys.map(([id, state]) => {
      const matches = geometry.filter((entry) => entry.id === id
        && Object.entries(state).every(([key, value]) => entry.state[key] === value));
      expect(matches, `unique composite sample ${id} ${JSON.stringify(state)}`).toHaveLength(1);
      return matches[0]!;
    });
    expect(new Set(compositeCases.map((entry) => `${entry.id}:${JSON.stringify(entry.state)}`)).size)
      .toBe(compositeStateKeys.length);
    expect(geometry.some((entry) => entry.id === 'minecraft:observer' && entry.state.facing === 'up'
      && entry.modelId.length > 0)).toBe(true);

  const buttonOnlySetup = await page.evaluate(async ({ databaseName, packId, blueprint, world: initialWorld }) => {
      const database = await new Promise<IDBDatabase>((resolveDatabase, rejectDatabase) => {
        const request = indexedDB.open(databaseName, 1);
        request.onsuccess = () => resolveDatabase(request.result);
        request.onerror = () => rejectDatabase(request.error);
      });
      try {
        const transaction = database.transaction('resourcePacks', 'readonly');
        const record = await new Promise<{ id: string; manifest: any }>((resolveRecord, rejectRecord) => {
          const request = transaction.objectStore('resourcePacks').get(packId);
          request.onsuccess = () => resolveRecord(request.result as { id: string; manifest: any });
          request.onerror = () => rejectRecord(request.error);
        });
        const target = window as typeof window & {
          __blockcolcVoxelTest: typeof import('@blockcolc/voxel');
          __blockstateRotationButtonRouteRenderer?: VoxelRenderer;
        };
        const routeCanvas = document.createElement('canvas');
        routeCanvas.setAttribute('aria-label', 'Blockstate rotation buttons-only route diagnostic');
        // This renderer is route-count-only, never used as visual evidence.
        routeCanvas.style.cssText = 'position:fixed;left:-2px;top:-2px;width:1px;height:1px;opacity:0;pointer-events:none';
        document.body.append(routeCanvas);
        const renderer = target.__blockcolcVoxelTest.createVoxelRenderer(routeCanvas,
          { blueprint, previewMode: true, lightingQuality: 'balanced', worldSeed: 'fixed-26.3-buttons-only-route' });
        renderer.setReducedMotion(true);
        renderer.setWorld({ ...initialWorld, blueprintId: blueprint.id });
        await renderer.setResourcePack({ id: record.id, manifest: record.manifest });
        renderer.setVisible(true);
        (window as typeof window & { __blockstateRotationButtonRouteRenderer?: VoxelRenderer })
          .__blockstateRotationButtonRouteRenderer = renderer;
        return { id: record.id, worldRebuildCount: renderer.getDiagnostics().worldRebuildCount,
          fullManifestBlockStateCount: record.manifest.blockStates.length,
          fullManifestModelCount: record.manifest.models.length };
      } finally {
        database.close();
      }
    }, { databaseName: RESOURCE_PACK_DATABASE, packId: selectedPack.id,
      blueprint: buttonOnlyBlueprint, world });
    observations.buttonOnlyFullManifest = {
      packId: buttonOnlySetup.id,
      importedManifestBlockStateCount: buttonOnlySetup.fullManifestBlockStateCount,
      importedManifestModelCount: buttonOnlySetup.fullManifestModelCount,
      scope: 'complete active manifest read from the actual imported JAR database record',
    };
    await waitForRenderedWorldRebuild(page, 'buttons-only', buttonOnlySetup.worldRebuildCount);
    const buttonsOnlyGlSample = await sampleCanvasGlErrors(page,
      'Blockstate rotation buttons-only route diagnostic', 'buttons-only');
    expect(buttonsOnlyGlSample.contextAvailable).toBe(true);
    expect(buttonsOnlyGlSample.samples).toBe(4);
    observations.webglCanvasSamples = { main: originalMainGlSample, 'buttons-only': buttonsOnlyGlSample };
    const buttonOnlyFullManifestDiagnostics = await page.evaluate(() => {
      const renderer = (window as typeof window & { __blockstateRotationButtonRouteRenderer: VoxelRenderer })
        .__blockstateRotationButtonRouteRenderer;
      const diagnostics = renderer.getDiagnostics();
      return {
        activeResourcePackId: diagnostics.activeResourcePackId,
        geometryVoxelCount: diagnostics.geometryVoxelCount,
        naturalFlowerPackPlacementCount: diagnostics.naturalFlowerPackPlacementCount,
        naturalFlowerOriginalFallbackCount: diagnostics.naturalFlowerOriginalFallbackCount,
        texturedVoxelCount: diagnostics.texturedVoxelCount,
        geometrySignatureBatchCount: diagnostics.geometrySignatureBatchCount,
        originalStaticShapeVoxelCount: diagnostics.originalStaticShapeVoxelCount,
        fallbackVoxelCount: diagnostics.fallbackVoxelCount,
        atlasPageCount: diagnostics.atlasPageCount,
        worldRebuildCount: diagnostics.worldRebuildCount,
        renderedWorldRebuildCount: diagnostics.renderedWorldRebuildCount,
      };
    });
    observations.buttonOnlyFullManifestDiagnostics = buttonOnlyFullManifestDiagnostics;
    expect(buttonOnlyFullManifestDiagnostics.activeResourcePackId).toBe(selectedPack.id);
    // Small blueprint previews deliberately exclude main-world biome scenery.
    // The complete manifest must route every button, without ambient flowers
    // contaminating the route count of this isolated fixture.
    expect(buttonOnlyFullManifestDiagnostics.geometryVoxelCount).toBe(fixture.buttons.length);
    expect(buttonOnlyFullManifestDiagnostics.naturalFlowerPackPlacementCount).toBe(0);
    expect(buttonOnlyFullManifestDiagnostics.naturalFlowerOriginalFallbackCount).toBe(0);
    expect(buttonOnlyFullManifestDiagnostics.geometryVoxelCount - buttonOnlyFullManifestDiagnostics.naturalFlowerPackPlacementCount)
      .toBe(fixture.buttons.length);

    const buttonsOnlyLimitedPack = await page.evaluate(async ({ packId, databaseName }) => {
      const renderer = (window as typeof window & { __blockstateRotationButtonRouteRenderer: VoxelRenderer })
        .__blockstateRotationButtonRouteRenderer;
      const database = await new Promise<IDBDatabase>((resolveDatabase, rejectDatabase) => {
        const request = indexedDB.open(databaseName, 1);
        request.onsuccess = () => resolveDatabase(request.result);
        request.onerror = () => rejectDatabase(request.error);
      });
      try {
        const transaction = database.transaction('resourcePacks', 'readonly');
        const record = await new Promise<{ id: string; manifest: any }>((resolveRecord, rejectRecord) => {
          const request = transaction.objectStore('resourcePacks').get(packId);
          request.onsuccess = () => resolveRecord(request.result as { id: string; manifest: any });
          request.onerror = () => rejectRecord(request.error);
        });
        const wanted = new Set(['minecraft:stone_button']);
        const blockStates = record.manifest.blockStates.filter((entry: { resourceId: string }) => wanted.has(entry.resourceId));
        const modelById = new Map<string, any>(record.manifest.models.map((model: any) => [model.resourceId, model]));
        const neededModels = new Map<string, any>();
        const pending: string[] = blockStates.flatMap((entry: any) => [
          ...entry.variants.flatMap((variant: any) => variant.choices.map((choice: any) => choice.model)),
          ...(entry.multipart ?? []).flatMap((part: any) => part.apply.map((choice: any) => choice.model)),
        ]);
        while (pending.length > 0) {
          const modelId = pending.pop()!;
          const model = modelById.get(modelId);
          if (!model || neededModels.has(modelId)) continue;
          neededModels.set(modelId, model);
          if (model.parent) pending.push(model.parent);
        }
        const manifest = { ...record.manifest, blockStates, models: [...neededModels.values()] };
        if (blockStates.length !== 1) throw new Error('Expected exactly the official stone_button blockstate.');
        await renderer.setResourcePack({ id: `${record.id}:rotation-buttons-only`, manifest });
        renderer.setVisible(true);
        return { id: `${record.id}:rotation-buttons-only`, worldRebuildCount: renderer.getDiagnostics().worldRebuildCount,
          blockStateCount: blockStates.length, modelCount: neededModels.size,
          textureCount: record.manifest.textures.length };
      } finally {
        database.close();
      }
    }, { databaseName: RESOURCE_PACK_DATABASE, packId: selectedPack.id });
    await waitForRenderedWorldRebuild(page, 'buttons-only', buttonsOnlyLimitedPack.worldRebuildCount);
    const buttonOnlyDiagnostics = await page.evaluate(() => {
      const renderer = (window as typeof window & { __blockstateRotationButtonRouteRenderer: VoxelRenderer })
        .__blockstateRotationButtonRouteRenderer;
      const diagnostics = renderer.getDiagnostics();
      return {
        activeResourcePackId: diagnostics.activeResourcePackId,
        geometryVoxelCount: diagnostics.geometryVoxelCount,
        naturalFlowerPackPlacementCount: diagnostics.naturalFlowerPackPlacementCount,
        naturalFlowerOriginalFallbackCount: diagnostics.naturalFlowerOriginalFallbackCount,
        texturedVoxelCount: diagnostics.texturedVoxelCount,
        geometrySignatureBatchCount: diagnostics.geometrySignatureBatchCount,
        originalStaticShapeVoxelCount: diagnostics.originalStaticShapeVoxelCount,
        fallbackVoxelCount: diagnostics.fallbackVoxelCount,
        atlasPageCount: diagnostics.atlasPageCount,
        worldRebuildCount: diagnostics.worldRebuildCount,
        renderedWorldRebuildCount: diagnostics.renderedWorldRebuildCount,
      };
    });
    observations.buttonOnlyManifest = { packId: buttonsOnlyLimitedPack.id,
      blockStateCount: buttonsOnlyLimitedPack.blockStateCount, modelCount: buttonsOnlyLimitedPack.modelCount,
      textureCount: buttonsOnlyLimitedPack.textureCount, source: 'parsed imported pinned JAR manifest with complete model-parent closure' };
    observations.buttonOnlyDiagnostics = buttonOnlyDiagnostics;
    expect(buttonOnlyDiagnostics.activeResourcePackId).toBe(buttonsOnlyLimitedPack.id);
    expect(buttonOnlyDiagnostics.geometryVoxelCount).toBe(fixture.buttons.length);
    expect(buttonOnlyDiagnostics.texturedVoxelCount).toBe(fixture.buttons.length);
    expect(buttonOnlyDiagnostics.geometrySignatureBatchCount).toBeGreaterThan(0);
    expect(buttonOnlyDiagnostics.geometrySignatureBatchCount).toBeLessThanOrEqual(64);
    expect(buttonOnlyDiagnostics.originalStaticShapeVoxelCount).toBe(0);
    expect(buttonOnlyDiagnostics.fallbackVoxelCount).toBe(buttonOnlySupportVoxelCount);
    expect(buttonOnlyDiagnostics.naturalFlowerPackPlacementCount).toBe(0);
    expect(buttonOnlyDiagnostics.naturalFlowerOriginalFallbackCount).toBe(0);
    expect(buttonOnlyDiagnostics.atlasPageCount).toBeGreaterThan(0);

    const packedDiagnostics = await page.evaluate(async ({ packId, databaseName }) => {
      const renderer = (window as typeof window & { __blockstateRotationRenderer: VoxelRenderer })
        .__blockstateRotationRenderer;
      const before = renderer.getDiagnostics().worldRebuildCount;
      const database = await new Promise<IDBDatabase>((resolveDatabase, rejectDatabase) => {
        const request = indexedDB.open(databaseName, 1);
        request.onsuccess = () => resolveDatabase(request.result);
        request.onerror = () => rejectDatabase(request.error);
      });
      try {
        const transaction = database.transaction('resourcePacks', 'readonly');
        const record = await new Promise<{ id: string; manifest: any }>((resolveRecord, rejectRecord) => {
          const request = transaction.objectStore('resourcePacks').get(packId);
          request.onsuccess = () => resolveRecord(request.result as { id: string; manifest: any });
          request.onerror = () => rejectRecord(request.error);
        });
        await renderer.setResourcePack({ id: record.id, manifest: record.manifest });
        renderer.setVisible(true);
        const diagnostics = renderer.getDiagnostics();
        return {
          beforeWorldRebuildCount: before,
          activeResourcePackId: diagnostics.activeResourcePackId,
          atlasPageCount: diagnostics.atlasPageCount,
          texturedVoxelCount: diagnostics.texturedVoxelCount,
          geometryVoxelCount: diagnostics.geometryVoxelCount,
          geometrySignatureBatchCount: diagnostics.geometrySignatureBatchCount,
          geometryElementInstanceCount: diagnostics.geometryElementInstanceCount,
          geometryQuadInstanceCount: diagnostics.geometryQuadInstanceCount,
          naturalFlowerPackPlacementCount: diagnostics.naturalFlowerPackPlacementCount,
          naturalFlowerOriginalFallbackCount: diagnostics.naturalFlowerOriginalFallbackCount,
          originalStaticShapeVoxelCount: diagnostics.originalStaticShapeVoxelCount,
          fallbackVoxelCount: diagnostics.fallbackVoxelCount,
          worldRebuildCount: diagnostics.worldRebuildCount,
          renderedWorldRebuildCount: diagnostics.renderedWorldRebuildCount,
        };
      } finally {
        database.close();
      }
    }, { packId: selectedPack.id, databaseName: RESOURCE_PACK_DATABASE });
    await canvas.evaluate((element) => { element.style.pointerEvents = 'auto'; element.style.opacity = '1'; });
    await waitForRenderedWorldRebuild(page, 'main', packedDiagnostics.worldRebuildCount);
    const packedCommittedDiagnostics = await page.evaluate(() => {
      const diagnostics = (window as typeof window & { __blockstateRotationRenderer: VoxelRenderer })
        .__blockstateRotationRenderer.getDiagnostics();
      return {
        activeResourcePackId: diagnostics.activeResourcePackId,
        atlasPageCount: diagnostics.atlasPageCount,
        texturedVoxelCount: diagnostics.texturedVoxelCount,
        geometryVoxelCount: diagnostics.geometryVoxelCount,
        geometrySignatureBatchCount: diagnostics.geometrySignatureBatchCount,
        geometryElementInstanceCount: diagnostics.geometryElementInstanceCount,
        geometryQuadInstanceCount: diagnostics.geometryQuadInstanceCount,
        naturalFlowerPackPlacementCount: diagnostics.naturalFlowerPackPlacementCount,
        naturalFlowerOriginalFallbackCount: diagnostics.naturalFlowerOriginalFallbackCount,
        originalStaticShapeVoxelCount: diagnostics.originalStaticShapeVoxelCount,
        fallbackVoxelCount: diagnostics.fallbackVoxelCount,
        worldRebuildCount: diagnostics.worldRebuildCount,
        renderedWorldRebuildCount: diagnostics.renderedWorldRebuildCount,
      };
    });
    observations.fullManifestMainDiagnostics = packedCommittedDiagnostics;
    expect(packedDiagnostics.worldRebuildCount).toBeGreaterThan(packedDiagnostics.beforeWorldRebuildCount);
    expect(packedCommittedDiagnostics.renderedWorldRebuildCount).toBe(packedCommittedDiagnostics.worldRebuildCount);
    expect(packedCommittedDiagnostics.activeResourcePackId).toBe(selectedPack.id);
    expect(packedCommittedDiagnostics.naturalFlowerPackPlacementCount).toBe(0);
    expect(packedCommittedDiagnostics.naturalFlowerOriginalFallbackCount).toBe(0);
    expect(packedCommittedDiagnostics.geometryVoxelCount).toBe(originalShapeSamples.length
      + packedCommittedDiagnostics.naturalFlowerPackPlacementCount);
    expect(packedCommittedDiagnostics.geometryVoxelCount - packedCommittedDiagnostics.naturalFlowerPackPlacementCount)
      .toBe(originalShapeSamples.length);

    const limitedPackedSetup = await page.evaluate(async ({ packId, databaseName }) => {
      const renderer = (window as typeof window & { __blockstateRotationRenderer: VoxelRenderer })
        .__blockstateRotationRenderer;
      const database = await new Promise<IDBDatabase>((resolveDatabase, rejectDatabase) => {
        const request = indexedDB.open(databaseName, 1);
        request.onsuccess = () => resolveDatabase(request.result);
        request.onerror = () => rejectDatabase(request.error);
      });
      try {
        const transaction = database.transaction('resourcePacks', 'readonly');
        const record = await new Promise<{ id: string; manifest: any }>((resolveRecord, rejectRecord) => {
          const request = transaction.objectStore('resourcePacks').get(packId);
          request.onsuccess = () => resolveRecord(request.result as { id: string; manifest: any });
          request.onerror = () => rejectRecord(request.error);
        });
        const wanted = new Set(['minecraft:stone_button', 'minecraft:oak_log', 'minecraft:stripped_spruce_log',
          'minecraft:oak_trapdoor', 'minecraft:observer']);
        const blockStates = record.manifest.blockStates.filter((entry: { resourceId: string }) => wanted.has(entry.resourceId));
        if (blockStates.length !== wanted.size) throw new Error('The imported manifest is missing a selected diagnostic blockstate.');
        const modelById = new Map<string, any>(record.manifest.models.map((model: any) => [model.resourceId, model]));
        const neededModels = new Map<string, any>();
        const pending: string[] = blockStates.flatMap((entry: any) => [
          ...entry.variants.flatMap((variant: any) => variant.choices.map((choice: any) => choice.model)),
          ...(entry.multipart ?? []).flatMap((part: any) => part.apply.map((choice: any) => choice.model)),
        ]);
        while (pending.length > 0) {
          const modelId = pending.pop()!;
          const model = modelById.get(modelId);
          if (!model || neededModels.has(modelId)) continue;
          neededModels.set(modelId, model);
          if (model.parent) pending.push(model.parent);
        }
        const manifest = { ...record.manifest, blockStates, models: [...neededModels.values()] };
        await renderer.setResourcePack({ id: `${record.id}:rotation-five-blocks`, manifest });
        renderer.setVisible(true);
        return { id: `${record.id}:rotation-five-blocks`, blockStateCount: blockStates.length,
          modelCount: neededModels.size, textureCount: record.manifest.textures.length,
          worldRebuildCount: renderer.getDiagnostics().worldRebuildCount };
      } finally {
        database.close();
      }
    }, { packId: selectedPack.id, databaseName: RESOURCE_PACK_DATABASE });
    await waitForRenderedWorldRebuild(page, 'main', limitedPackedSetup.worldRebuildCount);
    observations.packedManifest = { packId: limitedPackedSetup.id,
      blockStateCount: limitedPackedSetup.blockStateCount, modelCount: limitedPackedSetup.modelCount,
      textureCount: limitedPackedSetup.textureCount,
      source: 'parsed imported pinned JAR manifest: five selected blockstates with complete model-parent closure and original texture table' };
    const limitedPackedDiagnostics = await page.evaluate(() => {
      const diagnostics = (window as typeof window & { __blockstateRotationRenderer: VoxelRenderer })
        .__blockstateRotationRenderer.getDiagnostics();
      return { activeResourcePackId: diagnostics.activeResourcePackId,
        atlasPageCount: diagnostics.atlasPageCount,
        texturedVoxelCount: diagnostics.texturedVoxelCount,
        geometryVoxelCount: diagnostics.geometryVoxelCount,
        geometrySignatureBatchCount: diagnostics.geometrySignatureBatchCount,
        geometryElementInstanceCount: diagnostics.geometryElementInstanceCount,
        geometryQuadInstanceCount: diagnostics.geometryQuadInstanceCount,
        naturalFlowerPackPlacementCount: diagnostics.naturalFlowerPackPlacementCount,
        naturalFlowerOriginalFallbackCount: diagnostics.naturalFlowerOriginalFallbackCount,
        originalStaticShapeVoxelCount: diagnostics.originalStaticShapeVoxelCount,
        fallbackVoxelCount: diagnostics.fallbackVoxelCount,
        worldRebuildCount: diagnostics.worldRebuildCount,
        renderedWorldRebuildCount: diagnostics.renderedWorldRebuildCount };
    });
    observations.packedDiagnostics = limitedPackedDiagnostics;
    expect(limitedPackedDiagnostics.renderedWorldRebuildCount).toBe(limitedPackedDiagnostics.worldRebuildCount);
    expect(limitedPackedDiagnostics.activeResourcePackId).toBe(limitedPackedSetup.id);
    expect(limitedPackedDiagnostics.geometryVoxelCount).toBe(originalShapeSamples.length);
    expect(limitedPackedDiagnostics.texturedVoxelCount).toBe(originalShapeSamples.length + fullCubeTextureSamples.length);
    expect(limitedPackedDiagnostics.naturalFlowerPackPlacementCount).toBe(0);
    expect(limitedPackedDiagnostics.naturalFlowerOriginalFallbackCount).toBe(0);
    expect(limitedPackedDiagnostics.originalStaticShapeVoxelCount).toBe(0);
    expect(limitedPackedDiagnostics.fallbackVoxelCount).toBe(buttonOnlySupportVoxelCount);
    expect(limitedPackedDiagnostics.atlasPageCount).toBeGreaterThan(0);
    expect(limitedPackedDiagnostics.atlasPageCount).toBeLessThanOrEqual(4);
    expect(limitedPackedDiagnostics.geometrySignatureBatchCount).toBeGreaterThan(0);
    expect(limitedPackedDiagnostics.geometrySignatureBatchCount).toBeLessThanOrEqual(64);
    const packedMainGlSample = await sampleCanvasGlErrors(page,
      'Blockstate rotation renderer diagnostic', 'packed-main');
    expect(packedMainGlSample).toMatchObject({ contextAvailable: true, samples: 4, codes: [0, 0, 0, 0] });
    observations.packedMainGlSample = packedMainGlSample;
    expect(angleDistance(Number(await canvas.getAttribute('data-camera-azimuth')), originalTurn.after)).toBeLessThan(0.05);
    await expect(canvas).toHaveAttribute('data-active-resource-pack-id', limitedPackedSetup.id);
    await expect.poll(async () => Number(await canvas.getAttribute('data-geometry-voxel-count')))
      .toBe(originalShapeSamples.length);
    await captureFrame(canvas, testInfo, 'pinned-26.3-pack-opposite.png');
    const packedTurn = await rotateHalfTurn(page, canvas);
    observations.packedTurn = packedTurn;
    expect(angleDistance(packedTurn.after, originalTurn.before)).toBeLessThan(0.05);
    await captureFrame(canvas, testInfo, 'pinned-26.3-pack-front.png');

    const restoredDiagnostics = await page.evaluate(async () => {
      const renderer = (window as typeof window & { __blockstateRotationRenderer: VoxelRenderer }).__blockstateRotationRenderer;
      const before = renderer.getDiagnostics().worldRebuildCount;
      await renderer.setResourcePack(null);
      const diagnostics = renderer.getDiagnostics();
      return { beforeWorldRebuildCount: before, activeResourcePackId: diagnostics.activeResourcePackId,
        geometryVoxelCount: diagnostics.geometryVoxelCount,
        originalStaticShapeVoxelCount: diagnostics.originalStaticShapeVoxelCount,
        fallbackVoxelCount: diagnostics.fallbackVoxelCount,
        atlasPageCount: diagnostics.atlasPageCount, worldRebuildCount: diagnostics.worldRebuildCount };
    });
    await waitForRenderedWorldRebuild(page, 'main', restoredDiagnostics.worldRebuildCount);
    const restoredCommittedDiagnostics = await page.evaluate(() => {
      const diagnostics = (window as typeof window & { __blockstateRotationRenderer: VoxelRenderer })
        .__blockstateRotationRenderer.getDiagnostics();
      return { activeResourcePackId: diagnostics.activeResourcePackId,
        geometryVoxelCount: diagnostics.geometryVoxelCount,
        originalStaticShapeVoxelCount: diagnostics.originalStaticShapeVoxelCount,
        fallbackVoxelCount: diagnostics.fallbackVoxelCount,
        atlasPageCount: diagnostics.atlasPageCount, worldRebuildCount: diagnostics.worldRebuildCount,
        renderedWorldRebuildCount: diagnostics.renderedWorldRebuildCount };
    });
    expect(restoredDiagnostics.worldRebuildCount).toBeGreaterThan(restoredDiagnostics.beforeWorldRebuildCount);
    expect(restoredCommittedDiagnostics.renderedWorldRebuildCount).toBe(restoredCommittedDiagnostics.worldRebuildCount);
    expect(restoredCommittedDiagnostics.activeResourcePackId).toBeNull();
    expect(restoredCommittedDiagnostics.geometryVoxelCount).toBe(originalDiagnostics.geometryVoxelCount);
    expect(restoredCommittedDiagnostics.originalStaticShapeVoxelCount).toBe(originalDiagnostics.originalStaticShapeVoxelCount);
    expect(restoredCommittedDiagnostics.fallbackVoxelCount).toBe(originalDiagnostics.fallbackVoxelCount);
    expect(restoredCommittedDiagnostics.atlasPageCount).toBe(0);
    observations.restoredDiagnostics = restoredCommittedDiagnostics;
    const restoredMainGlSample = await sampleCanvasGlErrors(page,
      'Blockstate rotation renderer diagnostic', 'restored-main');
    expect(restoredMainGlSample).toMatchObject({ contextAvailable: true, samples: 4, codes: [0, 0, 0, 0] });
    observations.restoredMainGlSample = restoredMainGlSample;
    expect(angleDistance(Number(await canvas.getAttribute('data-camera-azimuth')), originalTurn.before)).toBeLessThan(0.05);
    await captureFrame(canvas, testInfo, 'restored-no-pack-front.png');
    const restoredTurn = await rotateHalfTurn(page, canvas);
    observations.restoredTurn = restoredTurn;
    expect(angleDistance(restoredTurn.after, originalTurn.after)).toBeLessThan(0.05);
    await captureFrame(canvas, testInfo, 'restored-no-pack-opposite.png');
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual({ x: 0, y: 0 });
    const gesture = await canvas.evaluate((element) => (
      (element as HTMLCanvasElement & { __rotationGesture?: Record<string, number> }).__rotationGesture ?? null
    ));
    expect(gesture).toMatchObject({ down: 3, up: 3, move: 36, cancel: 0 });
    expect(consoleErrorCount).toBe(0);
    expect(consoleErrorOverflow).toBe(0);
    expect(pageErrorCount).toBe(0);
    expect(pageErrorOverflow).toBe(0);
    const glObservation = await page.evaluate(() => (
      (window as typeof window & { __blockstateRotationGlObservation?: {
        counts: Record<string, number>; samples: Array<{ kind: string; code: number }>;
        canvasSamples: Record<string, { samples: number; codes: number[] }>; overflowCount: number;
      } }).__blockstateRotationGlObservation ?? null
    ));
    expect(glObservation).not.toBeNull();
    expect(glObservation!.counts.contextLost).toBe(0);
    expect(glObservation!.counts.contextRestored).toBe(0);
    // Three only asks COMPILE_STATUS on a failed-link diagnostic path. Do not
    // force an extra synchronous query into otherwise successful rendering.
    expect(glObservation!.counts.shaderCompileCalls).toBeGreaterThan(0);
    expect(glObservation!.counts.programLinkChecks).toBeGreaterThan(0);
    expect(glObservation!.counts.glErrorChecks).toBeGreaterThanOrEqual(16);
    expect(glObservation!.counts.shaderCompileFailures).toBe(0);
    expect(glObservation!.counts.programLinkFailures).toBe(0);
    expect(glObservation!.counts.programValidationFailures).toBe(0);
    expect(glObservation!.counts.glErrors).toBe(0);
    const failureCounts = ['shaderCompileFailures', 'programLinkFailures', 'programValidationFailures',
      'glErrors', 'contextLost', 'contextRestored'];
    expect(failureCounts.reduce((total, key) => total + glObservation!.counts[key]!, 0)).toBe(0);
    expect(glObservation!.overflowCount).toBe(0);
    expect(glObservation!.canvasSamples.main.samples).toBe(4);
    expect(glObservation!.canvasSamples['buttons-only'].samples).toBe(4);
    expect(glObservation!.canvasSamples['packed-main'].samples).toBe(4);
    expect(glObservation!.canvasSamples['restored-main'].samples).toBe(4);
    expect(await page.evaluate(() => ({
      nativePerformanceNow: /\[native code\]/.test(performance.now.toString()),
      nativeAnimationFrame: /\[native code\]/.test(requestAnimationFrame.toString()),
      fixedDateNow: Date.now(),
    }))).toEqual({ nativePerformanceNow: true, nativeAnimationFrame: true, fixedDateNow: new Date('2026-09-28T12:00:00+08:00').getTime() });

    observations.completed = true;
    observations.touch = { touchAction: await canvas.evaluate((element) => getComputedStyle(element).touchAction), gesture,
      viewportScale: await page.evaluate(() => window.visualViewport?.scale ?? 1),
      scroll: await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY })) };
    observations.screenshots = ['original-no-pack-front.png', 'original-no-pack-opposite.png',
      'pinned-26.3-pack-opposite.png', 'pinned-26.3-pack-front.png',
      'restored-no-pack-front.png', 'restored-no-pack-opposite.png'];
    observations.visuallyReviewed = false;
    observations.shaderVerification = 'Native compile submissions and LINK_STATUS checks observed; COMPILE_STATUS/VALIDATE_STATUS may be unqueried on successful Three programs. No forced shader query or source/log collection.';
    observations.performanceAndAnimationClocks = 'native performance.now() and requestAnimationFrame; Date only fixed';
    observations.scope = 'Production VoxelRenderer on support-backed blockstate board using a parsed pinned local Java 26.3 client JAR. Numeric resolver bounds and isolated button-only geometry counters establish input/route counts, not GPU mesh-position or complete vanilla visual equivalence; root must visually review paired screenshots.';
  } finally {
    let glObservation: { counts: Record<string, number>; samples: Array<{ kind: string; code: number }>;
      canvasSamples: Record<string, { samples: number; codes: number[] }>; overflowCount: number } | null = null;
    try {
      glObservation = await page.evaluate(() => (
        (window as typeof window & { __blockstateRotationGlObservation?: {
          counts: Record<string, number>; samples: Array<{ kind: string; code: number }>;
          canvasSamples: Record<string, { samples: number; codes: number[] }>; overflowCount: number;
        } }).__blockstateRotationGlObservation ?? null
      ));
    } catch {
      observations.glObservationReadUnavailable = true;
    }
    observations.runtimeErrors = {
      console: { count: consoleErrorCount, overflow: consoleErrorOverflow, samples: consoleErrorSamples },
      page: { count: pageErrorCount, overflow: pageErrorOverflow, samples: pageErrorSamples },
      webgl: glObservation,
    };
    try {
      await testInfo.attach('blockstate-rotation-observations', {
        body: Buffer.from(JSON.stringify({ outcome: observations.completed === true ? 'complete' : 'incomplete', ...observations }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      await page.evaluate(() => {
        const target = window as typeof window & {
          __blockstateRotationRenderer?: VoxelRenderer;
          __blockstateRotationButtonRouteRenderer?: VoxelRenderer;
        };
        target.__blockstateRotationRenderer?.dispose();
        target.__blockstateRotationButtonRouteRenderer?.dispose();
        delete target.__blockstateRotationRenderer;
        delete target.__blockstateRotationButtonRouteRenderer;
        document.querySelector('canvas[aria-label="Blockstate rotation renderer diagnostic"]')?.remove();
        document.querySelector('canvas[aria-label="Blockstate rotation buttons-only route diagnostic"]')?.remove();
      }).catch(() => undefined);
    }
  }
});

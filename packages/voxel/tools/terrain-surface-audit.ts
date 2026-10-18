/** Synthetic CPU comparison. Never imported by the App or connected to user data. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { alignWorldsToEnvironment, layoutWorlds } from '../src/renderer';
import { createSteppedTerrainData, settlementSupportHeightForPlacement, type TerrainEnvironmentStyle, type MergedGeometryData } from '../src/terrain';
import { roadCellsForVillage } from '../src/village';
import { precipitationGroundForSurfaces } from '../src/precipitation-ground';
import { createMosaicSeabed } from '../src/mosaic-seabed';
import { mosaicSeed } from '../src/mosaic-terrain';
import { terrainGeometryBytes } from '../src/terrain-cache';
import * as scenery from '../src/scenery';
import { surfaceIndexBytes } from '../src/surface-index';
import type { BlueprintV1 } from '../src/blueprint';

const output = resolve(process.env.BLOCKCOLC_SURFACE_AUDIT_OUTPUT ?? 'artifacts/performance/v2.8.0-terrain-surfaces-20261016');
mkdirSync(output, { recursive: true });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hashFile = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const frozenSurface = resolve(output, 'surface-reference.ts'), frozenScenery = resolve(output, 'scenery-reference.ts');
const unchanged = ['terrain.ts', 'terrain-mesh.ts', 'terrain-render-mesh.ts', 'terrain-profile.ts', 'mosaic-terrain.ts',
  'mosaic-seabed.ts', 'precipitation-ground.ts', 'village.ts', 'reef-field.ts'];
if (process.argv.includes('--freeze')) {
  assert.ok(!existsSync(frozenSurface) && !existsSync(frozenScenery), 'Keep old evidence; select a new experiment directory.');
  const file = resolve('packages/voxel/src/renderer.ts'), source = readFileSync(file, 'utf8');
  const start = source.indexOf('export function terrainSurfaceRectangles(');
  const end = source.indexOf('\nfunction sameSpatialWorldLayout', start);
  assert.ok(start >= 0 && end > start);
  assert.ok(!source.slice(start,end).includes('TerrainSurfaceTable'),
    'This capture targets the pre-table extractor. Reuse the archived, hash-verified references for this experiment; do not capture live helpers as an old baseline.');
  writeFileSync(frozenSurface, `import { TERRAIN_MATERIALS, type MergedGeometryData } from '${resolve('packages/voxel/src/terrain.ts').replaceAll('\\', '/')}';\n${source.slice(start, end)}`);
  const sceneryFile = resolve('packages/voxel/src/scenery.ts');
  writeFileSync(frozenScenery, readFileSync(sceneryFile, 'utf8').replace(/from (["'])(\.\/[^"']+)\1/g, (_all, quote, specifier) =>
    `from ${quote}${resolve(dirname(sceneryFile), `${specifier}.ts`).replaceAll('\\', '/')}${quote}`));
  writeFileSync(resolve(output, 'reference-source.json'), JSON.stringify({ capturedAt: new Date().toISOString(),
    renderer: hashFile(file), scenery: hashFile(sceneryFile), unchanged: Object.fromEntries(unchanged.map(f => [f, hashFile(resolve('packages/voxel/src', f))])),
  }, null, 2));
  console.log(`Frozen reference: ${output}`);
  process.exit(0);
}
const baseline = JSON.parse(readFileSync(resolve(output, 'reference-source.json'), 'utf8'));
const changedHelpers = ['precipitation-ground.ts', 'mosaic-seabed.ts'];
for (const file of unchanged.filter(f => !changedHelpers.includes(f))) {
  assert.equal(hashFile(resolve('packages/voxel/src', file)), baseline.unchanged[file], `Reference dependency changed: ${file}`);
}
// These helpers were clean at freeze time. Recover their exact Git bytes
// (allowing checkout CRLF only) and verify the frozen hash before using them.
for (const file of changedHelpers) {
  const path = resolve(output, `reference-${file}`);
  if (existsSync(path)) continue;
  const gitSource = execFileSync('git', ['show', `HEAD:packages/voxel/src/${file}`], { encoding: 'utf8' });
  const source = [gitSource, gitSource.replace(/\r?\n/g, '\r\n')].find(s =>
    createHash('sha256').update(s).digest('hex') === baseline.unchanged[file]);
  assert.ok(source, `Cannot reconstruct the frozen helper: ${file}`);
  writeFileSync(path, source.replace(/from (["'])(\.\/[^"']+)\1/g, (_all, quote, specifier) =>
    `from ${quote}${resolve('packages/voxel/src', `${specifier}.ts`).replaceAll('\\', '/')}${quote}`));
}
const referenceSurface = await import(frozenSurface.replaceAll('\\', '/')) as typeof import('../src/renderer');
const referenceScenery = await import(frozenScenery.replaceAll('\\', '/')) as typeof scenery;
const referenceGround = await import(resolve(output, 'reference-precipitation-ground.ts').replaceAll('\\', '/')) as typeof import('../src/precipitation-ground');
const referenceSeabed = await import(resolve(output, 'reference-mosaic-seabed.ts').replaceAll('\\', '/')) as typeof import('../src/mosaic-seabed');
const currentSurface = await import('../src/terrain-surface-table');
const quick = process.argv.includes('--quick');
const report = resolve(output, `${process.env.BLOCKCOLC_SURFACE_AUDIT_TAG ?? ''}${quick ? 'quick' : 'comparison'}.json`);
assert.ok(!existsSync(report), 'Do not overwrite a prior comparison.');
const styles: TerrainEnvironmentStyle[] = ['classic-island', 'natural-valley', 'ocean-island', 'mosaic-coast'];
const cases: { style: TerrainEnvironmentStyle; count: number; detail?: 'auto' | 'coarse'; wide?: boolean }[] =
  styles.flatMap(style => [1, 24, 60].map(count => ({ style, count })));
cases.push({ style: 'natural-valley', count: 24, detail: 'auto' }, { style: 'natural-valley', count: 24, detail: 'coarse' },
  { style: 'mosaic-coast', count: 24, detail: 'coarse' }, { style: 'mosaic-coast', count: 1, wide: true });
const rows: unknown[] = [];
for (const { style, count, detail, wide } of quick ? cases.filter(c => c.count === 24 && !c.detail) : cases) {
  for (const worldSeed of quick ? ['world-default'] : ['world-default', 'terrain-audit-280']) {
    const blueprint: BlueprintV1 = { schemaVersion: 1, id: 'audit-wide-60', title: 'Synthetic 60x60 foundation',
      bounds: { minX: -30, maxX: 29, minY: 0, maxY: 0, minZ: -30, maxZ: 29 },
      voxels: [{ x: 0, y: 0, z: 0, materialId: 'stone', buildOrder: 10000 }] };
    const worlds = alignWorldsToEnvironment(layoutWorlds(Array.from({ length: count }, (_, settlementIndex) => ({
      projectId: `terrain-audit-${settlementIndex}`, settlementIndex, blueprintId: 'builtin-small-workshop',
      buildingCompletionBasisPoints: 5000, buildingConditionBasisPoints: 10000, isMonument: false,
    })), wide ? () => blueprint : undefined), style).map(w => ({ ...w, worldPosition: { ...w.worldPosition,
      y: settlementSupportHeightForPlacement(w, style) } }));
    const roads = roadCellsForVillage(worlds), pads = worlds.map(w => ({ x: w.worldPosition.x, z: w.worldPosition.z,
      width: w.footprint.width, depth: w.footprint.depth, groundLevel: w.worldPosition.y }));
    const terrain = createSteppedTerrainData(worlds, roads, pads, undefined, {
      environmentStyle: style, worldSeed, terrainGenerationVersion: 4, refinedFar: detail === 'auto' ? undefined : detail !== 'coarse',
    });
    const terrainHash = digest(terrain), baseBytes = terrainGeometryBytes(terrain);
    const queries: [number, number][] = [];
    for (let x = -64; x <= 64; x += 8) for (let z = -64; z <= 64; z += 8) queries.push([x, z]);
    const protectedRects = worlds.map(w => ({ x: w.worldPosition.x, z: w.worldPosition.z,
      width: w.footprint.width + 5, depth: w.footprint.depth + 5 }));
    const read = (variant: 'reference' | 'candidate', data: MergedGeometryData) => variant === 'reference'
      ? referenceSurface.terrainSurfaceRectangles(data) : currentSurface.terrainSurfaceTable(data);
    const shadow = (data: MergedGeometryData, variant: 'reference' | 'candidate') => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
      for (const s of read(variant, data)) {
        if (s.water || s.supportY < 14) continue;
        const x = (s.minX + s.maxX) / 2, z = (s.minZ + s.maxZ) / 2;
        if (x < data.nearDetailBounds.minX || x > data.nearDetailBounds.maxX || z < data.nearDetailBounds.minZ || z > data.nearDetailBounds.maxZ) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); maxY = Math.max(maxY, s.supportY);
      }
      return [minX, maxX, minZ, maxZ, maxY];
    };
    const cold = (data: MergedGeometryData, variant: 'reference' | 'candidate') => {
      const module = variant === 'reference' ? referenceScenery : scenery;
      const started = performance.now();
      const ground = (variant === 'reference' ? referenceGround.precipitationGroundForSurfaces : precipitationGroundForSurfaces)(read(variant, data));
      const afterGround = performance.now(), sampler = module.surfaceSampler(read(variant, data));
      const support = queries.map(([x, z]) => sampler(x, z));
      const afterSupport = performance.now();
      const seabed = style === 'mosaic-coast' ? (variant === 'reference' ? referenceSeabed.createMosaicSeabed : createMosaicSeabed)(read(variant, data), mosaicSeed(worldSeed), Math.abs(data.framingBounds.maxX)) : null;
      const afterSeabed = performance.now();
      const plan = module.planWorldScenery({ environmentStyle: style, worldSeed, surfaces: read(variant, data),
        trees: data.naturalTrees, roads, normalBounds: data.nearDetailBounds, mosaicCoreRadius: Math.abs(data.framingBounds.maxX), protectedRects });
      const afterPlan = performance.now(), bounds = style === 'ocean-island' ? shadow(data, variant) : null;
      const end = performance.now();
      return { value: { ground, support, seabed, plan, bounds }, total: end - started,
        stages: { ground: afterGround - started, support: afterSupport - afterGround, seabed: afterSeabed - afterSupport,
          scenery: afterPlan - afterSeabed, bounds: end - afterPlan } };
    };
    const repeat = (data: MergedGeometryData, variant: 'reference' | 'candidate') => {
      const module = variant === 'reference' ? referenceScenery : scenery;
      const started = performance.now(), sampler = module.surfaceSampler(read(variant, data));
      const support = queries.map(([x, z]) => sampler(x, z));
      const bounds = style === 'ocean-island' ? shadow(data, variant) : null;
      return { value: { support, bounds }, total: performance.now() - started };
    };
    const samples = { reference: [] as unknown[], candidate: [] as unknown[] }, expected = new Map<string, string>();
    const repeats = count === 24 && !detail && worldSeed === 'world-default' ? 5 : 1;
    for (const variant of ['reference', 'candidate'] as const) cold({ ...terrain }, variant);
    let retainedBytes = 0, tableBytes = 0, indexBytes = 0;
    for (let run = 0; run < repeats; run++) {
      for (const variant of run % 2 ? ['candidate', 'reference'] as const : ['reference', 'candidate'] as const) {
        // Fresh geometry identity, unchanged numeric buffers; sidecars start cold.
        const data = { ...terrain }, result = cold(data, variant), resumed = repeat(data, variant);
        const hash = digest(result.value), repeatHash = digest(resumed.value);
        if (!expected.has('cold')) { expected.set('cold', hash); expected.set('repeat', repeatHash); }
        assert.equal(hash, expected.get('cold'), `all derived outputs: ${style}/${count}/${detail}/${worldSeed}/${variant}`);
        assert.equal(repeatHash, expected.get('repeat'), `repeat sampling: ${style}/${count}/${variant}`);
        samples[variant].push({ cold: result.total, stages: result.stages, repeat: resumed.total });
        if (variant === 'candidate') {
          retainedBytes = terrainGeometryBytes(data); tableBytes = currentSurface.terrainSurfaceTableBytes(data);
          indexBytes = surfaceIndexBytes(currentSurface.terrainSurfaceTable(data));
        }
      }
    }
    const surfaceData = { ...terrain };
    assert.equal(digest(Array.from(read('candidate', surfaceData))), digest(read('reference', terrain)), 'surface order and heights');
    assert.equal(digest(terrain), terrainHash, 'input geometry remains unchanged');
    rows.push({ style, count, worldSeed, detail: detail ?? 'refined', wide: Boolean(wide), cells: terrain.cellCount,
      terrainHash, outputHash: expected.get('cold'), surfaceHash: digest(Array.from(read('candidate', surfaceData))), baseBytes, retainedBytes, tableBytes, indexBytes, samples });
  }
}
const sourceFiles = ['terrain-surface-table.ts', 'surface-index.ts', 'terrain-cache.ts', 'renderer.ts', 'scenery.ts', 'precipitation-ground.ts', 'mosaic-seabed.ts'];
writeFileSync(report, JSON.stringify({ capturedAt: new Date().toISOString(), node: process.version,
  scope: 'Synthetic CPU only, warm JIT. Cold = height texture, support index, seabed if coast, scenery, island shadow bounds. Repeat = support and island bounds. Five AB/BA pairs only for 24-building/default-seed/refined; other inputs check equivalence once. Hashing excluded. No DB, GPU, Android or startup measurement.',
  sourceHashes: Object.fromEntries(sourceFiles.map(f => [f, hashFile(resolve('packages/voxel/src', f))])),
  referenceHashes: Object.fromEntries([frozenSurface,frozenScenery,...changedHelpers.map(f=>resolve(output,`reference-${f}`))].map(f=>[f,hashFile(f)])), rows }, null, 2));
console.log(JSON.stringify({ report, cases: rows.length }));

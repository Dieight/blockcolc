/** Synthetic CPU experiment, never imported by the App. No user database/GPU. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { dirname, resolve } from 'node:path';
import { alignWorldsToEnvironment, layoutWorlds, terrainSurfaceRectangles } from '../src/renderer';
import * as current from '../src/terrain';
import { compactTerrainRenderMesh } from '../src/terrain-render-mesh';
import { terrainGeometryBytes } from '../src/terrain-cache';
import { roadCellsForVillage } from '../src/village';
import { planWorldScenery } from '../src/scenery';
import type { BlueprintV1 } from '../src/blueprint';

const output = resolve(process.env.BLOCKCOLC_TERRAIN_AUDIT_OUTPUT ?? 'artifacts/performance/v2.8.0-terrain-20261016');
mkdirSync(output, { recursive: true });
const referencePath = resolve(output, 'terrain-reference.ts');
const meshReferencePath = resolve(output, 'terrain-mesh-reference.ts');
if (process.argv.includes('--snapshot')) {
  assert.ok(!existsSync(referencePath), 'Use a new output directory; do not overwrite the frozen reference.');
  // A generated, frozen reference outside production source. Preserve relative
  // dependencies by resolving them to the current, unchanged helper modules.
  const sourcePath = resolve('packages/voxel/src/terrain.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const resolved = source.replace(/from (["'])(\.\/[^"']+)\1/g, (_all, quote, specifier) =>
    `from ${quote}${resolve(dirname(sourcePath), `${specifier}.ts`).replaceAll('\\', '/')}${quote}`);
  writeFileSync(referencePath, resolved);
  writeFileSync(resolve(output, 'reference-source.json'), JSON.stringify({ sourcePath,
    sha256: createHash('sha256').update(source).digest('hex'), capturedAt: new Date().toISOString() }, null, 2));
}
if (process.argv.includes('--snapshot-mesh')) {
  assert.ok(!existsSync(meshReferencePath), 'Use a new output directory; do not overwrite the frozen mesh reference.');
  const sourcePath = resolve('packages/voxel/src/terrain-render-mesh.ts');
  const source = readFileSync(sourcePath, 'utf8');
  writeFileSync(meshReferencePath, source.replace(/from (["'])(\.\/[^"']+)\1/g, (_all, quote, specifier) =>
    `from ${quote}${resolve(dirname(sourcePath), `${specifier}.ts`).replaceAll('\\', '/')}${quote}`));
  writeFileSync(resolve(output, 'mesh-reference-source.json'), JSON.stringify({ sourcePath,
    sha256: createHash('sha256').update(source).digest('hex'), capturedAt: new Date().toISOString() }, null, 2));
}
if (process.argv.includes('--snapshot-only')) process.exit(0);
const reference: typeof current = process.argv.includes('--compare') ? await import(referencePath.replaceAll('\\', '/')) : current;
const meshReference: { compactTerrainRenderMesh: typeof compactTerrainRenderMesh } = process.argv.includes('--compare-mesh')
  ? await import(meshReferencePath.replaceAll('\\', '/')) : { compactTerrainRenderMesh };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const seeds = ['world-default', 'terrain-audit-280'];
const cases: Array<{ style: current.TerrainEnvironmentStyle; count: number; version: current.TerrainGenerationVersion;
  detail?: 'auto' | 'coarse'; wide?: boolean }> =
  (['classic-island', 'natural-valley', 'ocean-island', 'mosaic-coast'] as const).flatMap(style =>
    [1, 24, 60].map(count => ({ style, count, version: 4 as const })));
cases.push({ style: 'natural-valley', count: 24, version: 4, detail: 'auto' },
  { style: 'natural-valley', count: 24, version: 4, detail: 'coarse' },
  { style: 'mosaic-coast', count: 24, version: 4, detail: 'coarse' },
  { style: 'mosaic-coast', count: 1, version: 4, wide: true });
const rows: unknown[] = [];
const profileOnly = process.argv.includes('--profile');
const quick = process.argv.includes('--quick');
const tag = process.env.BLOCKCOLC_TERRAIN_AUDIT_TAG ?? '';
const name = profileOnly ? 'profile-rows.json' : process.argv.includes('--compare') ? 'comparison.json' : 'baseline.json';
const reportPath = resolve(output, `${tag}${name}`);
assert.ok(!existsSync(reportPath), 'Use a new report tag; preserve previous runs.');
const session = profileOnly ? new Session() : null;
const post = (method: string) => new Promise<any>((accept, reject) => session!.post(method as any, (error, result) => error ? reject(error) : accept(result)));
if (session) { session.connect(); await post('Profiler.enable'); await post('Profiler.start'); }
try {
  for (const { style, count, version, detail, wide } of profileOnly || quick
    ? cases.filter(c => c.count === 24 && !c.detail && !c.wide) : cases) {
    for (const worldSeed of profileOnly || quick ? seeds.slice(0, 1) : seeds) {
      const imported: BlueprintV1 = { schemaVersion: 1, id: 'audit-wide-60', title: 'Synthetic 60x60 foundation',
        bounds: { minX: -30, maxX: 29, minY: 0, maxY: 0, minZ: -30, maxZ: 29 },
        voxels: [{ x: 0, y: 0, z: 0, materialId: 'stone', buildOrder: 10000 }] };
      const worlds = alignWorldsToEnvironment(layoutWorlds(Array.from({ length: count }, (_, settlementIndex) => ({
        projectId: `terrain-audit-${settlementIndex}`, settlementIndex, blueprintId: 'builtin-small-workshop',
        buildingCompletionBasisPoints: 5000, buildingConditionBasisPoints: 10000, isMonument: false,
      })), wide ? () => imported : undefined), style).map(w => ({ ...w, worldPosition: { ...w.worldPosition,
        y: current.settlementSupportHeightForPlacement(w, style) } }));
      const roads = roadCellsForVillage(worlds);
      const pads = worlds.map(w => ({ x: w.worldPosition.x, z: w.worldPosition.z, width: w.footprint.width,
        depth: w.footprint.depth, groundLevel: w.worldPosition.y }));
      const options = { environmentStyle: style, worldSeed, terrainGenerationVersion: version,
        refinedFar: detail === 'auto' ? undefined : detail !== 'coarse' };
      const samples = { reference: [] as number[], candidate: [] as number[] };
      let terrain!: current.MergedGeometryData;
      let referenceDigest = '', candidateDigest = '';
      const expectedDigests = new Map<string, string>();
      // Warm each path, then alternate AB / BA. Hashing is outside timing.
      for (const variant of ['reference', 'candidate'] as const) {
        const module = variant === 'reference' ? reference : current;
        module.createSteppedTerrainData(worlds, roads, pads, undefined, options);
      }
      for (let repeat = 0; repeat < (profileOnly ? 1 : 5); repeat++) {
        for (const variant of repeat % 2 ? ['candidate', 'reference'] as const : ['reference', 'candidate'] as const) {
          const module = variant === 'reference' ? reference : current;
          const started = performance.now();
          const generated = module.createSteppedTerrainData(worlds, roads, pads, undefined, options);
          samples[variant].push(performance.now() - started);
          const hash = digest(generated);
          if (expectedDigests.has(variant)) assert.equal(hash, expectedDigests.get(variant), `determinism: ${variant}`);
          else expectedDigests.set(variant, hash);
          if (variant === 'reference') referenceDigest = hash;
          else { candidateDigest = hash; terrain = generated; }
        }
        assert.equal(candidateDigest, referenceDigest, `full generated output: ${style}/${count}/v${version}/${worldSeed}`);
      }
      const meshSamples = { reference: [] as number[], candidate: [] as number[] };
      let mesh!: ReturnType<typeof compactTerrainRenderMesh>, expectedMeshHash = '';
      for (let repeat = 0; repeat < (process.argv.includes('--compare-mesh') && count === 24 && worldSeed === seeds[0] ? 5 : 1); repeat++) {
        for (const variant of repeat % 2 ? ['candidate', 'reference'] as const : ['reference', 'candidate'] as const) {
          const compact = variant === 'reference' ? meshReference.compactTerrainRenderMesh : compactTerrainRenderMesh;
          const started = performance.now(), result = compact(terrain);
          meshSamples[variant].push(performance.now() - started);
          const hash = digest(result);
          if (!expectedMeshHash) expectedMeshHash = hash;
          assert.equal(hash, expectedMeshHash, `compact mesh: ${style}/${count}/v${version}/${worldSeed}`);
          if (variant === 'candidate') mesh = result;
        }
      }
      const surfaceStart = performance.now(), surfaces = terrainSurfaceRectangles(terrain), surfaceMs = performance.now() - surfaceStart;
      const sceneryStart = performance.now();
      const scenery = profileOnly ? null : planWorldScenery({ environmentStyle: style, worldSeed, surfaces, trees: terrain.naturalTrees,
        roads, normalBounds: terrain.nearDetailBounds, mosaicCoreRadius: Math.abs(terrain.framingBounds.maxX),
        protectedRects: worlds.map(w => ({ x: w.worldPosition.x, z: w.worldPosition.z, width: w.footprint.width + 5, depth: w.footprint.depth + 5 })) });
      const sceneryMs = performance.now() - sceneryStart;
      rows.push({ style, count, version, worldSeed, detail: detail ?? 'refined', wide: Boolean(wide), samples,
        terrainHash: candidateDigest, meshHash: digest(mesh),
        surfacesHash: digest(surfaces), sceneryHash: scenery ? digest(scenery) : null,
        meshSamples, surfaceMs, sceneryMs, cells: terrain.cellCount,
        triangles: terrain.triangleCount, compactTriangles: mesh.triangleCount, geometryBytes: terrainGeometryBytes(terrain),
        objects: scenery?.objects.length });
    }
  }
} finally {
  if (session) {
    const { profile } = await post('Profiler.stop');
    writeFileSync(resolve(output, `${tag}terrain-baseline.cpuprofile`), JSON.stringify(profile));
    session.disconnect();
  }
}
const defaults = { environmentStyle: 'natural-valley' as const, terrainGenerationVersion: 4 as const };
const auto = current.createSteppedTerrainData([], [], [], undefined, defaults);
const disabled = current.createSteppedTerrainData([], [], [], undefined, { ...defaults, refinedFar: false });
const refinedKeyCollision = current.terrainGenerationInputKey([], [], [], undefined, defaults)
  === current.terrainGenerationInputKey([], [], [], undefined, { ...defaults, refinedFar: false });
const sourceFiles = ['terrain.ts', 'terrain-profile.ts', 'terrain-line-index.ts', 'terrain-mesh.ts',
  'terrain-render-mesh.ts', 'mosaic-terrain.ts', 'scenery.ts', 'village.ts'];
const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file,
  createHash('sha256').update(readFileSync(resolve('packages/voxel/src', file))).digest('hex')]));
writeFileSync(reportPath, JSON.stringify({ capturedAt: new Date().toISOString(), node: process.version,
  scope: 'Synthetic Node CPU only; warm JIT, no storage/GPU/Android, five paired AB/BA samples; hashing excluded',
  sourceHashes, refinedKeyCollision, autoCells: auto.cellCount, disabledCells: disabled.cellCount, rows }, null, 2));
console.log(JSON.stringify({ report: reportPath, cases: rows.length, refinedKeyCollision,
  autoCells: auto.cellCount, disabledCells: disabled.cellCount }));

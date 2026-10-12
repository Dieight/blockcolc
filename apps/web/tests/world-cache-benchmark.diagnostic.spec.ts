import { expect, test } from '@playwright/test';

test('compares generated terrain/scenery with real IndexedDB restoration', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto('/');
  const report = await page.evaluate(async () => {
    // A development-server diagnostic, never included in the shipping bundle.
    const root = '/@fs/C:/Codex/blockcolc/packages/voxel/src/';
    const { layoutWorlds, alignWorldsToEnvironment, terrainSurfaceRectangles } = await import(`${root}renderer.ts`);
    const { createSteppedTerrainData, settlementSupportHeightForPlacement } = await import(`${root}terrain.ts`);
    const { roadCellsForVillage } = await import(`${root}village.ts`);
    const { planWorldScenery } = await import(`${root}scenery.ts`);
    const { compactTerrainRenderMesh } = await import(`${root}terrain-render-mesh.ts`);
    const { restoreWorldSceneCache,worldSceneCacheBytes,packWorldSceneCache,WORLD_SCENE_CACHE_REVISION } = await import(`${root}world-scene-cache.ts`);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('blockcolc-world-cache-benchmark', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('scene');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const put = (value: unknown) => new Promise<void>((resolve, reject) => {
      const tx = db.transaction('scene', 'readwrite');
      tx.objectStore('scene').put(value, 'current');
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
    });
    const get = () => new Promise<any>((resolve, reject) => {
      const request = db.transaction('scene').objectStore('scene').get('current');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const rows = [];
    try {
      for (const [environmentStyle, count] of [['ocean-island', 1], ['ocean-island', 24], ['mosaic-coast', 24]] as const) {
        const worlds = alignWorldsToEnvironment(layoutWorlds(Array.from({ length: count }, (_, settlementIndex) => ({
          projectId: `bench-${settlementIndex}`, settlementIndex, blueprintId: 'builtin-small-workshop',
          buildingCompletionBasisPoints: 5000, buildingConditionBasisPoints: 10000, isMonument: false,
        }))), environmentStyle).map((w: any) => ({ ...w, worldPosition: { ...w.worldPosition,
          y: Math.max(w.worldPosition.y, settlementSupportHeightForPlacement(w, environmentStyle)) } }));
        const roads = roadCellsForVillage(worlds);
        const pads = worlds.map((w: any) => ({ x:w.worldPosition.x,z:w.worldPosition.z,width:w.footprint.width,depth:w.footprint.depth,groundLevel:w.worldPosition.y }));
        const samples = [];
        for (let repeat = 0; repeat < 3; repeat++) {
          const start = performance.now();
          const terrain = createSteppedTerrainData(worlds, roads, pads, undefined, { environmentStyle, worldSeed:'cache-audit-270',terrainGenerationVersion:4,refinedFar:true });
          const terrainMs = performance.now() - start;
          const meshStart = performance.now(); const mesh = compactTerrainRenderMesh(terrain);
          const meshMs = performance.now() - meshStart;
          const planStart = performance.now();
          const scenery = planWorldScenery({ environmentStyle, worldSeed:'cache-audit-270',surfaces:terrainSurfaceRectangles(terrain),trees:terrain.naturalTrees,roads,normalBounds:terrain.nearDetailBounds,
            mosaicCoreRadius:Math.max(Math.abs(terrain.framingBounds.minX),Math.abs(terrain.framingBounds.maxX)),
            protectedRects:worlds.map((w: any) => ({ x:w.worldPosition.x,z:w.worldPosition.z,width:w.footprint.width+5,depth:w.footprint.depth+5 })) });
          const sceneryMs = performance.now() - planStart;
          const value = { revision:WORLD_SCENE_CACHE_REVISION,terrain:{key:'benchmark',data:terrain,renderMesh:mesh},scenery:{key:'benchmark|[]',plan:scenery} };
          const writeStart = performance.now(); await put(packWorldSceneCache(value)); const writeMs = performance.now() - writeStart;
          const readStart = performance.now(); const restored = await get(); const readMs = performance.now() - readStart;
          const validationStart=performance.now();const usable=restoreWorldSceneCache(restored);const validateMs=performance.now()-validationStart;
          const compareStart = performance.now();
          // Reef and house blocks have different insertion order for materialId
          // and buildOrder. Compare all fields, not JavaScript property order.
          const canonical=(value:unknown)=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
            ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
          const identical = canonical(usable) === canonical(value);
          const aliases = usable?.scenery.plan.objects.every((object: any) => object.distantVoxels.every((voxel: any) => object.voxels.includes(voxel)));
          samples.push({ terrainMs,meshMs,sceneryMs,writeMs,readMs,validateMs,usable:Boolean(usable),cacheBytes:worldSceneCacheBytes(value),compareMs:performance.now()-compareStart,identical,aliases,
            positions:terrain.positions.length,objects:scenery.objects.length });
        }
        rows.push({ environmentStyle,count,samples });
      }
      return { userAgent:navigator.userAgent,storage:'real IndexedDB structured clone',rows };
    } finally { db.close(); indexedDB.deleteDatabase('blockcolc-world-cache-benchmark'); }
  });
  await info.attach('world-cache-benchmark.json', { body:JSON.stringify(report,null,2),contentType:'application/json' });
  console.log(`WORLD_CACHE_BENCHMARK ${JSON.stringify(report)}`);
  for (const row of report.rows) for (const sample of row.samples) {
    expect(sample.identical).toBe(true); expect(sample.aliases).toBe(true);
    expect(sample.usable).toBe(true);
  }
});

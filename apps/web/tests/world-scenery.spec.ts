import { expect, test } from '@playwright/test';
import type * as THREE from 'three';
import type { VoxelRenderer } from '@blockcolc/voxel';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

type SceneryWindow = typeof window & {
  __blockcolcVoxelTest: typeof import('@blockcolc/voxel');
  __sceneryProbe: { app: VoxelRenderer; scene?: THREE.Scene };
};

test('expanded ocean settlements keep an exposed detailed wreck, including the legacy terrain input',async({page},info)=>{
  test.setTimeout(180_000);
  await page.goto('/');
  await page.waitForFunction(()=>!!(window as SceneryWindow).__blockcolcVoxelTest);
  await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','扩张海岛沉船验证');
    canvas.style.cssText='position:fixed;inset:0;width:100vw;height:100vh;touch-action:none;z-index:99999';document.body.append(canvas);
  });
  const observations=[];
  for(const entry of [{count:24,version:4},{count:32,version:3},{count:48,version:4}] as const){
    await page.evaluate(async({count,version})=>{
      const scope=window as SceneryWindow;scope.__sceneryProbe?.app.dispose();
      const canvas=document.querySelector<HTMLCanvasElement>('[aria-label="扩张海岛沉船验证"]')!;
      const app=scope.__blockcolcVoxelTest.createVoxelRenderer(canvas,{environmentStyle:'ocean-island',worldSeed:'archipelago-230',terrainGenerationVersion:version,
        lightingQuality:'performance',initialEnvironment:{weather:{kind:'clear',cloudIntensity:0},astronomy:null,debug:{date:Date.parse('2026-10-02T15:00:00+08:00')}}});
      scope.__sceneryProbe={app};app.setReducedMotion(true);app.setVisible(false);
      await app.initializeWorlds(Array.from({length:count},(_,settlementIndex)=>({projectId:`large-island-${settlementIndex}`,settlementIndex,blueprintId:'builtin-timber-house',
        buildingCompletionBasisPoints:10_000,buildingConditionBasisPoints:10_000,isMonument:false})),null);
      app.setVisible(true);await app.prepareInitialPresentation();
    },entry);
    const canvas=page.getByLabel('扩张海岛沉船验证');
    await canvas.dispatchEvent('wheel',{deltaY:100_000});
    await expect.poll(async()=>JSON.parse(await canvas.getAttribute('data-scenery-wreck-projection')??'null')?.anchorInViewport).toBe(true);
    const observation=await canvas.evaluate((node,entry)=>({...entry,radius:Number(node.dataset.oceanMainRadius),terrainVersion:node.dataset.terrainGenerationVersion,
      wreck:JSON.parse(node.dataset.sceneryWreckProjection??'null')}),entry);
    expect(observation.terrainVersion).toBe('4');
    expect(observation.wreck.silhouetteRetained).toBe(true);
    expect(observation.wreck.projectedWidth).toBeGreaterThan(8);
    observations.push(observation);
    await canvas.screenshot({path:info.outputPath(`ship-${entry.count}-from-v${entry.version}.png`)});
  }
  expect(observations[2]!.radius).toBeGreaterThan(observations[0]!.radius);
  await info.attach('expanded-ocean-wrecks',{body:JSON.stringify(observations,null,2),contentType:'application/json'});
  await page.evaluate(()=>(window as SceneryWindow).__sceneryProbe.app.dispose());
});

test('generates distant block scenery without moving tasks, adopting rewards or changing camera fit', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.waitForFunction(() => !!(window as SceneryWindow).__blockcolcVoxelTest);
  await page.evaluate(() => {
    const scope = window as SceneryWindow, voxel = scope.__blockcolcVoxelTest;
    const temporary = new voxel.LightingPostProcessor({ capabilities: { maxSamples: 0 } } as THREE.WebGLRenderer);
    const temporaryScene = (temporary as unknown as { quadScene: THREE.Scene }).quadScene;
    const prototype = Object.getPrototypeOf(Object.getPrototypeOf(temporaryScene)) as THREE.Object3D;
    temporary.dispose();
    const before = prototype.onBeforeRender;
    prototype.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      if (renderer.domElement.getAttribute('aria-label') === '群系只读预览' && scene.getObjectByName('worldLightRig')) {
        scope.__sceneryProbe.scene = scene as THREE.Scene;
      }
      before.call(this, renderer, scene, camera, geometry, material, group);
    };
    const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', '群系只读预览');
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;touch-action:none;z-index:99999';
    document.body.append(canvas);
  });
  for (const environmentStyle of ['natural-valley', 'classic-island', 'ocean-island'] as const) {
    const snapshots = [];
    for (const enabled of [false, true]) {
      await page.evaluate(async ({ environment, preview }) => {
        const scope = window as SceneryWindow, voxel = scope.__blockcolcVoxelTest;
        scope.__sceneryProbe?.app.dispose();
        const canvas = document.querySelector<HTMLCanvasElement>('[aria-label="群系只读预览"]')!;
        const app = voxel.createVoxelRenderer(canvas, { environmentStyle: environment, worldSeed: 'scenery-review-fixed',
          terrainGenerationVersion: 4, lightingQuality: 'balanced', scenery: preview });
        scope.__sceneryProbe = { app }; app.setReducedMotion(true); app.setVisible(false);
        await app.initializeWorlds(Array.from({ length: 7 }, (_, settlementIndex) => ({
          projectId: `review-task-${settlementIndex}`, settlementIndex,
          blueprintId: ['builtin-timber-house', 'builtin-small-workshop', 'builtin-village-chapel'][settlementIndex % 3]!,
          buildingCompletionBasisPoints: 10_000, buildingConditionBasisPoints: 10_000, isMonument: false,
        })), null);
        app.setEnvironmentDebugOverride({ date: Date.parse('2026-09-30T15:00:00+08:00'),
          weather: { kind: 'clear', precipitationIntensity: 0, cloudIntensity: 0 } }); app.setVisible(true);
      }, { environment: environmentStyle, preview: enabled });
      await expect.poll(() => page.evaluate(() => !!(window as SceneryWindow).__sceneryProbe.scene)).toBe(true);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      snapshots.push(await page.evaluate(() => {
        const scene = (window as SceneryWindow).__sceneryProbe.scene!;
        const canvas = document.querySelector<HTMLCanvasElement>('[aria-label="群系只读预览"]')!;
        const taskPositions: { id: string; position: number[]; rotation: number[] }[] = [];
        scene.traverse(o => { if (o.userData.projectId) taskPositions.push({ id: o.userData.projectId,
          position: o.position.toArray(), rotation: [o.rotation.x, o.rotation.y, o.rotation.z] }); });
        const scenery = scene.getObjectByName('world-scenery');
        let businessIds = 0, cropMeshes = 0, silhouetteBatches = 0;
        scenery?.traverse(o => { if (o.userData.projectId || o.userData.rewardId) businessIds++;
          if (o.userData.originalShape === 'original-crop-approximation') cropMeshes++; });
        scenery?.getObjectByName('scenery-landmark-silhouettes')?.traverseVisible(o => {
          if ((o as THREE.Mesh).isMesh) silhouetteBatches++;
        });
        return { taskPositions, terrain: [canvas.dataset.terrainCellCount, canvas.dataset.terrainWaterTriangles],
          detailCells: [Number(canvas.dataset.terrainNearCellCount), Number(canvas.dataset.terrainMiddleCellCount)],
          maximumDistanceRatio: Number(canvas.dataset.cameraMaximumDistanceRatio),
          wreckProjection: JSON.parse(canvas.dataset.sceneryWreckProjection ?? 'null'),
          fit: [canvas.dataset.cameraTargetX, canvas.dataset.cameraTargetY, canvas.dataset.cameraTargetZ, canvas.dataset.cameraDistance],
          village: scenery?.userData.sceneryVillage ?? null,
          businessIds, cropMeshes, silhouetteBatches,
          roles: scenery?.children.map(o => o.userData.sceneryObject?.role).filter(Boolean) ?? [],
          lods: scenery?.children.filter(o => o.userData.sceneryObject).map(o => ({ role: o.userData.sceneryObject.role,
            lod: o.userData.sceneryLod, projected: o.userData.sceneryProjectedWidth,
            full: o.getObjectByName('full')!.visible, distant: o.getObjectByName('distant')!.visible })) ?? [],
        };
      }));
    }
    expect(snapshots[1]!.taskPositions).toEqual(snapshots[0]!.taskPositions);
    expect(snapshots[1]!.taskPositions).toHaveLength(7);
    expect(snapshots[1]!.terrain).toEqual(snapshots[0]!.terrain);
    expect(snapshots[1]!.fit).toEqual(snapshots[0]!.fit);
    if (environmentStyle === 'natural-valley') {
      expect(snapshots[1]!.maximumDistanceRatio).toBe(.9);
      expect(snapshots[1]!.detailCells[0]).toBeGreaterThan(10_000);
      expect(snapshots[1]!.detailCells[1]).toBeGreaterThan(5_000);
    }
    expect(snapshots[0]!.village).toBeNull();
    expect(snapshots[0]!.silhouetteBatches).toBe(0);
    expect(snapshots[1]!.silhouetteBatches).toBeGreaterThan(0);
    if (environmentStyle === 'classic-island') expect(snapshots[1]!.village).toBeNull();
    else { expect(snapshots[1]!.village).not.toBeNull(); expect(snapshots[1]!.cropMeshes).toBeGreaterThan(0); }
    expect(snapshots[1]!.businessIds).toBe(0);
    expect(snapshots[1]!.roles.filter(role => role === 'house')).toHaveLength(environmentStyle === 'classic-island' ? 0 : 3);
    if (environmentStyle === 'ocean-island') {
      expect(snapshots[1]!.roles).toContain('wreck');
      expect(snapshots[1]!.wreckProjection).toMatchObject({ anchorInViewport: true, silhouetteRetained: true });
      expect(snapshots[1]!.wreckProjection.projectedWidth).toBeGreaterThan(20);
    }
    if (environmentStyle === 'natural-valley') expect(snapshots[1]!.roles).toContain('camp');
    for (const lod of snapshots[1]!.lods) {
      expect(lod.full).toBe(lod.lod === 'full'); expect(lod.distant).toBe(lod.lod === 'distant');
      expect(lod.projected).toBeGreaterThan(0);
    }
    await page.getByLabel('群系只读预览').screenshot({ path: testInfo.outputPath(`${environmentStyle}-mobile.png`) });
    await testInfo.attach(`${environmentStyle}-scenery`, { body: JSON.stringify(snapshots), contentType: 'application/json' });
    const observationPath = testInfo.outputPath(`${environmentStyle}-scenery.json`);
    await mkdir(dirname(observationPath), { recursive: true }); await writeFile(observationPath, JSON.stringify(snapshots, null, 2));
    if (environmentStyle === 'ocean-island') {
      const closeView = await page.evaluate(async () => {
        const app = (window as SceneryWindow).__sceneryProbe.app;
        app.setReducedMotion(false);
        await app.revealInitialProject(null);
        app.setReducedMotion(true);
        const canvas = document.querySelector<HTMLCanvasElement>('[aria-label="群系只读预览"]')!;
        return { distanceRatio: canvas.dataset.cameraDistanceRatio,
          wreck: JSON.parse(canvas.dataset.sceneryWreckProjection ?? 'null') };
      });
      await testInfo.attach('ocean-close-opening', { body: JSON.stringify(closeView), contentType: 'application/json' });
      await writeFile(testInfo.outputPath('ocean-close-opening.json'), JSON.stringify(closeView, null, 2));
      await page.getByLabel('群系只读预览').screenshot({ path: testInfo.outputPath('ocean-close-opening.png') });
      expect(Number(closeView.distanceRatio)).toBeCloseTo(.45, 2);
      expect(closeView.wreck?.silhouetteRetained).toBe(true);
    }
  }
  await page.evaluate(() => (window as SceneryWindow).__sceneryProbe.app.dispose());
});

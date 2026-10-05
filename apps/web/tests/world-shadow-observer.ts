import type { Page } from '@playwright/test';
import type * as THREE from 'three';

type Scope = Window & {
  __blockcolcVoxelTest: typeof import('@blockcolc/voxel');
  __shadowRequests?: { at: number; stack: string; dataset: Record<string, string | undefined> }[];
};

/** Opt-in diagnostics: observe requests on the existing GPU, without drawing or changing its policy. */
export async function observeShadowRequests(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as Scope).__blockcolcVoxelTest);
  await page.evaluate(() => {
    const scope = window as unknown as Scope;
    const temporary = new scope.__blockcolcVoxelTest.LightingPostProcessor({ capabilities: { maxSamples: 0 } } as THREE.WebGLRenderer);
    const scene = (temporary as unknown as { quadScene: THREE.Scene }).quadScene;
    const prototype = Object.getPrototypeOf(Object.getPrototypeOf(scene)) as THREE.Object3D;
    temporary.dispose();
    const before = prototype.onBeforeRender, observed = new WeakSet<THREE.WebGLRenderer>();
    scope.__shadowRequests = [];
    prototype.onBeforeRender = function (gpu, scene, camera, geometry, material, group) {
      if (gpu.domElement.getAttribute('aria-label') === '项目建筑世界' && scene.getObjectByName('worldLightRig') && !observed.has(gpu)) {
        observed.add(gpu);
        let pending = gpu.shadowMap.needsUpdate;
        Object.defineProperty(gpu.shadowMap, 'needsUpdate', { configurable: true, enumerable: true,
          get: () => pending,
          set(value: boolean) {
            if (value && !pending) scope.__shadowRequests!.push({ at: performance.now(), stack: new Error().stack ?? '', dataset: { ...gpu.domElement.dataset } });
            pending = value;
          },
        });
      }
      before.call(this, gpu, scene, camera, geometry, material, group);
    };
  });
}

export function readShadowRequests(page: Page) {
  return page.evaluate(() => (window as unknown as Scope).__shadowRequests);
}

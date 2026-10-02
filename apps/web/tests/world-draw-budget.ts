import type { Page } from '@playwright/test';
import type * as THREE from 'three';

type DrawBudgetWindow = typeof window & {
  __blockcolcVoxelTest: typeof import('@blockcolc/voxel');
  __worldDrawBudget?: { frame: number; draws: { path: string; triangles: number; shadow: boolean }[] };
};

/** Observe the actual main-scene draw list, without rendering a second frame. */
export async function observeWorldDrawBudget(page: Page, label: string): Promise<void> {
  await page.waitForFunction(() => !!(window as DrawBudgetWindow).__blockcolcVoxelTest);
  await page.evaluate(label => {
    const scope = window as DrawBudgetWindow;
    const post = new scope.__blockcolcVoxelTest.LightingPostProcessor({ capabilities: { maxSamples: 0 } } as THREE.WebGLRenderer);
    const scene = (post as unknown as { quadScene: THREE.Scene }).quadScene;
    const prototype = Object.getPrototypeOf(Object.getPrototypeOf(scene)) as THREE.Object3D;
    post.dispose();
    const before = prototype.onBeforeRender;
    prototype.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      if ((this as THREE.Mesh).isMesh && geometry && renderer.domElement.getAttribute('aria-label') === label && scene.getObjectByName('worldLightRig')) {
        const frame = renderer.info.render.frame;
        if (scope.__worldDrawBudget?.frame !== frame) scope.__worldDrawBudget = { frame, draws: [] };
        // Three passes a geometry draw range here; @types/three incorrectly
        // declares the callback's last argument as the scene's Group object.
        const drawGroup = group as unknown as { start: number; count: number } | null;
        const count = Math.max(0, Math.min(geometry.index?.count ?? geometry.attributes.position!.count,
          geometry.drawRange.start + geometry.drawRange.count, drawGroup ? drawGroup.start + drawGroup.count : Infinity)
          - Math.max(geometry.drawRange.start, drawGroup?.start ?? 0));
        const instances = (this as THREE.InstancedMesh).isInstancedMesh ? (this as THREE.InstancedMesh).count : 1;
        const names: string[] = [];
        let object: THREE.Object3D | null = this;
        while (object && object !== scene) { names.unshift(object.name || object.type); object = object.parent; }
        scope.__worldDrawBudget!.draws.push({ path: names.join('/'), triangles: count / 3 * instances, shadow: this.castShadow });
      }
      before.call(this, renderer, scene, camera, geometry, material, group);
    };
  }, label);
}

export async function readWorldDrawBudget(page: Page) {
  return page.evaluate(() => {
    const budget = (window as DrawBudgetWindow).__worldDrawBudget;
    return budget && { frame: budget.frame, triangles: budget.draws.reduce((sum, draw) => sum + draw.triangles, 0),
      draws: [...budget.draws].sort((a, b) => b.triangles - a.triangles) };
  });
}

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneryInstanceCulling } from '../src/scenery-instance-culling';

function fixture() {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial(), 3);
  [0,20,400].forEach((x, index) => mesh.setMatrixAt(index, new THREE.Matrix4().makeTranslation(x,0,0)));
  mesh.setColorAt(0, new THREE.Color(1,0,0)); mesh.setColorAt(1, new THREE.Color(0,1,0)); mesh.setColorAt(2, new THREE.Color(0,0,1));
  mesh.geometry.setAttribute('faceTile', new THREE.InstancedBufferAttribute(new Float32Array([11,22,33]),1));
  mesh.castShadow = true;
  const culling = new SceneryInstanceCulling();
  const shadow = culling.register(mesh)!;
  const camera = new THREE.PerspectiveCamera(35,1,.1,100);
  camera.position.set(0,0,20); camera.lookAt(0,0,0);
  return { mesh, shadow, camera, culling };
}

describe('static grove instance culling', () => {
  it('moves matrices, colors and atlas attributes together and restores previously hidden instances', () => {
    const {mesh,camera,culling} = fixture();
    culling.sync(camera);
    expect(mesh.count).toBe(1);
    expect(mesh.geometry.getAttribute('faceTile').getX(0)).toBe(11);
    const version = mesh.instanceMatrix.version;
    culling.sync(camera);
    expect(mesh.instanceMatrix.version).toBe(version);
    camera.position.set(400,0,20); camera.lookAt(400,0,0);
    culling.sync(camera);
    expect(mesh.count).toBe(1);
    expect(mesh.instanceMatrix.array[12]).toBe(400);
    expect(mesh.geometry.getAttribute('faceTile').getX(0)).toBe(33);
    expect([...mesh.instanceColor!.array.slice(0,3)]).toEqual([0,0,1]);
    camera.position.set(0,0,20); camera.lookAt(0,0,0); culling.sync(camera);
    expect(mesh.geometry.getAttribute('faceTile').getX(0)).toBe(11);
  });
  it('retains off-screen shadow casters with independent complete geometry and no color draw', () => {
    const {mesh,shadow,camera,culling} = fixture();
    culling.sync(camera);
    expect(mesh.castShadow).toBe(false);
    expect(shadow.castShadow).toBe(true);
    expect(shadow.geometry).not.toBe(mesh.geometry);
    expect([...shadow.geometry.getAttribute('faceTile').array]).toEqual([11,22,33]);
    expect(shadow.instanceMatrix.array[44]).toBe(400);
    shadow.onBeforeRender(null!,null!,null!,null!,null!,null!);
    expect(shadow.count).toBe(0);
    shadow.onBeforeShadow(null!,null!,null!,null!,null!,null!,null!);
    expect(shadow.count).toBe(3);
    shadow.onBeforeRender(null!,null!,null!,null!,null!,null!);
    expect(shadow.count).toBe(0);
    culling.clear();
    expect(culling.getDiagnostics()).toEqual({batches:0,source:0,visible:0});
  });
  it('refreshes quality-dependent AO without mixing original and compacted index order', () => {
    const {mesh,camera,culling} = fixture();
    culling.sync(camera);
    for (let index=0;index<3;index++) mesh.setColorAt(index,new THREE.Color(.25,.25,.25));
    culling.refreshColors(mesh);
    camera.position.set(400,0,20);camera.lookAt(400,0,0);culling.sync(camera);
    expect([...mesh.instanceColor!.array.slice(0,3)]).toEqual([.25,.25,.25]);
  });
  it('includes conservative geometry extents at the edge and applies parent world transforms', () => {
    const {mesh,camera,culling} = fixture();
    const root=new THREE.Group();root.add(mesh);root.position.x=-400;
    root.updateMatrixWorld(true);culling.sync(camera);
    expect(mesh.count).toBe(1);
    expect(mesh.geometry.getAttribute('faceTile').getX(0)).toBe(33);
    // An oversized base model that reaches into the view is never culled by its center alone.
    const wide=new THREE.InstancedMesh(new THREE.BoxGeometry(50,1,1),new THREE.MeshBasicMaterial(),1);
    wide.setMatrixAt(0,new THREE.Matrix4().makeTranslation(20,0,0));culling.register(wide);culling.sync(camera);
    expect(wide.count).toBe(1);
  });
});

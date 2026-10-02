import * as THREE from 'three';

type Copy = { attribute: THREE.InstancedBufferAttribute; source: THREE.InstancedBufferAttribute['array'] };
type Cluster = { sphere: THREE.Sphere; indices: number[] };
type Batch = { mesh: THREE.InstancedMesh; count: number; clusters: Cluster[]; copies: Copy[]; signature: string | null };

/** Compact only visible static grove instances. Geometry/UV/tint attributes
 * move together; unchanged visibility causes no uploads. Shadow copies retain
 * the complete grove independently, including off-screen shadow casters. */
export class SceneryInstanceCulling {
  private batches = new Map<THREE.InstancedMesh, Batch>();
  private projection = new THREE.Matrix4();
  private localProjection = new THREE.Matrix4();
  private frustum = new THREE.Frustum();

  register(mesh: THREE.InstancedMesh): THREE.InstancedMesh | null {
    if (!mesh.count) return null;
    const attributes = Object.values(mesh.geometry.attributes).filter((attribute): attribute is THREE.InstancedBufferAttribute =>
      attribute instanceof THREE.InstancedBufferAttribute);
    if (attributes.some(attribute => attribute.meshPerAttribute !== 1 || attribute.count !== mesh.count)) return null;
    mesh.computeBoundingSphere(); // Keep conservative whole-batch bounds after compaction.
    mesh.geometry.computeBoundingSphere();
    const matrix = new THREE.Matrix4();
    const center = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const bins = new Map<string, { indices: number[]; bounds: THREE.Box3; radius: number }>();
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(center, rotation, scale);
      const key = `${Math.floor(center.x / 8)}:${Math.floor(center.y / 8)}:${Math.floor(center.z / 8)}`;
      const bin = bins.get(key) ?? { indices: [], bounds: new THREE.Box3(), radius: 0 };
      bin.indices.push(index); bin.bounds.expandByPoint(center);
      const geometry = mesh.geometry.boundingSphere!;
      bin.radius = Math.max(bin.radius, (geometry.radius + geometry.center.length()) * Math.max(scale.x, scale.y, scale.z));
      bins.set(key, bin);
    }
    const clusters = [...bins.values()].map(bin => {
      const sphere = bin.bounds.getBoundingSphere(new THREE.Sphere());
      sphere.radius += bin.radius;
      return { sphere, indices: bin.indices };
    });
    // This immutable depth-only copy has no color-pass draw (count = 0 there).
    // Separate buffers avoid changing shadow geometry when color instances move.
    const shadow = mesh.castShadow || mesh.customDepthMaterial ? mesh.clone() : null;
    if (shadow) {
      const sourceCount = mesh.count;
      shadow.geometry = mesh.geometry.clone();
      shadow.userData = { sceneryShadowCopy: true };
      shadow.onBeforeRender = () => { shadow.count = 0; };
      shadow.onBeforeShadow = () => { shadow.count = sourceCount; };
      shadow.customDepthMaterial = mesh.customDepthMaterial;
    }
    const copies = [mesh.instanceMatrix, ...(mesh.instanceColor ? [mesh.instanceColor] : []), ...attributes].map(attribute => {
      attribute.setUsage(THREE.DynamicDrawUsage);
      return { attribute, source: attribute.array.slice() };
    });
    this.batches.set(mesh, { mesh, count: mesh.count, clusters, copies, signature: null });
    mesh.castShadow = false;
    return shadow;
  }

  refreshColors(mesh: THREE.InstancedMesh): void {
    const batch = this.batches.get(mesh);
    if (!batch || !mesh.instanceColor) return;
    const copy = batch.copies.find(copy => copy.attribute === mesh.instanceColor);
    if (copy) copy.source = mesh.instanceColor.array.slice();
    batch.signature = null;
  }

  sync(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    for (const batch of this.batches.values()) {
      batch.mesh.updateWorldMatrix(true, false);
      this.localProjection.multiplyMatrices(this.projection, batch.mesh.matrixWorld);
      this.frustum.setFromProjectionMatrix(this.localProjection);
      const selected = batch.clusters.map((cluster, index) => this.frustum.intersectsSphere(cluster.sphere) ? index : -1).filter(index => index >= 0);
      const signature = selected.join(',');
      if (signature === batch.signature) continue;
      batch.signature = signature;
      const indices = selected.flatMap(index => batch.clusters[index]!.indices);
      for (const copy of batch.copies) {
        const size = copy.attribute.itemSize;
        indices.forEach((index, destination) => copy.attribute.array.set(copy.source.subarray(index * size, (index + 1) * size), destination * size));
        if (indices.length) {
          copy.attribute.clearUpdateRanges();
          copy.attribute.addUpdateRange(0, indices.length * size);
          copy.attribute.needsUpdate = true;
        }
      }
      batch.mesh.count = indices.length;
    }
  }

  clear(): void { this.batches.clear(); }
  getDiagnostics(): { batches: number; source: number; visible: number } {
    const batches = [...this.batches.values()];
    return { batches: batches.length, source: batches.reduce((sum, batch) => sum + batch.count, 0),
      visible: batches.reduce((sum, batch) => sum + batch.mesh.count, 0) };
  }
}

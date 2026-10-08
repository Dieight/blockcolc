import type { BlueprintVoxel, MaterialId } from './blueprint';
import type { EnvironmentStyle } from './environment';
import { mosaicGridPosition, mosaicRegionAt, mosaicSeed, mosaicSeabedHeight, sampleMosaicTerrain } from './mosaic-terrain';
import { createReefField } from './reef-field';

/** Read-only samples of the *rendered* terrain, including its coarse far cells. */
export interface ScenerySurface {
  minX: number; maxX: number; minZ: number; maxZ: number;
  supportY: number; water: boolean;
  material?: string;
}
export interface SceneryProtectedRect {
  x: number; z: number; width: number; depth: number;
}
export type SceneryRole = 'house' | 'well' | 'farm' | 'path' | 'tree' | 'garden' | 'dock' | 'camp' | 'wreck' | 'ruin' | 'rock';
export interface SceneryObject {
  id: string;
  role: SceneryRole;
  x: number; y: number; z: number;
  width: number; depth: number;
  voxels: readonly BlueprintVoxel[];
  distantVoxels: readonly BlueprintVoxel[];
}
export interface WorldScenery {
  /** One locality, not a ring; no project, reward or construction identity. */
  village: { x: number; z: number; width: number; depth: number } | null;
  objects: readonly SceneryObject[];
}

/** A shared, immutable silhouette plus per-object near detail. Do not apply
 * this partition to a future far model that replaces blocks instead of merely
 * omitting detail: it must retain the independent two-model LOD route. */
export function sceneryGeometryLayers(object: Pick<SceneryObject, 'voxels' | 'distantVoxels'>): {
  silhouette: readonly BlueprintVoxel[]; detail: readonly BlueprintVoxel[];
} | null {
  const full = new Set(object.voxels);
  if (!object.distantVoxels.every(voxel => full.has(voxel))) return null;
  const silhouette = new Set(object.distantVoxels);
  return { silhouette: object.distantVoxels, detail: object.voxels.filter(voxel => !silhouette.has(voxel)) };
}

/** Self-authored conventional block structures; no upstream structure NBT/assets. */
class Blocks {
  private cells = new Map<string, { voxel: BlueprintVoxel; silhouette: boolean }>();
  put(x: number, y: number, z: number, block: string, materialId: MaterialId, silhouette = true,
    state?: Record<string, string>): void {
    this.cells.set(`${x}:${y}:${z}`, { voxel: { x, y, z, buildOrder: 0, materialId,
      sourceBlockId: `minecraft:${block}`, ...(state ? { sourceBlockState: state } : {}) }, silhouette });
  }
  remove(x: number, y: number, z: number): void { this.cells.delete(`${x}:${y}:${z}`); }
  result(): { voxels: BlueprintVoxel[]; distantVoxels: BlueprintVoxel[] } {
    const sorted = [...this.cells.values()].sort((a, b) =>
      a.voxel.y - b.voxel.y || a.voxel.x - b.voxel.x || a.voxel.z - b.voxel.z);
    return { voxels: sorted.map(cell => cell.voxel),
      distantVoxels: sorted.filter(cell => cell.silhouette).map(cell => cell.voxel) };
  }
}

function roof(blocks: Blocks, centerX: number, centerZ: number, halfX: number, halfZ: number,
  baseY: number, wood: string): void {
  for (let x = -halfX; x <= halfX; x++) {
    const rise = halfX - Math.abs(x);
    for (let z = -halfZ; z <= halfZ; z++) {
      blocks.put(centerX + x, baseY + rise, centerZ + z,
        x === 0 ? `${wood}_slab` : `${wood}_stairs`, 'roof', true,
        x === 0 ? { type: 'bottom', waterlogged: 'false' }
          : { facing: x < 0 ? 'east' : 'west', half: 'bottom', shape: 'straight', waterlogged: 'false' });
      // Gable infill keeps an actual roof, not two floating diagonal plates.
      if (Math.abs(z) === halfZ - 1) {
        for (let y = baseY; y < baseY + rise; y++) blocks.put(centerX + x, y, centerZ + z, `${wood}_planks`, 'plank');
      }
    }
  }
}

export function sceneryHouseBlocks(wood = 'oak', roofWood = 'spruce', chimney = false): ReturnType<Blocks['result']> {
  const b = new Blocks();
  for (let x = -3; x <= 3; x++) for (let z = -4; z <= 4; z++) {
    b.put(x, 0, z, 'cobblestone', 'stone');
    if (Math.abs(x) !== 3 && Math.abs(z) !== 4) continue;
    for (let y = 1; y <= 4; y++) b.put(x, y, z,
      Math.abs(x) === 3 && Math.abs(z) === 4 ? `${wood}_log` : `${wood}_planks`,
      Math.abs(x) === 3 && Math.abs(z) === 4 ? 'wood' : 'plank', true,
      Math.abs(x) === 3 && Math.abs(z) === 4 ? { axis: 'y' } : undefined);
  }
  for (const z of [-2, 1]) for (let y = 2; y <= 3; y++) {
    for (const x of [-3, 3]) b.put(x, y, z, 'glass_pane', 'glass', false,
      { north: 'true', south: 'true', west: 'false', east: 'false', waterlogged: 'false' });
  }
  for (const x of [-1, 0, 1]) b.put(x, 2, -4, 'glass_pane', 'glass', false,
    { west: 'true', east: 'true', north: 'false', south: 'false', waterlogged: 'false' });
  for (let y = 1; y <= 2; y++) b.put(0, y, 4, `${wood}_door`, 'wood', false,
    { facing: 'south', half: y === 1 ? 'lower' : 'upper', hinge: 'left', open: 'false', powered: 'false' });
  b.put(0, 0, 5, 'cobblestone_stairs', 'stone', true,
    { facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'false' });
  roof(b, 0, 0, 4, 5, 5, roofWood);
  // A little real interior rather than a sealed solid cube; far LOD omits it.
  b.put(-2, 1, -3, 'crafting_table', 'plank', false);
  b.put(2, 1, -3, 'bookshelf', 'plank', false);
  if (chimney) for (let y = 1; y <= 8; y++) b.put(2, y, -2, 'stone_bricks', 'stone');
  return b.result();
}

function wellBlocks(): ReturnType<Blocks['result']> {
  const b = new Blocks();
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    if (Math.abs(x) === 2 || Math.abs(z) === 2) b.put(x, 0, z, 'cobblestone', 'stone');
    else b.put(x, 0, z, 'water', 'glass', false, { level: '0' });
  }
  for (const x of [-2, 2]) for (const z of [-2, 2]) for (let y = 1; y <= 3; y++) {
    b.put(x, y, z, 'oak_fence', 'wood', true,
      { north: 'false', south: 'false', east: 'false', west: 'false', waterlogged: 'false' });
  }
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) b.put(x, 4, z, 'oak_slab', 'roof', true, { type: 'bottom', waterlogged: 'false' });
  return b.result();
}

function farmBlocks(): ReturnType<Blocks['result']> {
  const b = new Blocks();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    const edge = Math.abs(x) === 3 || Math.abs(z) === 3;
    b.put(x, 0, z, edge ? 'oak_log' : x === 0 ? 'water' : 'farmland', edge ? 'wood' : x === 0 ? 'glass' : 'accent',
      true, edge ? { axis: Math.abs(x) === 3 ? 'z' : 'x' } : x === 0 ? { level: '0' } : { moisture: '7' });
    if (!edge && x !== 0) b.put(x, 1, z, 'wheat', 'accent', false, { age: '7' });
  }
  return b.result();
}

export function sceneryTreeBlocks(species: 'oak' | 'birch' | 'spruce' | 'pale_oak' | 'poplar', variant: number, tallSpruce = false): ReturnType<Blocks['result']> {
  const b = new Blocks();
  if(species==='poplar') {
    // 26.3: 7–11 block trunks, branching below the crown and three warm
    // foliage variants. Author the silhouette here; do not copy structure NBT.
    const height=7+variant%5,color=['red','orange','yellow'][variant%3]!;
    for(let y=0;y<height;y++)b.put(0,y,0,'poplar_log','wood',true,{axis:'y'});
    for(let branch=0;branch<2+variant%3;branch++){
      const dx=branch%2===0?1:-1,dz=branch<2?0:1,y=height-5+branch;
      for(let i=1;i<=2;i++)b.put(dx*i,y+Math.floor(i/2),dz*i,'poplar_log','wood',true,{axis:dz?'z':'x'});
    }
    for(let layer=0;layer<6;layer++){
      const y=height-4+layer,radius=[2,3,4,3,2,1][layer]!;
      for(let x=-radius;x<=radius;x++)for(let z=-radius;z<=radius;z++){
        if(x*x+z*z>radius*radius+1||x===0&&z===0&&y<height
          ||Math.abs(x)+Math.abs(z)>radius&&hash(`${variant}:${x}:${y}:${z}`)%7===0)continue;
        b.put(x,y,z,`${color}_poplar_leaves`,'accent',true,{distance:'1',persistent:'true',waterlogged:'false'});
      }
    }
    return b.result();
  }
  const height = species === 'spruce' ? tallSpruce ? 9 + variant % 4 : 7 + variant % 2 : 4 + variant % 3;
  for (let y = 0; y < height; y++) b.put(0, y, 0, `${species}_log`, 'wood', true, { axis: 'y' });
  if (species !== 'spruce') b.put(1, height - 2, 0, `${species}_log`, 'wood', true, { axis: 'x' });
  const layers = species === 'spruce'
    ? tallSpruce
      ? Array.from({ length: 8 }, (_, i) => ({ y: height - 7 + i, radius: [3, 2, 3, 2, 2, 1, 1, 0][i]! }))
      : Array.from({ length: 6 }, (_, i) => ({ y: height - 5 + i, radius: [2, 1, 2, 1, 1, 0][i]! }))
    : [{ y: height - 2, radius: 2 }, { y: height - 1, radius: 2 }, { y: height, radius: 1 }, { y: height + 1, radius: 1 }];
  for (const { y, radius } of layers) for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    if (x === 0 && z === 0 && y < height) continue;
    if (radius > 0 && Math.abs(x) === radius && Math.abs(z) === radius
      && (species === 'spruce' || (hash(`${variant}:${x}:${y}:${z}`) & 1) === 0)) continue;
    b.put(x, y, z, `${species}_leaves`, 'accent', true, { distance: '1', persistent: 'true', waterlogged: 'false' });
  }
  return b.result();
}

export function sceneryLod(projectedWidthPx: number, current: 'full' | 'distant' = 'full'): 'full' | 'distant' {
  // Per-object projection and hysteresis, not a world-wide distance cut-off.
  return current === 'full' ? projectedWidthPx < 30 ? 'distant' : 'full'
    : projectedWidthPx > 42 ? 'full' : 'distant';
}

function overlaps(a: SceneryProtectedRect, b: SceneryProtectedRect, gap = 0): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap
    && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 + gap;
}

export function scenerySurfaceAt(surfaces: readonly ScenerySurface[], x: number, z: number): ScenerySurface | undefined {
  // Highest dry ground wins only when it is genuinely above the water surface.
  // Each bucket is visited many times. Keep first-in-input ties, as the former
  // stable sort did, without allocating and sorting three arrays per sample.
  let ground: ScenerySurface | undefined, water: ScenerySurface | undefined;
  for (const s of surfaces) {
    if (!(s.minX < s.maxX && s.minZ < s.maxZ && x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ)) continue;
    if (s.water) { if (!water || s.supportY > water.supportY) water = s; }
    else if (!ground || s.supportY > ground.supportY) ground = s;
  }
  return ground && (!water || ground.supportY > water.supportY + .01) ? ground : water;
}

/** Compute deterministic expensive scores once, preserving stable ties. */
function orderedBy<T>(values: readonly T[], score: (value: T) => number): T[] {
  return values.map(value => ({ value, score: score(value) }))
    .sort((a, b) => a.score - b.score).map(entry => entry.value);
}

/** Terrain is sampled many times while fitting a locality. Index it once. */
export function surfaceSampler(surfaces: readonly ScenerySurface[]): (x: number, z: number) => ScenerySurface | undefined {
  const bins = new Map<string, ScenerySurface[]>();
  for (const s of surfaces) {
    if (s.minX >= s.maxX || s.minZ >= s.maxZ) continue;
    for (let x = Math.floor(s.minX / 8); x <= Math.floor(s.maxX / 8); x++) {
      for (let z = Math.floor(s.minZ / 8); z <= Math.floor(s.maxZ / 8); z++) {
        const key = `${x}:${z}`, list = bins.get(key) ?? [];
        list.push(s); bins.set(key, list);
      }
    }
  }
  const cache = new Map<string, ScenerySurface | undefined>();
  return (x, z) => {
    const key = `${x}:${z}`;
    if (!cache.has(key)) cache.set(key, scenerySurfaceAt(bins.get(`${Math.floor(x / 8)}:${Math.floor(z / 8)}`) ?? [], x, z));
    return cache.get(key);
  };
}

/** Presentation only: old terrain versions and task/reward foundations remain byte-for-byte unchanged. */
export function planWorldScenery(input: {
  environmentStyle: EnvironmentStyle;
  worldSeed: string;
  surfaces: readonly ScenerySurface[];
  protectedRects: readonly SceneryProtectedRect[];
  roads: readonly { x: number; z: number }[];
  trees: readonly { x: number; y: number; z: number; scale: number }[];
  normalBounds?: { minX:number; maxX:number; minZ:number; maxZ:number };
  mosaicCoreRadius?:number;
}): WorldScenery {
  const { surfaces, protectedRects } = input;
  const surfaceAt = surfaceSampler(surfaces);
  const objects: SceneryObject[] = [];
  const outsideNormal = (x:number,z:number) => input.normalBounds !== undefined &&
    (x < input.normalBounds.minX || x > input.normalBounds.maxX || z < input.normalBounds.minZ || z > input.normalBounds.maxZ);
  const distantLand = surfaces.filter(s => !s.water && outsideNormal((s.minX+s.maxX)/2,(s.minZ+s.maxZ)/2));
  const distantArea = distantLand.reduce((area,s)=>area+(s.maxX-s.minX)*(s.maxZ-s.minZ),0);
  const exactMosaic=input.environmentStyle==='mosaic-coast'&&input.mosaicCoreRadius!==undefined;
  const coreX = exactMosaic?0:protectedRects.length ? protectedRects.reduce((sum, rect) => sum + rect.x, 0) / protectedRects.length : 0;
  const coreZ = exactMosaic?0:protectedRects.length ? protectedRects.reduce((sum, rect) => sum + rect.z, 0) / protectedRects.length : 0;
  const coreRadius = exactMosaic?input.mosaicCoreRadius!:Math.max(10, ...protectedRects.map(r => Math.hypot(r.x - coreX, r.z - coreZ) + Math.max(r.width, r.depth) / 2));
  const compact = input.environmentStyle === 'classic-island';
  const villageWidth = 33, villageDepth = 29;
  const modules = [
    { role: 'house' as const, x: -9, z: -7, width: 9, depth: 11,
      ...sceneryHouseBlocks(input.environmentStyle === 'ocean-island' ? 'birch' : 'oak', 'spruce', true) },
    { role: 'house' as const, x: 6, z: -8, width: 9, depth: 11, ...sceneryHouseBlocks('oak', 'oak') },
    { role: 'house' as const, x: -8, z: 7, width: 9, depth: 11, ...sceneryHouseBlocks('oak', 'spruce') },
    { role: 'well' as const, x: 3, z: 4, width: 7, depth: 7, ...wellBlocks() },
    { role: 'farm' as const, x: 11, z: 8, width: 7, depth: 7, ...farmBlocks() },
  ];
  const supports = (cx: number, cz: number, width: number, depth: number): { min: number; max: number } | null => {
    let min = Infinity, max = -Infinity;
    for (let dx = -Math.floor(width / 2); dx <= Math.floor(width / 2); dx++) {
      for (let dz = -Math.floor(depth / 2); dz <= Math.floor(depth / 2); dz++) {
        const x = cx + dx, z = cz + dz;
        const s = surfaceAt(x, z);
        if (!s || s.water || protectedRects.some(r => overlaps({ x, z, width: 1, depth: 1 }, r, 2))
          || input.roads.some(r => Math.abs(r.x - x) <= 2 && Math.abs(r.z - z) <= 2)) return null;
        // Keep the main island's raised earth cones clear, including their flanks.
        if (input.environmentStyle === 'ocean-island' && (s.supportY > 9 || s.material === 'stone')) return null;
        min = Math.min(min, s.supportY);
        max = Math.max(max, s.supportY);
        // A larger sampled area cannot recover an already excessive height range.
        if (max - min > 4) return null;
      }
    }
    return max - min <= 4 ? { min, max } : null;
  };
  // Prefer one farther locality on one side, but never invent land to fit it.
  const candidates = surfaces.filter(s => !s.water && s.minX < s.maxX && s.minZ < s.maxZ).flatMap(s => [
    { x: Math.round((s.minX + s.maxX) / 2), z: Math.round((s.minZ + s.maxZ) / 2) },
  ]).filter(p => {
    const distance = Math.hypot(p.x - coreX, p.z - coreZ);
    return distance >= coreRadius + 43 && distance <= coreRadius + 140;
  }).map(point => {
    const score = (p: { x: number; z: number }) =>
      Math.abs(Math.hypot(p.x - coreX, p.z - coreZ) - coreRadius - 62)
      // The default camera looks from +X/+Z: prefer a far locality behind the
      // task center, not one clipped off the narrow portrait side of the world.
      + Math.abs((p.x - coreX) - (p.z - coreZ)) * .55
      + Math.max(0, (p.x - coreX) + (p.z - coreZ)) * .4;
    return { point, score: score(point), tie: hash(`${input.worldSeed}:${point.x}:${point.z}`) };
  }).sort((a, b) => a.score - b.score || a.tie - b.tie || a.point.x - b.point.x || a.point.z - b.point.z)
    .map(entry => entry.point);
  const anchor = compact ? undefined : candidates.find(p => modules.every(m => supports(p.x + m.x, p.z + m.z, m.width, m.depth)));
  const village = anchor ? { ...anchor, width: villageWidth, depth: villageDepth } : null;
  const anchors = anchor ? [anchor] : [];
  // Separate localities on supported far land, never a decorative ring around tasks.
  const localityBudget = compact ? 0 : Math.min(3, Math.max(1, 1 + Math.floor(distantArea / 1_200_000)));
  const farVillageSites = orderedBy(distantLand.map(s=>({x:Math.round((s.minX+s.maxX)/2),z:Math.round((s.minZ+s.maxZ)/2)})),
    p=>hash(`${input.worldSeed}:far-village:${p.x}:${p.z}`));
  for (const site of farVillageSites) {
    if (anchors.length >= localityBudget || compact) break;
    if (Math.hypot(site.x-coreX,site.z-coreZ)<coreRadius+70 || anchors.some(p=>Math.hypot(p.x-site.x,p.z-site.z)<180))continue;
    if (modules.every(m=>supports(site.x+m.x,site.z+m.z,m.width,m.depth)))anchors.push(site);
  }
  for (const [localityIndex, anchor] of anchors.entries()) {
    const localityId = localityIndex === 0 ? 'village' : `far-village:${anchor.x}:${anchor.z}`;
    for (const [i, m] of modules.entries()) {
      const x = anchor.x + m.x, z = anchor.z + m.z;
      const datum = supports(x, z, m.width, m.depth)!.max;
      const footing = new Blocks();
      // Each floor block is supported to the sampled surface; no floating slab.
      for (const v of m.voxels.filter(v => v.y === 0)) {
        const support = surfaceAt(x + v.x, z + v.z)!;
        for (let y = -1; y >= Math.floor(support.supportY - datum + .001); y--) footing.put(v.x, y, v.z, 'cobblestone', 'stone');
      }
      const base = footing.result();
      objects.push({ id: `scenery:${input.worldSeed}:${localityId}:${i}`, role: m.role, x, y: datum, z,
        width: m.width, depth: m.depth, voxels: [...base.voxels, ...m.voxels], distantVoxels: [...base.distantVoxels, ...m.distantVoxels] });
    }
    const b = new Blocks();
    // Branch streets meet each entrance rather than two unrelated path strips.
    for (const m of modules) {
      const targetZ = m.z + Math.ceil(m.depth / 2);
      for (let x = Math.min(0, m.x); x <= Math.max(0, m.x); x++) path(x, 0);
      for (let z = Math.min(0, targetZ); z <= Math.max(0, targetZ); z++) path(m.x, z);
    }
    function path(x: number, z: number): void {
      for (const dx of [0, 1]) {
        const s = surfaceAt(anchor!.x + x + dx, anchor!.z + z);
        if (s && !s.water && !modules.some(m => Math.abs(x + dx - m.x) < m.width / 2 && Math.abs(z - m.z) < m.depth / 2))
          b.put(x + dx, s.supportY - .08, z, 'dirt_path', 'wood');
      }
    }
    objects.push({ id: `scenery:${input.worldSeed}:${localityId}:path`, role: 'path', x: anchor.x, y: 0, z: anchor.z,
      width: villageWidth, depth: villageDepth, ...b.result() });
  }
  const occupied = (p: SceneryProtectedRect, gap = 2) => protectedRects.some(r => overlaps(p, r, gap))
    || objects.some(o => o.role !== 'path' && overlaps(p, o, gap))
    || input.roads.some(r => overlaps(p, { ...r, width: 1, depth: 1 }, gap));
  // One or two readable landmarks, not every possible structure sprinkled everywhere.
  const landSites = orderedBy(surfaces.filter(s => !s.water).map(s => ({ x: Math.round((s.minX + s.maxX) / 2), z: Math.round((s.minZ + s.maxZ) / 2) }))
    .filter(p => Math.hypot(p.x - coreX, p.z - coreZ) > coreRadius + (compact ? 6 : 15)),
    p => hash(`${input.worldSeed}:landmark:${p.x}:${p.z}`));
  function landStructure(role: SceneryRole, width: number, depth: number, blocks: ReturnType<Blocks['result']>, preferredDistance: number,
    accept: (x:number,z:number)=>boolean = ()=>true, suffix=''): void {
    const site = orderedBy(landSites.filter(p => accept(p.x,p.z) && !occupied({ ...p, width, depth })),
      p => Math.abs(Math.hypot(p.x - coreX, p.z - coreZ) - preferredDistance))
      .find(p => supports(p.x, p.z, width, depth));
    if (!site) return;
    const datum = supports(site.x, site.z, width, depth)!.max, footing = new Blocks();
    for (const v of blocks.voxels.filter(v => v.y === 0)) {
      const s = surfaceAt(site.x + v.x, site.z + v.z);
      if (!s || s.water) continue;
      for (let y = -1; y >= Math.floor(s.supportY - datum + .001); y--) footing.put(v.x, y, v.z, 'stone', 'stone');
    }
    const base = footing.result();
    objects.push({ id: `scenery:${input.worldSeed}:${role}${suffix}`, role, ...site, y: datum, width, depth,
      voxels: [...blocks.voxels, ...base.voxels], distantVoxels: [...blocks.distantVoxels, ...base.distantVoxels] });
  }
  if (input.environmentStyle === 'mosaic-coast') {
    const region=(x:number,z:number)=>mosaicRegionAt(x-coreX,z-coreZ,coreRadius);
    const regionIs=(ids:readonly string[])=>(x:number,z:number)=>ids.includes(region(x,z));
    landStructure('camp',13,11,sceneryCampBlocks('white_wool'),coreRadius+155,regionIs(['11','12']),':snow');
    landStructure('ruin',9,9,sceneryRuinBlocks(),coreRadius+180,regionIs(['31','32']),':mesa');
    landStructure('house',9,11,sceneryHouseBlocks('poplar','spruce'),coreRadius+180,regionIs(['33']),':forest');
    landStructure('camp',13,11,sceneryCampBlocks('orange_wool'),coreRadius+160,regionIs(['33']),':forest');
    landStructure('dock',7,15,sceneryDockBlocks(),coreRadius+130,regionIs(['23']),':coast');
    let spikes=0;
    for (const site of landSites) {
      if (spikes>=26) break;
      const s=surfaceAt(site.x,site.z);
      if (region(site.x,site.z)!=='21' || !s || !['ice','snow'].includes(s.material??'')
        || occupied({...site,width:9,depth:9},6) || !supports(site.x,site.z,7,7)) continue;
      const datum=supports(site.x,site.z,7,7)!.max,spire=sceneryIceSpireBlocks(hash(`${input.worldSeed}:${site.x}:${site.z}`)),footing=new Blocks();
      for(const block of spire.voxels.filter(block=>block.y===0)){
        const ground=surfaceAt(site.x+block.x,site.z+block.z)!;
        for(let y=-1;y>=Math.floor(ground.supportY-datum+.001);y--)footing.put(block.x,y,block.z,'packed_ice','glass');
      }
      const base=footing.result();
      objects.push({id:`scenery:${input.worldSeed}:ice-spike:${spikes}`,role:'rock',...site,y:datum,
        width:7,depth:7,voxels:[...spire.voxels,...base.voxels],distantVoxels:[...spire.distantVoxels,...base.distantVoxels]});
      spikes++;
    }
    // One world-coordinate reef, partitioned only for culling and batching.
    // No independently seeded ellipses or regularly spaced prefab gaps.
    const seed=mosaicSeed(input.worldSeed),spacing=mosaicGridPosition(0,0,coreRadius).spacing;
    const centerX=coreX+.25*spacing/Math.SQRT2,centerZ=coreZ-1.55*spacing/Math.SQRT2;
    const radius=Math.max(88,Math.min(150,spacing*.6)),tile=40,half=tile/2;
    const dryStructures=objects.filter(o=>o.role!=='path');
    for(let x=Math.floor((centerX-radius)/tile)*tile;x<=centerX+radius;x+=tile)
      for(let z=Math.floor((centerZ-radius)/tile)*tile;z<=centerZ+radius;z+=tile){
        const allowed=(dx:number,dz:number)=>{
          if(dx< -half||dx>=half||dz< -half||dz>=half)return false;
          const wx=x+dx,wz=z+dz,at=surfaceAt(wx,wz);
          const fringe=radius+(hash(`${input.worldSeed}:reef-edge:${Math.floor(wx/12)}:${Math.floor(wz/12)}`)%9-4);
          return Boolean(at?.water&&['13','23'].includes(region(wx,wz))&&Math.hypot(wx-centerX,wz-centerZ)<fringe
            &&!protectedRects.some(r=>overlaps({x:wx,z:wz,width:1,depth:1},r,2))
            &&!dryStructures.some(r=>overlaps({x:wx,z:wz,width:1,depth:1},r,1)));
        };
        const reef=createReefField(seed,half,half,allowed,{originX:x,originZ:z,
          baseY:(dx,dz)=>Math.floor(mosaicSeabedHeight(x+dx-coreX,z+dz-coreZ,seed,coreRadius)+.5)});
        if(reef.voxels.length<12)continue;
        objects.push({id:`scenery:${input.worldSeed}:reef:${x}:${z}`,role:'rock',x,z,y:0,width:tile,depth:tile,...reef});
      }
  }
  if (input.environmentStyle === 'natural-valley') {
    landStructure('camp', 13, 11, sceneryCampBlocks(), coreRadius + 27);
    landStructure('ruin', 9, 9, sceneryRuinBlocks(), coreRadius + 105);
  } else if (compact) {
    landStructure('rock', 7, 7, sceneryRockBlocks(input.worldSeed), coreRadius + 12);
  } else {
    landStructure('camp', 13, 11, sceneryCampBlocks(), coreRadius + 30);
    // Ocean water can be one large quad, whose center is under the main island.
    // Search supported shore offsets instead of requiring one candidate per water quad.
    function wreckAtShore(searchRadius:number) {
    const waterCandidates = new Map<string, { x: number; z: number; y: number }>();
    for (const land of landSites.filter(p => Math.hypot(p.x - coreX, p.z - coreZ) < searchRadius)) {
      for (const offset of [16, 20, 24, 28]) for (const [dx, dz] of [[offset, 0], [-offset, 0], [0, offset], [0, -offset]]) {
        const x = land.x + dx!, z = land.z + dz!, s = surfaceAt(x, z);
        if (s?.water) waterCandidates.set(`${x}:${z}`, { x, z, y: s.supportY });
      }
    }
    const waterSites = [...waterCandidates.values()].filter(p => Math.hypot(p.x - coreX, p.z - coreZ) > coreRadius + 15)
      .sort((a, b) => {
        const score = (p: { x: number; z: number }) => Math.abs(Math.hypot(p.x - coreX, p.z - coreZ) - coreRadius - 33)
          + Math.abs((p.x - coreX) - (p.z - coreZ)) * .4
          + Math.max(0, (p.x - coreX) + (p.z - coreZ)) * .5;
        return score(a) - score(b) || a.x - b.x || a.z - b.z;
      });
    return waterSites.find(p => !occupied({ ...p, width: 9, depth: 21 }, 4)
      && [-4, 0, 4].every(dx => [-10, 0, 10].every(dz => surfaceAt(p.x + dx, p.z + dz)?.water))
      && [[18, 0], [-18, 0], [0, 18], [0, -18]].some(([dx, dz]) => { const s = surfaceAt(p.x + dx!, p.z + dz!); return s && !s.water; }));
    }
    // Keep existing valid landmarks. The island grows faster than the task
    // footprint: if the old search is all dry land, follow the actual shore.
    const wreck = wreckAtShore(coreRadius + 75) ?? wreckAtShore(coreRadius * 3 + 140);
    if (wreck) objects.push({ id: `scenery:${input.worldSeed}:wreck`, role: 'wreck', x: wreck.x, y: wreck.y - .2, z: wreck.z,
      width: 9, depth: 21, ...sceneryWreckBlocks() });
    const shore = landSites.find(p => !occupied({ ...p, width: 7, depth: 15 })
      && supports(p.x, p.z - 5, 5, 5) && surfaceAt(p.x, p.z + 5)?.water && surfaceAt(p.x + 2, p.z + 7)?.water);
    if (shore) objects.push({ id: `scenery:${input.worldSeed}:dock`, role: 'dock', ...shore,
      y: Math.max(surfaceAt(shore.x, shore.z - 5)!.supportY, surfaceAt(shore.x, shore.z + 5)!.supportY + .6),
      width: 7, depth: 15, ...sceneryDockBlocks() });
  }
  // Keep deterministic tree sites, replace the giant-box model with unit blocks.
  const coldRegionCache = new Map<string,boolean>();
  const sceneryClimateSeed = mosaicSeed(input.worldSeed);
  const coldTreeRegion = (x:number,z:number) => {
    if (input.environmentStyle !== 'mosaic-coast') return false;
    const key=`${x}:${z}`,cached=coldRegionCache.get(key);
    if(cached!==undefined)return cached;
    const surface = surfaceAt(x,z);
    // A crown belongs to the snow grove even when its trunk falls on a grass
    // border cell. Centre-only classification left old oak/birch beside ice.
    const cold=surface?.material === 'snow' || surface?.material === 'ice'
      || mosaicRegionAt(x-coreX,z-coreZ,coreRadius) === '21'
      || sampleMosaicTerrain(x-coreX,z-coreZ,sceneryClimateSeed,coreRadius).biome === 'glacier'
      || [[-8,0],[8,0],[0,-8],[0,8],[-6,-6],[-6,6],[6,-6],[6,6]].some(([dx,dz])=>{
        const material=surfaceAt(x+dx!,z+dz!)?.material;
        return material==='snow'||material==='ice';
      });
    coldRegionCache.set(key,cold);return cold;
  };
  // The snow grove owns all cold-region trees. Don't retain old generic tree
  // sites alongside the new tall spruce placement pass.
  const treeSites = input.trees.filter(tree => !coldTreeRegion(tree.x,tree.z));
  if (!compact && input.normalBounds) {
    const farTreeBudget = Math.min(320, Math.floor(Math.sqrt(distantArea) / 8));
    const farSites = orderedBy(distantLand.map(s=>({x:Math.round((s.minX+s.maxX)/2),z:Math.round((s.minZ+s.maxZ)/2)})),
      p=>hash(`${input.worldSeed}:far-tree:${p.x}:${p.z}`));
    let count=0;
    for (const site of farTreeBudget > 0 ? farSites : []) {
      const s=surfaceAt(site.x,site.z);
      if (!s || s.water || coldTreeRegion(site.x,site.z) || (s.material && !['grass'].includes(s.material)) || occupied({...site,width:7,depth:7})
        || treeSites.some(t=>Math.hypot(t.x-site.x,t.z-site.z)<14) || !supports(site.x,site.z,3,3))continue;
      treeSites.push({...site,y:s.supportY,scale:1});
      if (++count >= farTreeBudget) break;
    }
  }
  if (compact && treeSites.length === 0) for (const site of landSites) {
    if (supports(site.x, site.z, 5, 5) && !occupied({ ...site, width: 7, depth: 7 })
      && treeSites.every(t => Math.hypot(t.x - site.x, t.z - site.z) > 8)) treeSites.push({ ...site, y: surfaceAt(site.x, site.z)!.supportY, scale: 1 });
    if (treeSites.length >= 3) break;
  }
  if(input.environmentStyle==='mosaic-coast'){
    let grove=0;
    for(const site of [...landSites].sort((a,b)=>Math.hypot(a.x-coreX,a.z-coreZ)-Math.hypot(b.x-coreX,b.z-coreZ)||a.x-b.x||a.z-b.z)){
      if(grove>=120)break;
      if(sampleMosaicTerrain(site.x-coreX,site.z-coreZ,mosaicSeed(input.worldSeed),coreRadius).biome!=='forest')continue;
      const s=surfaceAt(site.x,site.z);
      if(!s||s.water||s.material!=='grass'||occupied({...site,width:11,depth:11},2)
        ||!supports(site.x,site.z,3,3)||treeSites.some(t=>Math.hypot(t.x-site.x,t.z-site.z)<11))continue;
      treeSites.push({...site,y:s.supportY,scale:1});grove++;
    }
    let taiga=0;
    for(const site of landSites){
      if(taiga>=65)break;
      const s=surfaceAt(site.x,site.z);
      if(!coldTreeRegion(site.x,site.z)||!s||s.water||s.material!=='snow'||occupied({...site,width:9,depth:9},3)
        ||!supports(site.x,site.z,5,5)||treeSites.some(t=>Math.hypot(t.x-site.x,t.z-site.z)<11))continue;
      treeSites.push({...site,y:s.supportY,scale:1});taiga++;
    }
  }
  for (const [index, tree] of treeSites.entries()) {
    const x = Math.round(tree.x), z = Math.round(tree.z);
    const mosaicBiome=input.environmentStyle==='mosaic-coast'?sampleMosaicTerrain(x-coreX,z-coreZ,mosaicSeed(input.worldSeed),coreRadius).biome:null;
    const poplar=mosaicBiome==='forest',taiga=coldTreeRegion(x,z);
    const footprint=poplar?9:taiga?7:5;
    if (objects.filter(o => o.role !== 'path').some(o => overlaps({ x, z, width: footprint+2, depth: footprint+2 }, o, 2))
      || protectedRects.some(r => overlaps({ x, z, width: footprint+2, depth: footprint+2 }, r, 2))
      || input.roads.some(r => Math.abs(r.x - x) < 5 && Math.abs(r.z - z) < 5)) continue;
    const support = surfaceAt(x, z);
    if (!support || support.water || (support.material && !['grass','snow'].includes(support.material)) || !supports(x,z,3,3)) continue;
    const biome = sceneryBiome(input.worldSeed, x, z, input.environmentStyle, support.supportY);
    if (!poplar && !taiga && biome === 'meadow' && hash(`${input.worldSeed}:open:${x}:${z}`) % 4 !== 0) continue;
    const species = poplar ? 'poplar'
      : taiga || biome === 'highland' ? 'spruce' : biome === 'birch-grove' ? 'birch' : 'oak';
    const variant=poplar?hash(`${input.worldSeed}:poplar:${Math.floor(x/24)}:${Math.floor(z/24)}`):index;
    objects.push({ id: `scenery:${input.worldSeed}:tree:${index}`, role: 'tree', x, y: support.supportY, z,
      width: footprint, depth: footprint, ...sceneryTreeBlocks(species, variant, taiga) });
  }
  if (anchor) {
    const groveSites = [{ x: anchor.x - 16, z: anchor.z - 3 }, { x: anchor.x - 12, z: anchor.z - 13 },
      { x: anchor.x + 15, z: anchor.z + 2 }];
    for (const [index, site] of groveSites.entries()) {
      if (coldTreeRegion(site.x,site.z)) continue;
      const support = surfaceAt(site.x, site.z);
      if (!support || support.water || (support.material && support.material!=='grass') || !supports(site.x,site.z,3,3) || objects.some(o => o.role !== 'path' && overlaps({ ...site, width: 7, depth: 7 }, o, 1))
        || protectedRects.some(r => overlaps({ ...site, width: 7, depth: 7 }, r, 2))
        || input.roads.some(r => Math.abs(r.x - site.x) < 5 && Math.abs(r.z - site.z) < 5)) continue;
      objects.push({ id: `scenery:${input.worldSeed}:village-tree:${index}`, role: 'tree', ...site, y: support.supportY,
        width: 5, depth: 5, ...sceneryTreeBlocks(index === 1 ? 'birch' : 'oak', index) });
    }
  }
  // Compact mixed patches, with clustered species rather than isolated petals.
  const flowerKinds = ['poppy', 'dandelion', 'oxeye_daisy', 'cornflower'] as const;
  const meadowSites = landSites.filter(p => {
    if (Math.hypot(p.x - coreX, p.z - coreZ) >= coreRadius + (compact ? 20 : 60)
      || occupied({ ...p, width: 9, depth: 7 })) return false;
    const s = surfaceAt(p.x, p.z);
    return s && !s.water && (!s.material || s.material==='grass')
      && sceneryBiome(input.worldSeed, p.x, p.z, input.environmentStyle, s.supportY) === 'meadow' && supports(p.x,p.z,9,7);
  });
  const gardenSites = anchor ? [{ x: anchor.x - 15, z: anchor.z + 5 }, { x: anchor.x + 6, z: anchor.z + 14 }] : [];
  for (const site of meadowSites) {
    if (gardenSites.every(p => Math.hypot(p.x - site.x, p.z - site.z) > 18)) gardenSites.push(site);
    if (gardenSites.length >= (compact ? 2 : 6)) break;
  }
  if (!compact && input.normalBounds) {
    const farGardenBudget = Math.min(24, Math.floor(Math.sqrt(distantArea)/110));
    let count=0;
    for (const s of orderedBy(farGardenBudget > 0 ? distantLand : [],
      p=>hash(`${input.worldSeed}:far-garden:${p.minX}:${p.minZ}`))) {
      if(s.material && s.material !== 'grass')continue;
      const site={x:Math.round((s.minX+s.maxX)/2),z:Math.round((s.minZ+s.maxZ)/2)};
      if(sceneryBiome(input.worldSeed,site.x,site.z,input.environmentStyle,s.supportY)!=='meadow'
        || occupied({...site,width:9,depth:7}) || gardenSites.some(p=>Math.hypot(p.x-site.x,p.z-site.z)<24))continue;
      gardenSites.push(site);
      if(++count>=farGardenBudget)break;
    }
  }
  for (const [index, site] of gardenSites.entries()) {
    if (!supports(site.x,site.z,9,7)) continue;
    const b = new Blocks();
    for (let dx = -4; dx <= 4; dx++) for (let dz = -3; dz <= 3; dz++) {
      if ((dx / 4) ** 2 + (dz / 3) ** 2 > 1 || hash(`${input.worldSeed}:flower:${dx}:${dz}:${index}`) % 100 > 64) continue;
      const x = site.x + dx, z = site.z + dz, s = surfaceAt(x, z);
      if (!s || s.water || (s.material && s.material!=='grass') || protectedRects.some(r => overlaps({ x, z, width: 1, depth: 1 }, r, 2))
        || input.roads.some(r => Math.abs(r.x - x) <= 2 && Math.abs(r.z - z) <= 2)
        || objects.filter(o => o.role !== 'path').some(o => overlaps({ x, z, width: 1, depth: 1 }, o, 1))) continue;
      const flower = flowerKinds[(Math.floor((dx + 4) / 3) + Math.floor((dz + 3) / 3) + index) % flowerKinds.length]!;
      b.put(dx, s.supportY, dz, flower, 'accent');
    }
    if (b.result().voxels.length) objects.push({ id: `scenery:${input.worldSeed}:garden:${index}`, role: 'garden',
      x: site.x, y: 0, z: site.z, width: 9, depth: 7, ...b.result() });
  }
  return { village, objects };
}

/** Continuous value noise gives connected patches; adjacent blocks do not roll independent biomes. */
export function sceneryBiome(seed: string, x: number, z: number, environment: EnvironmentStyle, height: number): 'meadow' | 'oak-grove' | 'birch-grove' | 'highland' {
  if ((environment === 'natural-valley' || environment === 'mosaic-coast') && height > 20) return 'highland';
  const sx = x / 32, sz = z / 32, ix = Math.floor(sx), iz = Math.floor(sz);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const tx = smooth(sx - ix), tz = smooth(sz - iz);
  const n = (dx: number, dz: number) => hash(`${seed}:biome:${ix + dx}:${iz + dz}`) / 0xffffffff;
  const value = (n(0, 0) * (1 - tx) + n(1, 0) * tx) * (1 - tz) + (n(0, 1) * (1 - tx) + n(1, 1) * tx) * tz;
  return value < .42 ? 'meadow' : value > .68 && environment !== 'ocean-island' ? 'birch-grove' : 'oak-grove';
}

export function sceneryCampBlocks(cloth='brown_wool'): ReturnType<Blocks['result']> {
  const b = new Blocks();
  // Low A-frame tent, open doorway, extinguished campfire and a broken log bench.
  for (let x = -4; x <= 2; x++) for (let z = -4; z <= 1; z++) {
    b.put(x, 0, z, 'spruce_planks', 'plank');
    const y = 4 - Math.abs(x + 1);
    if (y > 0) b.put(x, y, z, cloth, 'roof');
    if (z === -4 && y > 1) for (let yy = 1; yy < y; yy++) b.put(x, yy, z, cloth, 'roof');
  }
  b.put(-1, 4, -4, 'spruce_log', 'wood', true, { axis: 'z' });
  b.put(4, 0, 3, 'campfire', 'wood', false, { facing: 'north', lit: 'false', signal_fire: 'false', waterlogged: 'false' });
  for (let x = 2; x <= 5; x++) b.put(x, 0, 5, 'oak_log', 'wood', true, { axis: 'x' });
  b.put(-3, 1, -3, 'barrel', 'wood', false, { facing: 'up', open: 'false' });
  return b.result();
}

export function sceneryWreckBlocks(): ReturnType<Blocks['result']> {
  const b = new Blocks();
  for (let z = -10; z <= 10; z++) {
    const radius = Math.abs(z) > 7 ? 1 : Math.abs(z) > 5 ? 2 : 3;
    for (let x = -radius; x <= radius; x++) {
      b.put(x, -2, z, 'dark_oak_planks', 'plank');
      if (Math.abs(x) === radius) for (let y = -1; y <= (z < 4 ? 2 : 0); y++) {
        if (z === 2 && y === 2 && x > 0) continue;
        b.put(x, y, z, 'dark_oak_planks', 'plank');
      }
      if (z < -5 || z > 6) b.put(x, 1, z, 'spruce_slab', 'plank', true, { type: 'bottom', waterlogged: 'false' });
    }
  }
  for (let y = -1; y <= 10; y++) b.put(0, y, -2, 'spruce_log', 'wood', true, { axis: 'y' });
  for (let x = -4; x <= 3; x++) b.put(x, 8, -2, 'spruce_log', 'wood', true, { axis: 'x' });
  for (let x = -3; x <= 2; x++) for (let y = 4; y <= 7; y++) {
    if (hash(`torn:${x}:${y}`) % 5) b.put(x, y, -2, 'white_wool', 'accent');
  }
  return b.result();
}

export function sceneryDockBlocks(): ReturnType<Blocks['result']> {
  const b = new Blocks();
  for (let z = -7; z <= 7; z++) for (let x = -2; x <= 2; x++) b.put(x, 0, z, 'oak_slab', 'plank', true, { type: 'bottom', waterlogged: 'false' });
  for (const x of [-3, 3]) for (const z of [-5, 0, 5]) for (let y = -3; y <= 1; y++) b.put(x, y, z, 'oak_log', 'wood', true, { axis: 'y' });
  b.put(1, 1, -5, 'barrel', 'wood', false, { facing: 'up', open: 'false' });
  return b.result();
}

export function sceneryRuinBlocks(): ReturnType<Blocks['result']> {
  const b = new Blocks();
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
    b.put(x, 0, z, 'mossy_cobblestone', 'stone');
    if (Math.abs(x) !== 3 && Math.abs(z) !== 3) continue;
    if (z === 3 && Math.abs(x) <= 1) continue;
    const height = 4 + hash(`ruin:${x}:${z}`) % 6;
    for (let y = 1; y <= height; y++) {
      if (y === 4 && (Math.abs(x) === 3 && z === 0 || Math.abs(z) === 3 && x === 0)) continue;
      b.put(x, y, z, hash(`moss:${x}:${y}:${z}`) % 4 === 0 ? 'mossy_stone_bricks' : 'stone_bricks', 'stone');
    }
  }
  return b.result();
}

function sceneryRockBlocks(seed: string): ReturnType<Blocks['result']> {
  const b = new Blocks();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    if (x * x + z * z > 13) continue;
    const height = Math.max(1, 5 - Math.abs(x) - Math.abs(z) + hash(`${seed}:rock:${x}:${z}`) % 2);
    for (let y = 0; y < height; y++) b.put(x, y, z, y === height - 1 && (x + z) % 3 ? 'moss_block' : 'andesite', y === height - 1 ? 'accent' : 'stone');
  }
  return b.result();
}

export function sceneryIceSpireBlocks(seed:number): ReturnType<Blocks['result']> {
  const b=new Blocks(),height=12+seed%17;
  for(let y=0;y<height;y++){
    const radius=Math.max(0,Math.floor(3*Math.pow(1-y/height,1.4)));
    for(let x=-radius;x<=radius;x++)for(let z=-radius;z<=radius;z++)if(Math.abs(x)+Math.abs(z)<=radius+1)
      b.put(x,y,z,(x+z+y)%7===0?'blue_ice':'packed_ice','glass');
  }
  return b.result();
}
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
  return value >>> 0;
}

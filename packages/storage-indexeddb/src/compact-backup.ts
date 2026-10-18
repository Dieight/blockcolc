import type { DomainState, ImportedBlueprintV1, ImportedBlueprintVoxel } from '@blockcolc/domain';

/** Bounds reference expansion independently of the encoded file size. */
export const MAX_EXPANDED_BACKUP_BYTES = 512 * 1024 * 1024;
type VoxelStyle = Omit<ImportedBlueprintVoxel, 'x' | 'y' | 'z'>;
interface PackedBlueprint extends Omit<ImportedBlueprintV1, 'voxels'> {
  palette: VoxelStyle[];
  voxels: Array<[number, number, number, number]>;
}
export interface CompactBackupPayload { state: unknown; blueprints: PackedBlueprint[] }
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Deduplicate complete blueprint snapshots, then repeated voxel properties.
 * References only occur in known blueprint slots, never in arbitrary user text. */
export function packBackupPayload(state: DomainState): CompactBackupPayload {
  const blueprints: PackedBlueprint[] = [], byContent = new Map<string, number>();
  const byIdentity = new WeakMap<ImportedBlueprintV1, { $blueprint: number }>();
  const reference = (blueprint: ImportedBlueprintV1 | null) => {
    if (blueprint === null) return null;
    const known = byIdentity.get(blueprint);
    if (known) return known;
    const { voxels, ...header } = blueprint;
    const palette: VoxelStyle[] = [], styles = new Map<string, number>();
    const packed: PackedBlueprint = { ...header, palette, voxels: voxels.map(({ x, y, z, ...style }) => {
      const key = JSON.stringify(style);
      let index = styles.get(key);
      if (index === undefined) { index = palette.length; styles.set(key, index); palette.push(style); }
      return [x, y, z, index];
    }) };
    const key = JSON.stringify(packed);
    let index = byContent.get(key);
    if (index === undefined) { index = blueprints.length; byContent.set(key, index); blueprints.push(packed); }
    const result = { $blueprint: index }; byIdentity.set(blueprint, result); return result;
  };
  return { state: mapBlueprintSlots(state, reference), blueprints };
}

export function unpackBackupPayload(raw: unknown): unknown {
  const payload = record(raw);
  if (Object.keys(payload).sort().join(',') !== 'blueprints,state' || !Array.isArray(payload.blueprints)) throw Error('Invalid compact backup');
  const state = record(payload.state), used = new Set<number>();
  let expandedBytes = bytes(state);
  const decoded = new Map<number, { blueprint: ImportedBlueprintV1; bytes: number }>();
  const reference = (rawReference: unknown) => {
    if (rawReference === null) return null;
    const ref = record(rawReference), index = ref.$blueprint;
    if (Object.keys(ref).length !== 1 || !Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= payload.blueprints.length) throw Error('Invalid blueprint reference');
    const id = Number(index); used.add(id);
    let entry = decoded.get(id);
    if (!entry) {
      const packed = record(payload.blueprints[id]);
      if (Object.keys(packed).sort().join(',') !== 'bounds,id,palette,schemaVersion,title,voxels'
        || !Array.isArray(packed.palette) || packed.palette.length < 1 || packed.palette.length > 300_000
        || !Array.isArray(packed.voxels) || packed.voxels.length < 1 || packed.voxels.length > 300_000) throw Error('Invalid packed blueprint');
      const palette = packed.palette.map((value: unknown) => {
        const style = record(value);
        if ('x' in style || 'y' in style || 'z' in style) throw Error('Palette cannot override coordinates');
        return style;
      });
      const { palette: _palette, voxels: _voxels, ...header } = packed;
      // Account for repeated palette data before allocating expanded voxels.
      const styleBytes = palette.map((style: unknown) => bytes(style));
      let blueprintBytes = bytes(header) + 16;
      for (const voxel of packed.voxels) {
        if (!Array.isArray(voxel) || voxel.length !== 4 || !voxel.every(Number.isSafeInteger)
          || voxel[3] < 0 || voxel[3] >= palette.length) throw Error('Invalid packed voxel');
        blueprintBytes += styleBytes[voxel[3]]! + bytes({ x: voxel[0], y: voxel[1], z: voxel[2] }) + 1;
        if (expandedBytes + blueprintBytes > MAX_EXPANDED_BACKUP_BYTES) throw Error('Backup exceeds the 512 MiB expanded limit');
      }
      const blueprint = { ...header, voxels: packed.voxels.map((v: number[]) => ({ ...palette[v[3]!], x: v[0], y: v[1], z: v[2] })) } as ImportedBlueprintV1;
      entry = { blueprint, bytes: bytes(blueprint) }; decoded.set(id, entry);
    }
    expandedBytes += entry.bytes;
    if (expandedBytes > MAX_EXPANDED_BACKUP_BYTES) throw Error('Backup exceeds the 512 MiB expanded limit');
    return entry.blueprint;
  };
  const restored = mapBlueprintSlots(state, reference);
  if (used.size !== payload.blueprints.length) throw Error('Unreferenced blueprint content');
  return restored;
}

function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected backup object');
  return value as Record<string, any>;
}

function mapBlueprintSlots(state: Record<string, any>, convert: (blueprint: any) => unknown): unknown {
  const map = (key: string, slot: string) => {
    if (!Array.isArray(state[key])) throw Error('Invalid blueprint owner collection');
    return state[key].map((raw: unknown) => { const owner = record(raw); return { ...owner, [slot]: convert(owner[slot]) }; });
  };
  return { ...state, projects: map('projects', 'importedBlueprint'), habitBuildings: map('habitBuildings', 'importedBlueprint'),
    buildingBlueprintResources: map('buildingBlueprintResources', 'blueprint'), decorationBlueprintResources: map('decorationBlueprintResources', 'blueprint') };
}

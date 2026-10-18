import { TERRAIN_MATERIALS, type MergedGeometryData, type TerrainMaterial } from './terrain';

/** The datum used by props/rewards, half a block above the actual top vertices. */
export interface ScenerySurface {
  minX: number; maxX: number; minZ: number; maxZ: number;
  supportY: number; water: boolean; material?: string;
}
export type SurfaceSource = readonly ScenerySurface[] | TerrainSurfaceTable;
type TerrainSurface = ScenerySurface & { material: TerrainMaterial };
type TerrainTops = Pick<MergedGeometryData, 'positions' | 'indicesByMaterial'>;
const WATER_MATERIAL = TERRAIN_MATERIALS.indexOf('water');

/** A read-only CPU table, not another mesh. Rows follow material/quad input
 * order (including equal-height ties). Private numeric columns avoid retaining
 * tens of thousands of rectangle objects or duplicating decoded positions. */
export class TerrainSurfaceTable implements Iterable<TerrainSurface> {
  readonly length: number;
  readonly byteLength: number;
  readonly #coordinates: Float64Array;
  readonly #materials: Uint8Array;

  constructor(terrain: TerrainTops) {
    this.length = TERRAIN_MATERIALS.reduce((n, material) => n + Math.floor(terrain.indicesByMaterial[material].length / 6), 0);
    this.#coordinates = new Float64Array(this.length * 5);
    this.#materials = new Uint8Array(this.length);
    let row = 0;
    const p = terrain.positions;
    for (let material = 0; material < TERRAIN_MATERIALS.length; material++) {
      const indices = terrain.indicesByMaterial[TERRAIN_MATERIALS[material]!];
      for (let i = 0; i + 5 < indices.length; i += 6, row++) {
        const a = indices[i]! * 3, b = indices[i + 1]! * 3, c = indices[i + 2]! * 3, d = indices[i + 5]! * 3;
        const offset = row * 5;
        this.#coordinates[offset] = Math.min(p[a]!, p[b]!, p[c]!, p[d]!);
        this.#coordinates[offset + 1] = Math.max(p[a]!, p[b]!, p[c]!, p[d]!);
        this.#coordinates[offset + 2] = Math.min(p[a + 2]!, p[b + 2]!, p[c + 2]!, p[d + 2]!);
        this.#coordinates[offset + 3] = Math.max(p[a + 2]!, p[b + 2]!, p[c + 2]!, p[d + 2]!);
        this.#coordinates[offset + 4] = Math.max(p[a + 1]!, p[b + 1]!, p[c + 1]!, p[d + 1]!) + .5;
        this.#materials[row] = material;
      }
    }
    this.byteLength = this.#coordinates.byteLength + this.#materials.byteLength;
    Object.freeze(this);
  }

  /** Fresh records: a caller cannot mutate the table through an iteration. */
  at(row: number): TerrainSurface | undefined {
    if (!Number.isInteger(row) || row < 0 || row >= this.length) return undefined;
    const offset = row * 5, material = TERRAIN_MATERIALS[this.#materials[row]!]!;
    return { minX: this.#coordinates[offset]!, maxX: this.#coordinates[offset + 1]!,
      minZ: this.#coordinates[offset + 2]!, maxZ: this.#coordinates[offset + 3]!,
      supportY: this.#coordinates[offset + 4]!, water: material === 'water', material };
  }

  *[Symbol.iterator](): IterableIterator<TerrainSurface> {
    for (let row = 0; row < this.length; row++) yield this.at(row)!;
  }

  /** Scan numeric rows, allocating only the winning record. Equal heights keep
   * the earlier input; dry ground must be more than .01 above water to win. */
  sample(x: number, z: number, rows?: Uint32Array, start = 0, end = rows?.length ?? this.length): TerrainSurface | undefined {
    let ground = -1, water = -1, groundY = 0, waterY = 0;
    const p = this.#coordinates;
    for (let i = start; i < end; i++) {
      const row = rows ? rows[i]! : i, offset = row * 5;
      if (!(p[offset]! < p[offset + 1]! && p[offset + 2]! < p[offset + 3]!
        && x >= p[offset]! && x <= p[offset + 1]! && z >= p[offset + 2]! && z <= p[offset + 3]!)) continue;
      const y = p[offset + 4]!;
      if (this.#materials[row] === WATER_MATERIAL) { if (water < 0 || y > waterY) { water = row; waterY = y; } }
      else if (ground < 0 || y > groundY) { ground = row; groundY = y; }
    }
    return this.at(ground >= 0 && (water < 0 || groundY > waterY + .01) ? ground : water);
  }
}

const tables = new WeakMap<TerrainTops, TerrainSurfaceTable>();

/** Generated/restored source geometry is immutable for its renderer lifetime.
 * A new terrain identity starts a new table; no seed-only or global history. */
export function terrainSurfaceTable(terrain: TerrainTops): TerrainSurfaceTable {
  let table = tables.get(terrain);
  if (!table) { table = new TerrainSurfaceTable(terrain); tables.set(terrain, table); }
  return table;
}

/** Inspection does not allocate. Used by the renderer's existing CPU budget. */
export function peekTerrainSurfaceTable(terrain: TerrainTops): TerrainSurfaceTable | undefined {
  return tables.get(terrain);
}

export function terrainSurfaceTableBytes(terrain: TerrainTops): number {
  const table = tables.get(terrain);
  return table ? table.byteLength + 256 : 0;
}

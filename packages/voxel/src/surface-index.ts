import { TerrainSurfaceTable, type ScenerySurface, type SurfaceSource } from './terrain-surface-table';

/** Same input-order and wet/dry tie rules for arrays supplied by other callers. */
export function scenerySurfaceAt(surfaces: SurfaceSource, x: number, z: number): ScenerySurface | undefined {
  if (surfaces instanceof TerrainSurfaceTable) return surfaces.sample(x, z);
  let ground: ScenerySurface | undefined, water: ScenerySurface | undefined;
  for (const s of surfaces) {
    if (!(s.minX < s.maxX && s.minZ < s.maxZ && x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ)) continue;
    if (s.water) { if (!water || s.supportY > water.supportY) water = s; }
    else if (!ground || s.supportY > ground.supportY) ground = s;
  }
  return ground && (!water || ground.supportY > water.supportY + .01) ? ground : water;
}

const BIN_SIZE = 8;
const MAX_BINS = 1_000_000, MAX_REFERENCES = 2_000_000;
const valid = (s: ScenerySurface) => s.minX < s.maxX && s.minZ < s.maxZ
  && Number.isFinite(s.minX) && Number.isFinite(s.maxX) && Number.isFinite(s.minZ) && Number.isFinite(s.maxZ);

/** Compressed rows of cell ordinals. References within a bin remain in input
 * order; no per-bin arrays, string keys or retained point-query results. */
class SurfaceIndex {
  readonly byteLength: number;
  readonly #minX: number;
  readonly #minZ: number;
  readonly #width: number;
  readonly #height: number;
  readonly #offsets: Uint32Array | null;
  readonly #rows: Uint32Array | null;

  constructor(readonly source: SurfaceSource) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, references = 0, unbounded = false;
    for (const s of source) {
      if (s.minX < s.maxX && s.minZ < s.maxZ && !valid(s)) unbounded = true;
      if (!valid(s)) continue;
      const x0 = Math.floor(s.minX / BIN_SIZE), x1 = Math.floor(s.maxX / BIN_SIZE);
      const z0 = Math.floor(s.minZ / BIN_SIZE), z1 = Math.floor(s.maxZ / BIN_SIZE);
      minX = Math.min(minX, x0); minZ = Math.min(minZ, z0); maxX = Math.max(maxX, x1); maxZ = Math.max(maxZ, z1);
      references += (x1 - x0 + 1) * (z1 - z0 + 1);
    }
    this.#minX = minX; this.#minZ = minZ;
    this.#width = maxX - minX + 1; this.#height = maxZ - minZ + 1;
    const bins = this.#width * this.#height;
    if (unbounded || !Number.isSafeInteger(bins) || bins <= 0 || bins > MAX_BINS || !Number.isSafeInteger(references) || references > MAX_REFERENCES) {
      // Very sparse/extreme public inputs use a bounded linear fallback.
      this.#offsets = this.#rows = null; this.byteLength = 256; return;
    }
    const offsets = new Uint32Array(bins + 1);
    const visitBins = (s: ScenerySurface, visit: (bin: number) => void) => {
      for (let z = Math.floor(s.minZ / BIN_SIZE); z <= Math.floor(s.maxZ / BIN_SIZE); z++) {
        for (let x = Math.floor(s.minX / BIN_SIZE); x <= Math.floor(s.maxX / BIN_SIZE); x++) visit((z - minZ) * this.#width + x - minX);
      }
    };
    for (const s of source) if (valid(s)) visitBins(s, bin => { offsets[bin + 1] = offsets[bin + 1]! + 1; });
    for (let bin = 1; bin < offsets.length; bin++) offsets[bin] = offsets[bin]! + offsets[bin - 1]!;
    const rows = new Uint32Array(references), cursor = offsets.slice(0, -1);
    let ordinal = 0;
    for (const s of source) {
      if (valid(s)) visitBins(s, bin => { rows[cursor[bin]!] = ordinal; cursor[bin] = cursor[bin]! + 1; });
      ordinal++;
    }
    this.#offsets = offsets; this.#rows = rows;
    this.byteLength = offsets.byteLength + rows.byteLength + 256;
  }

  sample(x: number, z: number): ScenerySurface | undefined {
    if (!this.#offsets || !this.#rows) return scenerySurfaceAt(this.source, x, z);
    const column = Math.floor(x / BIN_SIZE) - this.#minX, row = Math.floor(z / BIN_SIZE) - this.#minZ;
    if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || row < 0 || column >= this.#width || row >= this.#height) return undefined;
    const bin = row * this.#width + column, start = this.#offsets[bin]!, end = this.#offsets[bin + 1]!;
    if (this.source instanceof TerrainSurfaceTable) return this.source.sample(x, z, this.#rows, start, end);
    let ground: ScenerySurface | undefined, water: ScenerySurface | undefined;
    for (let i = start; i < end; i++) {
      const s = this.source[this.#rows[i]!]!;
      if (!(x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ)) continue;
      if (s.water) { if (!water || s.supportY > water.supportY) water = s; }
      else if (!ground || s.supportY > ground.supportY) ground = s;
    }
    return ground && (!water || ground.supportY > water.supportY + .01) ? ground : water;
  }

  query(b: {minX:number;maxX:number;minZ:number;maxZ:number}): ScenerySurface[] {
    if (![b.minX,b.maxX,b.minZ,b.maxZ].every(Number.isFinite) || b.minX>=b.maxX || b.minZ>=b.maxZ) return [];
    const result:ScenerySurface[]=[], seen=new Set<number>();
    const visit=(row:number)=>{
      if(seen.has(row))return;seen.add(row);
      const s=this.source instanceof TerrainSurfaceTable?this.source.at(row)!:this.source[row]!;
      if(s.minX<b.maxX&&s.maxX>b.minX&&s.minZ<b.maxZ&&s.maxZ>b.minZ)result.push(s);
    };
    if(!this.#offsets||!this.#rows){let row=0;for(const _ of this.source)visit(row++);return result;}
    const x0=Math.max(0,Math.floor(b.minX/BIN_SIZE)-this.#minX),x1=Math.min(this.#width-1,Math.floor(b.maxX/BIN_SIZE)-this.#minX);
    const z0=Math.max(0,Math.floor(b.minZ/BIN_SIZE)-this.#minZ),z1=Math.min(this.#height-1,Math.floor(b.maxZ/BIN_SIZE)-this.#minZ);
    for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){
      const bin=z*this.#width+x;for(let i=this.#offsets[bin]!;i<this.#offsets[bin+1]!;i++)visit(this.#rows[i]!);
    }
    return result;
  }
}

// Only the private, immutable numeric table may share an index. Plain arrays
// may be edited between calls, so they retain the old fresh-index contract.
const indexes = new WeakMap<TerrainSurfaceTable, SurfaceIndex>();
/** Uncached spatial queries for continuously moving consumers; no point-history Map. */
export function surfaceQuery(source:SurfaceSource):(bounds:{minX:number;maxX:number;minZ:number;maxZ:number})=>ScenerySurface[] {
  let index=source instanceof TerrainSurfaceTable?indexes.get(source):undefined;
  if(!index){index=new SurfaceIndex(source);if(source instanceof TerrainSurfaceTable)indexes.set(source,index);}
  return bounds=>index.query(bounds);
}
export function surfaceIndexBytes(source: SurfaceSource): number {
  return source instanceof TerrainSurfaceTable ? indexes.get(source)?.byteLength ?? 0 : 0;
}

export function surfaceSampler(surfaces: SurfaceSource): (x: number, z: number) => ScenerySurface | undefined {
  let index = surfaces instanceof TerrainSurfaceTable ? indexes.get(surfaces) : undefined;
  if (!index) {
    index = new SurfaceIndex(surfaces);
    if (surfaces instanceof TerrainSurfaceTable) indexes.set(surfaces, index);
  }
  const current = index, cache = new Map<string, ScenerySurface | undefined>();
  return (x, z) => {
    const key = `${x}:${z}`;
    if (!cache.has(key)) cache.set(key, current.sample(x, z));
    return cache.get(key);
  };
}

import type { RoadCell, VillagePlacement } from './village';

export const ROAD_LAMP_SPACING = 24;

/** Sparse roadside cues, not a second lighting grid over every building. */
export function roadLampCells(roads: readonly RoadCell[], placements: readonly VillagePlacement[]): RoadCell[] {
  if (roads.length < 32) return [];
  const limit = Math.min(8, Math.max(1, Math.floor(roads.length / 96)));
  const occupied = placements.map(p => ({
    minX: p.worldPosition.x - p.footprint.width / 2 - 2,
    maxX: p.worldPosition.x + p.footprint.width / 2 + 2,
    minZ: p.worldPosition.z - p.footprint.depth / 2 - 2,
    maxZ: p.worldPosition.z + p.footprint.depth / 2 + 2,
  }));
  const rank = (p: RoadCell) => ((Math.imul(p.x, 73856093) ^ Math.imul(p.z, 19349663)) >>> 0);
  const candidates = [...roads].sort((a,b) => rank(a)-rank(b) || a.x-b.x || a.z-b.z);
  const selected: RoadCell[] = [];
  for (const p of candidates) {
    if (occupied.some(r => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ)) continue;
    if (selected.some(q => Math.hypot(p.x-q.x,p.z-q.z) < ROAD_LAMP_SPACING)) continue;
    selected.push({x:p.x,z:p.z});
    if (selected.length === limit) break;
  }
  return selected;
}

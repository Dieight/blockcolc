export interface AllocationWeight { minutes: number; durationMs?: number }

export function allocationWeight(row: AllocationWeight): number {
  const value = row.durationMs ?? row.minutes * 60_000;
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Largest remainders: exactly 100 approximate percentage units, never per-session dots. */
export function allocationPercentageUnits(rows: readonly AllocationWeight[]): number[] {
  const weights = rows.map(allocationWeight);
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total === 0) return weights.map(() => 0);
  const exact = weights.map(value => value / total * 100);
  const units = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, fraction: value - units[index]! }))
    .sort((a,b) => b.fraction - a.fraction || a.index - b.index);
  const remaining = 100 - units.reduce((sum,value) => sum + value,0);
  for (const { index } of order.slice(0,remaining)) units[index]! += 1;
  return units;
}

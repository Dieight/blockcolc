/** Temporary generation index. Query results keep the input order, including
 * overlapping intervals; mesh emission must not reorder mixed-LOD edges. */
export class TerrainLineIndex<T extends { start: number; end: number }> {
  private readonly order: Uint32Array;
  private readonly maximumEnds: Float64Array;

  constructor(private readonly intervals: readonly T[]) {
    this.order = Uint32Array.from({ length: intervals.length }, (_, i) => i);
    this.order.sort((a, b) => intervals[a]!.start - intervals[b]!.start || a - b);
    this.maximumEnds = new Float64Array(intervals.length);
    let maximum = -Infinity;
    for (let i = 0; i < this.order.length; i++) {
      maximum = Math.max(maximum, intervals[this.order[i]!]!.end);
      this.maximumEnds[i] = maximum;
    }
  }

  overlapping(start: number, end: number): readonly T[] {
    let low = 0, high = this.order.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.maximumEnds[middle]! <= start) low = middle + 1; else high = middle;
    }
    const matches: number[] = [];
    for (let i = low; i < this.order.length; i++) {
      const ordinal = this.order[i]!, interval = this.intervals[ordinal]!;
      if (interval.start >= end) break;
      if (interval.end > start) matches.push(ordinal);
    }
    if (matches.length > 1) matches.sort((a, b) => a - b);
    return matches.map(ordinal => this.intervals[ordinal]!);
  }
}

/** Bounded numeric measurements: no DOM, task text, URLs or identifiers. */
export function durationSamples(limit = 4096) {
  const values: number[] = [];
  let count = 0, totalMs = 0, maxMs = 0, over34 = 0, over50 = 0, over100 = 0;
  return {
    add(ms: number) {
      if (!Number.isFinite(ms) || ms < 0) return;
      count++; totalMs += ms; maxMs = Math.max(maxMs, ms);
      if (ms > 34) over34++; if (ms > 50) over50++; if (ms > 100) over100++;
      // Capture windows are bounded; a long window never grows unbounded memory.
      if (values.length < limit) values.push(ms);
    },
    summary() {
      const sorted = [...values].sort((a, b) => a - b);
      const percentile = (fraction: number) => sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1]! : null;
      return { count, sampled: values.length, meanMs: count ? totalMs / count : null,
        p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs, totalMs, over34, over50, over100 };
    },
  };
}

/**
 * Low-cost browser marks for the ready/break -> next-focus path. Marks are
 * diagnostics only: timer truth and plan persistence never depend on them.
 * The diagnostics suite reads the same names to separate gesture, command,
 * storage and renderer timing; a real-device frame claim still requires a
 * user trace.
 */
export const FOCUS_PERFORMANCE_PREFIX = 'blockcolc-focus:';
export type FocusPerformanceMark =
  | 'gesture-confirmed'
  | 'command-queued'
  | 'command-committed'
  | 'plan-persisted'
  | 'renderer-requested'
  | 'renderer-updated';

export function markFocusPerformance(mark: FocusPerformanceMark): void {
  try { globalThis.performance?.mark(`${FOCUS_PERFORMANCE_PREFIX}${mark}`); } catch { /* diagnostics never affect focus */ }
}

export function readFocusPerformanceMarks(): PerformanceEntry[] {
  try {
    return globalThis.performance?.getEntriesByType('mark').filter(entry => entry.name.startsWith(FOCUS_PERFORMANCE_PREFIX)) ?? [];
  } catch { return []; }
}

export function clearFocusPerformanceMarks(): void {
  try {
    for (const entry of readFocusPerformanceMarks()) globalThis.performance.clearMarks(entry.name);
  } catch { /* diagnostics never affect focus */ }
}

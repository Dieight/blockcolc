import type { DomainState } from '@tomato-clock/domain';

export const FOCUS_EXPORT_VERSION = 1 as const;
const DAY_MS = 86_400_000;
const UTC8_MS = 8 * 3_600_000;
export const MAX_EXPORT_DAYS = 366;

/** Business allowlist. Never spread domain objects across this boundary. */
export interface FocusExportSnapshot {
  currentName: string | null;
  startedAt: string | null;
  estimatedElapsedMs: number;
  estimatedEndsAt: string | null;
  todayActualFocusMs: number;
}

export interface FocusExportDay {
  date: string;
  actualFocusMs: number;
  /** Closed date with no unreconciled active interval touching it. */
  confirmed: boolean;
}

export interface FocusExportEnvelope {
  schemaVersion: typeof FOCUS_EXPORT_VERSION;
  sourceEpoch: string;
  revision: number;
  capturedAt: string;
  snapshot: FocusExportSnapshot;
}

/** Supplied only from adopted, successfully saved round context, never a draft. */
export interface FocusExportContext {
  breakInterval?: { startedAt: string; endsAt: string } | null;
}

function instant(value: string): number {
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result)) throw new Error('Invalid focus export instant');
  return result;
}

export function focusExportDate(at: string): string {
  return new Date(instant(at) + UTC8_MS).toISOString().slice(0, 10);
}

function dayStart(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid focus export date');
  const start = instant(`${date}T00:00:00.000+08:00`);
  if (focusExportDate(new Date(start).toISOString()) !== date) throw new Error('Invalid focus export date');
  return start;
}

/** Pure projection over validated, adopted DomainState. No account, network or mutations. */
export function projectFocusExportDays(
  state: DomainState, fromDate: string, throughDate: string, capturedAt: string,
): FocusExportDay[] {
  const from = dayStart(fromDate);
  const through = dayStart(throughDate);
  const now = instant(capturedAt);
  const count = (through - from) / DAY_MS + 1;
  if (count < 1 || count > MAX_EXPORT_DAYS || throughDate > focusExportDate(capturedAt)) {
    throw new Error('Invalid focus export range');
  }
  const result = Array.from({ length: count }, (_, index): FocusExportDay => {
    const start = from + index * DAY_MS;
    const end = start + DAY_MS;
    const active = state.activeFocusSession;
    const unresolved = active !== null && instant(active.startedAt) < end && instant(active.endsAt) > start;
    return { date: focusExportDate(new Date(start).toISOString()), actualFocusMs: 0, confirmed: end <= now && !unresolved };
  });
  const seen = new Set<string>();
  for (const session of state.focusHistory) {
    if (seen.has(session.id)) throw new Error('Duplicate focus export interval');
    seen.add(session.id);
    const start = instant(session.startedAt);
    const duration = session.actualDurationMs;
    if (!Number.isSafeInteger(duration) || duration < 0) throw new Error('Invalid actual focus duration');
    const end = start + duration;
    // Never label future effort as confirmed; a clock reversal requires reconciliation.
    if (end > now) throw new Error('Focus history is ahead of the capture clock');
    const first = Math.max(0, Math.floor((start - from) / DAY_MS));
    const last = Math.min(count - 1, Math.ceil((end - from) / DAY_MS) - 1);
    for (let index = first; index <= last; index++) {
      const day = result[index]!;
      const lower = from + index * DAY_MS;
      day.actualFocusMs += Math.max(0, Math.min(end, lower + DAY_MS) - Math.max(start, lower));
      if (day.actualFocusMs > DAY_MS) throw new Error('Overlapping focus history exceeds a day');
    }
  }
  return result;
}

export function projectFocusExportSnapshot(
  state: DomainState, capturedAt: string, context: FocusExportContext = {},
): FocusExportSnapshot {
  const now = instant(capturedAt);
  const date = focusExportDate(capturedAt);
  const todayActualFocusMs = projectFocusExportDays(state, date, date, capturedAt)[0]!.actualFocusMs;
  const active = state.activeFocusSession;
  const rest = context.breakInterval;
  // An actual active focus wins over stale UI break context.
  let interval: { startedAt: string; endsAt: string } | null = active;
  let name: string | null = null;
  if (active) {
    const project = state.projects.find(value => value.id === active.projectId);
    name = active.deferredSettlement ? '极简模式' : active.marathon ? '马拉松'
      : project?.subtasks.find(value => value.id === active.subtaskId)?.title ?? '专注中';
  } else if (rest && instant(rest.endsAt) > now) {
    interval = rest;
    name = '休息';
  }
  if (!interval) return { currentName: null, startedAt: null, estimatedElapsedMs: 0, estimatedEndsAt: null, todayActualFocusMs };
  const start = instant(interval.startedAt);
  const end = instant(interval.endsAt);
  if (end <= start || start > now) throw new Error('Invalid current focus interval');
  return {
    currentName: name,
    startedAt: new Date(start).toISOString(),
    estimatedElapsedMs: Math.min(now, end) - start,
    estimatedEndsAt: new Date(end).toISOString(),
    todayActualFocusMs,
  };
}

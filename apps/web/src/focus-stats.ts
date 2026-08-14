import { addLocalDays, localDateOf, type DomainState, type ISODate, type ISOInstant } from '@tomato-clock/domain';

export type FocusHistory = DomainState['focusHistory'];
export type FocusHistoryEntry = FocusHistory[number];

export function focusSessionEndedAt(session: FocusHistoryEntry): ISOInstant {
  return session.status === 'interrupted' ? session.interruptedAt : session.completedAt;
}

export function focusSessionLocalDate(session: FocusHistoryEntry): ISODate {
  return session.status === 'interrupted'
    ? localDateOf(session.interruptedAt, session.timeZoneAtStart)
    : session.completedLocalDate;
}

export function effectiveFocusMillisecondsByDate(history: FocusHistory): Map<ISODate, number> {
  const millisecondsByDate = new Map<ISODate, number>();
  for (const session of history) {
    const date = focusSessionLocalDate(session);
    millisecondsByDate.set(date, (millisecondsByDate.get(date) ?? 0) + session.actualDurationMs);
  }
  return millisecondsByDate;
}

export function focusHeatmapLevel(minutes: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (minutes <= 0) return 0;
  if (minutes < 90) return 1;
  if (minutes < 180) return 2;
  if (minutes < 270) return 3;
  if (minutes < 360) return 4;
  return 5;
}

export interface FocusWindowSummary {
  minutes: number;
  activeDays: number;
  completed: number;
  early: number;
  interrupted: number;
}

export interface ProjectFocusAllocation {
  projectId: string;
  title: string;
  minutes: number;
  share: number;
}

export function focusWindowSummary(state: DomainState, endDate: ISODate, days: number): FocusWindowSummary {
  if (!Number.isSafeInteger(days) || days < 1) throw new Error('days must be a positive integer');
  const startDate = addLocalDays(endDate, 1 - days);
  const sessions = state.focusHistory.filter((session) => {
    const date = focusSessionLocalDate(session);
    return date >= startDate && date <= endDate;
  });
  return {
    minutes: Math.round(sessions.reduce((sum, session) => sum + session.actualDurationMs, 0) / 60_000),
    activeDays: new Set(sessions.filter((session) => session.actualDurationMs > 0).map(focusSessionLocalDate)).size,
    completed: sessions.filter((session) => session.status === 'completed').length,
    early: sessions.filter((session) => session.status === 'completed-early').length,
    interrupted: sessions.filter((session) => session.status === 'interrupted').length,
  };
}

export function projectFocusAllocation(state: DomainState, endDate: ISODate, days = 30): ProjectFocusAllocation[] {
  if (!Number.isSafeInteger(days) || days < 1) throw new Error('days must be a positive integer');
  const startDate = addLocalDays(endDate, 1 - days);
  const milliseconds = new Map<string, number>();
  for (const session of state.focusHistory) {
    const date = focusSessionLocalDate(session);
    if (date < startDate || date > endDate || session.actualDurationMs <= 0) continue;
    milliseconds.set(session.projectId, (milliseconds.get(session.projectId) ?? 0) + session.actualDurationMs);
  }
  const total = [...milliseconds.values()].reduce((sum, value) => sum + value, 0);
  const titles = new Map(state.projects.map((project) => [project.id, project.title]));
  return [...milliseconds]
    .map(([projectId, value]) => ({ projectId, title: titles.get(projectId) ?? '已移除任务', minutes: Math.round(value / 60_000), share: total > 0 ? Math.round(value / total * 100) : 0 }))
    .sort((left, right) => right.minutes - left.minutes || left.title.localeCompare(right.title, 'zh-CN'));
}

export interface FocusHourProject {
  projectId: string;
  minutes: number;
}

export interface FocusHourBucket {
  hour: number;
  minutes: number;
  projects: FocusHourProject[];
}

export function focusHourDistribution(state: DomainState, endDate: ISODate, days: number): FocusHourBucket[] {
  if (!Number.isSafeInteger(days) || days < 1) throw new Error('days must be a positive integer');
  const startDate = addLocalDays(endDate, 1 - days);
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: 0, projects: new Map<string, number>() }));
  for (const session of state.focusHistory) {
    const date = focusSessionLocalDate(session);
    if (date < startDate || date > endDate || session.actualDurationMs <= 0) continue;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: session.timeZoneAtStart, hour: 'numeric', hourCycle: 'h23' }).format(new Date(focusSessionEndedAt(session))));
    if (!Number.isInteger(hour) || hour < 0 || hour >= 24) continue;
    const bucket = buckets[hour]!;
    bucket.minutes += session.actualDurationMs;
    bucket.projects.set(session.projectId, (bucket.projects.get(session.projectId) ?? 0) + session.actualDurationMs);
  }
  return buckets.map((bucket) => ({
    hour: bucket.hour,
    minutes: Math.round(bucket.minutes / 60_000),
    projects: [...bucket.projects]
      .map(([projectId, milliseconds]) => ({ projectId, minutes: Math.round(milliseconds / 60_000) }))
      .sort((left, right) => right.minutes - left.minutes),
  }));
}

export interface SettlementTotals {
  totalMinutes: number;
  completedRounds: number;
  buildings: number;
}

export function settlementTotals(state: DomainState): SettlementTotals {
  return {
    totalMinutes: Math.round(state.focusHistory.reduce((sum, session) => sum + session.actualDurationMs, 0) / 60_000),
    completedRounds: state.focusHistory.filter((session) => session.status === 'completed' || session.status === 'completed-early').length,
    buildings: state.habitBuildings.length + state.projects.filter((project) => project.status === 'monument').length,
  };
}

import { localDateOf, type DomainState, type ISODate, type ISOInstant } from '@tomato-clock/domain';

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

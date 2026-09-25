import { projectFocusAttribution } from '@tomato-clock/application';
import { completedPomodorosOn, dailyGoalForDate, type DomainState } from '@tomato-clock/domain';

export interface TodayFocusSeries {
  key: string;
  title: string;
  milliseconds: number[];
  totalMs: number;
  unallocated: boolean;
}

export interface TodayFocusTimeline {
  date: string;
  totalMs: number;
  completedRounds: number;
  targetRounds: number | null;
  series: TodayFocusSeries[];
}

/** Real occupied intervals, not sessions placed wholesale at their end hour.
 * The axis uses the saved calendar zone. A DST repeated hour accumulates both
 * occurrences; the missing hour remains empty. Attribution is shared with stats.
 * This read-only panel never rewrites the historical completion-day convention.
 */
export function projectTodayFocusTimeline(state: DomainState, date: string): TodayFocusTimeline {
  const nominal = Date.parse(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(nominal)
    || new Date(nominal).toISOString().slice(0, 10) !== date) throw new Error('Invalid timeline date');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: state.calendar.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const sources = new Map(state.focusHistory.map(session => [session.id, session]));
  const series = new Map<string, TodayFocusSeries>();
  // Broad UTC envelope bounds work before formatting and accommodates all
  // supported civil offsets plus DST. Only minute boundaries are traversed.
  const earliest = nominal - 15 * 3_600_000;
  const latest = nominal + 39 * 3_600_000;
  for (const attribution of projectFocusAttribution(state).sessions) {
    const source = sources.get(attribution.sessionId);
    if (!source || attribution.actualDurationMs <= 0) continue;
    const startedAt = Date.parse(source.startedAt);
    const endedAt = Math.min(Date.parse(attribution.endedAt), startedAt + attribution.actualDurationMs, latest);
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= earliest) continue;
    const key = attribution.kind === 'unallocated' ? 'unallocated'
      : JSON.stringify([attribution.projectId, attribution.subtaskId]);
    let row = series.get(key);
    for (let at = Math.max(startedAt, earliest); at < endedAt;) {
      const until = Math.min(endedAt, (Math.floor(at / 60_000) + 1) * 60_000);
      const parts = Object.fromEntries(formatter.formatToParts(at).map(part => [part.type, part.value]));
      if (`${parts.year}-${parts.month}-${parts.day}` === date) {
        if (!row) {
          row = { key, title: attribution.subtaskTitle ? `${attribution.projectTitle} · ${attribution.subtaskTitle}` : attribution.projectTitle,
            milliseconds: Array<number>(96).fill(0), totalMs: 0, unallocated: attribution.kind === 'unallocated' };
          series.set(key, row);
        }
        const bucket = Number(parts.hour) * 4 + Math.floor(Number(parts.minute) / 15);
        row.milliseconds[bucket] = (row.milliseconds[bucket] ?? 0) + until - at;
        row.totalMs += until - at;
      }
      at = until;
    }
  }
  const rows = [...series.values()].sort((left, right) => left.key.localeCompare(right.key));
  const goal = dailyGoalForDate(state, date);
  return {
    date, totalMs: rows.reduce((sum, row) => sum + row.totalMs, 0),
    completedRounds: completedPomodorosOn(state, date),
    targetRounds: goal.enabled ? goal.targetPomodoros : null, series: rows,
  };
}

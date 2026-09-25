import type { DomainState } from '@tomato-clock/domain';

type Metric = 'completed-rounds' | 'focus-minutes' | 'buildings' | 'focus-days';

export interface AchievementDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly metric: Metric;
  readonly target: number;
  readonly unit: '轮' | '分钟' | '栋' | '天';
}

export interface AchievementProgress extends AchievementDefinition {
  /** Display progress is capped at the target, never a second product counter. */
  readonly progress: number;
  readonly unlocked: boolean;
  /** Null means locked OR the retained history cannot establish an exact instant. */
  readonly unlockedAt: string | null;
}

export const ACHIEVEMENTS: readonly AchievementDefinition[] = Object.freeze([
  { id: 'focus-first', title: '第一块基石', description: '完成第一轮专注', metric: 'completed-rounds', target: 1, unit: '轮' },
  { id: 'focus-ten', title: '渐入佳境', description: '累计完成 10 轮专注', metric: 'completed-rounds', target: 10, unit: '轮' },
  { id: 'focus-fifty', title: '日积月累', description: '累计完成 50 轮专注', metric: 'completed-rounds', target: 50, unit: '轮' },
  { id: 'focus-hundred', title: '百轮成形', description: '累计完成 100 轮专注', metric: 'completed-rounds', target: 100, unit: '轮' },
  { id: 'time-hour', title: '投入一小时', description: '累计记录 60 分钟实际专注', metric: 'focus-minutes', target: 60, unit: '分钟' },
  { id: 'time-ten-hours', title: '十小时的形状', description: '累计记录 600 分钟实际专注', metric: 'focus-minutes', target: 600, unit: '分钟' },
  { id: 'time-twenty-five-hours', title: '长路有光', description: '累计记录 1500 分钟实际专注', metric: 'focus-minutes', target: 1500, unit: '分钟' },
  { id: 'building-first', title: '初见落成', description: '完成第一栋普通或习惯建筑', metric: 'buildings', target: 1, unit: '栋' },
  { id: 'building-five', title: '聚落初成', description: '累计完成 5 栋普通或习惯建筑', metric: 'buildings', target: 5, unit: '栋' },
  { id: 'building-ten', title: '十景相连', description: '累计完成 10 栋普通或习惯建筑', metric: 'buildings', target: 10, unit: '栋' },
  { id: 'days-seven', title: '七日足迹', description: '在 7 个不同日期完成专注，无需连续', metric: 'focus-days', target: 7, unit: '天' },
  { id: 'days-thirty', title: '三十日留痕', description: '在 30 个不同日期完成专注，无需连续', metric: 'focus-days', target: 30, unit: '天' },
] satisfies AchievementDefinition[]);

interface Milestone { at: string | null; amount: number }

/** Pure projection over validated retained facts; no clock, writes or reward commands. */
export function projectAchievements(state: DomainState): readonly AchievementProgress[] {
  const milestones: Record<Metric, Milestone[]> = {
    'completed-rounds': [], 'focus-minutes': [], buildings: [], 'focus-days': [],
  };
  const sessions = [...state.focusHistory].sort((left, right) => {
    const a = left.status === 'interrupted' ? left.interruptedAt : left.completedAt;
    const b = right.status === 'interrupted' ? right.interruptedAt : right.completedAt;
    return Date.parse(a) - Date.parse(b) || left.id.localeCompare(right.id);
  });
  const dates = new Set<string>();
  for (const session of sessions) {
    const at = session.status === 'interrupted' ? session.interruptedAt : session.completedAt;
    // Accumulate integer milliseconds: repeated fractional minutes can miss a threshold.
    milestones['focus-minutes'].push({ at, amount: session.actualDurationMs });
    if (session.status === 'interrupted') continue;
    milestones['completed-rounds'].push({ at, amount: 1 });
    // Use the frozen completion date, not the current device timezone.
    if (!dates.has(session.completedLocalDate)) {
      dates.add(session.completedLocalDate);
      milestones['focus-days'].push({ at, amount: 1 });
    }
  }

  const finalReports = new Map<string, string>();
  for (const report of state.progressReports) {
    if (report.progressBasisPoints !== 10000) continue;
    const previous = finalReports.get(report.projectId);
    if (!previous || Date.parse(report.reportedAt) > Date.parse(previous)) finalReports.set(report.projectId, report.reportedAt);
  }
  for (const project of state.projects) {
    if (project.kind !== 'finite' || !project.subtasks.length
      || !project.subtasks.every(task => task.progressBasisPoints === 10000)) continue;
    milestones.buildings.push({ at: finalReports.get(project.id) ?? null, amount: 1 });
  }
  for (const building of state.habitBuildings) milestones.buildings.push({ at: building.completedAt, amount: 1 });
  milestones.buildings.sort((a, b) => (a.at === null ? Infinity : Date.parse(a.at)) - (b.at === null ? Infinity : Date.parse(b.at)));

  return Object.freeze(ACHIEVEMENTS.map(definition => {
    const scale = definition.metric === 'focus-minutes' ? 60_000 : 1;
    const threshold = definition.target * scale;
    let total = 0;
    let unlockedAt: string | null = null;
    for (const point of milestones[definition.metric]) {
      const previous = total;
      total += point.amount;
      if (previous < threshold && total >= threshold) unlockedAt = point.at;
    }
    if (definition.metric === 'buildings' && milestones.buildings.some(point => point.at === null)) unlockedAt = null;
    return Object.freeze({ ...definition, progress: Math.min(definition.target, Math.floor(total / scale)), unlocked: total >= threshold, unlockedAt });
  }));
}

/** Call only for a successful user operation; initial load/import/recovery is a silent baseline. */
export function newlyUnlockedAchievements(
  before: readonly AchievementProgress[] | null,
  after: readonly AchievementProgress[],
): readonly AchievementProgress[] {
  if (before === null) return [];
  const previous = new Map(before.map(item => [item.id, item.unlocked]));
  return after.filter(item => item.unlocked && previous.get(item.id) === false);
}

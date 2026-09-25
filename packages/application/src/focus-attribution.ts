import type { DomainState, FocusSession, ProgressReport } from '@tomato-clock/domain';

export type FocusAttributionKind = 'finite-subtask' | 'habit-building' | 'habit-project' | 'unallocated';
export type FocusAttributionReason =
  | 'not-reported'
  | 'legacy-shared'
  | 'discarded'
  | 'interrupted-marathon'
  | 'conflicting-owners'
  | 'missing-session';

export interface FocusAttribution {
  sessionId: string;
  endedAt: string;
  timeZoneAtStart: string;
  actualDurationMs: number;
  status: FocusSession['status'];
  kind: FocusAttributionKind;
  projectId: string | null;
  projectTitle: string;
  subtaskId: string | null;
  subtaskTitle: string | null;
  targetId: string | null;
  targetTitle: string | null;
  reason: FocusAttributionReason | null;
}

export interface MonumentSubtaskProjection {
  subtaskId: string;
  title: string;
  rounds: number;
  interruptedRounds: number;
  minutes: number;
  interruptedMinutes: number;
  share: number | null;
}

export interface MonumentFocusProjection {
  id: string;
  source: 'finite' | 'habit';
  projectId: string | null;
  title: string;
  completedAt: string | null;
  expectedRounds: number | null;
  /** Completed and completed-early sessions only. */
  rounds: number;
  /** Interrupted sessions are real effort, but are not completed rounds. */
  interruptedRounds: number;
  unknownRounds: number;
  minutes: number;
  interruptedMinutes: number;
  unknownMinutes: number;
  subtasks: MonumentSubtaskProjection[];
}

export interface UnallocatedFocusProjection {
  rounds: number;
  completedRounds: number;
  interruptedRounds: number;
  minutes: number;
}

export interface FocusAttributionProjection {
  sessions: readonly FocusAttribution[];
  unallocated: UnallocatedFocusProjection;
}

interface Target {
  kind: Exclude<FocusAttributionKind, 'unallocated'>;
  projectId: string | null;
  projectTitle: string;
  subtaskId: string | null;
  subtaskTitle: string | null;
  targetId: string;
  targetTitle: string;
}

/**
 * Resolve each retained focus session once.  New F19 reports carry
 * `allocation: "explicit"`; legacy shared reports are deliberately not
 * averaged or repeated.  All ambiguity is returned as an unallocated record
 * so consumers cannot silently fall back to the session's host project.
 */
export function projectFocusAttribution(state: DomainState): FocusAttributionProjection {
  const projects = new Map(state.projects.map(project => [project.id, project]));
  const reportsBySession = new Map<string, ProgressReport[]>();
  for (const report of state.progressReports) {
    for (const sessionId of report.focusSessionIds) {
      const list = reportsBySession.get(sessionId) ?? [];
      list.push(report);
      reportsBySession.set(sessionId, list);
    }
  }

  const habitTargets = new Map<string, Target[]>();
  for (const building of state.habitBuildings) {
    const source = projects.get(building.habitProjectId);
    const target: Target = {
      kind: 'habit-building', projectId: building.habitProjectId,
      projectTitle: source?.title ?? building.habitTitle, subtaskId: null, subtaskTitle: null,
      targetId: building.id, targetTitle: `${building.habitTitle} · 第 ${building.cycleNumber} 座`,
    };
    for (const sessionId of building.focusSessionIds) {
      const targets = habitTargets.get(sessionId) ?? [];
      targets.push(target);
      habitTargets.set(sessionId, targets);
    }
  }
  for (const project of state.projects) {
    if (project.kind !== 'habit' || project.habit === null) continue;
    const target: Target = {
      kind: 'habit-project', projectId: project.id, projectTitle: project.title,
      subtaskId: null, subtaskTitle: null, targetId: project.id, targetTitle: project.title,
    };
    for (const sessionId of project.habit.completedFocusSessionIds) {
      const targets = habitTargets.get(sessionId) ?? [];
      targets.push(target);
      habitTargets.set(sessionId, targets);
    }
  }

  const sessions = [...state.focusHistory].sort((left, right) => {
    const leftAt = focusEndedAt(left);
    const rightAt = focusEndedAt(right);
    return Date.parse(leftAt) - Date.parse(rightAt) || left.id.localeCompare(right.id);
  });
  const result: FocusAttribution[] = sessions.map(session => {
    const reports = reportsBySession.get(session.id) ?? [];
    const habits = habitTargets.get(session.id) ?? [];
    const explicit = reports.filter(report => report.allocation === 'explicit');
    const regular = reports.filter(report => report.allocation !== 'explicit' && report.shared !== true);
    const shared = reports.filter(report => report.shared === true);
    const candidates = [
      ...explicit.map(report => targetFromReport(state, report)),
      ...regular.map(report => targetFromReport(state, report)),
      ...habits,
    ].filter((target): target is Target => target !== null);
    const uniqueTargets = new Map(candidates.map(target => [target.targetId, target]));
    const isAmbiguous = uniqueTargets.size > 1 || (shared.length > 0 && candidates.length > 0);
    if (isAmbiguous) return unallocated(session, 'conflicting-owners');
    if (uniqueTargets.size === 1 && shared.length === 0) return attributed(session, [...uniqueTargets.values()][0]!);
    if (shared.length > 0) return unallocated(session, 'legacy-shared');
    if (session.marathon === true) {
      return unallocated(session, session.status === 'interrupted' ? 'interrupted-marathon' : session.settledAt ? 'discarded' : 'not-reported');
    }
    if (session.deferredSettlement === true) return unallocated(session, 'not-reported');
    const host = targetFromSession(state, session);
    return host ? attributed(session, host) : unallocated(session, 'missing-session');
  });

  const unallocatedRows = result.filter(item => item.kind === 'unallocated');
  const unallocatedMilliseconds = unallocatedRows.reduce((sum, item) => sum + item.actualDurationMs, 0);
  const unallocatedCompletedRounds = unallocatedRows.filter(item => isCompletedStatus(item.status) && item.actualDurationMs > 0).length;
  const unallocatedInterruptedRounds = unallocatedRows.filter(item => item.status === 'interrupted' && item.actualDurationMs > 0).length;
  return {
    sessions: Object.freeze(result),
    unallocated: {
      rounds: unallocatedCompletedRounds + unallocatedInterruptedRounds,
      completedRounds: unallocatedCompletedRounds,
      interruptedRounds: unallocatedInterruptedRounds,
      minutes: Math.round(unallocatedMilliseconds / 60_000),
    },
  };
}

/** Pure monument view consumed by stats and building-memory surfaces. */
export function projectMonumentFocus(state: DomainState): readonly MonumentFocusProjection[] {
  const attribution = projectFocusAttribution(state).sessions;
  const attributionBySession = new Map(attribution.map(item => [item.sessionId, item]));
  const byTarget = new Map<string, FocusAttribution[]>();
  for (const item of attribution) {
    if (item.targetId === null || item.kind === 'unallocated') continue;
    const list = byTarget.get(item.targetId) ?? [];
    list.push(item);
    byTarget.set(item.targetId, list);
  }
  const finite = state.projects.flatMap(project => {
    if (project.kind !== 'finite' || project.status !== 'monument') return [];
    // Finite reports target a subtask, while habit reports target their
    // building.  Grouping a finite monument by project id would silently
    // erase all F19 explicit allocations, so filter on the owning project.
    const rows = attribution.filter(item => item.kind === 'finite-subtask' && item.projectId === project.id);
    const knownMilliseconds = rows.reduce((sum, row) => sum + row.actualDurationMs, 0);
    const unknownSessionIds = finiteUnknownSessionIds(state, project.id, attributionBySession);
    const unknownRows = [...unknownSessionIds].map(sessionId => state.focusHistory.find(session => session.id === sessionId)).filter((session): session is FocusSession => session !== undefined);
    const totalMinutes = Math.round(knownMilliseconds / 60_000);
    const totalRounds = rows.filter(row => isCompletedStatus(row.status) && row.actualDurationMs > 0).length;
    const interruptedRows = rows.filter(row => row.status === 'interrupted' && row.actualDurationMs > 0);
    const unknownMilliseconds = unknownRows.reduce((sum, session) => sum + session.actualDurationMs, 0);
    const reports = state.progressReports.filter(report => report.projectId === project.id && report.progressBasisPoints === 10_000);
    const completedAt = reports.length > 0 ? reports.map(report => report.reportedAt).sort().at(-1) ?? null : null;
    const knownBySubtask = project.subtasks.map(subtask => {
      const subtaskRows = rows.filter(row => row.subtaskId === subtask.id);
      const milliseconds = subtaskRows.reduce((sum, row) => sum + row.actualDurationMs, 0);
      const minutes = Math.round(milliseconds / 60_000);
      const interrupted = subtaskRows.filter(row => row.status === 'interrupted' && row.actualDurationMs > 0);
      const share = unknownSessionIds.size === 0 && knownMilliseconds > 0
        ? Math.round(milliseconds / knownMilliseconds * 100)
        : null;
      return {
        subtaskId: subtask.id,
        title: subtask.title,
        rounds: subtaskRows.filter(row => isCompletedStatus(row.status) && row.actualDurationMs > 0).length,
        interruptedRounds: interrupted.length,
        minutes,
        interruptedMinutes: Math.round(interrupted.reduce((sum, row) => sum + row.actualDurationMs, 0) / 60_000),
        share,
      };
    });
    return [{
      id: project.id, source: 'finite' as const, projectId: project.id, title: project.title, completedAt,
      expectedRounds: null,
      rounds: totalRounds,
      interruptedRounds: interruptedRows.length,
      unknownRounds: unknownSessionIds.size,
      minutes: totalMinutes,
      interruptedMinutes: Math.round(interruptedRows.reduce((sum, row) => sum + row.actualDurationMs, 0) / 60_000),
      unknownMinutes: Math.round(unknownMilliseconds / 60_000),
      subtasks: knownBySubtask,
    }];
  });
  const habits = state.habitBuildings.map(building => {
    const rows = byTarget.get(building.id) ?? [];
    const expectedIds = new Set(building.focusSessionIds);
    const knownIds = new Set(rows.map(row => row.sessionId));
    const unknownIds = [...expectedIds].filter(sessionId => !knownIds.has(sessionId));
    const unknownRows = unknownIds.map(sessionId => state.focusHistory.find(session => session.id === sessionId)).filter((session): session is FocusSession => session !== undefined);
    const totalMilliseconds = rows.reduce((sum, row) => sum + row.actualDurationMs, 0);
    const interruptedRows = rows.filter(row => row.status === 'interrupted' && row.actualDurationMs > 0);
    return {
      id: building.id, source: 'habit' as const, projectId: building.habitProjectId,
      title: `${building.habitTitle} · 第 ${building.cycleNumber} 座`, completedAt: building.completedAt,
      expectedRounds: expectedIds.size,
      rounds: rows.filter(row => isCompletedStatus(row.status) && row.actualDurationMs > 0).length,
      interruptedRounds: interruptedRows.length,
      unknownRounds: unknownIds.length,
      minutes: Math.round(totalMilliseconds / 60_000),
      interruptedMinutes: Math.round(interruptedRows.reduce((sum, row) => sum + row.actualDurationMs, 0) / 60_000),
      unknownMinutes: Math.round(unknownRows.reduce((sum, session) => sum + session.actualDurationMs, 0) / 60_000),
      subtasks: [],
    };
  });
  return Object.freeze([...finite, ...habits]);
}

/**
 * Legacy marathon reports can tell us that a finite building participated in
 * a shared session, but cannot tell us which building actually owns that
 * time.  Keep those session ids as an explicit unknown gap.  A session that
 * was explicitly attributed to another target is not copied back to its host
 * project, which is the important cross-building no-duplication rule.
 */
function finiteUnknownSessionIds(
  state: DomainState,
  projectId: string,
  attributionBySession: ReadonlyMap<string, FocusAttribution>,
): Set<string> {
  const unknown = new Set<string>();
  for (const report of state.progressReports) {
    if (report.projectId !== projectId || (report.shared !== true && report.allocation !== 'explicit')) continue;
    for (const sessionId of report.focusSessionIds) {
      const item = attributionBySession.get(sessionId);
      if (!item || item.kind === 'unallocated') unknown.add(sessionId);
    }
  }
  for (const session of state.focusHistory) {
    if (session.projectId !== projectId || session.marathon !== true) continue;
    const item = attributionBySession.get(session.id);
    // Discarded rounds are a known deliberate choice, not an unknown gap.
    if ((!item || item.kind === 'unallocated') && item?.reason !== 'discarded') unknown.add(session.id);
  }
  return unknown;
}

function isCompletedStatus(status: FocusSession['status']): status is 'completed' | 'completed-early' {
  return status === 'completed' || status === 'completed-early';
}

function targetFromReport(state: DomainState, report: ProgressReport): Target | null {
  const project = state.projects.find(candidate => candidate.id === report.projectId);
  const subtask = project?.subtasks.find(candidate => candidate.id === report.subtaskId);
  if (!project || !subtask) return null;
  return {
    kind: 'finite-subtask', projectId: project.id, projectTitle: project.title,
    subtaskId: subtask.id, subtaskTitle: subtask.title, targetId: subtask.id, targetTitle: subtask.title,
  };
}

function targetFromSession(state: DomainState, session: FocusSession): Target | null {
  const project = state.projects.find(candidate => candidate.id === session.projectId);
  if (!project) return null;
  if (project.kind === 'habit') {
    return { kind: 'habit-project', projectId: project.id, projectTitle: project.title, subtaskId: null, subtaskTitle: null, targetId: project.id, targetTitle: project.title };
  }
  if (!session.subtaskId) return null;
  const subtask = project.subtasks.find(candidate => candidate.id === session.subtaskId);
  return subtask ? { kind: 'finite-subtask', projectId: project.id, projectTitle: project.title, subtaskId: subtask.id, subtaskTitle: subtask.title, targetId: subtask.id, targetTitle: subtask.title } : null;
}

function attributed(session: FocusSession, target: Target): FocusAttribution {
  return {
    sessionId: session.id, endedAt: focusEndedAt(session), timeZoneAtStart: session.timeZoneAtStart, actualDurationMs: session.actualDurationMs,
    status: session.status, ...target, reason: null,
  };
}

function unallocated(session: FocusSession, reason: FocusAttributionReason): FocusAttribution {
  return {
    sessionId: session.id, endedAt: focusEndedAt(session), timeZoneAtStart: session.timeZoneAtStart, actualDurationMs: session.actualDurationMs,
    status: session.status, kind: 'unallocated', projectId: null, projectTitle: '未分配 / 不可追溯',
    subtaskId: null, subtaskTitle: null, targetId: null, targetTitle: null, reason,
  };
}

function focusEndedAt(session: FocusSession): string {
  return session.status === 'interrupted' ? session.interruptedAt : session.completedAt;
}

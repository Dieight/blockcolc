import type { DomainState } from '@tomato-clock/domain';

/** Includes allocations made by older versions, before settledAt was stored. */
export function settledFocusSessionIds(state: DomainState): Set<string> {
  return new Set([
    ...state.progressReports.flatMap(report => report.focusSessionIds),
    ...state.habitBuildings.flatMap(building => building.focusSessionIds),
    ...state.projects.flatMap(project => project.habit?.completedFocusSessionIds ?? []),
  ]);
}

export function unsettledMarathonSessions(state: DomainState, hostProjectId?: string) {
  const settled = settledFocusSessionIds(state);
  return state.focusHistory.filter(session =>
    (hostProjectId === undefined || session.projectId === hostProjectId)
    && (session.status === 'completed' || session.status === 'completed-early')
    && session.marathon === true && session.settledAt === undefined && !settled.has(session.id))
    .sort((left, right) => {
      const leftAt = left.status === 'completed' || left.status === 'completed-early' ? left.completedAt : left.endsAt;
      const rightAt = right.status === 'completed' || right.status === 'completed-early' ? right.completedAt : right.endsAt;
      return Date.parse(leftAt) - Date.parse(rightAt) || left.id.localeCompare(right.id);
    });
}

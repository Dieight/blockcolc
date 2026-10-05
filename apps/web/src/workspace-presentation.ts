import type { ActiveProjectProjection, WorldProjection } from '@blockcolc/application';
import type { DomainState } from '@blockcolc/domain';

/** A finished workspace remains visible; it is not an authorization to start focus. */
export function workspacePresentation(state: DomainState, active: ActiveProjectProjection | null,
  world: WorldProjection): ActiveProjectProjection | null {
  if (active) return active;
  for (let index = state.projects.length - 1; index >= 0; index--) {
    const project = state.projects[index]!;
    if (project.status === 'deleted') continue;
    const building = world.projects.find(item => item.project.id === project.id)?.building;
    if (building) return { project, building, unreportedCompletedSessions: [] };
  }
  return null;
}

export function requiresFirstProjectSetup(state: DomainState, marker: boolean, hasDeferredReport: boolean): boolean {
  return !marker && state.projects.length === 0 && state.focusHistory.length === 0
    && state.habitBuildings.length === 0 && !hasDeferredReport;
}

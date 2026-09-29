import type { ApplicationService } from '@blockcolc/application';
import type { BlueprintV1, WorldSnapshot } from '@blockcolc/voxel';

export function toVoxelWorlds(projects:ReturnType<ApplicationService['worldProjection']>['projects'],state?:ReturnType<ApplicationService['snapshot']>):WorldSnapshot[] { const dates=state?decorationDatesByProject(state):new Map<string,string[]>();return projects.map(project=>({projectId:project.project.id,blueprintId:project.building.blueprintId,buildingCompletionBasisPoints:project.building.completionBasisPoints,buildingConditionBasisPoints:project.building.conditionBasisPoints,isMonument:project.project.status==='monument',isActive:project.isActive,settlementIndex:project.settlementIndex,decorationDates:dates.get(project.project.id)??[],importedDecorations:project.importedDecorations.map(reward=>({...reward,blueprint:reward.blueprint as BlueprintV1}))})); }
export function decorationDatesByProject(state:ReturnType<ApplicationService['snapshot']>):Map<string,string[]> {
  const result = new Map<string, string[]>();
  const importedDates = new Set(state.decorationRewards.map(reward => reward.date));
  // Preserve Array.find's first-match behavior while replacing the per-goal
  // history scan with one indexed pass. Long-lived focus histories otherwise
  // made every world projection cost O(goals × sessions).
  const projectByCompletionTime = new Map<string, string>();
  for (const session of state.focusHistory) {
    if (session.status === 'interrupted' || projectByCompletionTime.has(session.completedAt)) continue;
    projectByCompletionTime.set(session.completedAt, session.projectId);
  }
  for (const goal of state.dailyGoals) {
    if (!goal.reachedAt || importedDates.has(goal.date)) continue;
    const projectId = projectByCompletionTime.get(goal.reachedAt);
    if (!projectId) continue;
    const dates = result.get(projectId) ?? [];
    dates.push(goal.date);
    result.set(projectId, dates);
  }
  return result;
}

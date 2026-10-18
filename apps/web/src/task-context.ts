import type { DomainState } from '@blockcolc/domain';
import { reconcileRoundPlan, type RoundPlan } from './round-plan';

export interface TaskContextRequest {projectId:string;subtaskId:string;revision:number}

/** Navigation can select an idle task, never rebind a retained focus plan. */
export function canSelectTaskContext(state:DomainState,plan:RoundPlan|null,unreported=0):boolean{
  return !state.activeFocusSession&&unreported===0&&reconcileRoundPlan(plan,state,state.activeProjectId??'')===null;
}

export function validTaskContext(state:DomainState,request:TaskContextRequest):boolean{
  const project=state.projects.find(project=>project.id===request.projectId);
  return project?.kind==='finite'&&project.status==='active'&&state.activeProjectId===project.id
    &&project.subtasks.some(task=>task.id===request.subtaskId&&task.progressBasisPoints<10000);
}

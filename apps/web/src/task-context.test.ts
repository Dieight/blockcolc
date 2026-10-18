import {describe,expect,it} from 'vitest';
import {createInitialState,execute,type DomainState} from '@blockcolc/domain';
import {canSelectTaskContext,validTaskContext} from './task-context';
import type {RoundPlan} from './round-plan';

function fixture(){
  const result=execute(createInitialState('Asia/Shanghai'),{type:'CreateProject',projectId:'p',title:'写作',blueprintId:'builtin-small-workshop',subtasks:[{id:'a',title:'提纲'},{id:'b',title:'正文'}]},{now:()=>new Date('2026-10-15T08:00:00+08:00')});
  if(!result.ok)throw Error(result.message);return result.state;
}
describe('idle task context selection',()=>{
  it('allows selecting an unfinished task without starting or rewriting a plan',()=>{
    const state=fixture(),before=JSON.stringify(state);
    expect(canSelectTaskContext(state,null)).toBe(true);
    expect(validTaskContext(state,{projectId:'p',subtaskId:'b',revision:1})).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
  });
  it('never rebinds a prepared multi-round plan or an unreported result',()=>{
    const state=fixture(),plan:RoundPlan={projectId:'p',subtaskId:'a',totalRounds:2,completedRounds:0,status:'ready',reportedSessionIds:[]};
    expect(canSelectTaskContext(state,plan)).toBe(false);
    expect(canSelectTaskContext(state,null,1)).toBe(false);
    const result=execute(state,{type:'StartFocus',sessionId:'s',subtaskId:'a',plannedDurationMs:60_000},{now:()=>new Date('2026-10-15T08:01:00+08:00')});
    if(!result.ok)throw Error(result.message);
    expect(canSelectTaskContext(result.state,null)).toBe(false);
  });
  it('rejects stale project, deleted task and completed task requests',()=>{
    const state=fixture();
    expect(validTaskContext(state,{projectId:'other',subtaskId:'b',revision:1})).toBe(false);
    expect(validTaskContext(state,{projectId:'p',subtaskId:'missing',revision:1})).toBe(false);
    const finished={...state,projects:state.projects.map(project=>({...project,subtasks:project.subtasks.map(task=>({...task,progressBasisPoints:10000}))}))} as DomainState;
    expect(validTaskContext(finished,{projectId:'p',subtaskId:'b',revision:1})).toBe(false);
  });
});

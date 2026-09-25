import { describe, expect, it } from 'vitest';
import { createInitialState, execute, type DomainCommand } from '@tomato-clock/domain';
import { parseRoundPlan, reconcileRoundPlan, roundPlansEqual, type RoundPlan } from './round-plan';

describe('deferred marathon round-plan continuity', () => {
  const plan: RoundPlan = {projectId:'h',subtaskId:null,totalRounds:1,completedRounds:0,status:'focus',reportedSessionIds:[],currentSessionId:'r',mode:'marathon',deferredSettlement:true};
  const now = Date.parse('2026-09-06T08:00:00Z');
  function fixture() {
    let state = createInitialState('UTC');
    const run=(command:DomainCommand, at=now)=>{
      const result=execute(state,command,{now:()=>new Date(at)});
      if(!result.ok) throw new Error(result.message);
      state=result.state; return state;
    };
    run({type:'CreateHabitProject',projectId:'h',title:'Habit',blueprintId:'cottage',targetRounds:10});
    run({type:'StartFocus',sessionId:'r',subtaskId:null,plannedDurationMs:60_000,marathon:true,deferredSettlement:true});
    return {run,state:()=>state};
  }
  it('parses only marathon drafts with no subtask and includes semantics in equality', () => {
    expect(parseRoundPlan(plan,'h')).toMatchObject({deferredSettlement:true});
    expect(parseRoundPlan({...plan,mode:'rounds'},'h')).toBeNull();
    expect(parseRoundPlan({...plan,subtaskId:'s'},'h')).toBeNull();
    expect(roundPlansEqual(plan,{...plan,deferredSettlement:undefined})).toBe(false);
  });
  it('recovers active deferred identity without inventing lost end-time schedule', () => {
    const f=fixture();
    expect(reconcileRoundPlan(null,f.state(),'h',now)).toMatchObject({mode:'marathon',deferredSettlement:true,currentSessionId:'r'});
    expect(reconcileRoundPlan(null,f.state(),'h',now)?.endAt).toBeUndefined();
  });
  it('keeps the final habit-host report until explicitly settled', () => {
    const f=fixture(); f.run({type:'CompleteFocus'},now+60_000);
    const report=reconcileRoundPlan(plan,f.state(),'h',now+60_000);
    expect(report).toMatchObject({status:'report',completedRounds:1,deferredSettlement:true});
    expect(reconcileRoundPlan(report,f.state(),'h',now+120_000)).toEqual(report);
  });
  it('recovers a lost plan from retained completed rounds even after switching hosts', () => {
    const f=fixture(); f.run({type:'CompleteFocus'},now+60_000);
    expect(reconcileRoundPlan(null,f.state(),'another-project',now+60_000)).toMatchObject({
      projectId:'h',status:'report',completedRounds:1,deferredSettlement:true,
    });
  });
  it('does not resurrect a report after explicit discard or settlement', () => {
    const f=fixture(); f.run({type:'CompleteFocus'},now+60_000);
    const report=reconcileRoundPlan(null,f.state(),'h',now+60_000);
    f.run({type:'ReportMarathonFocus',focusSessionIds:['r'],entries:[],habitAllocations:[]},now+65_000);
    expect(reconcileRoundPlan(report,f.state(),'h',now+65_000)).toBeNull();
    expect(reconcileRoundPlan(null,f.state(),'h',now+65_000)).toBeNull();
  });
  it('does not treat an interrupted round as a pending final report', () => {
    const f=fixture(); f.run({type:'CancelFocus',interruptionCategory:null},now+20_000);
    expect(reconcileRoundPlan(null,f.state(),'h',now+20_000)).toBeNull();
  });
  it('continues through break and ready without losing deferred semantics', () => {
    const f=fixture(); f.run({type:'CompleteFocus'},now+60_000);
    const rest=reconcileRoundPlan({...plan,totalRounds:2},f.state(),'h',now+60_000,5_000,5_000);
    expect(rest).toMatchObject({status:'break',deferredSettlement:true,completedRounds:1});
    expect(reconcileRoundPlan(rest,f.state(),'h',now+65_000,5_000,5_000)).toMatchObject({status:'ready',deferredSettlement:true});
  });
});

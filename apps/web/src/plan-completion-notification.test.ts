import { describe, expect, it } from 'vitest';
import { createInitialState, execute } from '@blockcolc/domain';
import { planCompletionNotification } from './plan-completion-notification';
import type { RoundPlan } from './round-plan';

const now = Date.parse('2026-10-23T08:00:00Z');
const created = execute(createInitialState('UTC'), { type:'CreateProject', projectId:'p', title:'Work', blueprintId:'cottage', subtasks:[{id:'t',title:'Task'}] }, {now:()=>new Date(now)});
if (!created.ok) throw Error(created.message);
const started = execute(created.state, {type:'StartFocus',sessionId:'s',projectId:'p',subtaskId:null,marathon:true,deferredSettlement:true,plannedDurationMs:60_000},{now:()=>new Date(now)});
if (!started.ok) throw Error(started.message);
const state = started.state;
const plan:RoundPlan = {projectId:'p',subtaskId:null,mode:'marathon',deferredSettlement:true,totalRounds:3,completedRounds:0,status:'focus',currentSessionId:'s',reportedSessionIds:[]};
const automatic = {authorizationId:'a',focusDurationMs:60_000,breakDurationMs:30_000};

describe('one completion notice for a batch',()=>{
  it('never prompts for reports after manual intermediate rounds',()=>{
    expect(planCompletionNotification(plan,state)).toBeNull();
    expect(planCompletionNotification({...plan,status:'break',breakEndsAt:new Date(now+90_000).toISOString(),reportedSessionIds:['s']}, {...state,activeFocusSession:null})).toBeNull();
    expect(planCompletionNotification({...plan,mode:'rounds',deferredSettlement:undefined},state)).toBeNull();
  });
  it('schedules one last-round reminder, separate from per-focus cancellation',()=>{
    expect(planCompletionNotification({...plan,completedRounds:2,reportedSessionIds:['first','second']},state)).toEqual({planKey:'p:first',endsAt:new Date(now+60_000).toISOString(),requiresReport:true});
  });
  it('projects the complete authorized background timeline once',()=>{
    const first=planCompletionNotification({...plan,automaticContinuation:automatic},state)!;
    expect(first.endsAt).toBe(new Date(now+240_000).toISOString());
    const rest=planCompletionNotification({...plan,status:'break',currentSessionId:undefined,completedRounds:1,reportedSessionIds:['s'],breakEndsAt:new Date(now+90_000).toISOString(),automaticContinuation:automatic},{...state,activeFocusSession:null})!;
    expect(rest).toEqual(first);
  });
  it('includes an exact terminal rest without inventing a focus round',()=>{
    const endAt=new Date(now+75_000).toISOString();
    expect(planCompletionNotification({...plan,totalRounds:1,endAt,deadlinePolicy:'exact'},state)?.endsAt).toBe(endAt);
    expect(planCompletionNotification({...plan,totalRounds:1,completedRounds:1,status:'break',endAfterBreak:true,breakEndsAt:endAt,currentSessionId:undefined,reportedSessionIds:['s'],endAt,deadlinePolicy:'exact'},{...state,activeFocusSession:null})?.endsAt).toBe(endAt);
  });
  it('cancellation, missing hosts, and ready/report phases do not retain future reminders',()=>{
    for(const altered of [{...plan,cancellationRequested:true as const},{...plan,status:'report' as const},{...plan,status:'ready' as const},{...plan,projectId:'gone'}])expect(planCompletionNotification(altered,state)).toBeNull();
  });
});

import assert from 'node:assert/strict';

/** Executes the actual current UI orchestrator over its actual application
 * service. These are synthetic manual-flow inputs, not invented native rules. */
export async function presentationFlowOracle(load,defaults,canonical){
 const {ApplicationService}=await load('packages/application/src/index.ts');
 const {createFocusFlow}=await load('apps/web/src/focus-flow.ts');
 const cases=[];
 const start=Date.parse('2026-10-24T08:00:00.000Z');
 function summary(state,plan){
  return canonical({
   activeProjectId:state.activeProjectId,
   phase:state.activeFocusSession?'FOCUS':plan?{focus:'FOCUS',break:'REST',ready:'READY',report:'REPORT'}[plan.status]:'IDLE',
   totalRounds:plan?.totalRounds??null,completedRounds:plan?.completedRounds??0,hasStarted:plan?.hasStarted===true,
   automatic:!!plan?.automaticContinuation,mode:plan?(plan.deferredSettlement?'MINIMAL':plan.mode==='marathon'?'MARATHON':'ROUNDS'):null,
   subtaskId:plan?.subtaskId??null,plannedDurationMs:state.activeFocusSession?.plannedDurationMs??null,
   history:state.focusHistory.map(x=>({status:x.status,actualDurationMs:x.actualDurationMs,plannedDurationMs:x.plannedDurationMs})),
   reports:state.progressReports.map(r=>({subtaskId:r.subtaskId,progressBasisPoints:r.progressBasisPoints,rounds:r.focusSessionIds.length})),
   projects:state.projects.map(p=>({id:p.id,status:p.status,progress:p.subtasks.map(t=>t.progressBasisPoints),habitApplied:p.habit?.completedFocusSessionIds.length??0})),
  });
 }
 for(const kind of ['finite','habit'])for(const mode of ['ROUNDS','MINIMAL','MARATHON'])
 for(const action of ['early','interrupt'])for(const rounds of [1,3])for(const breakMinutes of [0,5])for(const autoContinueFocus of [false,true]){
  let now=start,persisted=null,revision=0,serial=0,plan=null;
  const repository={load:async()=>({state:persisted,revision}),save:async(next,expected)=>{assert.equal(expected,revision);persisted=structuredClone(next);return ++revision;}};
  const capability={permission:'denied',precision:'unavailable',canSchedule:false};
  const service=await ApplicationService.initialize({repository,clock:{now:()=>new Date(now)},ids:{next:type=>`${type}-${++serial}`},initialTimeZone:'UTC',notifications:{
   requestPermission:async()=>capability,refreshCapability:async()=>capability,scheduleFocusCompletion:async()=>{},cancelFocusCompletion:async()=>{},scheduleBreakCompletion:async()=>{},cancelBreakCompletion:async()=>{},
  }});
  const result=await service.dispatch(kind==='habit'?{type:'CreateHabitProject',title:'Habit',blueprintId:'cottage',targetRounds:10}:
   {type:'CreateProject',title:'Work',blueprintId:'cottage',subtasks:[{title:'First'},{title:'Second'}]});assert.ok(result.ok);
  const owner=service.snapshot().projects[0],taskId=kind==='habit'||mode==='MINIMAL'?null:owner.subtasks[0].id;
  const preferences={...defaults,focusMinutes:1,habitFocusMinutes:2,breakMinutes,autoContinueFocus};
  const draft={projectId:owner.id,selectedId:taskId,mode:'rounds',rounds,endAt:'23:59'};
  if(mode!=='ROUNDS')plan={projectId:owner.id,subtaskId:taskId,totalRounds:rounds,completedRounds:0,status:'ready',reportedSessionIds:[],mode:'marathon',...(mode==='MINIMAL'?{deferredSettlement:true}:{})};
  const initial=structuredClone(service.snapshot());
  const flow=createFocusFlow({snapshot:()=>service.snapshot(),dispatch:c=>service.dispatch(c),resume:()=>service.resume(),readPlan:()=>plan,writePlan:p=>{plan=p;},
   preferences:()=>preferences,draft:()=>draft,nowMs:()=>now,closeEnding(){},closePlan(){},resetDraftMode(){draft.mode='rounds';},constructionFeedback(){},newAuthorizationId:()=> 'formal-authorization'});
  await flow.startFocus();assert.ok(service.snapshot().activeFocusSession);
  const steps=[{action:'start',now,canonical:summary(service.snapshot(),plan)}];
  now+=1000;
  if(action==='early')await flow.completeEarly();else await flow.interruptFocus(null);
  steps.push({action,now,canonical:summary(service.snapshot(),plan)});
  assert.equal(service.snapshot().activeFocusSession,null);
  assert.equal(!!plan?.automaticContinuation,false);
  cases.push({name:[kind,mode,action,rounds,breakMinutes,autoContinueFocus].join(':'),mode,rounds,projectId:owner.id,subtaskId:taskId,initial,preferences,steps});
 }
 assert.equal(cases.length,96);
 return cases;
}

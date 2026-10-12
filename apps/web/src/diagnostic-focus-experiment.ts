/** Diagnostic-only module. Isolated data never reaches the user's database or relay. */
import {ApplicationService,type NotificationPort} from '@blockcolc/application';
import type {DomainState} from '@blockcolc/domain';
import {IndexedDbStateRepository} from '@blockcolc/storage-indexeddb';
import {DateClock,CryptoIdGenerator} from './browser-adapters';
import {defaultFocusPreferences} from './focus-preferences';
import type {RoundPlan} from './round-plan';
export async function prepareFocusExperiment(state:DomainState){
  if(state.activeFocusSession)throw new Error('Active focus is not allowed');
  const databaseName=`blockcolc-diagnostic-${crypto.randomUUID()}`;
  const repository=new IndexedDbStateRepository({databaseName});
  const capability=async()=>({permission:'unavailable',precision:'unavailable',canSchedule:false} as const);
  const notifications:NotificationPort={requestPermission:capability,refreshCapability:capability,scheduleFocusCompletion:async()=>{},cancelFocusCompletion:async()=>{},scheduleBreakCompletion:async()=>{},cancelBreakCompletion:async()=>{}};
  try{
    await repository.save(state,0);
    const service=await ApplicationService.initialize({repository,notifications,clock:new DateClock(),ids:new CryptoIdGenerator()});
    const created=await service.dispatch({type:'CreateProject',title:'Diagnostic focus',blueprintId:'builtin-small-workshop',subtasks:[{title:'Diagnostic work'}]});
    if(!created.ok)throw new Error(created.code);
    const started=await service.dispatch({type:'StartFocus',subtaskId:null,plannedDurationMs:24_000,marathon:true,deferredSettlement:true});
    if(!started.ok||!started.state.activeFocusSession)throw new Error('Diagnostic session start failed');
    const active=started.state.activeFocusSession,authorizationId=`diagnostic-${crypto.randomUUID()}`;
    const plan:RoundPlan={projectId:active.projectId,subtaskId:null,totalRounds:3,completedRounds:0,status:'focus',hasStarted:true,currentSessionId:active.id,reportedSessionIds:[],mode:'marathon',deferredSettlement:true,
      endAt:new Date(Date.parse(active.startedAt)+96_000).toISOString(),automaticContinuation:{authorizationId,focusDurationMs:24_000,breakDurationMs:12_000}};
    return{databaseName,authorizationId,plan,firstEndsAt:Date.parse(active.endsAt),initialHistoryCount:state.focusHistory.length,
      preferences:{...defaultFocusPreferences(),minimalMode:true,autoContinueFocus:true,focusMinutes:1,breakMinutes:1,realWeatherEnabled:false},
      baseline:{projects:state.projects.length,history:state.focusHistory.length}};
  }finally{repository.close();}
}

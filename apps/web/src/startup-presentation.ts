import type { LoadingStage } from './LoadingPage';

type StartupPresentation={active:boolean;stage:LoadingStage;status:string};
let state:StartupPresentation={active:true,stage:'storage',status:'正在读取本地记录…'};
const listeners=new Set<()=>void>();
export const startupPresentationSnapshot=()=>state;
export const subscribeStartupPresentation=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
function publish(next:StartupPresentation){state=next;listeners.forEach(listener=>listener());}
export function advanceStartupPresentation(stage:LoadingStage,status:string){
  if(state.active&&(state.stage!==stage||state.status!==status))publish({...state,stage,status});
}
/** One loader owns the whole cold boot, including the IndexedDB-to-world handoff. */
export function completeStartupPresentation(){
  if(!state.active)return;
  document.documentElement.dataset.coldStartup='false';
  publish({...state,active:false});
}

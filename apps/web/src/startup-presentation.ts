import type { LoadingStage } from './LoadingPage';
import { loadFocusPreferences } from './focus-preferences';
import { diagnosticProgressiveStartup } from './performance-probe';

type StartupPresentation={active:boolean;progressive:boolean;stage:LoadingStage;status:string};
let progressive=false;
try { progressive=loadFocusPreferences(window.localStorage).progressiveStartup===true; } catch { /* Default to the complete startup presentation. */ }
progressive=progressive||diagnosticProgressiveStartup();
document.documentElement.dataset.progressiveStartup=String(progressive);
let state:StartupPresentation={active:true,progressive,stage:'storage',status:'读取记录…'};
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

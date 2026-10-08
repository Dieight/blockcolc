import {createRoot} from 'react-dom/client';
import {App} from '../App';
import {ApplicationService,type StateRepository,type NotificationPort} from '@blockcolc/application';
import {createInitialState,execute,type DomainCommand} from '@blockcolc/domain';
import {CORE_BUILTIN_BLUEPRINT_CATALOG} from '@blockcolc/voxel';
import type {ResourcePackRepository} from '@blockcolc/resource-pack-indexeddb';
import {defaultFocusPreferences} from '../focus-preferences';
import '../styles/index.css';
import './portal-app.css';

export async function startPortalApp(){
  const parameters = new URLSearchParams(location.search);
  const count = Math.max(1, Math.min(24, Number(parameters.get('buildings')) || 8));
  let state=createInitialState('Asia/Shanghai'),revision=1;
  const now=Date.now(),clock={now:()=>new Date(now)};
  function run(command:DomainCommand,time=now){const result=execute(state,command,{now:()=>new Date(time)});if(!result.ok)throw new Error(result.message);state=result.state;}
  for(let index=0;index<count;index++){
    const id=`portal-${index}`,time=now-(count+1-index)*240_000;
    run({type:'CreateProject',projectId:id,title:index===count-1?'林间工坊':`已经建成的小屋 ${index+1}`,blueprintId:CORE_BUILTIN_BLUEPRINT_CATALOG[index%3]!.id,subtasks:[{id:`${id}-s`,title:index===count-1?'搭好下一层的框架':'完成施工'}]},time);
    run({type:'StartFocus',projectId:id,sessionId:`${id}-f`,subtaskId:`${id}-s`,plannedDurationMs:60_000},time+1000);
    run({type:'CompleteFocus'},time+61_000);
    run({type:'ReportSubtaskProgress',reportId:`${id}-r`,subtaskId:`${id}-s`,focusSessionIds:[`${id}-f`],progressBasisPoints:index===count-1?6500:10000},time+62_000);
  }
  run({type:'ConfigureWorldEnvironment',environmentStyle:parameters.get('environment')==='mosaic-coast'?'mosaic-coast':'ocean-island'});
  const repository:StateRepository={load:async()=>({state,revision}),save:async(next,expected)=>{if(expected!==revision)throw new Error('Review revision changed');state=next;return++revision;}};
  const unavailable=async()=>({permission:'unavailable',precision:'unavailable',canSchedule:false} as const);
  const notifications:NotificationPort={requestPermission:unavailable,refreshCapability:unavailable,scheduleFocusCompletion:async()=>{},cancelFocusCompletion:async()=>{},scheduleBreakCompletion:async()=>{},cancelBreakCompletion:async()=>{}};
  const packs:ResourcePackRepository={list:async()=>[],get:async()=>undefined,getActive:async()=>undefined,getBase:async()=>undefined,select:async()=>undefined,selectBase:async()=>undefined,delete:async()=>null,clear:async()=>{},close:()=>{},save:async()=>{throw new Error('Review does not import packs');}};
  const service=await ApplicationService.initialize({repository,notifications,clock,ids:{next:kind=>`${kind}-${crypto.randomUUID()}`}});
  const theme=parameters.get('theme')==='dark'?'dark':'light';
  localStorage.setItem('blockcolc-first-project-setup-v1','1');
  localStorage.setItem('blockcolc-focus-preferences-v1',JSON.stringify({...defaultFocusPreferences(),minimalMode:true,themeMode:theme,realWeatherEnabled:false,autoCheckUpdates:false,lightingQuality:parameters.get('quality')==='performance'?'performance':'cinematic'}));
  createRoot(document.getElementById('root')!).render(<App service={service} resourcePacks={packs}/>);
  const wait=async(check:()=>boolean,timeout=12_000)=>{
    const start=performance.now();while(!check()){if(performance.now()-start>timeout)throw new Error('Review layout did not become ready');await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));}
  };
  await wait(()=>document.querySelector('.world-screen')?.getAttribute('data-world-ready')==='true',60_000);
  (document.querySelector('.minimal-exit') as HTMLButtonElement).click();
  await wait(()=>document.querySelector('.world-screen')?.getAttribute('data-minimal-mode')==='false');
  await wait(()=>document.querySelector('.app-shell')?.getAttribute('data-presentation-transition')==='complete');
  // The fixture now uses the production choreography, not a second click interceptor.
  await wait(()=>document.querySelector('.app-shell')?.getAttribute('data-mode-portal-active')==='false');
  document.body.dataset.reviewReady='true';
}

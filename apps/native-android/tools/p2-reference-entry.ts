import './export-fixture';
import {ApplicationService} from '../../../packages/application/src/application-service';
import {projectFocusAttribution} from '../../../packages/application/src/focus-attribution';
import {IndexedDbStateRepository} from '../../../packages/storage-indexeddb/src/repository';
import {parseDomainState,projectProgressBasisPoints} from '../../../packages/domain/src/index';
import {restoreSourceAnimalInput} from './animal-source';
// @ts-expect-error Shared debug-host instrumentation, covered by node:test.
import {observeP2Repository,observeP2Transactions} from './p2-reference-cost.mjs';
// @ts-expect-error Frozen bounded fixture identities.
import {P1_FIXTURES} from './fixture-scope.mjs';

const bridge=(window as any).P1Reference,lab=()=>(window as any).nativeP1;
const query=new URLSearchParams(location.search),fixture=query.get('fixture')!,runId=query.get('p2Run')!;
if(!/^[a-z0-9-]{1,80}$/.test(runId)||!P1_FIXTURES.some((r:any)=>r.name===fixture))throw Error('Invalid P2 cost identity');
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const ns=()=>bridge.monotonicNs();
let service:ApplicationService,phase='IDLE',round=0,sequence=0,clock=Date.now(),reserved='',progressReport='';
const commands:any[]=[],operations:any[]=[],startedNs=ns();
let initial:any,ready=false,busy=false;
let frozen:any;
let activeCost:any=null;
observeP2Transactions(IDBDatabase.prototype,()=>activeCost,ns);
async function animalsReady(expected:number){
  const until=performance.now()+120000;
  for(;;){
    const animals=lab().assetState().diagnostics.animals;
    if(animals?.ready){if(animals.count!==expected)throw Error('Source animal population changed during construction');return animals;}
    if(performance.now()>until)throw Error('Source animal preparation did not finish: '+JSON.stringify(animals));
    // Let the real visible-world pump prepare its own navigation/population;
    // do not replace it with cached agents or extra diagnostic update ticks.
    await new Promise(r=>setTimeout(r,32));
  }
}
function canvasState(){
  const h=lab().hook(),gl=h.renderer.getContext(),canvas=h.renderer.domElement,rect=canvas.getBoundingClientRect(),pixel=new Uint8Array(4);
  h.draw();gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  return {hidden:document.hidden,contextLost:gl.isContextLost(),width:canvas.width,height:canvas.height,cssWidth:rect.width,cssHeight:rect.height,
    framebufferIsDefault:gl.getParameter(gl.FRAMEBUFFER_BINDING)===null,centerPixel:[...pixel],render:h.renderer.info.render,camera:h.state()};
}
const report=(extra:any={})=>bridge.save(JSON.stringify({kind:'p2-integrated-cost',timingSchema:2,backend:'web',fixture,runId,phase,round,sequence,ready,startedNs,operations,initial:canonical(initial??null),final:service?canonical(service.snapshot()):null,commands,...extra}));
async function sha(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
async function dispatch(command:any,materialized:any){
  if(activeCost)activeCost.marks.serviceStartedNs=ns();
  const r=await service.dispatch(command);
  if(activeCost)activeCost.marks.serviceReturnedNs=ns();
  if(!r.ok)throw Error(command.type+':'+r.code);
  const begin=ns();
  commands.push({commands:[{command:materialized,now:clock}],events:r.events,after:canonical(r.state)});
  if(activeCost)activeCost.spans.push({name:'test-journal',beginNs:begin,endNs:ns(),ok:true});
}
(window as any).p2CostAction=async(action:string,inputNs:string,at:number)=>{
  if(!ready||busy)throw Error('Cost action before readiness / repeated');busy=true;clock=at;
  const operation:any={action,inputNs,sequence,receivedNs:ns()};
  activeCost=action==='stats'?null:{schema:2,backend:'web',marks:{receivedNs:operation.receivedNs},spans:[],transactions:[]};
  try{
    if(action==='start'){
      if(!['IDLE','READY'].includes(phase))throw Error('Not ready');
      reserved='session:cost-plan:'+(round+1)+':'+(await sha('start-'+sequence)).slice(0,16);
      const command={type:'StartFocus',projectId:'complex-0',subtaskId:null,plannedDurationMs:60000,marathon:true,deferredSettlement:true};
      await dispatch(command,{...command,sessionId:reserved});phase='FOCUS';
    }else if(action==='early'){
      if(phase!=='FOCUS')throw Error('No active focus');progressReport='early:early-'+sequence;
      await dispatch({type:'CompleteFocusEarly'},{type:'CompleteFocusEarly',reportId:progressReport});round++;phase=round===3?'REPORT':'READY';
    }else if(action==='report'){
      if(phase!=='REPORT'||round!==3)throw Error('Wrong report');progressReport='cost-report';
      const state=service.snapshot(),ids=state.focusHistory.filter(f=>f.id.startsWith('session:cost-plan:')).map(f=>f.id);
      const entries=[{projectId:'complex-0',subtaskId:'read',progressBasisPoints:5000,rounds:3}];
      await dispatch({type:'ReportMarathonFocus',entries,habitAllocations:[],focusSessionIds:ids},
        {type:'ReportMarathonFocus',entries:entries.map(e=>({...e,reportId:progressReport})),habitAllocations:[],focusSessionIds:ids});
      phase='DONE';
    }else if(action!=='stats')throw Error('Unknown cost action');
    operation.savedNs=ns();
    if(action==='report'){
      const progress=projectProgressBasisPoints(service.snapshot().projects[0]!);
      // Actual source setWorlds, not the owner-only preparation shortcut.
      const population=lab().assetState().diagnostics.animals.count;
      await lab().construction(progress,false);operation.progress=progress;operation.geometrySubmittedNs=ns();
      await animalsReady(population);
      lab().hook().frozenCamera(frozen.camera);lab().hook().draw();operation.worldSubmittedNs=ns();
    }
    const attribution=projectFocusAttribution(service.snapshot());operation.projectedNs=ns();
    const loaded=await repository.load();if(canonical(loaded.state)!==canonical(service.snapshot()))throw Error('Committed IndexedDB mismatch');
    if(activeCost)operation.timing=activeCost;activeCost=null;
    sequence++;operations.push(operation);busy=false;report({attribution,completed:action==='stats',world:lab().assetState(),...(action==='stats'?{canvas:canvasState()}:{} )});
  }catch(error){activeCost=null;busy=false;report({failed:String(error)});}
};
const capability={permission:'denied',precision:'unavailable',canSchedule:false};
const repository=observeP2Repository(new IndexedDbStateRepository({databaseName:'p2-cost-'+runId}),()=>activeCost,ns);
try{
  const deadline=performance.now()+30000;
  while(!bridge.foreground()){if(performance.now()>deadline)throw Error('No foreground');await new Promise(r=>setTimeout(r,50));}
  initial=parseDomainState(await(await fetch('/web/p2-fixture-domain.json')).json());
  const prior=await repository.load();if(prior.state!==null)throw Error('Cost run ID reused');
  // Seeding is explicit setup; not counted as normal read/start latency.
  await repository.save(initial,prior.revision);
  const loadStart=ns();
  service=await ApplicationService.initialize({repository,clock:{now:()=>new Date(clock)},ids:{next:(kind)=>kind==='focus-session'?reserved:progressReport},
    notifications:{requestPermission:async()=>capability,refreshCapability:async()=>capability,scheduleFocusCompletion:async()=>{},cancelFocusCompletion:async()=>{},scheduleBreakCompletion:async()=>{},cancelBreakCompletion:async()=>{}}} as any);
  const databaseReadyNs=ns();frozen=await(await fetch('/web/frozen-camera-'+fixture+'.json')).json();
  if(frozen.resourcePack)await lab().loadResourcePackWire(frozen.resourcePack);
  await lab().build(P1_FIXTURES.find((r:any)=>r.name===fixture).style,25,'day',0);
  const hook=lab().hook();
  // This isolated comparison owns its output buffer. Production setWorlds
  // reapplies its quality profile (and the phone's DPR); keep later frames at
  // the same 720x960 as Filament, not just the first screenshot.
  const setPixelRatio=hook.renderer.setPixelRatio.bind(hook.renderer);
  hook.renderer.setPixelRatio=(_requested:number)=>setPixelRatio(1);
  hook.renderer.setPixelRatio(1);hook.renderer.setSize(720,960,false);hook.camera.aspect=.75;hook.camera.updateProjectionMatrix();
  hook.frozenCamera(frozen.camera);
  if(frozen.animalRuntime){restoreSourceAnimalInput(hook.animals(),frozen.animalRuntime);hook.prepareTick();}
  lab().runtime(true);hook.draw();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  ready=true;report({loadStartNs:loadStart,databaseReadyNs,worldSubmittedNs:ns(),width:720,height:960,world:lab().assetState(),camera:hook.state(),canvas:canvasState(),
    scope:'Same Compose controls; formal TS ApplicationService + real IndexedDB + production Three renderer. Native adds its actual coordinator/publication. No React-shell or whole-App startup claim; source notification adapter is denied/no-op, so no native benefit is attributed to notifications.'});
}catch(error){report({failed:String(error)});}

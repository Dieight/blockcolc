import type { DerivedCacheRequest,DerivedCacheResponse } from './derived-cache-protocol';

/** One shared worker, no immortal per-renderer threads. A load/error/timeout
 * disables it for this session; callers fall back to their ordinary adapter. */
export function createDerivedCacheWorkerClient(factory:()=>Worker){
  let worker:Worker|null=null,disabled=false,sequence=0,idle:ReturnType<typeof setTimeout>|undefined;
  const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  const terminate=()=>{if(idle)clearTimeout(idle);idle=undefined;worker?.terminate();worker=null;};
  const fail=()=>{
    disabled=true;terminate();for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Derived cache worker unavailable'));}pending.clear();
  };
  const scheduleIdle=()=>{if(!pending.size)idle=setTimeout(terminate,30_000);};
  return {
    request(request:Omit<DerivedCacheRequest,'id'>):Promise<unknown>{
      if(disabled)return Promise.reject(new Error('Derived cache worker unavailable'));
      if(idle)clearTimeout(idle);idle=undefined;
      if(!worker){
        try{
          worker=factory();
          worker.onmessage=event=>{
            const result=event.data as DerivedCacheResponse,item=pending.get(result?.id);if(!item)return;
            pending.delete(result.id);clearTimeout(item.timer);
            result.ok?item.resolve(result.value):item.reject(new Error('Derived cache worker operation failed'));scheduleIdle();
          };
          worker.onerror=event=>{event.preventDefault();fail();};worker.onmessageerror=fail;
        }catch{fail();return Promise.reject(new Error('Derived cache worker unavailable'));}
      }
      const id=++sequence;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(fail,request.operation==='read'?4000:10_000);pending.set(id,{resolve,reject,timer});
        // A write is cloned, not transferred: the current world still owns it.
        try{worker!.postMessage({...request,id});}catch{fail();}
      });
    },
    dispose(){fail();},
  };
}

let shared:ReturnType<typeof createDerivedCacheWorkerClient>|undefined;
export function derivedCacheWorkerClient(){
  return shared??=createDerivedCacheWorkerClient(()=>new Worker(new URL('./derived-cache.worker.ts',import.meta.url),{type:'module',name:'blockcolc-derived-cache'}));
}

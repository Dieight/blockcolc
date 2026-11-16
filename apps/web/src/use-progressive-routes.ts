import { startTransition, useEffect, useState, useSyncExternalStore } from 'react';
import { queueIdleWork } from './idle-work';
import { startupPresentationSnapshot, subscribeStartupPresentation } from './startup-presentation';

export type PreparedRoute = 'tasks' | 'stats' | 'settings';
type RouteLoaders = Readonly<Record<PreparedRoute,()=>Promise<unknown>>>;

/** Idle preparation is reserved for progressive startup, after the main page. */
export function prepareRoutesWhenReady(mainPageReady:boolean,loaders:RouteLoaders,publish:(route:PreparedRoute)=>void,
  schedule:(key:string,work:()=>Promise<void>)=>()=>void=queueIdleWork) {
  if(!mainPageReady)return ()=>{};
  let live=true;
  const cancel=(['tasks','stats','settings'] as const).map(route=>schedule(`route-prepare:${route}`,async()=>{
    await loaders[route]();
    if(!live)return;
    publish(route);
    await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  }));
  return()=>{live=false;cancel.forEach(stop=>stop());};
}

/** Complete startup prepares routes in order, without the idle queue's boot veto. */
export function createStartupRouteScheduler(){
  let tail=Promise.resolve();
  return (_key:string,work:()=>Promise<void>)=>{
    let cancelled=false;
    tail=tail.then(async()=>{if(!cancelled)await work();}).catch(error=>console.warn('Startup page preparation skipped',error));
    return()=>{cancelled=true;};
  };
}

export function routePreparationReady(enabled:boolean,progressive:boolean,mainPageReady:boolean){
  return enabled&&(!progressive||mainPageReady);
}

export function useProgressiveRoutes(enabled:boolean,loaders:RouteLoaders) {
  const startup=useSyncExternalStore(subscribeStartupPresentation,startupPresentationSnapshot);
  const [prepared,setPrepared]=useState<ReadonlySet<PreparedRoute>>(()=>new Set());
  useEffect(()=>{
    return prepareRoutesWhenReady(routePreparationReady(enabled,startup.progressive,!startup.active),loaders,route=>{
      startTransition(()=>setPrepared(current=>new Set([...current,route])));
    },startup.progressive?queueIdleWork:createStartupRouteScheduler());
  },[enabled,loaders,startup.active,startup.progressive]);
  return prepared;
}

import { startTransition, useEffect, useState } from 'react';
import { queueIdleWork } from './idle-work';

export type PreparedRoute = 'tasks' | 'stats' | 'settings';
export function useProgressiveRoutes(enabled:boolean,loaders:Readonly<Record<PreparedRoute,()=>Promise<unknown>>>,priority=false) {
  const [prepared,setPrepared]=useState<ReadonlySet<PreparedRoute>>(()=>new Set());
  useEffect(()=>{
    if(!enabled)return;
    let live=true;
    if(priority){
      // Download/parse these small modules together before terrain preparation.
      // Publish each mounted page, then yield a paint before allowing the world.
      void Promise.allSettled((['tasks','stats','settings'] as const).map(async route=>{
        await loaders[route]();
        if(live)setPrepared(current=>new Set([...current,route]));
      })).then(()=>{if(live)setPrepared(new Set(['tasks','stats','settings']));});
      return()=>{live=false;};
    }
    const cancel=(['tasks','stats','settings'] as const).map(route=>queueIdleWork(`route-prepare:${route}`,async()=>{
      await loaders[route]();
      if(!live)return;
      startTransition(()=>setPrepared(current=>new Set([...current,route])));
      await new Promise<void>(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    }));
    return()=>{live=false;cancel.forEach(stop=>stop());};
  },[enabled,loaders,priority]);
  return prepared;
}

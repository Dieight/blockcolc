import { describe, expect, it, vi } from 'vitest';
vi.mock('./startup-presentation',()=>({startupPresentationSnapshot:()=>({active:true}),subscribeStartupPresentation:()=>()=>{}}));
import { createStartupRouteScheduler, prepareRoutesWhenReady, routePreparationReady, type PreparedRoute } from './use-progressive-routes';

describe('route preparation after main-page startup',()=>{
  const loaders=()=>({tasks:vi.fn(async()=>{}),stats:vi.fn(async()=>{}),settings:vi.fn(async()=>{})});
  it('only progressive startup postpones routes until the main page is ready',()=>{
    expect(routePreparationReady(true,false,false)).toBe(true);
    expect(routePreparationReady(true,true,false)).toBe(false);
    expect(routePreparationReady(true,true,true)).toBe(true);
    expect(routePreparationReady(false,false,true)).toBe(false);
  });
  it('prepares complete-startup routes serially, and cancellation stops queued work',async()=>{
    const schedule=createStartupRouteScheduler(),calls:string[]=[];let finish!:()=>void;
    schedule('tasks',async()=>{calls.push('tasks');await new Promise<void>(resolve=>{finish=resolve;});});
    const stop=schedule('stats',async()=>{calls.push('stats');});
    const done=new Promise<void>(resolve=>schedule('settings',async()=>{calls.push('settings');resolve();}));
    await Promise.resolve();expect(calls).toEqual(['tasks']);stop();finish();await done;
    expect(calls).toEqual(['tasks','settings']);
  });
  it('does not even enqueue hidden pages until the main page is ready',()=>{
    const schedule=vi.fn(),load=loaders();
    prepareRoutesWhenReady(false,load,vi.fn(),schedule)();
    expect(schedule).not.toHaveBeenCalled();
    for(const loader of Object.values(load))expect(loader).not.toHaveBeenCalled();
  });
  it('enqueues separate idle jobs in order and publishes only completed imports',async()=>{
    vi.stubGlobal('requestAnimationFrame',(callback:()=>void)=>{callback();return 1;});
    try{
      const jobs:Array<()=>Promise<void>>=[],load=loaders(),published:PreparedRoute[]=[];
      prepareRoutesWhenReady(true,load,route=>published.push(route),(key,job)=>{jobs.push(job);return()=>{};});
      expect(jobs).toHaveLength(3);expect(load.tasks).not.toHaveBeenCalled();
      for(const job of jobs)await job();
      expect(published).toEqual(['tasks','stats','settings']);
    }finally{vi.unstubAllGlobals();}
  });
  it('cancels queued jobs and ignores an import that completes after disposal',async()=>{
    let finish!:()=>void;
    const load=loaders();load.tasks.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const jobs:Array<()=>Promise<void>>=[],stop=vi.fn(),published=vi.fn();
    const dispose=prepareRoutesWhenReady(true,load,published,(_,job)=>{jobs.push(job);return stop;});
    const pending=jobs[0]!();dispose();finish();await pending;
    expect(stop).toHaveBeenCalledTimes(3);expect(published).not.toHaveBeenCalled();
  });
  it('does not mount a route when its import fails',async()=>{
    const load=loaders();load.tasks.mockRejectedValue(new Error('load failed'));
    const jobs:Array<()=>Promise<void>>=[],published=vi.fn();
    prepareRoutesWhenReady(true,load,published,(_,job)=>{jobs.push(job);return()=>{};});
    await expect(jobs[0]!()).rejects.toThrow('load failed');expect(published).not.toHaveBeenCalled();
  });
});

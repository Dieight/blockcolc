import { afterEach,describe,expect,it,vi } from 'vitest';
import { createIdleWorkQueue,scheduleIdleOpportunity } from './idle-work';

const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
describe('quiet preparation queue',()=>{
  function fixture(){
    let allowed=false;const callbacks:Array<()=>void>=[];
    const queue=createIdleWorkQueue({allowed:()=>allowed,schedule:callback=>{callbacks.push(callback);return()=>callbacks.splice(callbacks.indexOf(callback),1);}});
    return {queue,allow:()=>{allowed=true;},tick:()=>callbacks.shift()?.(),callbacks};
  }
  it('does not perform jobs during startup or interaction',async()=>{
    const f=fixture(),job=vi.fn();f.queue.enqueue('page',job);f.tick();await flush();expect(job).not.toHaveBeenCalled();
    f.allow();f.tick();await flush();expect(job).toHaveBeenCalledTimes(1);
  });
  it('runs one asynchronous job at a time and coalesces the latest pending layout',async()=>{
    const f=fixture();f.allow();let finish!:()=>void;
    const first=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),obsolete=vi.fn(),latest=vi.fn();
    f.queue.enqueue('first',first);f.queue.enqueue('scene',obsolete);f.queue.enqueue('scene',latest);
    f.tick();await flush();expect(first).toHaveBeenCalledOnce();expect(f.callbacks).toHaveLength(0);
    finish();await flush();f.tick();await flush();expect(obsolete).not.toHaveBeenCalled();expect(latest).toHaveBeenCalledOnce();
  });
  it('cancels pending work without removing its replacement and stops cleanly',async()=>{
    const f=fixture();f.allow();const old=vi.fn(),next=vi.fn();const cancel=f.queue.enqueue('scene',old);
    f.queue.enqueue('scene',next);cancel();f.tick();await flush();expect(next).toHaveBeenCalledOnce();
    f.queue.enqueue('page',old);f.queue.stop();await flush();expect(f.callbacks).toHaveLength(0);expect(old).not.toHaveBeenCalled();
  });
  it('a failing cache job does not strand the following page',async()=>{
    let callback=()=>{};const failed=vi.fn(),next=vi.fn();
    const queue=createIdleWorkQueue({allowed:()=>true,schedule:run=>{callback=run;return()=>{};},failed});
    queue.enqueue('cache',()=>{throw Error('quota');});queue.enqueue('page',next);callback();await flush();callback();await flush();
    expect(failed).toHaveBeenCalledOnce();expect(next).toHaveBeenCalledOnce();
  });
  it('a cancelled last job leaves the scheduled opportunity safe and permits later work',async()=>{
    const f=fixture();f.allow();const cancelled=vi.fn(),later=vi.fn();
    f.queue.enqueue('old',cancelled)();expect(()=>f.tick()).not.toThrow();await flush();
    f.queue.enqueue('later',later);f.tick();await flush();
    expect(cancelled).not.toHaveBeenCalled();expect(later).toHaveBeenCalledOnce();
  });
});

describe('bounded browser idle opportunities',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  function fixture(){
    let tick=()=>{},idle:IdleRequestCallback=()=>{};
    const timer=vi.fn((callback:()=>void)=>{tick=callback;return 7;});
    const request=vi.fn((callback:IdleRequestCallback)=>{idle=callback;return 0;});
    const clear=vi.fn(),cancel=vi.fn();
    vi.stubGlobal('window',{setTimeout:timer});vi.stubGlobal('clearTimeout',clear);
    vi.stubGlobal('requestIdleCallback',request);vi.stubGlobal('cancelIdleCallback',cancel);
    return {timer,request,clear,cancel,tick:()=>tick(),idle:(didTimeout:boolean,remaining:number)=>idle({didTimeout,timeRemaining:()=>remaining})};
  }
  it('sets a finite native timeout and does not re-defer its zero-budget callback',()=>{
    const f=fixture(),callback=vi.fn(),postpone=vi.fn();scheduleIdleOpportunity(callback,postpone);
    expect(f.timer).toHaveBeenCalledWith(expect.any(Function),600);f.tick();
    expect(f.request).toHaveBeenCalledWith(expect.any(Function),{timeout:1500});
    f.idle(true,0);expect(postpone).not.toHaveBeenCalled();expect(callback).toHaveBeenCalledOnce();
  });
  it('defers a genuinely short idle slot but accepts sufficient idle budget',()=>{
    const f=fixture(),callback=vi.fn(),postpone=vi.fn();scheduleIdleOpportunity(callback,postpone);f.tick();
    f.idle(false,4);expect(postpone).toHaveBeenCalledOnce();expect(callback).toHaveBeenCalledOnce();
    f.idle(false,20);expect(postpone).toHaveBeenCalledOnce();expect(callback).toHaveBeenCalledTimes(2);
  });
  it('cancels both the delay and a registered native callback, including handle zero',()=>{
    const f=fixture(),callback=vi.fn(),postpone=vi.fn();const cancel=scheduleIdleOpportunity(callback,postpone);
    f.tick();cancel();expect(f.clear).toHaveBeenCalledWith(7);expect(f.cancel).toHaveBeenCalledWith(0);
  });
  it('falls back to the guarded opportunity when idle callbacks are unavailable',()=>{
    const f=fixture(),callback=vi.fn(),postpone=vi.fn();vi.stubGlobal('requestIdleCallback',undefined);
    scheduleIdleOpportunity(callback,postpone);f.tick();expect(callback).toHaveBeenCalledOnce();expect(postpone).not.toHaveBeenCalled();
  });
});

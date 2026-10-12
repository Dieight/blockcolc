import { IDBFactory,IDBObjectStore } from 'fake-indexeddb';
import { describe,expect,it,vi } from 'vitest';
import { WORLD_SCENE_CACHE_REVISION, type WorldSceneCache } from '@blockcolc/voxel';
import { createWorldSceneCachePort, createBuildingCpuCachePort } from './world-scene-cache';

const entry=(key:string)=>({revision:WORLD_SCENE_CACHE_REVISION,terrain:{key}} as WorldSceneCache);
describe('derived scene IndexedDB adapter',()=>{
  it('stores building recipes separately and keeps their own 32 MiB cap',async()=>{
    const database=new IDBFactory(),jobs:Array<()=>void|Promise<void>>=[];
    const schedule=(_key:string,job:()=>void|Promise<void>)=>{jobs.push(job);return()=>{};};
    const scene=createWorldSceneCachePort('ocean-island',()=>1,schedule,database);
    const buildings=createBuildingCpuCachePort('ocean-island',()=>1024,schedule,database);
    scene.write(entry('terrain'));buildings.write({revision:1,recipes:[]});
    await jobs.shift()!();await jobs.shift()!();
    expect(await scene.read()).toEqual(entry('terrain'));expect(await buildings.read()).toEqual({revision:1,recipes:[]});
    const tooLarge=createBuildingCpuCachePort('ocean-island',()=>33*1024*1024,schedule,database);
    tooLarge.write({revision:1,recipes:[]});await jobs.shift()!();expect(jobs).toHaveLength(0);
    expect(await buildings.read()).toEqual({revision:1,recipes:[]});
  });
  function fixture(){
    const database=new IDBFactory(),jobs:Array<()=>void|Promise<void>>=[];
    const schedule=(_key:string,job:()=>void|Promise<void>)=>{jobs.push(job);return()=>{};};
    const port=(environment:'classic-island'|'ocean-island'|'mosaic-coast',size=1024)=>createWorldSceneCachePort(environment,()=>size,schedule,database);
    return {port,jobs,database};
  }
  it('does not serialize or open a database from the submitting command',async()=>{
    const f=fixture(),port=f.port('ocean-island');port.write(entry('saved'));
    expect(await port.read()).toBeNull();await f.jobs.shift()!();expect(await port.read()).toEqual(entry('saved'));
  });
  it('isolates environments and evicts the oldest within the total memory budget',async()=>{
    const f=fixture(),size=25*1024*1024;
    const a=f.port('classic-island',size),b=f.port('ocean-island',size),c=f.port('mosaic-coast',size);
    a.write(entry('a'));await f.jobs.shift()!();
    await new Promise(resolve=>setTimeout(resolve,2));b.write(entry('b'));await f.jobs.shift()!();
    await new Promise(resolve=>setTimeout(resolve,2));c.write(entry('c'));await f.jobs.shift()!();
    expect(await a.read()).toBeNull();expect(await b.read()).toEqual(entry('b'));expect(await c.read()).toEqual(entry('c'));
  });
  it('skips an oversize layout without replacing the previous usable cache',async()=>{
    const f=fixture(),port=f.port('ocean-island');port.write(entry('before'));await f.jobs.shift()!();
    f.port('ocean-island',65*1024*1024).write(entry('oversize'));await f.jobs.shift()!();expect(f.jobs).toHaveLength(0);
    expect(await port.read()).toEqual(entry('before'));
  });
  it('a quota/storage failure is contained and preserves the earlier transaction',async()=>{
    const f=fixture(),port=f.port('ocean-island');port.write(entry('before'));await f.jobs.shift()!();
    const fail=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementationOnce(()=>{throw new DOMException('full','QuotaExceededError');});
    try{port.write(entry('after'));await expect(Promise.resolve(f.jobs.shift()!())).resolves.toBeUndefined();}finally{fail.mockRestore();}
    expect(await port.read()).toEqual(entry('before'));
  });
  it('unavailable optional storage is a miss',async()=>{
    const port=createWorldSceneCachePort('ocean-island',()=>0,()=>()=>{},{open(){throw Error('disabled');}} as unknown as IDBFactory);
    expect(await port.read()).toBeNull();
  });
  it('a denied global storage getter does not prevent renderer creation',async()=>{
    const previous=Object.getOwnPropertyDescriptor(globalThis,'indexedDB');
    Object.defineProperty(globalThis,'indexedDB',{configurable:true,get(){throw new DOMException('denied','SecurityError');}});
    try{
      const port=createWorldSceneCachePort('ocean-island',()=>0,()=>()=>{});
      expect(await port.read()).toBeNull();
    }finally{
      if(previous)Object.defineProperty(globalThis,'indexedDB',previous);
      else Reflect.deleteProperty(globalThis,'indexedDB');
    }
  });
});

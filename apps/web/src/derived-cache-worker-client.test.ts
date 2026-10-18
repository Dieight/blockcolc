import {describe,expect,it,vi} from 'vitest';
import {createDerivedCacheWorkerClient} from './derived-cache-worker-client';
import {derivedCacheTransferBuffers} from './derived-cache-protocol';

const read={kind:'building',environment:'ocean-island',operation:'read'} as const;
function fixture(){
  const fake={postMessage:vi.fn(),terminate:vi.fn(),onmessage:null as ((event:MessageEvent)=>void)|null,onerror:null as ((event:ErrorEvent)=>void)|null,onmessageerror:null as (()=>void)|null};
  const factory=vi.fn(()=>fake as unknown as Worker),client=createDerivedCacheWorkerClient(factory);
  return {client,fake,factory,reply(id:number,value:unknown){fake.onmessage!({data:{id,ok:true,value}} as MessageEvent);}};
}
describe('derived cache worker ownership and lifetime',()=>{
  it('routes concurrent replies by ID, clones writes and releases an idle worker',async()=>{
    vi.useFakeTimers();const f=fixture();
    try{
      const first=f.client.request(read),second=f.client.request({...read,operation:'write',entry:{buffer:Float32Array.of(1,2)}});
      expect(f.fake.postMessage.mock.calls.every(call=>call.length===1)).toBe(true);
      f.reply(2,'second');f.reply(1,'first');expect(await first).toBe('first');expect(await second).toBe('second');
      await vi.advanceTimersByTimeAsync(30_000);expect(f.fake.terminate).toHaveBeenCalledTimes(1);
      const third=f.client.request(read);f.reply(3,null);expect(await third).toBeNull();expect(f.factory).toHaveBeenCalledTimes(2);
    }finally{f.client.dispose();vi.useRealTimers();}
  });
  it('rejects pending work on a timeout and never repeatedly retries a broken worker',async()=>{
    vi.useFakeTimers();const f=fixture();
    try{
      const pending=expect(f.client.request(read)).rejects.toThrow('unavailable');await vi.advanceTimersByTimeAsync(4000);await pending;
      await expect(f.client.request(read)).rejects.toThrow('unavailable');expect(f.factory).toHaveBeenCalledTimes(1);expect(f.fake.terminate).toHaveBeenCalledTimes(1);
    }finally{f.client.dispose();vi.useRealTimers();}
  });
  it('contains construction and postMessage errors without leaking a worker',async()=>{
    const denied=createDerivedCacheWorkerClient(()=>{throw new DOMException('denied','SecurityError');});
    await expect(denied.request(read)).rejects.toThrow('unavailable');denied.dispose();
    const f=fixture();f.fake.postMessage.mockImplementation(()=>{throw new DOMException('clone failed','DataCloneError');});
    await expect(f.client.request(read)).rejects.toThrow('unavailable');expect(f.fake.terminate).toHaveBeenCalledTimes(1);f.client.dispose();
  });
  it('deduplicates read-transfer buffers and preserves shared view identity',()=>{
    const buffer=new ArrayBuffer(64),view=new Float32Array(buffer),owner={view,other:new Uint8Array(buffer),map:new Map([['geometry',view]])};
    const list=derivedCacheTransferBuffers(owner);expect(list).toEqual([buffer]);
    const cloned=structuredClone(owner,{transfer:list});expect(view.byteLength).toBe(0);
    expect(cloned.view.buffer).toBe(cloned.other.buffer);expect(cloned.map.get('geometry')).toBe(cloned.view);
  });
});

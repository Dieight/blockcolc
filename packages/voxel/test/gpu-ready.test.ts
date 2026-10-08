import {describe,it,expect,vi} from 'vitest';
import {waitForGpuCompletion} from '../src/gpu-ready';
describe('startup GPU completion',()=>{
 function harness(results:number[]){const sync={};const gl={SYNC_GPU_COMMANDS_COMPLETE:1,ALREADY_SIGNALED:2,CONDITION_SATISFIED:3,WAIT_FAILED:4,fenceSync:vi.fn(()=>sync),flush:vi.fn(),clientWaitSync:vi.fn(()=>results.shift()??0),deleteSync:vi.fn()};return gl;}
 it('yields until the queued draw finishes and releases the fence',async()=>{const gl=harness([0,0,3]),wait=vi.fn(async()=>{});expect(await waitForGpuCompletion(gl as any,()=>true,wait)).toBe('complete');expect(wait).toHaveBeenCalledTimes(2);expect(gl.deleteSync).toHaveBeenCalledTimes(1);expect(gl.flush).toHaveBeenCalledOnce();});
 it('is bounded and releases resources on timeout, failure and backgrounding',async()=>{
  for(const expected of ['timeout','failed','cancelled'] as const){const gl=harness(expected==='failed'?[4]:[0]);let time=0;let live=true;const result=await waitForGpuCompletion(gl as any,()=>live,async()=>{time=10;if(expected==='cancelled')live=false;},()=>time,5);expect(result).toBe(expected);expect(gl.deleteSync).toHaveBeenCalledOnce();}
 });
 it('does not pretend WebGL1 has a completion fence',async()=>{expect(await waitForGpuCompletion({} as any,()=>true)).toBe('unsupported');});
});

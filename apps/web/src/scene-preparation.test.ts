import {describe,it,expect,vi} from 'vitest';
import {createScenePreparation} from './scene-preparation';

describe('saved settings and prepared renderer are separate lifetimes',()=>{
  it('holds loading until the matching renderer acknowledges readiness',async()=>{
    const changed=vi.fn(),preparation=createScenePreparation<string>(changed),done=vi.fn();
    const task=preparation.begin('coast').then(done);
    preparation.ready('valley');await Promise.resolve();expect(done).not.toHaveBeenCalled();
    expect(changed.mock.calls).toEqual([['coast']]);
    preparation.ready('coast');await task;
    expect(done).toHaveBeenCalledTimes(1);expect(changed.mock.calls).toEqual([['coast'],[null]]);
  });
  it('rejects a superseded wait and ignores its late failure/readiness',async()=>{
    const changed=vi.fn(),preparation=createScenePreparation<string>(changed);
    const old=preparation.begin('valley'),oldResult=expect(old).rejects.toThrow('superseded');
    const next=preparation.begin('coast');await oldResult;
    preparation.ready('valley');preparation.failed('valley');
    expect(changed.mock.calls.at(-1)).toEqual(['coast']);
    preparation.ready('coast');await expect(next).resolves.toBeUndefined();
  });
  it('clears ownership after failure, cancellation or timeout and permits a retry',async()=>{
    vi.useFakeTimers();
    try {
      const changed=vi.fn(),preparation=createScenePreparation<string>(changed,20);
      const failed=preparation.begin('coast');preparation.failed('coast');await expect(failed).rejects.toThrow('未完成');
      const cancelled=preparation.begin('valley');preparation.cancel();await expect(cancelled).rejects.toThrow('cancelled');
      const timed=preparation.begin('island'),result=expect(timed).rejects.toThrow('超时');await vi.advanceTimersByTimeAsync(20);await result;
      expect(changed.mock.calls.at(-1)).toEqual([null]);
      const retry=preparation.begin('island');preparation.ready('island');await expect(retry).resolves.toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {vi.useRealTimers();}
  });
});

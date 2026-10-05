import { describe, expect, it } from 'vitest';
import { initialEnvironmentPending, waitForInitialEnvironment, prepareInitialEnvironmentAndModule } from './initial-environment';
import { vi } from 'vitest';
import type { WorldWeatherView } from './use-world-weather';

describe('initial world environment preparation', () => {
  it('loads the module during the same provider wait, not after it', async () => {
    vi.useFakeTimers();
    try {
      let now=0,loaded=false;
      const ports={pending:()=>now<600,current:()=>true,visible:()=>true,now:()=>now,
        wait:(ms:number)=>new Promise<void>(resolve=>setTimeout(()=>{now+=ms;resolve();},ms))};
      const preparing=prepareInitialEnvironmentAndModule(ports,async()=>{loaded=true;await new Promise(resolve=>setTimeout(resolve,400));return 'world-module';});
      expect(loaded).toBe(true);
      await vi.advanceTimersByTimeAsync(600);
      const result=await preparing;
      expect(result).toMatchObject({module:'world-module',result:'ready',totalMs:600,environmentMs:600});
      expect(result.moduleMs).toBeLessThan(result.totalMs);
    } finally {vi.useRealTimers();}
  });
  it('waits for weather and astronomy independently, except when sync is disabled', () => {
    for (const syncState of ['not_synced', 'syncing', 'available', 'fallback'] as const) {
      for (const astronomySyncState of ['not_synced', 'syncing', 'calendar', 'ephemeris_only', 'unavailable'] as const) {
        const view = { syncState, astronomySyncState } as WorldWeatherView;
        expect(initialEnvironmentPending(false, view)).toBe(false);
        expect(initialEnvironmentPending(true, view)).toBe(
          ['not_synced', 'syncing'].includes(syncState) || ['not_synced', 'syncing'].includes(astronomySyncState));
      }
    }
  });
  it('finishes before reveal when data arrives and bounds offline waiting', async () => {
    let elapsed = 0;
    const ports = { pending: () => elapsed < 300, current: () => true, visible: () => true,
      now: () => elapsed, wait: async (ms: number) => { elapsed += ms; } };
    expect(await waitForInitialEnvironment(ports)).toBe('ready');
    expect(elapsed).toBe(300);
    elapsed = 0;
    expect(await waitForInitialEnvironment({ ...ports, pending: () => true }, 450)).toBe('timeout');
    expect(elapsed).toBe(450);
  });
  it('drops a replaced or hidden generation without waiting for a provider', async () => {
    let elapsed = 0;
    const ports = { pending: () => true, current: () => elapsed < 100, visible: () => true,
      now: () => elapsed, wait: async (ms: number) => { elapsed += ms; } };
    expect(await waitForInitialEnvironment(ports)).toBe('obsolete');
    expect(await waitForInitialEnvironment({ ...ports, current: () => true, visible: () => false })).toBe('hidden');
  });
});

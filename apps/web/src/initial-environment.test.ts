import { describe, expect, it } from 'vitest';
import { initialEnvironmentPending, waitForInitialEnvironment } from './initial-environment';
import type { WorldWeatherView } from './use-world-weather';

describe('initial world environment preparation', () => {
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

import type { WorldWeatherView } from './use-world-weather';

export function initialEnvironmentPending(enabled: boolean, view: WorldWeatherView): boolean {
  return enabled && (view.syncState === 'not_synced' || view.syncState === 'syncing'
    || view.astronomySyncState === 'not_synced' || view.astronomySyncState === 'syncing');
}

/** Initial provider reads share the loader; an offline request cannot hold it forever. */
export async function waitForInitialEnvironment(ports: {
  pending(): boolean; current(): boolean; visible(): boolean;
  now(): number; wait(ms: number): Promise<void>;
}, budgetMs = 8_000): Promise<'ready' | 'timeout' | 'hidden' | 'obsolete'> {
  const deadline = ports.now() + budgetMs;
  while (ports.current()) {
    if (!ports.visible()) return 'hidden';
    if (!ports.pending()) return 'ready';
    const remaining = deadline - ports.now();
    if (remaining <= 0) return 'timeout';
    await ports.wait(Math.min(100, remaining));
  }
  return 'obsolete';
}
